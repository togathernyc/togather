/**
 * PCO Services Queries
 *
 * Queries for accessing PCO integration data.
 * Includes both internal queries (for use by other Convex functions)
 * and public queries (for use by frontend components).
 */

import { v } from "convex/values";
import { internalQuery, query } from "../../_generated/server";
import { requireAuth } from "../../lib/auth";
import { isLeaderRole } from "../../lib/helpers";

/**
 * Get the PCO integration for a community (internal use only).
 * Returns the full integration record including credentials.
 */
export const getIntegration = internalQuery({
  args: {
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const integration = await ctx.db
      .query("communityIntegrations")
      .withIndex("by_community_type", (q) =>
        q
          .eq("communityId", args.communityId)
          .eq("integrationType", "planning_center")
      )
      .unique();

    return integration;
  },
});

// =============================================================================
// PUBLIC QUERIES
// =============================================================================

/**
 * Get the auto channel config for a channel (public query).
 * Used by frontend components to display channel sync status.
 *
 * Requires authentication and verifies the user has access to the channel.
 * This query can expose PII (unmatched people's contact info in sync results),
 * so access must be verified.
 */
export const getAutoChannelConfigByChannel = query({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get the channel to verify access
    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      return null;
    }
    if (!channel.groupId) {
      return null; // Skip ad-hoc channels (DM/group_dm)
    }
    const groupId = channel.groupId;

    // Get the group to find the community
    const group = await ctx.db.get(groupId);
    if (!group) {
      return null;
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

    // Check if user is a member of the channel (for non-main channels)
    // or a member of the group (for main channels)
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership) {
      // User is not a member of the group
      return null;
    }

    // For custom/pco_services channels, check channel membership
    if (channel.channelType === "custom" || channel.channelType === "pco_services") {
      const channelMembership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", args.channelId).eq("userId", userId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();

      // For custom/pco_services channels, need to be a channel member or group leader/admin
      const isLeaderOrAdmin = isLeaderRole(groupMembership.role);

      if (!channelMembership && !isLeaderOrAdmin) {
        return null;
      }
    }

    return await ctx.db
      .query("autoChannelConfigs")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .unique();
  },
});
