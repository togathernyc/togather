/**
 * Membership Sync Module
 *
 * Centralized logic for syncing memberships across the system:
 * - Group channel memberships (main + leaders channels)
 * - Announcement group memberships (based on community admin status)
 *
 * This module is the single source of truth for membership sync.
 * All other functions should call these sync functions when memberships change.
 */

import { v } from "convex/values";
import { internalMutation, action } from "../../_generated/server";
import type { MutationCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { getDisplayName, getMediaUrl } from "../../lib/utils";
import { COMMUNITY_ADMIN_THRESHOLD } from "../../lib/permissions";

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * CENTRALIZED MEMBERSHIP SYNC - MAIN ENTRY POINT
 *
 * This is the single entry point for all membership syncing operations.
 * All group/community member changes should call this function.
 *
 * It orchestrates:
 * 1. Group channel membership sync (main + leaders channels)
 * 2. Announcement group membership sync (based on community admin status)
 *
 * @param userId - The user to sync
 * @param groupId - Optional: sync channels for this specific group
 * @param syncAnnouncementGroup - If true, sync announcement group based on community admin status
 * @param communityId - Required when syncAnnouncementGroup is true
 */
export const syncMemberships = internalMutation({
  args: {
    userId: v.id("users"),
    groupId: v.optional(v.id("groups")),
    syncAnnouncementGroup: v.optional(v.boolean()),
    communityId: v.optional(v.id("communities")),
  },
  handler: async (ctx, args) => {
    // 1. Sync group channel memberships if groupId provided
    if (args.groupId) {
      await syncUserChannelMembershipsLogic(ctx, args.userId, args.groupId);
    }

    // 2. Sync announcement group membership if requested
    if (args.syncAnnouncementGroup && args.communityId) {
      await syncAnnouncementGroupMembership(ctx, args.userId, args.communityId);
    }
  },
});

// ============================================================================
// Announcement Group Sync
// ============================================================================

/**
 * Sync a user's announcement group membership based on their community role.
 *
 * This function:
 * - Looks up the user's community role
 * - Finds the announcement group for the community
 * - Ensures the user is:
 *   - **Leader** if community admin (roles >= 3)
 *   - **Member** if regular community member
 *   - **Removed** if not in community
 * - Syncs the announcement group's channels
 *
 * IMPORTANT: Call this directly within your mutation for transactional guarantees.
 * Do NOT use scheduler.runAfter() as that creates a race condition.
 */
export async function syncAnnouncementGroupMembership(
  ctx: MutationCtx,
  userId: Id<"users">,
  communityId: Id<"communities">
): Promise<void> {
  const now = Date.now();

  // Get user's community membership
  const communityMembership = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q: any) =>
      q.eq("userId", userId).eq("communityId", communityId)
    )
    .first();

  // Find the announcement group for this community
  const announcementGroup = await ctx.db
    .query("groups")
    .withIndex("by_community", (q: any) => q.eq("communityId", communityId))
    .filter((q: any) =>
      q.and(
        q.eq(q.field("isAnnouncementGroup"), true),
        q.eq(q.field("isArchived"), false)
      )
    )
    .first();

  if (!announcementGroup) {
    console.warn(`[syncAnnouncementGroupMembership] No announcement group found for community ${communityId}`);
    return;
  }

  // Determine what the user's status SHOULD be
  const isActiveCommunityMember = communityMembership && communityMembership.status === 1;
  const communityRoles = communityMembership?.roles ?? 0;
  const shouldBeLeader = isActiveCommunityMember && communityRoles >= COMMUNITY_ADMIN_THRESHOLD;
  const shouldBeMember = isActiveCommunityMember && communityRoles < COMMUNITY_ADMIN_THRESHOLD;
  const shouldBeInGroup = shouldBeLeader || shouldBeMember;
  const targetRole = shouldBeLeader ? "leader" : "member";

  // Get current announcement group membership
  const currentMembership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q: any) =>
      q.eq("groupId", announcementGroup._id).eq("userId", userId)
    )
    .first();

  const isCurrentlyInGroup = currentMembership && !currentMembership.leftAt;

  // Sync to desired state
  if (shouldBeInGroup && !isCurrentlyInGroup) {
    // ADD to announcement group
    if (currentMembership) {
      // Reactivate existing membership
      await ctx.db.patch(currentMembership._id, {
        leftAt: undefined,
        role: targetRole,
        joinedAt: now,
      });
      console.log(`[syncAnnouncementGroupMembership] Reactivated user ${userId} in announcement group as ${targetRole}`);
    } else {
      // Create new membership
      await ctx.db.insert("groupMembers", {
        groupId: announcementGroup._id,
        userId,
        role: targetRole,
        joinedAt: now,
        notificationsEnabled: true,
      });
      console.log(`[syncAnnouncementGroupMembership] Added user ${userId} to announcement group as ${targetRole}`);
    }
  } else if (!shouldBeInGroup && isCurrentlyInGroup) {
    // REMOVE from announcement group (soft delete)
    await ctx.db.patch(currentMembership!._id, {
      leftAt: now,
    });
    console.log(`[syncAnnouncementGroupMembership] Removed user ${userId} from announcement group`);
  } else if (shouldBeInGroup && isCurrentlyInGroup && currentMembership.role !== targetRole) {
    // UPDATE role if it changed (e.g., promotion to/demotion from leader)
    await ctx.db.patch(currentMembership._id, {
      role: targetRole,
    });
    console.log(`[syncAnnouncementGroupMembership] Updated user ${userId} role to ${targetRole} in announcement group`);
  }

  // Sync announcement group channels
  await syncUserChannelMembershipsLogic(ctx, userId, announcementGroup._id);
}

