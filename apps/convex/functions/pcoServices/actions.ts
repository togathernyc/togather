/**
 * PCO Services Actions
 *
 * Public actions for interacting with Planning Center Services API.
 * Used for Auto Channels feature to configure and sync service teams.
 */

import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import {
  fetchServiceTypes,
  fetchTeamsForServiceType,
  fetchUpcomingPlans,
  fetchPlanTeamMembers,
  getPersonContactInfo,
  getValidAccessToken,
} from "../../lib/pcoServicesApi";
import { requireAuth } from "../../lib/auth";
import { isCommunityAdmin } from "../../lib/permissions";
import { isLeaderRole } from "../../lib/helpers";
import { applyFilters, deduplicateByPersonId } from "./filterHelpers";
import {
  formatTeamDisplayName,
  formatPositionDisplayName,
} from "./displayHelpers";
import type { Id } from "../../_generated/dataModel";

// ============================================================================
// Internal Mutations for Auth Verification (called by actions)
// ============================================================================

// NOTE: verifyGroupAccess and verifyGroupMemberAccess share similar structure
// but extracting the common logic into a helper function causes TypeScript
// type inference issues with Convex's MutationCtx type. The duplication is
// intentional to maintain type safety.

/**
 * Verify that a user is an active member of a community.
 * Used by actions to verify access before making PCO API calls.
 */
export const verifyCommunityMemberAccess = internalMutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args): Promise<{ userId: string; isAdmin: boolean }> => {
    const userId = await requireAuth(ctx, args.token);

    // Verify user is an active member of this community
    const membership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", args.communityId)
      )
      .first();

    if (!membership || membership.status !== 1) {
      throw new Error("Not a member of this community");
    }

    // Check if user is an admin
    const isAdmin = await isCommunityAdmin(ctx, args.communityId, userId);

    return {
      userId: userId as string,
      isAdmin,
    };
  },
});

/**
 * Verify that a user is a leader/admin for a group.
 * Used by triggerGroupSync to verify the user can sync all channels in the group.
 *
 * Only group leaders or community admins can trigger a group-wide sync.
 */
export const verifyGroupAccess = internalMutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ userId: string; communityId: Id<"communities">; isAdmin: boolean }> => {
    const userId = await requireAuth(ctx, args.token);

    // Get the group to find the community
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new Error("Group not found");
    }

    // Verify user is an active member of the community
    const communityMembership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", group.communityId)
      )
      .first();

    if (!communityMembership || communityMembership.status !== 1) {
      throw new Error("Not a member of this community");
    }

    // Check if user is a group leader
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    const isGroupLeader = groupMembership && isLeaderRole(groupMembership.role);

    // Check if user is a community admin
    const isAdmin = await isCommunityAdmin(ctx, group.communityId, userId);

    // Must be either a group leader or community admin to trigger group-wide sync
    if (!isGroupLeader && !isAdmin) {
      throw new Error("You must be a group leader or community admin to trigger a group sync");
    }

    return {
      userId: userId as string,
      communityId: group.communityId,
      isAdmin,
    };
  },
});

/**
 * Verify that a user is a member of a group (any role) and return community info.
 * Used by read-only features like the Run Sheet that should be visible to all group members,
 * not just leaders/admins.
 *
 * @param token - User auth token
 * @param groupId - The group to check membership for
 * @returns userId, communityId, and whether the user is an admin
 */
export const verifyGroupMemberAccess = internalMutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ userId: string; communityId: Id<"communities">; isAdmin: boolean }> => {
    const userId = await requireAuth(ctx, args.token);

    // Get the group to find the community
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new Error("Group not found");
    }

    // Verify user is an active member of the community
    const communityMembership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", group.communityId)
      )
      .first();

    if (!communityMembership || communityMembership.status !== 1) {
      throw new Error("Not a member of this community");
    }

    // Check if user is a group member (any role is acceptable)
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership) {
      throw new Error("You must be a member of this group to view the run sheet");
    }

    // Check if user is a community admin (for optional future use)
    const isAdmin = await isCommunityAdmin(ctx, group.communityId, userId);

    return {
      userId: userId as string,
      communityId: group.communityId,
      isAdmin,
    };
  },
});

