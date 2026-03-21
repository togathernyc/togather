/**
 * PCO Services Rotation Engine
 *
 * Manages automatic channel membership based on Planning Center Services schedules.
 * Adds members before their scheduled service and removes them after.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import {
  fetchUpcomingPlans,
  fetchPlanTeamMembers,
  getPersonContactInfo,
  getValidAccessToken,
} from "../../lib/pcoServicesApi";
import { getDisplayName, getMediaUrl } from "../../lib/utils";
import { applyFilters, deduplicateByPersonId, FilterableMember, PositionFilterInput } from "./filterHelpers";
import { updateChannelMemberCount } from "../messaging/helpers";

// ============================================================================
// Constants
// ============================================================================

/** Milliseconds in one day */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Default number of upcoming plans to fetch from PCO */
const DEFAULT_PLANS_LOOKAHEAD = 5;

// ============================================================================
// Filter Configuration Types
// ============================================================================

/**
 * Filter configuration for multi-service-type sync.
 * All fields are optional - empty/undefined means "include all".
 */
interface FilterConfig {
  serviceTypeIds?: string[];
  serviceTypeNames?: string[];
  teamIds?: string[];
  teamNames?: string[];
  // Support both strings and position objects with context
  positions?: PositionFilterInput[];
  statuses?: string[];
}

/**
 * Migrate legacy config format to filter-based format.
 * Legacy configs use serviceTypeId/syncScope/teamIds at the top level.
 * New configs use a filters object.
 *
 * @param config - The config object from autoChannelConfig
 * @returns Filter configuration, or null if no service types configured
 */
function migrateToFilterConfig(config: {
  filters?: FilterConfig;
  serviceTypeId?: string;
  serviceTypeName?: string;
  syncScope?: string;
  teamIds?: string[];
  teamNames?: string[];
}): FilterConfig | null {
  // If already using new format, return filters
  if (config.filters) {
    return config.filters;
  }

  // If no legacy serviceTypeId, cannot create filter config
  if (!config.serviceTypeId) {
    return null;
  }

  // Migrate from legacy format
  return {
    serviceTypeIds: [config.serviceTypeId],
    serviceTypeNames: config.serviceTypeName ? [config.serviceTypeName] : undefined,
    // Only include teamIds if not syncing all teams
    teamIds: config.syncScope !== "all_teams" ? config.teamIds : undefined,
    teamNames: config.teamNames,
    positions: undefined,
    statuses: undefined,
  };
}

/**
 * Get all active auto channel configs for PCO Services.
 */
export const getActiveAutoChannelConfigs = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("autoChannelConfigs")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .filter((q) => q.eq(q.field("integrationType"), "pco_services"))
      .collect();
  },
});

/**
 * Get auto channel config for a channel.
 */
export const getAutoChannelConfig = internalQuery({
  args: {
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("autoChannelConfigs")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .unique();
  },
});

/**
 * Get config by ID (internal query).
 */
export const getAutoChannelConfigById = internalQuery({
  args: {
    configId: v.id("autoChannelConfigs"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.configId);
  },
});

/**
 * Get all active auto-channel configs for a specific group.
 * Used to sync a user to PCO auto-channels when they join a group.
 */
export const getAutoChannelConfigsForGroup = internalQuery({
  args: {
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    // Get the chat channels for this group
    const channels = await ctx.db
      .query("chatChannels")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    const channelIds = channels.map((c) => c._id);

    // Get all active auto-channel configs
    const configs = await ctx.db
      .query("autoChannelConfigs")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .filter((q) => q.eq(q.field("integrationType"), "pco_services"))
      .collect();

    // Filter to configs for channels in this group
    return configs.filter((config) => channelIds.includes(config.channelId));
  },
});

/**
 * Check and sync a user to auto-channels when they join a group.
 * Called after a user is added to a group to immediately sync them to PCO channels.
 *
 * This is triggered with a small delay (2 seconds) to allow any PCO person linking
 * to complete first, ensuring the user can be matched to their PCO profile.
 */