// ============================================================================
// Channel Membership Sync
// ============================================================================

/**
 * Sync a user's channel memberships for a specific group.
 *
 * This function:
 * - Gets the user's current role in the group
 * - Ensures they are in the main channel if they're an active member
 * - Ensures they are in the leaders channel only if they're a leader/admin
 * - Removes them from channels they shouldn't be in
 * - Updates channel member counts
 * - When user leaves group: removes them from ALL custom channels
 *   - If the leaving user was the channel owner, promotes the oldest member
 *   - If no other members remain, archives the custom channel
 *
 * IMPORTANT: Call this directly within your mutation for transactional guarantees.
 * Do NOT use scheduler.runAfter() as that creates a race condition.
 */
export async function syncUserChannelMembershipsLogic(
  ctx: MutationCtx,
  userId: Id<"users">,
  groupId: Id<"groups">
): Promise<void> {
  const now = Date.now();

  // Get user info for denormalization
  const user = await ctx.db.get(userId);
  if (!user) {
    console.warn(`[syncUserChannelMembershipsLogic] User ${userId} not found`);
    return;
  }
  const displayName = getDisplayName(user.firstName, user.lastName);
  const profilePhoto = getMediaUrl(user.profilePhoto);

  // Get user's group membership
  const groupMembership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q: any) =>
      q.eq("groupId", groupId).eq("userId", userId)
    )
    .first();

  const isActiveGroupMember = !!(groupMembership && !groupMembership.leftAt);
  const groupRole = groupMembership?.role;
  const isLeaderOrAdmin = !!(groupRole === "leader" || groupRole === "admin");

  // Get channels for this group
  const channels = await ctx.db
    .query("chatChannels")
    .withIndex("by_group", (q: any) => q.eq("groupId", groupId))
    .filter((q: any) => q.eq(q.field("isArchived"), false))
    .collect();

  // Sync each auto-channel (main, leaders) - skip custom channels
  // Custom channel membership is managed manually, not auto-synced
  for (const channel of channels) {
    // Skip custom channels - they have manual membership
    if (channel.channelType === "custom") {
      continue;
    }

    // Determine if user SHOULD be in this channel
    let shouldBeInChannel = false;
    if (channel.channelType === "main") {
      shouldBeInChannel = isActiveGroupMember;
    } else if (channel.channelType === "leaders") {
      shouldBeInChannel = isActiveGroupMember && isLeaderOrAdmin;
    } else if (channel.channelType === "reach_out") {
      shouldBeInChannel = isActiveGroupMember;
    }

    // Get current channel membership
    const currentMembership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q: any) =>
        q.eq("channelId", channel._id).eq("userId", userId)
      )
      .first();

    const isCurrentlyInChannel = currentMembership && !currentMembership.leftAt;

    // Determine expected channel role
    const expectedChannelRole = isLeaderOrAdmin ? "admin" : "member";

    // Sync membership to desired state
    if (shouldBeInChannel && !isCurrentlyInChannel) {
      // ADD to channel
      if (currentMembership) {
        // Reactivate existing membership
        await ctx.db.patch(currentMembership._id, {
          leftAt: undefined,
          joinedAt: now,
          role: expectedChannelRole,
          displayName,
          profilePhoto,
        });
        console.log(`[syncUserChannelMembershipsLogic] Reactivated user ${userId} in ${channel.channelType} channel ${channel._id}`);
      } else {
        // Create new membership
        await ctx.db.insert("chatChannelMembers", {
          channelId: channel._id,
          userId,
          role: expectedChannelRole,
          joinedAt: now,
          isMuted: false,
          displayName,
          profilePhoto,
        });
        console.log(`[syncUserChannelMembershipsLogic] Added user ${userId} to ${channel.channelType} channel ${channel._id}`);
      }
    } else if (!shouldBeInChannel && isCurrentlyInChannel) {
      // REMOVE from channel (soft delete)
      await ctx.db.patch(currentMembership!._id, {
        leftAt: now,
      });
      console.log(`[syncUserChannelMembershipsLogic] Removed user ${userId} from ${channel.channelType} channel ${channel._id}`);
    } else if (shouldBeInChannel && isCurrentlyInChannel && currentMembership.role !== expectedChannelRole) {
      // UPDATE role if it changed (e.g., promoted to leader or demoted from leader)
      await ctx.db.patch(currentMembership._id, {
        role: expectedChannelRole,
        displayName,
        profilePhoto,
      });
    }

    // Update channel member count
    const memberCount = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel", (q: any) => q.eq("channelId", channel._id))
      .filter((q: any) => q.eq(q.field("leftAt"), undefined))
      .collect();

    await ctx.db.patch(channel._id, {
      memberCount: memberCount.length,
    });
  }

  // Handle custom channels when user leaves group
  // Users who leave the group should be removed from ALL custom channels
  if (!isActiveGroupMember) {
    const customChannels = await ctx.db
      .query("chatChannels")
      .withIndex("by_group", (q: any) => q.eq("groupId", groupId))
      .filter((q: any) =>
        q.and(
          q.eq(q.field("channelType"), "custom"),
          q.eq(q.field("isArchived"), false)
        )
      )
      .collect();

    for (const channel of customChannels) {
      const channelMembership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q: any) =>
          q.eq("channelId", channel._id).eq("userId", userId)
        )
        .first();

      if (channelMembership && !channelMembership.leftAt) {
        // Handle owner leaving - promote next member or archive channel
        if (channelMembership.role === "owner") {
          const otherMembers = await ctx.db
            .query("chatChannelMembers")
            .withIndex("by_channel", (q: any) => q.eq("channelId", channel._id))
            .filter((q: any) =>
              q.and(
                q.neq(q.field("userId"), userId),
                q.eq(q.field("leftAt"), undefined)
              )
            )
            .collect();

          if (otherMembers.length > 0) {
            // Promote the oldest member (by joinedAt) to owner
            const newOwner = otherMembers.sort((a, b) => a.joinedAt - b.joinedAt)[0];
            await ctx.db.patch(newOwner._id, { role: "owner" });
            console.log(`[syncUserChannelMembershipsLogic] Promoted user ${newOwner.userId} to owner of custom channel ${channel._id}`);
          } else {
            // No other members - archive the channel
            await ctx.db.patch(channel._id, {
              isArchived: true,
              archivedAt: now,
            });
            console.log(`[syncUserChannelMembershipsLogic] Archived empty custom channel ${channel._id}`);
          }
        }

        // Remove user from custom channel
        await ctx.db.patch(channelMembership._id, { leftAt: now });
        console.log(`[syncUserChannelMembershipsLogic] Removed user ${userId} from custom channel ${channel._id} (left group)`);

        // Update member count
        const updatedMemberCount = await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel", (q: any) => q.eq("channelId", channel._id))
          .filter((q: any) => q.eq(q.field("leftAt"), undefined))
          .collect();

        await ctx.db.patch(channel._id, {
          memberCount: updatedMemberCount.length,
          updatedAt: now,
        });
      }
    }
  }
}