/**
 * Verify that a user has access to a channel and return community info.
 * Used by triggerChannelSync to verify the user can sync this channel.
 *
 * Channel members OR group leaders can trigger a sync - admin access is NOT required.
 * Admin access is only required for creating/configuring PCO channels.
 */
export const verifyChannelAccess = internalMutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ userId: string; communityId: Id<"communities">; isAdmin: boolean }> => {
    const userId = await requireAuth(ctx, args.token);

    // Get the channel
    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }

    // Get the group to find the community
    const group = await ctx.db.get(channel.groupId);
    if (!group) {
      throw new Error("Group not found");
    }

    // Verify user is an active member of the community
    const communityMembership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", group.communityId)
      )
      .first();

    if (!communityMembership || communityMembership.status !== 1) {
      throw new Error("Not a member of this community");
    }

    // Check if user is an active channel member
    const channelMembership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    // Check if user is a group leader (can sync even if not a channel member)
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", channel.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    const isGroupLeader = groupMembership && isLeaderRole(groupMembership.role);

    // Allow sync if user is either a channel member OR a group leader
    if (!channelMembership && !isGroupLeader) {
      throw new Error("You must be a channel member or group leader to trigger a sync");
    }

    // Check if user is admin (for informational purposes, not required for sync)
    const isAdmin = await isCommunityAdmin(ctx, group.communityId, userId);

    return {
      userId: userId as string,
      communityId: group.communityId,
      isAdmin,
    };
  },
});

/**
 * Get all service types for a community's PCO organization.
 * Used when configuring an Auto Channel to select which service type to sync.
 */
export const getServiceTypes = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    // Verify the user is a member of this community (admins only for PCO config)
    const authResult = await ctx.runMutation(
      internal.functions.pcoServices.actions.verifyCommunityMemberAccess,
      { token: args.token, communityId: args.communityId }
    );

    if (!authResult.isAdmin) {
      throw new Error("Admin access required to view PCO service types");
    }

    const accessToken = await getValidAccessToken(ctx, args.communityId);
    const serviceTypes = await fetchServiceTypes(accessToken);

    return serviceTypes.map((st) => ({
      id: st.id,
      name: st.attributes.name.trim(),
    }));
  },
});

/**
 * Get all teams for a service type.
 * Used when configuring an Auto Channel to select which teams to include.
 *
 * Returns teams with hierarchical display names for disambiguation:
 * - displayName: "Service Type > Team Name" (e.g., "MANHATTAN > PRODUCTION")
 */
export const getTeamsForServiceType = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    serviceTypeId: v.string(),
    serviceTypeName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verify the user is an admin of this community
    const authResult = await ctx.runMutation(
      internal.functions.pcoServices.actions.verifyCommunityMemberAccess,
      { token: args.token, communityId: args.communityId }
    );

    if (!authResult.isAdmin) {
      throw new Error("Admin access required to view PCO teams");
    }

    const accessToken = await getValidAccessToken(ctx, args.communityId);
    const teams = await fetchTeamsForServiceType(
      accessToken,
      args.serviceTypeId
    );

    return teams.map((team) => ({
      id: team.id,
      name: team.attributes.name,
      serviceTypeName: args.serviceTypeName || "",
      displayName: formatTeamDisplayName(
        team.attributes.name,
        args.serviceTypeName
      ),
    }));
  },
});

/**
 * Get upcoming plans for a service type.
 * Used to preview which services the Auto Channel will sync.
 */
export const getUpcomingPlans = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    serviceTypeId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Verify the user is an admin of this community
    const authResult = await ctx.runMutation(
      internal.functions.pcoServices.actions.verifyCommunityMemberAccess,
      { token: args.token, communityId: args.communityId }
    );

    if (!authResult.isAdmin) {
      throw new Error("Admin access required to view PCO plans");
    }

    const accessToken = await getValidAccessToken(ctx, args.communityId);
    const plans = await fetchUpcomingPlans(
      accessToken,
      args.serviceTypeId,
      args.limit || 10
    );

    return plans.map((plan) => ({
      id: plan.id,
      title: plan.attributes.title,
      date: plan.attributes.sort_date,
      dates: plan.attributes.dates,
    }));
  },
});

