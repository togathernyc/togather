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
import { Doc, Id } from "../../_generated/dataModel";
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
  handler: async (
    ctx,
    args
  ): Promise<
    | { synced: false; reason: string }
    | {
        synced: true;
        channelCount: number;
        failedConfigIds?: string[];
      }
  > => {
    // Get all auto-channel configs for this group
    const configs = await ctx.runQuery(
      internal.functions.pcoServices.rotation.getAutoChannelConfigsForGroup,
      { groupId: args.groupId }
    );

    if (!configs || configs.length === 0) {
      return { synced: false, reason: "no_auto_channels" };
    }

    // All configs in a group belong to the same community.
    const communityId = configs[0].communityId;

    // Single batched call shares plan/contact fetches across all configs in
    // the group, instead of N separate syncs that each re-hit PCO.
    let batched: CommunitySyncResult;
    try {
      batched = await ctx.runAction(
        internal.functions.pcoServices.rotation.syncCommunityAutoChannels,
        { communityId, configIds: configs.map((c) => c._id) }
      );
    } catch (error) {
      console.error(
        `Failed to sync auto-channels for group ${args.groupId}:`,
        error
      );
      return {
        synced: true,
        channelCount: 0,
        failedConfigIds: configs.map((c) => c._id),
      };
    }

    let syncedToChannels = 0;
    const failedConfigIds: string[] = [];
    for (const r of batched.results) {
      if (r.status === "error") {
        console.error(
          `Failed to sync auto-channel ${r.configId}:`,
          r.error
        );
        failedConfigIds.push(r.configId);
      } else {
        // Both "skipped" and "success" count as a successful sync attempt,
        // matching the legacy behavior where syncAutoChannel returning a
        // skip didn't count as a failure.
        syncedToChannels++;
      }
    }

    return {
      synced: true,
      channelCount: syncedToChannels,
      failedConfigIds: failedConfigIds.length > 0 ? failedConfigIds : undefined,
    };
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
    if (!channel.groupId) {
      return { success: false, reason: "channel_not_found" }; // Skip ad-hoc channels (DM/group_dm)
    }
    const groupId = channel.groupId;

    // SAFEGUARD: Verify user is an active member of the primary group
    // or any accepted secondary group before adding to channel
    const primaryGroupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", args.userId)
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
 * Per-config result returned by syncCommunityAutoChannels.
 * Mirrors the shape of SyncAutoChannelResult plus configId, plus
 * "error" status used when an individual config fails mid-batch.
 */
type PerConfigResult =
  | { configId: Id<"autoChannelConfigs">; status: "skipped"; reason: string }
  | {
      configId: Id<"autoChannelConfigs">;
      status: "success";
      addedCount: number;
      removedCount: number;
    }
  | {
      configId: Id<"autoChannelConfigs">;
      status: "success";
      addedCount: number;
      removedCount: number;
      planId: string;
      planDate: string;
    }
  | {
      configId: Id<"autoChannelConfigs">;
      status: "success";
      addedCount: number;
      removedCount: number;
      syncedServices: Array<{ serviceTypeId: string; planId: string; planDate: string }>;
    }
  | {
      configId: Id<"autoChannelConfigs">;
      status: "error";
      error: string;
    };

type CommunitySyncResult = {
  processed: number;
  results: PerConfigResult[];
};

type AutoChannelConfigDoc = Doc<"autoChannelConfigs">;

/**
 * Batched community-level PCO Services sync.
 *
 * The cron job used to call syncAutoChannel(configId) per channel, which made
 * each config independently re-fetch upcoming plans, team members, and per-person
 * contact info from PCO. With several configs in a community sharing the same
 * service types, cumulative API calls inside PCO's 100/20s rate limit window
 * blew past the threshold and triggered HTTP 429s.
 *
 * This action fetches each (serviceType, plan) and each person's contact info
 * exactly once per community per sync, then dispatches matched members into
 * each config's channel using in-memory filtering. The fix is volume reduction —
 * there is no retry/backoff logic.
 *
 * If `configIds` is provided, only those configs are synced (still using shared
 * caches); otherwise all active PCO configs for the community are synced.
 */
export const syncCommunityAutoChannels = internalAction({
  args: {
    communityId: v.id("communities"),
    configIds: v.optional(v.array(v.id("autoChannelConfigs"))),
  },
  handler: async (ctx, args): Promise<CommunitySyncResult> => {
    // Step 1: Load configs for the community.
    let configs: AutoChannelConfigDoc[];
    if (args.configIds && args.configIds.length > 0) {
      const loaded = await Promise.all(
        args.configIds.map((id) =>
          ctx.runQuery(
            internal.functions.pcoServices.rotation.getAutoChannelConfigById,
            { configId: id }
          )
        )
      );
      configs = loaded.filter(
        (c): c is AutoChannelConfigDoc =>
          !!c &&
          c.isActive === true &&
          c.integrationType === "pco_services" &&
          c.communityId === args.communityId
      );
    } else {
      const all = await ctx.runQuery(
        internal.functions.pcoServices.rotation.getActiveAutoChannelConfigs,
        {}
      );
      configs = all.filter((c) => c.communityId === args.communityId);
    }

    if (configs.length === 0) {
      return { processed: 0, results: [] };
    }

    // Per-config preflight: timing validation + channel-scoped removal mutations.
    // We defer the PCO access-token fetch until we know at least one config
    // has serviceTypeIds — otherwise a community without an active PCO
    // integration would fail before we can return a clean "skipped" result.
    // We track per-config working state so we can fall through to dispatch later.
    type ConfigContext = {
      config: AutoChannelConfigDoc;
      filters: FilterConfig | null;
      serviceTypeIds: string[];
      addMembersDaysBefore: number;
      removeMembersDaysAfter: number;
      addWindowMs: number;
      removeWindowMs: number;
      preflightRemoved: number;
      serviceTypeNameMap: Map<string, string>;
    };

    const contexts: ConfigContext[] = [];
    const earlyResults: PerConfigResult[] = [];

    for (const config of configs) {
      const pcoConfig = config.config;
      const filters = migrateToFilterConfig(pcoConfig);

      const serviceTypeIds = filters?.serviceTypeIds?.length
        ? filters.serviceTypeIds
        : pcoConfig.serviceTypeId
          ? [pcoConfig.serviceTypeId]
          : [];

      if (serviceTypeIds.length === 0) {
        earlyResults.push({
          configId: config._id,
          status: "skipped",
          reason: "No service type configured",
        });
        continue;
      }

      // Step 3 (per-config): Run channel-scoped cleanup mutations. Not PCO
      // API calls, so no rate-limit cost. Wrapped per-config so a transient
      // failure (e.g., updateChannelMemberCount patching a deleted channel
      // mid-run) only fails THIS config — the rest of the community keeps
      // syncing instead of aborting the whole batch.
      let preflightRemoved: number;
      try {
        const removeExpiredResult = await ctx.runMutation(
          internal.functions.pcoServices.rotation.removeExpiredMembers,
          { channelId: config.channelId }
        );
        const removeNonMatchingResult = await ctx.runMutation(
          internal.functions.pcoServices.rotation.removeNonMatchingMembers,
          { channelId: config.channelId, configId: config._id }
        );
        preflightRemoved =
          removeExpiredResult.removedCount + removeNonMatchingResult.removedCount;
      } catch (preflightError) {
        const errorMessage =
          preflightError instanceof Error
            ? preflightError.message
            : "Unknown error";
        // Best-effort status write — same delete-mid-run guard as elsewhere.
        try {
          await ctx.runMutation(
            internal.functions.pcoServices.rotation.updateSyncStatus,
            { configId: config._id, status: "error", error: errorMessage }
          );
        } catch {
          // Swallow.
        }
        earlyResults.push({
          configId: config._id,
          status: "error",
          error: errorMessage,
        });
        continue;
      }

      // Validate timing config.
      const addMembersDaysBefore = pcoConfig.addMembersDaysBefore ?? 0;
      const removeMembersDaysAfter = pcoConfig.removeMembersDaysAfter ?? 0;
      if (addMembersDaysBefore < 0 || removeMembersDaysAfter < 0) {
        await ctx.runMutation(
          internal.functions.pcoServices.rotation.updateSyncStatus,
          {
            configId: config._id,
            status: "error",
            error: "Invalid timing config: days values must be non-negative",
          }
        );
        earlyResults.push({
          configId: config._id,
          status: "skipped",
          reason: "Invalid timing configuration",
        });
        continue;
      }

      // Build serviceTypeId -> serviceTypeName map for display.
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

      contexts.push({
        config,
        filters,
        serviceTypeIds,
        addMembersDaysBefore,
        removeMembersDaysAfter,
        addWindowMs: addMembersDaysBefore * MS_PER_DAY,
        removeWindowMs: removeMembersDaysAfter * MS_PER_DAY,
        preflightRemoved,
        serviceTypeNameMap,
      });
    }

    // If every config was skipped, we have no PCO work to do — return early
    // without acquiring an access token (which would fail for communities
    // without an active PCO integration).
    if (contexts.length === 0) {
      return { processed: earlyResults.length, results: earlyResults };
    }

    // Hoist shared-phase state so the per-config dispatch below can read it
    // on the success path. Populated inside the try block; on shared-phase
    // failure we fall through to the catch and mark every surviving config
    // as errored before returning.
    type TargetPlan = {
      planId: string;
      planDateMs: number;
      planDateStr: string;
    };
    type ConfigPlanSelection = {
      perServiceType: Map<string, TargetPlan>;
      syncedServices: Array<{ serviceTypeId: string; planId: string; planDate: string }>;
    };
    type MatchResult = {
      userId: Id<"users"> | null;
      status: "already_linked" | "matched" | "not_found";
    };

    const plansByServiceType = new Map<
      string,
      Awaited<ReturnType<typeof fetchUpcomingPlans>>
    >();
    const membersByPlan = new Map<
      string,
      Awaited<ReturnType<typeof fetchPlanTeamMembers>>
    >();
    const contactByPerson = new Map<
      string,
      { name: string; phone: string | null; email: string | null }
    >();
    const matchByPerson = new Map<string, MatchResult>();
    const configPlanSelections = new Map<
      Id<"autoChannelConfigs">,
      ConfigPlanSelection
    >();
    // Per-config filtered roster, populated after fetching plan members. We
    // only call matchAndLinkPcoPerson on people who survive at least one
    // config's filters — without this, we'd write Planning Center person↔user
    // links for people excluded from every channel (declined status, wrong
    // team, etc.) and add unnecessary mutation load.
    const filteredMembersByConfig = new Map<
      Id<"autoChannelConfigs">,
      FilterableMember[]
    >();

    try {
      // Now that we know there's PCO work to do, get one access token for the
      // whole community.
      const accessToken = await getValidAccessToken(ctx, args.communityId);

      // Step 4: Compute the union of serviceTypeIds across surviving configs.
      const serviceTypeUnion = new Set<string>();
      for (const ctxItem of contexts) {
        for (const id of ctxItem.serviceTypeIds) {
          serviceTypeUnion.add(id);
        }
      }

      // Step 5: Fetch upcoming plans once per unique service type.
      for (const serviceTypeId of serviceTypeUnion) {
        const plans = await fetchUpcomingPlans(
          accessToken,
          serviceTypeId,
          DEFAULT_PLANS_LOOKAHEAD
        );
        plansByServiceType.set(serviceTypeId, plans);
      }

      // For each config, compute its target plan per service type using its own
      // add window. Cache so we don't recompute later.
      const now = Date.now();
      const planFetchSet = new Set<string>(); // "serviceTypeId:planId"

      for (const ctxItem of contexts) {
        const perServiceType = new Map<string, TargetPlan>();
        const syncedServices: Array<{
          serviceTypeId: string;
          planId: string;
          planDate: string;
        }> = [];

        for (const serviceTypeId of ctxItem.serviceTypeIds) {
          const plans = plansByServiceType.get(serviceTypeId);
          if (!plans || plans.length === 0) continue;

          let target: TargetPlan | null = null;
          for (const plan of plans) {
            const planDateMs = new Date(plan.attributes.sort_date).getTime();
            const addDate = planDateMs - ctxItem.addWindowMs;
            if (now >= addDate) {
              target = {
                planId: plan.id,
                planDateMs,
                planDateStr: plan.attributes.sort_date,
              };
              break;
            }
          }

          if (!target) continue;
          perServiceType.set(serviceTypeId, target);
          syncedServices.push({
            serviceTypeId,
            planId: target.planId,
            planDate: target.planDateStr,
          });
          planFetchSet.add(`${serviceTypeId}:${target.planId}`);
        }

        configPlanSelections.set(ctxItem.config._id, {
          perServiceType,
          syncedServices,
        });
      }

      // Step 6: Fetch team members once per unique (serviceTypeId, planId).
      // We pass undefined for teamIds so we get every team — per-config team
      // filtering happens in memory later via applyFilters.
      for (const key of planFetchSet) {
        const [serviceTypeId, planId] = key.split(":");
        const members = await fetchPlanTeamMembers(
          accessToken,
          serviceTypeId,
          planId,
          undefined
        );
        membersByPlan.set(key, members);
      }

      // Step 6.5: Per-config build allMembers + applyFilters; cache the
      // filtered roster and collect the union of pcoPersonIds across configs.
      // Doing this BEFORE Steps 7-8 preserves a behavior from the legacy
      // per-config flow: matchAndLinkPcoPerson only runs for people who
      // survive at least one config's filters. Otherwise we'd write Planning
      // Center person↔user links for declined or wrong-team people and add
      // mutation load for people no channel cares about.
      const filteredPersonIds = new Set<string>();
      for (const ctxItem of contexts) {
        const selection = configPlanSelections.get(ctxItem.config._id);
        if (!selection) {
          filteredMembersByConfig.set(ctxItem.config._id, []);
          continue;
        }

        const allMembers: FilterableMember[] = [];
        for (const [serviceTypeId, target] of selection.perServiceType) {
          const planMembers =
            membersByPlan.get(`${serviceTypeId}:${target.planId}`) ?? [];
          const scheduledRemovalAt = target.planDateMs + ctxItem.removeWindowMs;
          const serviceTypeName = ctxItem.serviceTypeNameMap.get(serviceTypeId);
          for (const m of planMembers) {
            allMembers.push({
              pcoPersonId: m.pcoPersonId,
              name: m.name,
              position: m.position,
              teamId: m.teamId,
              teamName: m.teamName,
              status: m.status,
              scheduledRemovalAt,
              serviceTypeId,
              serviceTypeName,
              planId: target.planId,
              planDate: target.planDateMs,
            });
          }
        }

        // Effective teamIds: filters.teamIds wins; else legacy teamIds (unless
        // syncScope is "all_teams"). Mirrors the legacy dispatch logic.
        let effectiveTeamIds: string[] | undefined = undefined;
        if (ctxItem.filters?.teamIds && ctxItem.filters.teamIds.length > 0) {
          effectiveTeamIds = ctxItem.filters.teamIds;
        } else if (
          ctxItem.config.config.syncScope !== "all_teams" &&
          ctxItem.config.config.teamIds?.length
        ) {
          effectiveTeamIds = ctxItem.config.config.teamIds;
        }

        const filtered = applyFilters(allMembers, {
          teamIds: effectiveTeamIds,
          positions: ctxItem.filters?.positions,
          statuses: ctxItem.filters?.statuses,
        });

        filteredMembersByConfig.set(ctxItem.config._id, filtered);
        for (const m of filtered) {
          if (m.pcoPersonId) filteredPersonIds.add(m.pcoPersonId);
        }
      }

      // Step 7: Batch-fetch contact info for the filtered roster only,
      // concurrently in groups of 10. We use Promise.allSettled so a single
      // failed lookup (transient 5xx, deleted-but-still-rostered person, etc.)
      // doesn't abort the entire community's sync. Failed PIDs are simply
      // omitted from contactByPerson — those people won't be added this run,
      // but unrelated channels still sync.
      const CONTACT_BATCH_SIZE = 10;
      const personIdList = Array.from(filteredPersonIds);
      for (let i = 0; i < personIdList.length; i += CONTACT_BATCH_SIZE) {
        const batch = personIdList.slice(i, i + CONTACT_BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (pid) => {
            const contact = await getPersonContactInfo(accessToken, pid);
            return { pid, contact };
          })
        );
        for (const r of results) {
          if (r.status === "fulfilled") {
            contactByPerson.set(r.value.pid, r.value.contact);
          }
        }
      }

      // Step 8: Match each unique person once. matchAndLinkPcoPerson is a
      // Convex mutation, so failures are rare (transient OCC retry exhaustion,
      // DB write conflict). We use Promise.allSettled here for the same reason
      // we use it for contact lookups: a single failed match shouldn't reject
      // the whole batch and abort every config in the community via the
      // shared-phase catch path. Failed PIDs are omitted from matchByPerson
      // and the dispatch loop's `if (!matchResult) continue;` already handles
      // them.
      const MATCH_BATCH_SIZE = 10;
      for (let i = 0; i < personIdList.length; i += MATCH_BATCH_SIZE) {
        const batch = personIdList.slice(i, i + MATCH_BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (pid) => {
            const contact = contactByPerson.get(pid);
            const matchResult = (await ctx.runMutation(
              internal.functions.pcoServices.matching.matchAndLinkPcoPerson,
              {
                communityId: args.communityId,
                pcoPersonId: pid,
                pcoPhone: contact?.phone || undefined,
                pcoEmail: contact?.email || undefined,
              }
            )) as MatchResult;
            return { pid, matchResult };
          })
        );
        for (const r of results) {
          if (r.status === "fulfilled") {
            matchByPerson.set(r.value.pid, r.value.matchResult);
          }
        }
      }
    } catch (sharedError) {
      // Shared PCO fetch phase failed (token refresh, 429/5xx on plans/members,
      // etc.). Without this catch the function would exit without ever calling
      // updateSyncStatus on the affected configs, leaving their lastSyncStatus
      // showing a stale "success". Mark every surviving context as errored so
      // admins see the real state, then return cleanly.
      const errorMessage =
        sharedError instanceof Error ? sharedError.message : "Unknown error";
      const sharedErrorResults: PerConfigResult[] = [];
      for (const ctxItem of contexts) {
        // Guard the per-config status write: a config could have been deleted
        // mid-run (rare but possible during admin edits), in which case the
        // patch throws. We don't want one missing config to abort the recovery
        // loop and leave the remaining configs without their per-config error
        // result.
        try {
          await ctx.runMutation(
            internal.functions.pcoServices.rotation.updateSyncStatus,
            {
              configId: ctxItem.config._id,
              status: "error",
              error: errorMessage,
            }
          );
        } catch {
          // Swallow — we still surface the error in the per-config result
          // below so callers see what happened.
        }
        sharedErrorResults.push({
          configId: ctxItem.config._id,
          status: "error",
          error: errorMessage,
        });
      }
      return {
        processed: earlyResults.length + sharedErrorResults.length,
        results: [...earlyResults, ...sharedErrorResults],
      };
    }

    // Step 9: Per-config dispatch in memory.
    const dispatchResults: PerConfigResult[] = [];

    for (const ctxItem of contexts) {
      const { config, preflightRemoved } = ctxItem;
      const selection = configPlanSelections.get(config._id);
      const syncedServices = selection?.syncedServices ?? [];

      try {
        // Pre-filtered roster was built and cached during Step 6.5 of the
        // shared phase. Reading from the cache (instead of recomputing here)
        // keeps the dispatch deterministic with the matching pass that just
        // ran — we only have match results for people who survived at least
        // one config's filters.
        const filteredMembers = filteredMembersByConfig.get(config._id) ?? [];
        const uniqueMembers = deduplicateByPersonId(filteredMembers);

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

        const membersToProcess = uniqueMembers.filter((m) => m.pcoPersonId);

        for (const member of membersToProcess) {
          const pcoPersonId = member.pcoPersonId!;
          // If getPersonContactInfo failed earlier (allSettled), fall back to
          // the team-roster name with empty phone/email instead of skipping.
          // Skipping would omit this person from expectedUserIds, and the
          // subsequent removeStalePcoSyncedMembers call would yank them out of
          // a channel they're still scheduled for. matchByPerson will still
          // resolve via the "already_linked" path if they were linked on a
          // prior run, keeping existing channel members intact.
          const contact = contactByPerson.get(pcoPersonId) ?? {
            name: member.name,
            phone: null,
            email: null,
          };
          const matchResult = matchByPerson.get(pcoPersonId);
          if (!matchResult) {
            // matchAndLinkPcoPerson rejected for this PID (transient OCC retry
            // exhaustion or DB write conflict). Silently skipping would omit
            // the person from expectedUserIds and let removeStalePcoSyncedMembers
            // yank them out of a channel they're still scheduled for. Throwing
            // here fails ONLY this config (the per-config catch below records
            // the error and we move on); other configs in the community still
            // sync, and stale-removal is skipped on this errored config.
            throw new Error(
              `Failed to match scheduled PCO person ${pcoPersonId} (${member.name}) — refusing to sync this config to avoid removing valid members`
            );
          }

          const serviceName = member.planDate
            ? new Date(member.planDate).toLocaleDateString("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
              })
            : "Service";

          if (matchResult.userId) {
            const addResult = await ctx.runMutation(
              internal.functions.pcoServices.rotation.addChannelMember,
              {
                channelId: config.channelId,
                userId: matchResult.userId,
                syncEventId: member.planId || "unknown",
                scheduledRemovalAt: member.scheduledRemovalAt,
                pcoName: contact.name,
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
        const totalRemovedWithStale = preflightRemoved + staleRemoved;

        const firstSyncedService = syncedServices[0];
        await ctx.runMutation(
          internal.functions.pcoServices.rotation.updateSyncStatus,
          {
            configId: config._id,
            status: "success",
            currentEventId: firstSyncedService?.planId,
            currentEventDate: firstSyncedService
              ? new Date(firstSyncedService.planDate).getTime()
              : undefined,
            syncResults: {
              matchedCount: addedCount,
              unmatchedCount: unmatchedPeople.length,
              unmatchedPeople:
                unmatchedPeople.length > 0 ? unmatchedPeople : undefined,
            },
          }
        );

        if (syncedServices.length > 1) {
          dispatchResults.push({
            configId: config._id,
            status: "success",
            addedCount,
            removedCount: totalRemovedWithStale,
            syncedServices,
          });
        } else if (syncedServices.length === 1) {
          dispatchResults.push({
            configId: config._id,
            status: "success",
            addedCount,
            removedCount: totalRemovedWithStale,
            planId: syncedServices[0].planId,
            planDate: syncedServices[0].planDate,
          });
        } else {
          dispatchResults.push({
            configId: config._id,
            status: "success",
            addedCount,
            removedCount: totalRemovedWithStale,
          });
        }
      } catch (error) {
        // Per-config error: record on the config and continue. The wrapper
        // syncAutoChannel still throws to its caller (see below) so test
        // expectations and existing scheduler call sites don't change.
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        // Same guard as the shared-phase catch: if the config was deleted
        // during the run, the patch throws and would otherwise abort the
        // dispatch loop for the rest of the community batch.
        try {
          await ctx.runMutation(
            internal.functions.pcoServices.rotation.updateSyncStatus,
            {
              configId: config._id,
              status: "error",
              error: errorMessage,
            }
          );
        } catch {
          // Swallow — we still surface the error in dispatchResults below.
        }
        dispatchResults.push({
          configId: config._id,
          status: "error",
          error: errorMessage,
        });
      }
    }

    const allResults: PerConfigResult[] = [...earlyResults, ...dispatchResults];
    return { processed: allResults.length, results: allResults };
  },
});

/**
 * Sync a single auto channel - thin wrapper around syncCommunityAutoChannels.
 *
 * Preserved as a wrapper (rather than removed) so existing call sites
 * (manual "Sync Now", scheduler.runAfter on auto-channel create/re-enable)
 * keep working without changes.
 */
export const syncAutoChannel = internalAction({
  args: {
    configId: v.id("autoChannelConfigs"),
  },
  handler: async (ctx, args): Promise<SyncAutoChannelResult> => {
    // Load the config first so we can get the communityId and short-circuit
    // on the same skip cases the original implementation handled.
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

    const batched = await ctx.runAction(
      internal.functions.pcoServices.rotation.syncCommunityAutoChannels,
      { communityId: config.communityId, configIds: [args.configId] }
    );

    const result = batched.results[0];
    if (!result) {
      // Should not happen — we passed exactly one configId — but treat as a
      // skip rather than throwing.
      return { status: "skipped", reason: "Config not found or inactive" };
    }

    if (result.status === "error") {
      // syncCommunityAutoChannels already called updateSyncStatus; throw to
      // match the legacy contract (callers in actions.ts handle thrown errors).
      throw new Error(result.error);
    }

    if (result.status === "skipped") {
      return { status: "skipped", reason: result.reason };
    }

    // Success branches — strip configId before returning.
    if ("syncedServices" in result) {
      return {
        status: "success",
        addedCount: result.addedCount,
        removedCount: result.removedCount,
        syncedServices: result.syncedServices,
      };
    }
    if ("planId" in result) {
      return {
        status: "success",
        addedCount: result.addedCount,
        removedCount: result.removedCount,
        planId: result.planId,
        planDate: result.planDate,
      };
    }
    return {
      status: "success",
      addedCount: result.addedCount,
      removedCount: result.removedCount,
    };
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
    syncedServices?: Array<{ serviceTypeId: string; planId: string; planDate: string }>;
  }>;
};

/**
 * Process all active auto channels - called by cron job.
 *
 * Groups configs by community and dispatches one batched sync per community
 * via syncCommunityAutoChannels, dramatically reducing PCO API call volume
 * (one fetch per (serviceType, plan, person) instead of one per channel).
 */
export const processAllAutoChannels = internalAction({
  args: {},
  handler: async (ctx): Promise<ProcessAllResult> => {
    const configs = await ctx.runQuery(
      internal.functions.pcoServices.rotation.getActiveAutoChannelConfigs,
      {}
    );

    // Group configs by communityId.
    const byCommunity = new Map<Id<"communities">, typeof configs>();
    for (const config of configs) {
      const list = byCommunity.get(config.communityId) ?? [];
      list.push(config);
      byCommunity.set(config.communityId, list);
    }

    const results: ProcessAllResult["results"] = [];
    for (const [communityId, communityConfigs] of byCommunity) {
      try {
        // Pass the configIds we already loaded so syncCommunityAutoChannels
        // doesn't re-run a global getActiveAutoChannelConfigs scan inside each
        // community batch (which would turn one table-wide read into N reads
        // for N communities and amplify cron memory/runtime as tenants grow).
        const batched = await ctx.runAction(
          internal.functions.pcoServices.rotation.syncCommunityAutoChannels,
          {
            communityId,
            configIds: communityConfigs.map((c) => c._id),
          }
        );
        for (const r of batched.results) {
          // Spread keeps shape identical to the previous per-config flatten.
          results.push({ ...r });
        }
      } catch (error) {
        // Whole-community failure — record an error entry per config so the
        // result shape (one entry per config) is preserved.
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        for (const config of communityConfigs) {
          results.push({
            configId: config._id,
            status: "error",
            error: errorMessage,
          });
        }
      }
    }

    return { processed: results.length, results };
  },
});