export const checkAndSyncUserToAutoChannels = internalAction({
  args: {
    userId: v.id("users"),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    // Get all auto-channel configs for this group
    const configs = await ctx.runQuery(
      internal.functions.pcoServices.rotation.getAutoChannelConfigsForGroup,
      { groupId: args.groupId }
    );

    if (!configs || configs.length === 0) {
      return { synced: false, reason: "no_auto_channels" };
    }

    let syncedToChannels = 0;

    // For each config, run a sync to check if this user should be added
    // The sync logic will handle checking if the user is scheduled and adding them if so
    for (const config of configs) {
      try {
        await ctx.runAction(
          internal.functions.pcoServices.rotation.syncAutoChannel,
          { configId: config._id }
        );
        syncedToChannels++;
      } catch (error) {
        console.error(`Failed to sync auto-channel ${config._id}:`, error);
      }
    }

    return { synced: true, channelCount: syncedToChannels };
  },
});

/**
 * Add a member to a channel via PCO sync.
 * Uses syncSource and scheduledRemovalAt on chatChannelMembers.
 *
 * IMPORTANT: This function verifies the user is a group member before adding
 * them to the channel. Returns status to indicate success or failure reason.
 */
export const addChannelMember = internalMutation({
  args: {
    channelId: v.id("chatChannels"),
    userId: v.id("users"),
    syncEventId: v.string(), // PCO Plan ID
    scheduledRemovalAt: v.number(),
    // PCO name as fallback if user doesn't have name in Togather
    pcoName: v.optional(v.string()),
    // Optional sync metadata for display
    syncMetadata: v.optional(
      v.object({
        serviceTypeName: v.optional(v.string()),
        teamName: v.optional(v.string()),
        position: v.optional(v.string()),
        serviceDate: v.optional(v.number()),
        serviceName: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<{ success: boolean; reason?: string }> => {
    const now = Date.now();

    // Get the channel to find its groupId
    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      return { success: false, reason: "channel_not_found" };
    }

    // SAFEGUARD: Verify user is an active member of the primary group
    // or any accepted secondary group before adding to channel
    const primaryGroupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", channel.groupId).eq("userId", args.userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    let isInGroup = !!primaryGroupMembership;

    // If not in primary group, check accepted secondary groups
    if (!isInGroup && channel.isShared && channel.sharedGroups) {
      for (const sg of channel.sharedGroups) {
        if (sg.status !== "accepted") continue;
        const secondaryMembership = await ctx.db
          .query("groupMembers")
          .withIndex("by_group_user", (q) =>
            q.eq("groupId", sg.groupId).eq("userId", args.userId)
          )
          .filter((q) => q.eq(q.field("leftAt"), undefined))
          .first();
        if (secondaryMembership) {
          isInGroup = true;
          break;
        }
      }
    }

    if (!isInGroup) {
      // User is NOT an active member of any group on this channel
      return { success: false, reason: "not_in_group" };
    }

    // Check if user is already a member of the channel
    const existingMember = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", args.userId)
      )
      .unique();

    // Fetch user data for display name
    const user = await ctx.db.get(args.userId);

    // Build display name: prefer user's name in Togather, fallback to PCO name
    const userDisplayName = user ? getDisplayName(user.firstName, user.lastName) : null;
    const displayName = (userDisplayName && userDisplayName !== "Anonymous")
      ? userDisplayName
      : (args.pcoName || "Unknown");

    if (existingMember) {
      // Update the sync info if already a member
      // Update scheduledRemovalAt to the later date if scheduled for multiple services
      const newRemovalAt = Math.max(
        existingMember.scheduledRemovalAt || 0,
        args.scheduledRemovalAt
      );

      // Update display name if it was missing or "Unknown"
      const shouldUpdateName = !existingMember.displayName || existingMember.displayName === "Unknown";

      // Check if we're re-adding a member who had left
      const wasLeft = existingMember.leftAt !== undefined;

      // Clear leftAt to "re-add" them if they had left, and update sync info
      await ctx.db.patch(existingMember._id, {
        syncSource: "pco_services",
        syncEventId: args.syncEventId,
        scheduledRemovalAt: newRemovalAt,
        syncMetadata: args.syncMetadata,
        displayName: shouldUpdateName ? displayName : existingMember.displayName,
        leftAt: undefined, // Clear leftAt to re-add if they had left
      });

      // If we re-added a member who had left, update the member count
      if (wasLeft) {
        await updateChannelMemberCount(ctx, args.channelId);
      }

      return { success: true };
    }

    // Add to chatChannelMembers with sync tracking and display info
    await ctx.db.insert("chatChannelMembers", {
      channelId: args.channelId,
      userId: args.userId,
      role: "member",
      joinedAt: now,
      isMuted: false,
      syncSource: "pco_services",
      syncEventId: args.syncEventId,
      scheduledRemovalAt: args.scheduledRemovalAt,
      syncMetadata: args.syncMetadata,
      // Denormalized user info for display
      displayName,
      profilePhoto: user?.profilePhoto ? getMediaUrl(user.profilePhoto) : undefined,
    });

    // Update member count by recomputing from actual membership records (avoids race conditions)
    await updateChannelMemberCount(ctx, args.channelId);

    return { success: true };
  },
});

/**
 * Remove PCO-synced channel members who are not in the roster returned by the
 * current sync. PCO is the source of truth: if someone is unscheduled or moved
 * off the team before scheduledRemovalAt, they should still leave the channel.
 *
 * Only affects members with syncSource === "pco_services"; manual members are untouched.
 */
export const removeStalePcoSyncedMembers = internalMutation({
  args: {
    channelId: v.id("chatChannels"),
    /** Users who appear on the current PCO roster for this channel (and were added successfully). */
    expectedUserIds: v.array(v.id("users")),
  },
  handler: async (ctx, args): Promise<{ removedCount: number }> => {
    const now = Date.now();
    const expected = new Set(args.expectedUserIds);

    const pcoMembers = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .filter((q) =>
        q.and(
          q.eq(q.field("syncSource"), "pco_services"),
          q.eq(q.field("leftAt"), undefined)
        )
      )
      .collect();

    let removedCount = 0;

    for (const member of pcoMembers) {
      if (!expected.has(member.userId)) {
        await ctx.db.patch(member._id, {
          leftAt: now,
          scheduledRemovalAt: undefined,
        });
        removedCount++;
      }
    }

    if (removedCount > 0) {
      await updateChannelMemberCount(ctx, args.channelId);
    }

    return { removedCount };
  },
});

/**
 * Remove members whose scheduled removal time has passed.
 */
export const removeExpiredMembers = internalMutation({
  args: {
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get all PCO-synced members that should be removed
    const membersToRemove = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .filter((q) =>
        q.and(
          q.eq(q.field("syncSource"), "pco_services"),
          q.neq(q.field("scheduledRemovalAt"), undefined),
          q.lte(q.field("scheduledRemovalAt"), now)
        )
      )
      .collect();

    let removedCount = 0;

    for (const member of membersToRemove) {
      // Use soft delete (leftAt) to match the codebase pattern
      // This allows addChannelMember to detect and re-add members who had left
      await ctx.db.patch(member._id, {
        leftAt: now,
        scheduledRemovalAt: undefined, // Clear the scheduled removal flag
      });
      removedCount++;
    }

    // Update member count by recomputing from active membership records (avoids race conditions)
    if (removedCount > 0) {
      await updateChannelMemberCount(ctx, args.channelId);
    }

    return { removedCount };
  },
});

/**
 * Remove PCO-synced members whose sync metadata no longer matches the current filter configuration.
 * This handles the case where filters are updated and existing members should be removed.
 *
 * Checks:
 * - syncMetadata.teamName against config.teamNames or config.filters.teamNames
 * - syncMetadata.position against config.filters.positions
 *
 * Only removes members with syncSource === "pco_services".
 * Manually added members (no syncSource) are never removed.
 */
export const removeNonMatchingMembers = internalMutation({
  args: {
    channelId: v.id("chatChannels"),
    configId: v.id("autoChannelConfigs"),
  },
  handler: async (ctx, args): Promise<{ removedCount: number }> => {
    const now = Date.now();

    // Get the current config
    const config = await ctx.db.get(args.configId);
    if (!config || !config.isActive) {
      return { removedCount: 0 };
    }

    const pcoConfig = config.config as {
      teamIds?: string[];
      teamNames?: string[];
      syncScope?: string;
      filters?: {
        teamIds?: string[];
        teamNames?: string[];
        positions?: Array<string | { name: string; teamId?: string }>;
      };
    };

    // Extract filter criteria from config
    // Check both legacy format (teamNames at root) and new format (filters.teamNames)
    const filterTeamNames: string[] = [];
    if (pcoConfig.filters?.teamNames?.length) {
      filterTeamNames.push(...pcoConfig.filters.teamNames);
    } else if (pcoConfig.teamNames?.length && pcoConfig.syncScope !== "all_teams") {
      filterTeamNames.push(...pcoConfig.teamNames);
    }

    // Extract position filters (normalize to strings)
    const filterPositions: string[] = [];
    if (pcoConfig.filters?.positions?.length) {
      for (const pos of pcoConfig.filters.positions) {
        if (typeof pos === "string") {
          filterPositions.push(pos);
        } else if (pos.name) {
          filterPositions.push(pos.name);
        }
      }
    }

    // If no filters are set, don't remove anyone
    const hasTeamFilter = filterTeamNames.length > 0;
    const hasPositionFilter = filterPositions.length > 0;
    if (!hasTeamFilter && !hasPositionFilter) {
      return { removedCount: 0 };
    }

    // Get all active PCO-synced members for this channel
    const pcoMembers = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .filter((q) =>
        q.and(
          q.eq(q.field("syncSource"), "pco_services"),
          q.eq(q.field("leftAt"), undefined)
        )
      )
      .collect();

    let removedCount = 0;

    for (const member of pcoMembers) {
      const metadata = member.syncMetadata as {
        teamName?: string;
        position?: string;
      } | undefined;

      // Check if member matches current filters
      let matchesFilters = true;

      // Check team filter
      if (hasTeamFilter) {
        const memberTeam = metadata?.teamName;
        if (!memberTeam || !filterTeamNames.includes(memberTeam)) {
          matchesFilters = false;
        }
      }

      // Check position filter (only if team filter passed or no team filter)
      if (matchesFilters && hasPositionFilter) {
        const memberPosition = metadata?.position;
        if (!memberPosition || !filterPositions.includes(memberPosition)) {
          matchesFilters = false;
        }
      }

      // Remove member if they don't match filters
      if (!matchesFilters) {
        await ctx.db.patch(member._id, {
          leftAt: now,
          scheduledRemovalAt: undefined,
        });
        removedCount++;
      }
    }

    // Update member count if any members were removed
    if (removedCount > 0) {
      await updateChannelMemberCount(ctx, args.channelId);
    }

    return { removedCount };
  },
});

/**
 * Update the sync status of an auto channel config.
 */
export const updateSyncStatus = internalMutation({
  args: {
    configId: v.id("autoChannelConfigs"),
    status: v.string(),
    error: v.optional(v.string()),
    currentEventId: v.optional(v.string()),
    currentEventDate: v.optional(v.number()),
    syncResults: v.optional(
      v.object({
        matchedCount: v.number(),
        unmatchedCount: v.number(),
        unmatchedPeople: v.optional(
          v.array(
            v.object({
              pcoPersonId: v.string(),
              pcoName: v.string(),
              pcoPhone: v.optional(v.string()),
              pcoEmail: v.optional(v.string()),
              serviceTypeName: v.optional(v.string()),
              teamName: v.optional(v.string()),
              position: v.optional(v.string()),
              reason: v.string(),
            })
          )
        ),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.configId, {
      lastSyncAt: now,
      lastSyncStatus: args.status,
      lastSyncError: args.error,
      currentEventId: args.currentEventId,
      currentEventDate: args.currentEventDate,
      lastSyncResults: args.syncResults,
      updatedAt: now,
    });
  },
});

// Result type for syncAutoChannel
type SyncAutoChannelResult =
  | { status: "skipped"; reason: string }
  | { status: "success"; addedCount: number; removedCount: number }
  | {
      status: "success";
      addedCount: number;
      removedCount: number;
      planId: string;
      planDate: string;
    }
  | {
      status: "success";
      addedCount: number;
      removedCount: number;
      syncedServices: Array<{ serviceTypeId: string; planId: string; planDate: string }>;
    };

/**
 * Sync a single auto channel - the main rotation action.
 * Supports both legacy single-service-type configs and new filter-based multi-service configs.
 */
export const syncAutoChannel = internalAction({
  args: {
    configId: v.id("autoChannelConfigs"),
  },
  handler: async (ctx, args): Promise<SyncAutoChannelResult> => {
    // Get the config
    const config = await ctx.runQuery(
      internal.functions.pcoServices.rotation.getAutoChannelConfigById,
      { configId: args.configId }
    );

    if (!config || !config.isActive) {
      return { status: "skipped", reason: "Config not found or inactive" };
    }

    if (config.integrationType !== "pco_services") {
      return { status: "skipped", reason: "Not a PCO Services config" };
    }

    const pcoConfig = config.config;

    // Migrate to filter-based config (handles both legacy and new formats)
    const filters = migrateToFilterConfig(pcoConfig);

    // Get service type IDs to process
    const serviceTypeIds = filters?.serviceTypeIds?.length
      ? filters.serviceTypeIds
      : pcoConfig.serviceTypeId ? [pcoConfig.serviceTypeId] : [];

    if (serviceTypeIds.length === 0) {
      return { status: "skipped", reason: "No service type configured" };
    }

    try {
      // Get access token
      const accessToken = await getValidAccessToken(ctx, config.communityId);

      // Step 1a: Remove expired members (scheduled removal time passed)
      const removeExpiredResult = await ctx.runMutation(
        internal.functions.pcoServices.rotation.removeExpiredMembers,
        { channelId: config.channelId }
      );

      // Step 1b: Remove members who no longer match current filters
      // This handles filter changes - members added under old filters should be removed
      const removeNonMatchingResult = await ctx.runMutation(
        internal.functions.pcoServices.rotation.removeNonMatchingMembers,
        { channelId: config.channelId, configId: args.configId }
      );

      // Combine removal counts for reporting
      const totalRemoved = removeExpiredResult.removedCount + removeNonMatchingResult.removedCount;

      // Validate config timing values before using them
      const addMembersDaysBefore = pcoConfig.addMembersDaysBefore ?? 0;
      const removeMembersDaysAfter = pcoConfig.removeMembersDaysAfter ?? 0;

      if (addMembersDaysBefore < 0 || removeMembersDaysAfter < 0) {
        await ctx.runMutation(
          internal.functions.pcoServices.rotation.updateSyncStatus,
          {
            configId: args.configId,
            status: "error",
            error: "Invalid timing config: days values must be non-negative",
          }
        );
        return { status: "skipped", reason: "Invalid timing configuration" };
      }

      const now = Date.now();
      const addWindowMs = addMembersDaysBefore * MS_PER_DAY;
      const removeWindowMs = removeMembersDaysAfter * MS_PER_DAY;

      // Step 2: Collect members from all service types within the add window
      const allMembers: FilterableMember[] = [];
      const syncedServices: Array<{ serviceTypeId: string; planId: string; planDate: string }> = [];

      // Build a map from serviceTypeId to serviceTypeName for display
      const serviceTypeNameMap = new Map<string, string>();
      if (filters?.serviceTypeNames && filters.serviceTypeIds) {
        for (let i = 0; i < filters.serviceTypeIds.length; i++) {
          const id = filters.serviceTypeIds[i];
          const name = filters.serviceTypeNames[i];
          if (id && name) {
            serviceTypeNameMap.set(id, name);
          }
        }
      }

      for (const serviceTypeId of serviceTypeIds) {
        // Get upcoming plans for this service type
        const plans = await fetchUpcomingPlans(
          accessToken,
          serviceTypeId,
          DEFAULT_PLANS_LOOKAHEAD
        );

        if (plans.length === 0) {
          continue;
        }

        // Find the plan within the add window
        let targetPlan: (typeof plans)[0] & { planDateMs: number } | null = null;
        for (const plan of plans) {
          const planDate = new Date(plan.attributes.sort_date).getTime();
          const addDate = planDate - addWindowMs;

          // Check if we're in the add window for this plan
          if (now >= addDate) {
            targetPlan = { ...plan, planDateMs: planDate };
            break;
          }
        }

        if (!targetPlan) {
          continue;
        }

        // Track synced service
        syncedServices.push({
          serviceTypeId,
          planId: targetPlan.id,
          planDate: targetPlan.attributes.sort_date,
        });

        // Determine teamIds for fetching members
        // For filter-based config, use filters.teamIds
        // For legacy config, check syncScope
        let teamIds: string[] | undefined = undefined;
        if (filters?.teamIds && filters.teamIds.length > 0) {
          teamIds = filters.teamIds;
        } else if (pcoConfig.syncScope !== "all_teams" && pcoConfig.teamIds?.length) {
          teamIds = pcoConfig.teamIds;
        }

        // Fetch team members for this plan
        const members = await fetchPlanTeamMembers(
          accessToken,
          serviceTypeId,
          targetPlan.id,
          teamIds
        );

        // Calculate scheduled removal date for this plan
        const scheduledRemovalAt = targetPlan.planDateMs + removeWindowMs;

        // Extract service name from plan title or date
        const serviceName = targetPlan.attributes.title ||
          new Date(targetPlan.planDateMs).toLocaleDateString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
          });

        // Transform to FilterableMember format
        const serviceTypeName = serviceTypeNameMap.get(serviceTypeId);
        for (const member of members) {
          allMembers.push({
            pcoPersonId: member.pcoPersonId,
            name: member.name,
            position: member.position,
            teamId: member.teamId,
            teamName: member.teamName,
            status: member.status,
            scheduledRemovalAt,
            serviceTypeId,
            serviceTypeName,
            planId: targetPlan.id,
            planDate: targetPlan.planDateMs,
          });
        }
      }

      if (allMembers.length === 0) {
        // We are inside the add window for at least one plan (syncedServices) but
        // nobody is scheduled — drop anyone still in the channel from a prior sync.
        let staleRemoved = 0;
        if (syncedServices.length > 0) {
          const staleResult = await ctx.runMutation(
            internal.functions.pcoServices.rotation.removeStalePcoSyncedMembers,
            {
              channelId: config.channelId,
              expectedUserIds: [],
            }
          );
          staleRemoved = staleResult.removedCount;
        }

        await ctx.runMutation(
          internal.functions.pcoServices.rotation.updateSyncStatus,
          {
            configId: args.configId,
            status: "success",
            // Note: "No plans within add window" is informational, not an error
          }
        );
        return {
          status: "success",
          addedCount: 0,
          removedCount: totalRemoved + staleRemoved,
        };
      }

      // Step 3: Apply filters (teamIds already filtered at API level in fetchPlanTeamMembers)
      const filteredMembers = applyFilters(allMembers, {
        // Note: teamIds omitted - already filtered when fetching from PCO API
        positions: filters?.positions,
        statuses: filters?.statuses,
      });

      // Step 4: Deduplicate across services (same person scheduled in multiple services)
      const uniqueMembers = deduplicateByPersonId(filteredMembers);

      // Step 5: Add members to channel and track unmatched
      let addedCount = 0;
      const expectedUserIds = new Set<Id<"users">>();
      const unmatchedPeople: Array<{
        pcoPersonId: string;
        pcoName: string;
        pcoPhone?: string;
        pcoEmail?: string;
        serviceTypeName?: string;
        teamName?: string;
        position?: string;
        reason: string;
      }> = [];

      // Filter to members with valid pcoPersonId
      const membersToProcess = uniqueMembers.filter((m) => m.pcoPersonId);

      // Batch fetch contact info for all members in chunks of 15
      // PCO rate limit is 100 requests per 20 seconds, so 15 concurrent is safe
      const BATCH_SIZE = 15;
      const contactInfoMap = new Map<
        string,
        { name: string; phone: string | null; email: string | null }
      >();

      for (let i = 0; i < membersToProcess.length; i += BATCH_SIZE) {
        const batch = membersToProcess.slice(i, i + BATCH_SIZE);
        const contactPromises = batch.map(async (member) => {
          const contact = await getPersonContactInfo(
            accessToken,
            member.pcoPersonId!
          );
          return { pcoPersonId: member.pcoPersonId!, contact };
        });

        const batchResults = await Promise.all(contactPromises);
        for (const { pcoPersonId, contact } of batchResults) {
          contactInfoMap.set(pcoPersonId, contact);
        }
      }

      // Now process each member with the pre-fetched contact info
      for (const member of membersToProcess) {
        const pcoPersonId = member.pcoPersonId!;
        const contact = contactInfoMap.get(pcoPersonId)!;

        // Match and link the PCO person to a Together user
        const matchResult = await ctx.runMutation(
          internal.functions.pcoServices.matching.matchAndLinkPcoPerson,
          {
            communityId: config.communityId,
            pcoPersonId,
            pcoPhone: contact.phone || undefined,
            pcoEmail: contact.email || undefined,
          }
        );

        // Build service name for this member's plan
        const serviceName = member.planDate
          ? new Date(member.planDate).toLocaleDateString("en-US", {
              weekday: "long",
              month: "short",
              day: "numeric",
            })
          : "Service";

        if (matchResult.userId) {
          // Try to add to channel with sync metadata and PCO name as fallback
          const addResult = await ctx.runMutation(
            internal.functions.pcoServices.rotation.addChannelMember,
            {
              channelId: config.channelId,
              userId: matchResult.userId,
              syncEventId: member.planId || "unknown",
              scheduledRemovalAt: member.scheduledRemovalAt,
              pcoName: contact.name, // Use PCO name as fallback if user doesn't have name in Togather
              syncMetadata: {
                serviceTypeName: member.serviceTypeName || undefined,
                teamName: member.teamName || undefined,
                position: member.position || undefined,
                serviceDate: member.planDate,
                serviceName,
              },
            }
          );

          if (addResult.success) {
            addedCount++;
            expectedUserIds.add(matchResult.userId);
          } else {
            // User was matched but couldn't be added to channel (e.g., not in group)
            unmatchedPeople.push({
              pcoPersonId,
              pcoName: contact.name,
              pcoPhone: contact.phone || undefined,
              pcoEmail: contact.email || undefined,
              serviceTypeName: member.serviceTypeName || undefined,
              teamName: member.teamName || undefined,
              position: member.position || undefined,
              reason: addResult.reason || "unknown",
            });
          }
        } else {
          // Track unmatched person with their PCO info
          let reason = "not_in_community";
          if (!contact.phone && !contact.email) {
            reason = "no_contact_info";
          } else if (matchResult.status === "not_found") {
            reason = contact.phone ? "phone_mismatch" : "email_mismatch";
          }

          unmatchedPeople.push({
            pcoPersonId,
            pcoName: contact.name,
            pcoPhone: contact.phone || undefined,
            pcoEmail: contact.email || undefined,
            serviceTypeName: member.serviceTypeName || undefined,
            teamName: member.teamName || undefined,
            position: member.position || undefined,
            reason,
          });
        }
      }

      // Step 6: Remove PCO-synced members who are no longer on the roster returned
      // above (handles role changes, unscheduling, and filter narrowing).
      let staleRemoved = 0;
      if (syncedServices.length > 0) {
        const staleResult = await ctx.runMutation(
          internal.functions.pcoServices.rotation.removeStalePcoSyncedMembers,
          {
            channelId: config.channelId,
            expectedUserIds: Array.from(expectedUserIds),
          }
        );
        staleRemoved = staleResult.removedCount;
      }

      const totalRemovedWithStale = totalRemoved + staleRemoved;

      // Update sync status with results
      // For multi-service sync, use the first synced service for currentEventId/currentEventDate
      const firstSyncedService = syncedServices[0];
      await ctx.runMutation(
        internal.functions.pcoServices.rotation.updateSyncStatus,
        {
          configId: args.configId,
          status: "success",
          currentEventId: firstSyncedService?.planId,
          currentEventDate: firstSyncedService
            ? new Date(firstSyncedService.planDate).getTime()
            : undefined,
          syncResults: {
            matchedCount: addedCount,
            unmatchedCount: unmatchedPeople.length,
            unmatchedPeople: unmatchedPeople.length > 0 ? unmatchedPeople : undefined,
          },
        }
      );

      // Return result with multi-service info if applicable
      if (syncedServices.length > 1) {
        return {
          status: "success",
          addedCount,
          removedCount: totalRemovedWithStale,
          syncedServices,
        };
      } else if (syncedServices.length === 1) {
        return {
          status: "success",
          addedCount,
          removedCount: totalRemovedWithStale,
          planId: syncedServices[0].planId,
          planDate: syncedServices[0].planDate,
        };
      }

      return {
        status: "success",
        addedCount,
        removedCount: totalRemovedWithStale,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await ctx.runMutation(
        internal.functions.pcoServices.rotation.updateSyncStatus,
        {
          configId: args.configId,
          status: "error",
          error: errorMessage,
        }
      );
      throw error;
    }
  },
});

// Result type for processAllAutoChannels
type ProcessAllResult = {
  processed: number;
  results: Array<{
    configId: Id<"autoChannelConfigs">;
    status?: string;
    error?: string;
    addedCount?: number;
    removedCount?: number;
    planId?: string;
    planDate?: string;
    reason?: string;
  }>;
};

/**
 * Process all active auto channels - called by cron job.
 */
export const processAllAutoChannels = internalAction({
  args: {},
  handler: async (ctx): Promise<ProcessAllResult> => {
    const configs = await ctx.runQuery(
      internal.functions.pcoServices.rotation.getActiveAutoChannelConfigs,
      {}
    );

    const results: ProcessAllResult["results"] = [];
    for (const config of configs) {
      try {
        const result = await ctx.runAction(
          internal.functions.pcoServices.rotation.syncAutoChannel,
          { configId: config._id }
        );
        results.push({ configId: config._id, ...result });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        results.push({
          configId: config._id,
          status: "error",
          error: errorMessage,
        });
      }
    }

    return { processed: results.length, results };
  },
});