/**
 * Get team members for a specific plan.
 * Used to sync channel membership based on who is scheduled for a service.
 *
 * Returns team members with their PCO person ID and contact info for matching
 * to existing users in the system.
 */
export const getPlanTeamMembers = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    serviceTypeId: v.string(),
    planId: v.string(),
    teamIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Verify the user is an admin of this community
    const authResult = await ctx.runMutation(
      internal.functions.pcoServices.actions.verifyCommunityMemberAccess,
      { token: args.token, communityId: args.communityId }
    );

    if (!authResult.isAdmin) {
      throw new Error("Admin access required to view PCO plan members");
    }

    const accessToken = await getValidAccessToken(ctx, args.communityId);
    const members = await fetchPlanTeamMembers(
      accessToken,
      args.serviceTypeId,
      args.planId,
      args.teamIds
    );

    // Get contact info for each member in batches to respect PCO rate limits
    // PCO rate limit is 100 requests per 20 seconds, so 15 concurrent is safe
    const BATCH_SIZE = 15;
    const membersWithContact: Array<{
      id: string;
      pcoPersonId: string | null;
      name: string;
      status: string;
      position: string | null;
      teamId: string | null;
      teamName: string | null;
      phone: string | null;
      email: string | null;
    }> = [];

    for (let i = 0; i < members.length; i += BATCH_SIZE) {
      const batch = members.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (member) => {
          let phone: string | null = null;
          let email: string | null = null;

          if (member.pcoPersonId) {
            const contact = await getPersonContactInfo(accessToken, member.pcoPersonId);
            phone = contact.phone;
            email = contact.email;
          }

          return {
            id: member.id,
            pcoPersonId: member.pcoPersonId,
            name: member.name,
            status: member.status,
            position: member.position,
            teamId: member.teamId,
            teamName: member.teamName,
            phone,
            email,
          };
        })
      );
      membersWithContact.push(...batchResults);
    }

    return membersWithContact;
  },
});

/**
 * Manually trigger a sync for an auto channel.
 * Called from the frontend to force a sync outside the normal cron schedule.
 */
export const triggerChannelSync = action({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    status: string;
    addedCount?: number;
    removedCount?: number;
    planId?: string;
    planDate?: string;
    reason?: string;
  }> => {
    // Verify the user has admin access to this channel's community
    await ctx.runMutation(
      internal.functions.pcoServices.actions.verifyChannelAccess,
      { token: args.token, channelId: args.channelId }
    );

    // Get the config for this channel
    const config = await ctx.runQuery(
      internal.functions.pcoServices.rotation.getAutoChannelConfig,
      { channelId: args.channelId }
    );

    if (!config) {
      throw new Error("No auto channel config found for this channel");
    }

    // Trigger the sync
    const result = await ctx.runAction(
      internal.functions.pcoServices.rotation.syncAutoChannel,
      { configId: config._id }
    );

    return result;
  },
});

// ============================================================================
// Filter-Based Configuration Actions
// ============================================================================

/**
 * Position data with full context for hierarchical display and filtering.
 * Includes IDs for backend filtering and names for display.
 */
interface PositionContext {
  positionName: string;
  teamId: string | null;
  teamName: string | null;
  serviceTypeId: string | null;
  serviceTypeName: string | null;
}

/**
 * Get available positions from recent PCO plans.
 * Fetches unique positions from recent plans to populate the filter UI.
 *
 * Implements cascading filter logic:
 * - If teamIds are provided, only positions from those teams are returned
 * - If no teamIds but serviceTypeIds are provided, all positions from those services are returned
 * - If no serviceTypeIds, all positions from all services are returned
 *
 * Positions are returned sorted by frequency (most common first) to help
 * users identify commonly used positions in their organization.
 *
 * Returns positions with hierarchical display names for disambiguation:
 * - displayName: "Service Type > Team > Position" (e.g., "MANHATTAN > PRODUCTION > Technical Director")
 */