// ============================================================================
// User Profile Sync
// ============================================================================

/**
 * Sync a user's profile data (displayName, profilePhoto) to all their channel memberships.
 *
 * This function:
 * - Fetches the user's current displayName and profilePhoto
 * - Updates all active chatChannelMembers records for this user
 *
 * Call this whenever a user's profile is updated (firstName, lastName, profilePhoto).
 */
export const syncUserProfileToChannels = internalMutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Get user info for denormalization
    const user = await ctx.db.get(args.userId);
    if (!user) {
      console.warn(`[syncUserProfileToChannels] User ${args.userId} not found`);
      return;
    }

    const displayName = getDisplayName(user.firstName, user.lastName);
    const profilePhoto = getMediaUrl(user.profilePhoto);

    // Find all active channel memberships for this user
    const channelMemberships = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_user", (q: any) => q.eq("userId", args.userId))
      .filter((q: any) => q.eq(q.field("leftAt"), undefined))
      .collect();

    // Update each membership with the new profile data
    for (const membership of channelMemberships) {
      // Only update if the values have actually changed
      if (membership.displayName !== displayName || membership.profilePhoto !== profilePhoto) {
        await ctx.db.patch(membership._id, {
          displayName,
          profilePhoto,
        });
      }
    }

    console.log(`[syncUserProfileToChannels] Updated ${channelMemberships.length} channel memberships for user ${args.userId}`);
  },
});

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Test helper action to invoke syncMemberships.
 * Used in tests because scheduler.runAfter doesn't work synchronously in tests.
 */
export const testSyncMemberships = action({
  args: {
    userId: v.id("users"),
    groupId: v.optional(v.id("groups")),
    syncAnnouncementGroup: v.optional(v.boolean()),
    communityId: v.optional(v.id("communities")),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.functions.sync.memberships.syncMemberships, {
      userId: args.userId,
      groupId: args.groupId,
      syncAnnouncementGroup: args.syncAnnouncementGroup,
      communityId: args.communityId,
    });
  },
});