export const getAvailablePositions = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    serviceTypeIds: v.optional(v.array(v.string())), // Scope to specific services
    teamIds: v.optional(v.array(v.string())), // Scope to specific teams (cascading filter)
  },
  handler: async (
    ctx,
    args
  ): Promise<
    Array<{
      name: string;
      teamId: string | null;
      teamName: string | null;
      serviceTypeId: string | null;
      serviceTypeName: string | null;
      displayName: string;
      count: number;
    }>
  > => {
    // Verify admin access
    const authResult = await ctx.runMutation(
      internal.functions.pcoServices.actions.verifyCommunityMemberAccess,
      { token: args.token, communityId: args.communityId }
    );

    if (!authResult.isAdmin) {
      throw new Error("Admin access required to view PCO positions");
    }

    const accessToken = await getValidAccessToken(ctx, args.communityId);

    // Fetch all service types to get their names
    const allServiceTypes = await fetchServiceTypes(accessToken);
    const serviceTypeNameMap = new Map(
      allServiceTypes.map((st) => [st.id, st.attributes.name.trim()])
    );

    // Determine which service types to fetch
    let serviceTypeIds = args.serviceTypeIds;
    if (!serviceTypeIds || serviceTypeIds.length === 0) {
      serviceTypeIds = allServiceTypes.map((st) => st.id);
    }

    // Collect positions with full context using a composite key
    // Key: "serviceTypeName|teamName|positionName"
    const positionContextMap = new Map<
      string,
      { context: PositionContext; count: number }
    >();

    // Process service types in batches to respect rate limits
    const BATCH_SIZE = 15;
    for (let i = 0; i < serviceTypeIds.length; i += BATCH_SIZE) {
      const batch = serviceTypeIds.slice(i, i + BATCH_SIZE);

      // Fetch recent plans (3-5 plans) for each service type in batch
      const planPromises = batch.map((serviceTypeId) =>
        fetchUpcomingPlans(accessToken, serviceTypeId, 5)
      );
      const planResults = await Promise.all(planPromises);

      // For each service type's plans, fetch team members
      for (let j = 0; j < batch.length; j++) {
        const serviceTypeId = batch[j];
        const serviceTypeName = serviceTypeNameMap.get(serviceTypeId) || null;
        const plans = planResults[j];

        // Fetch team members for each plan (limited to 3 plans per service type)
        const plansToFetch = plans.slice(0, 3);
        for (const plan of plansToFetch) {
          const members = await fetchPlanTeamMembers(
            accessToken,
            serviceTypeId,
            plan.id
          );

          // Collect unique positions with full context
          // Apply cascading filter: if teamIds specified, only include positions from those teams
          for (const member of members) {
            if (member.position) {
              // Skip this member if teamIds are specified and this member isn't on one of those teams
              if (args.teamIds && args.teamIds.length > 0) {
                if (!member.teamId || !args.teamIds.includes(member.teamId)) {
                  continue;
                }
              }

              // Use IDs in key for uniqueness (handles teams with same name in different services)
              const key = `${serviceTypeId}|${member.teamId || ""}|${member.position}`;
              const existing = positionContextMap.get(key);
              if (existing) {
                existing.count += 1;
              } else {
                positionContextMap.set(key, {
                  context: {
                    positionName: member.position,
                    teamId: member.teamId,
                    teamName: member.teamName,
                    serviceTypeId,
                    serviceTypeName,
                  },
                  count: 1,
                });
              }
            }
          }
        }
      }
    }

    // Convert to array with display names and sort by count (most common first)
    const positions = Array.from(positionContextMap.values())
      .map(({ context, count }) => ({
        name: context.positionName,
        teamId: context.teamId,
        teamName: context.teamName,
        serviceTypeId: context.serviceTypeId,
        serviceTypeName: context.serviceTypeName,
        displayName: formatPositionDisplayName(
          context.positionName,
          context.teamName ?? undefined,
          context.serviceTypeName ?? undefined
        ),
        count,
      }))
      .sort((a, b) => b.count - a.count);

    return positions;
  },
});

/**
 * Preview filter results before creating a channel.
 * Shows who would match the given filters to help users verify their configuration.
 *
 * Returns:
 * - totalCount: Number of unique people matching the filters
 * - sample: First 5 matched people with details
 * - nextServiceDate: Date of the next service in the add window (or null if none)
 */
export const previewFilterResults = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    filters: v.object({
      serviceTypeIds: v.optional(v.array(v.string())),
      teamIds: v.optional(v.array(v.string())),
      // Support both strings and position objects with context
      positions: v.optional(
        v.array(
          v.union(
            v.string(),
            v.object({
              name: v.string(),
              teamId: v.optional(v.string()),
              teamName: v.optional(v.string()),
              serviceTypeId: v.optional(v.string()),
              serviceTypeName: v.optional(v.string()),
            })
          )
        )
      ),
      statuses: v.optional(v.array(v.string())),
    }),
    addMembersDaysBefore: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    totalCount: number;
    sample: Array<{
      name: string;
      position: string | null;
      team: string | null;
      service: string | null;
    }>;
    nextServiceDate: number | null;
  }> => {
    // Verify admin access
    const authResult = await ctx.runMutation(
      internal.functions.pcoServices.actions.verifyCommunityMemberAccess,
      { token: args.token, communityId: args.communityId }
    );

    if (!authResult.isAdmin) {
      throw new Error("Admin access required to preview filter results");
    }

    const accessToken = await getValidAccessToken(ctx, args.communityId);

    // Determine which service types to fetch
    let serviceTypeIds = args.filters.serviceTypeIds;
    if (!serviceTypeIds || serviceTypeIds.length === 0) {
      // Fetch all service types if none specified
      const serviceTypes = await fetchServiceTypes(accessToken);
      serviceTypeIds = serviceTypes.map((st) => st.id);
    }

    // Collect all members from plans within the add window
    const allMembers: Array<{
      pcoPersonId: string | null;
      name: string;
      position: string | null;
      teamId: string | null;
      teamName: string | null;
      status: string;
      scheduledRemovalAt: number;
      serviceTypeId?: string;
      serviceTypeName?: string;
      planDate?: number;
    }> = [];

    let nextServiceDate: number | null = null;

    // Calculate the add window cutoff
    const now = Date.now();
    const addWindowCutoff = now + args.addMembersDaysBefore * 24 * 60 * 60 * 1000;

    // Fetch service type names for display
    const serviceTypes = await fetchServiceTypes(accessToken);
    const serviceTypeNameMap = new Map(
      serviceTypes.map((st) => [st.id, st.attributes.name.trim()])
    );

    // Process service types in batches to respect rate limits
    const BATCH_SIZE = 15;
    for (let i = 0; i < serviceTypeIds.length; i += BATCH_SIZE) {
      const batch = serviceTypeIds.slice(i, i + BATCH_SIZE);

      // Fetch upcoming plans for each service type in batch
      const planPromises = batch.map((serviceTypeId) =>
        fetchUpcomingPlans(accessToken, serviceTypeId, 10)
      );
      const planResults = await Promise.all(planPromises);

      // For each service type's plans, find plans in the add window
      for (let j = 0; j < batch.length; j++) {
        const serviceTypeId = batch[j];
        const plans = planResults[j];
        const serviceTypeName = serviceTypeNameMap.get(serviceTypeId);

        for (const plan of plans) {
          const planDate = new Date(plan.attributes.sort_date).getTime();

          // Check if plan is within the add window (between now and cutoff)
          if (planDate >= now && planDate <= addWindowCutoff) {
            // Track earliest service date in the window
            if (nextServiceDate === null || planDate < nextServiceDate) {
              nextServiceDate = planDate;
            }

            // Fetch team members for this plan
            const members = await fetchPlanTeamMembers(
              accessToken,
              serviceTypeId,
              plan.id
            );

            // Add to collection with metadata (including serviceTypeId for position context matching)
            for (const member of members) {
              allMembers.push({
                pcoPersonId: member.pcoPersonId,
                name: member.name,
                position: member.position,
                teamId: member.teamId,
                teamName: member.teamName,
                status: member.status,
                scheduledRemovalAt: planDate, // For deduplication
                serviceTypeId,
                serviceTypeName,
                planDate,
              });
            }
          }
        }
      }
    }

    // Apply filters using the helper function
    const filteredMembers = applyFilters(allMembers, {
      teamIds: args.filters.teamIds,
      positions: args.filters.positions,
      statuses: args.filters.statuses,
    });

    // Deduplicate by person ID
    const uniqueMembers = deduplicateByPersonId(filteredMembers);

    // Prepare sample (first 5 people)
    const sample = uniqueMembers.slice(0, 5).map((member) => ({
      name: member.name,
      position: member.position,
      team: member.teamName,
      service: member.serviceTypeName || null,
    }));

    return {
      totalCount: uniqueMembers.length,
      sample,
      nextServiceDate,
    };
  },
});

// ============================================================================
// Group-Level Sync Actions
// ============================================================================

/**
 * Trigger sync for all auto channels in a group.
 * Syncs all channels that have an autoChannelConfig configured.
 *
 * Returns aggregated results for all channels in the group.
 */
export const triggerGroupSync = action({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    totalChannels: number;
    syncedChannels: number;
    results: Array<{
      channelName: string;
      status: "synced" | "skipped" | "error";
      addedCount: number;
      removedCount: number;
      reason?: string;
    }>;
  }> => {
    // Verify the user is a group leader or community admin
    await ctx.runMutation(
      internal.functions.pcoServices.actions.verifyGroupAccess,
      { token: args.token, groupId: args.groupId }
    );

    // Get all channels for this group
    const channels = await ctx.runQuery(
      internal.functions.pcoServices.actions.getChannelsForGroup,
      { groupId: args.groupId }
    );

    const results: Array<{
      channelName: string;
      status: "synced" | "skipped" | "error";
      addedCount: number;
      removedCount: number;
      reason?: string;
    }> = [];

    let syncedChannels = 0;

    // Process each channel
    for (const channel of channels) {
      // Check if this channel has an auto channel config
      const config = await ctx.runQuery(
        internal.functions.pcoServices.rotation.getAutoChannelConfig,
        { channelId: channel._id }
      );

      if (!config) {
        // No auto channel config - skip this channel
        results.push({
          channelName: channel.name,
          status: "skipped",
          addedCount: 0,
          removedCount: 0,
          reason: "No auto channel config",
        });
        continue;
      }

      if (!config.isActive) {
        // Config exists but is inactive
        results.push({
          channelName: channel.name,
          status: "skipped",
          addedCount: 0,
          removedCount: 0,
          reason: "Auto sync is disabled",
        });
        continue;
      }

      try {
        // Trigger the sync for this channel
        const syncResult = await ctx.runAction(
          internal.functions.pcoServices.rotation.syncAutoChannel,
          { configId: config._id }
        );

        // Map the result to our expected format
        if (syncResult.status === "skipped") {
          results.push({
            channelName: channel.name,
            status: "skipped",
            addedCount: 0,
            removedCount: 0,
            reason: syncResult.reason,
          });
        } else {
          // status is "success"
          syncedChannels++;
          results.push({
            channelName: channel.name,
            status: "synced",
            addedCount: syncResult.addedCount ?? 0,
            removedCount: syncResult.removedCount ?? 0,
          });
        }
      } catch (error) {
        // Handle sync errors
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        results.push({
          channelName: channel.name,
          status: "error",
          addedCount: 0,
          removedCount: 0,
          reason: errorMessage,
        });
      }
    }

    return {
      totalChannels: channels.length,
      syncedChannels,
      results,
    };
  },
});

/**
 * Internal query to get all channels for a group.
 * Used by triggerGroupSync and run sheet queries to find channels to sync.
 *
 * Returns channels owned by this group AND shared channels where this group
 * is an accepted secondary participant — so secondary groups in a shared-group
 * relationship can discover the primary group's PCO configuration.
 */
export const getChannelsForGroup = internalQuery({
  args: {
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    // 1. Channels owned by this group
    const ownedChannels = await ctx.db
      .query("chatChannels")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    // 2. Shared channels where this group is an accepted secondary participant
    const sharedChannels = await ctx.db
      .query("chatChannels")
      .withIndex("by_isShared", (q) => q.eq("isShared", true))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    const acceptedSharedChannels = sharedChannels.filter(
      (ch) =>
        ch.sharedGroups?.some(
          (sg) => sg.groupId === args.groupId && sg.status === "accepted"
        )
    );

    // 3. Deduplicate (a channel owned by the group won't also have it in sharedGroups,
    // but guard against edge cases)
    const seenIds = new Set(ownedChannels.map((ch) => ch._id));
    for (const ch of acceptedSharedChannels) {
      if (!seenIds.has(ch._id)) {
        ownedChannels.push(ch);
        seenIds.add(ch._id);
      }
    }

    return ownedChannels;
  },
});

// ============================================================================
// PCO Position Placeholder Resolution
// ============================================================================

/**
 * Format a list of names with proper grammar.
 * - 0 names: returns empty string
 * - 1 name: "John"
 * - 2 names: "John and Jane"
 * - 3+ names: "John, Jane, and Bob"
 */
export function formatNamesList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * Placeholder data type
 */
export interface Placeholder {
  fullMatch: string;
  serviceTypeName: string;
  teamName: string;
  positionName: string;
}

/**
 * Parse placeholders from a message.
 * Format: {{ServiceType > Team > Position}}
 */
export function parsePlaceholders(message: string): Placeholder[] {
  const placeholderRegex = /\{\{([^>]+)\s*>\s*([^>]+)\s*>\s*([^}]+)\}\}/g;
  const placeholders: Placeholder[] = [];

  let match;
  while ((match = placeholderRegex.exec(message)) !== null) {
    placeholders.push({
      fullMatch: match[0],
      serviceTypeName: match[1].trim(),
      teamName: match[2].trim(),
      positionName: match[3].trim(),
    });
  }

  return placeholders;
}

/**
 * Core placeholder resolution logic shared between public and internal actions.
 *
 * @param accessToken - PCO access token
 * @param message - Message with placeholders
 * @param placeholders - Parsed placeholder data
 * @param throwOnError - If true, throw on API errors; if false, return original message
 * @returns Resolved message with placeholders replaced
 */
async function resolvePlaceholdersCore(
  accessToken: string,
  message: string,
  placeholders: Placeholder[],
  throwOnError: boolean
): Promise<string> {
  let resolvedMessage = message;

  // Get service types
  let serviceTypes;
  try {
    serviceTypes = await fetchServiceTypes(accessToken);
  } catch (error) {
    if (throwOnError) throw error;
    console.error("Failed to fetch service types:", error);
    return message;
  }

  // Map to store resolved names: key = "ServiceType > Team > Position", value = names
  const resolvedNames = new Map<string, string[]>();

  // Get unique service types from placeholders
  const uniqueServiceTypes = [...new Set(placeholders.map((p) => p.serviceTypeName))];

  for (const serviceTypeName of uniqueServiceTypes) {
    const serviceType = serviceTypes.find(
      (st) => st.attributes.name.trim().toLowerCase() === serviceTypeName.toLowerCase()
    );

    if (!serviceType) {
      console.warn(`Service type not found: ${serviceTypeName}`);
      continue;
    }

    // Get upcoming plan
    let plans;
    try {
      plans = await fetchUpcomingPlans(accessToken, serviceType.id, 1);
    } catch (error) {
      if (throwOnError) throw error;
      console.error(`Failed to fetch plans for ${serviceTypeName}:`, error);
      continue;
    }

    if (plans.length === 0) {
      console.warn(`No upcoming plans for service type: ${serviceTypeName}`);
      continue;
    }

    const plan = plans[0];

    // Fetch team members with team info (paginated to get ALL members)
    let teamMembers;
    try {
      teamMembers = await fetchPlanTeamMembers(
        accessToken,
        serviceType.id,
        plan.id
      );
    } catch (error) {
      if (throwOnError) throw error;
      console.error(`Failed to fetch team members for plan ${plan.id}:`, error);
      continue;
    }

    // Match team members to placeholders
    for (const placeholder of placeholders.filter(
      (p) => p.serviceTypeName.toLowerCase() === serviceTypeName.toLowerCase()
    )) {
      const key = `${placeholder.serviceTypeName} > ${placeholder.teamName} > ${placeholder.positionName}`;
      const matchedNames = teamMembers
        .filter(
          (m) =>
            m.teamName?.trim().toLowerCase() === placeholder.teamName.toLowerCase() &&
            m.position?.trim().toLowerCase() === placeholder.positionName.toLowerCase() &&
            m.pcoPersonId && // Has an actual person assigned (not an empty slot)
            m.status !== "D" // Exclude declined members
        )
        .map((m) => m.name.split(" ")[0]); // Use first name only

      resolvedNames.set(key, matchedNames);
    }
  }

  // Replace placeholders with formatted names
  for (const placeholder of placeholders) {
    const key = `${placeholder.serviceTypeName} > ${placeholder.teamName} > ${placeholder.positionName}`;
    const names = resolvedNames.get(key) || [];

    const formattedNames = formatNamesList(names);
    resolvedMessage = resolvedMessage.replace(
      placeholder.fullMatch,
      formattedNames || "[TBD]"
    );
  }

  return resolvedMessage;
}

/**
 * Resolve PCO position placeholders in a message (public action).
 * Used for testing/preview in the UI.
 *
 * Placeholders format: {{ServiceType > Team > Position}}
 * Example: "Hey {{Sunday Service > Worship > Vocals}}, you're on this week!"
 *
 * Matches team members from the upcoming plan who:
 * - Are on the specified team
 * - Have the specified position
 * - Have "C" (confirmed) status
 */
export const resolvePositionPlaceholders = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    message: v.string(),
  },
  handler: async (ctx, args): Promise<string> => {
    // Verify access
    await ctx.runMutation(
      internal.functions.pcoServices.actions.verifyCommunityMemberAccess,
      { token: args.token, communityId: args.communityId }
    );

    // Get valid access token
    const accessToken = await getValidAccessToken(ctx, args.communityId);
    if (!accessToken) {
      throw new Error("No valid PCO integration found");
    }

    // Parse placeholders
    const placeholders = parsePlaceholders(args.message);
    if (placeholders.length === 0) {
      return args.message;
    }

    // Resolve placeholders (throw on errors for public action)
    return await resolvePlaceholdersCore(accessToken, args.message, placeholders, true);
  },
});

/**
 * Internal action to resolve PCO position placeholders.
 * Used by scheduled jobs (communication bot) to resolve placeholders without auth token.
 *
 * Placeholders format: {{ServiceType > Team > Position}}
 */
export const resolvePositionPlaceholdersInternal = internalAction({
  args: {
    communityId: v.id("communities"),
    message: v.string(),
  },
  handler: async (ctx, args): Promise<string> => {
    // Get valid access token (no auth verification needed for internal action)
    const accessToken = await getValidAccessToken(ctx, args.communityId);
    if (!accessToken) {
      console.warn("No valid PCO integration found for community");
      return args.message;
    }

    // Parse placeholders
    const placeholders = parsePlaceholders(args.message);
    if (placeholders.length === 0) {
      return args.message;
    }

    // Resolve placeholders (don't throw on errors for internal action)
    return await resolvePlaceholdersCore(accessToken, args.message, placeholders, false);
  },
});

