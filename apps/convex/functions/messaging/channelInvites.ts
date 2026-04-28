/**
 * Channel Invite Link Functions
 *
 * Queries and mutations for shareable invite links on custom chat channels.
 * Supports two join modes: "open" (instant join) and "approval_required" (pending request).
 */

import { v, ConvexError } from "convex/values";
import { query, mutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { isLeaderRole, channelIsLeaderEnabled } from "../../lib/helpers";
import { generateShortId, getDisplayName, getMediaUrl } from "../../lib/utils";

/**
 * Build the set of group IDs whose members are eligible to use a channel's invite link.
 * Includes the primary group and all accepted secondary groups for shared channels.
 */
function getEligibleGroupIds(channel: { groupId?: Id<"groups">; isShared?: boolean; sharedGroups?: Array<{ groupId: Id<"groups">; status: string }> }): Set<Id<"groups">> {
  if (!channel.groupId) {
    throw new Error("This operation is only valid for group channels");
  }
  const ids = new Set<Id<"groups">>([channel.groupId]);
  if (channel.isShared) {
    for (const sg of channel.sharedGroups ?? []) {
      if (sg.status === "accepted") {
        ids.add(sg.groupId);
      }
    }
  }
  return ids;
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Get channel info by invite shortId (public-facing for share page + smart card).
 * Returns channel name, group name, member count, user's status, etc.
 */
export const getByShortId = query({
  args: {
    shortId: v.string(),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Look up channel by inviteShortId
    const channel = await ctx.db
      .query("chatChannels")
      .withIndex("by_inviteShortId", (q) => q.eq("inviteShortId", args.shortId))
      .first();

    if (!channel || !channel.inviteEnabled || channel.isArchived || !channelIsLeaderEnabled(channel)) {
      return null;
    }
    if (!channel.groupId) return null; // Skip ad-hoc channels (DM/group_dm)

    // Get group info
    const group = await ctx.db.get(channel.groupId);
    if (!group) return null;

    // Get community info
    const community = group.communityId
      ? await ctx.db.get(group.communityId)
      : null;

    // Check user status if authenticated
    let userStatus:
      | "not_authenticated"
      | "not_group_member"
      | "already_member"
      | "pending_request"
      | "declined"
      | "eligible" = "not_authenticated";
    let userId: Id<"users"> | null = null;

    if (args.token) {
      try {
        userId = await requireAuth(ctx, args.token);

        // Check if user is a member of any eligible group (primary + accepted shared groups)
        const eligibleGroupIds = getEligibleGroupIds(channel);
        const userGroupMemberships = await ctx.db
          .query("groupMembers")
          .withIndex("by_user", (q) => q.eq("userId", userId!))
          .filter((q) => q.eq(q.field("leftAt"), undefined))
          .collect();
        const isEligibleGroupMember = userGroupMemberships.some((m) =>
          eligibleGroupIds.has(m.groupId)
        );

        if (!isEligibleGroupMember) {
          userStatus = "not_group_member";
        } else {
          // Check if already a channel member
          const channelMembership = await ctx.db
            .query("chatChannelMembers")
            .withIndex("by_channel_user", (q) =>
              q.eq("channelId", channel._id).eq("userId", userId!),
            )
            .filter((q) => q.eq(q.field("leftAt"), undefined))
            .first();

          if (channelMembership) {
            userStatus = "already_member";
          } else {
            // Check for pending or declined join request
            const existingRequest = await ctx.db
              .query("channelJoinRequests")
              .withIndex("by_channel_user", (q) =>
                q.eq("channelId", channel._id).eq("userId", userId!),
              )
              .filter((q) =>
                q.or(
                  q.eq(q.field("status"), "pending"),
                  q.eq(q.field("status"), "declined"),
                )
              )
              .first();

            if (existingRequest?.status === "pending") {
              userStatus = "pending_request";
            } else if (existingRequest?.status === "declined") {
              userStatus = "declined";
            } else {
              userStatus = "eligible";
            }
          }
        }
      } catch {
        userStatus = "not_authenticated";
      }
    }

    return {
      channelId: channel._id,
      channelName: channel.name,
      channelDescription: channel.description,
      channelSlug: channel.slug,
      groupId: channel.groupId,
      groupName: group.name,
      groupShortId: group.shortId,
      groupImage: getMediaUrl(group.preview),
      communityName: community?.name,
      communityLogo: getMediaUrl(community?.logo),
      memberCount: channel.memberCount,
      joinMode: channel.joinMode || "open",
      userStatus,
    };
  },
});

/**
 * Get the invite shortId for a channel (leaders only).
 */
export const getInviteInfo = query({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const channel = await ctx.db.get(args.channelId);
    if (!channel) return null;
    if (!channel.groupId) return null; // Skip ad-hoc channels (DM/group_dm)
    const groupId = channel.groupId;

    // Verify user is a group leader
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", userId),
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership || !isLeaderRole(groupMembership.role)) {
      return null;
    }

    return {
      inviteShortId: channel.inviteShortId || null,
      inviteEnabled: channel.inviteEnabled || false,
      joinMode: channel.joinMode || "open",
    };
  },
});

/**
 * List pending join requests for a channel (leaders only).
 */
export const getPendingRequests = query({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const channel = await ctx.db.get(args.channelId);
    if (!channel) return [];
    if (!channel.groupId) return []; // Skip ad-hoc channels (DM/group_dm)
    const groupId = channel.groupId;

    // Verify user is a group leader
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", userId),
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership || !isLeaderRole(groupMembership.role)) {
      return [];
    }

    const requests = await ctx.db
      .query("channelJoinRequests")
      .withIndex("by_channel_status", (q) =>
        q.eq("channelId", args.channelId).eq("status", "pending"),
      )
      .collect();

    // Enrich with user info
    const enriched = await Promise.all(
      requests.map(async (req) => {
        const user = await ctx.db.get(req.userId);
        return {
          _id: req._id,
          userId: req.userId,
          displayName: user
            ? getDisplayName(user.firstName, user.lastName)
            : "Unknown",
          profilePhoto: user ? getMediaUrl(user.profilePhoto) : undefined,
          requestedAt: req.requestedAt,
        };
      }),
    );

    return enriched;
  },
});

/**
 * Get total pending request count across all channels in a group (for banner).
 */
export const getPendingRequestCountByGroup = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Verify user is a group leader
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId),
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership || !isLeaderRole(groupMembership.role)) {
      return { count: 0, firstChannelSlug: null };
    }

    const requests = await ctx.db
      .query("channelJoinRequests")
      .withIndex("by_group_status", (q) =>
        q.eq("groupId", args.groupId).eq("status", "pending"),
      )
      .collect();

    // Get first channel slug for navigation
    let firstChannelSlug: string | null = null;
    if (requests.length > 0) {
      const firstChannel = await ctx.db.get(requests[0].channelId);
      firstChannelSlug = firstChannel?.slug || null;
    }

    return { count: requests.length, firstChannelSlug };
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Enable invite link for a channel. Generates shortId if not set.
 */
export const enableInviteLink = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  returns: v.object({ shortId: v.string() }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const channel = await ctx.db.get(args.channelId);
    if (!channel) throw new ConvexError("Channel not found");
    if (!channel.groupId) throw new ConvexError("This operation is only valid for group channels");
    const groupId = channel.groupId;

    // Only custom channels
    if (channel.channelType !== "custom") {
      throw new ConvexError(
        "Invite links are only available for custom channels.",
      );
    }

    // Verify user is a group leader
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", userId),
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership || !isLeaderRole(groupMembership.role)) {
      throw new ConvexError("Only group leaders can manage invite links.");
    }

    const shortId = channel.inviteShortId || generateShortId();
    await ctx.db.patch(args.channelId, {
      inviteShortId: shortId,
      inviteEnabled: true,
      updatedAt: Date.now(),
    });

    return { shortId };
  },
});

/**
 * Disable invite link for a channel.
 */
export const disableInviteLink = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const channel = await ctx.db.get(args.channelId);
    if (!channel) throw new ConvexError("Channel not found");
    if (!channel.groupId) throw new ConvexError("This operation is only valid for group channels");
    const groupId = channel.groupId;

    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", userId),
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership || !isLeaderRole(groupMembership.role)) {
      throw new ConvexError("Only group leaders can manage invite links.");
    }

    await ctx.db.patch(args.channelId, {
      inviteEnabled: false,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Regenerate invite link (old link stops working instantly).
 */
export const regenerateInviteLink = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  returns: v.object({ shortId: v.string() }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const channel = await ctx.db.get(args.channelId);
    if (!channel) throw new ConvexError("Channel not found");
    if (!channel.groupId) throw new ConvexError("This operation is only valid for group channels");
    const groupId = channel.groupId;

    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", userId),
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership || !isLeaderRole(groupMembership.role)) {
      throw new ConvexError("Only group leaders can manage invite links.");
    }

    const shortId = generateShortId();
    await ctx.db.patch(args.channelId, {
      inviteShortId: shortId,
      inviteEnabled: true,
      updatedAt: Date.now(),
    });

    return { shortId };
  },
});

/**
 * Update channel join mode.
 */
export const updateJoinMode = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    joinMode: v.union(v.literal("open"), v.literal("approval_required")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const channel = await ctx.db.get(args.channelId);
    if (!channel) throw new ConvexError("Channel not found");
    if (!channel.groupId) throw new ConvexError("This operation is only valid for group channels");
    const groupId = channel.groupId;

    if (channel.channelType !== "custom") {
      throw new ConvexError("Join mode can only be set on custom channels.");
    }

    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", userId),
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership || !isLeaderRole(groupMembership.role)) {
      throw new ConvexError("Only group leaders can change join mode.");
    }

    await ctx.db.patch(args.channelId, {
      joinMode: args.joinMode,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Join via invite link. Behavior depends on channel's joinMode.
 */
export const joinViaInviteLink = mutation({
  args: {
    token: v.string(),
    shortId: v.string(),
  },
  returns: v.object({
    joined: v.optional(v.boolean()),
    requested: v.optional(v.boolean()),
    channelId: v.optional(v.id("chatChannels")),
    groupId: v.optional(v.id("groups")),
    channelSlug: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Look up channel by shortId
    const channel = await ctx.db
      .query("chatChannels")
      .withIndex("by_inviteShortId", (q) => q.eq("inviteShortId", args.shortId))
      .first();

    if (!channel || !channel.inviteEnabled || channel.isArchived || !channelIsLeaderEnabled(channel)) {
      throw new ConvexError("This invite link is no longer valid.");
    }
    if (!channel.groupId) {
      throw new ConvexError("This operation is only valid for group channels");
    }

    // Verify user is a member of any eligible group (primary + accepted shared groups)
    const eligibleGroupIds = getEligibleGroupIds(channel);
    const userGroupMemberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();
    const isEligibleGroupMember = userGroupMemberships.some((m) =>
      eligibleGroupIds.has(m.groupId)
    );

    if (!isEligibleGroupMember) {
      throw new ConvexError(
        "You must be a member of the group to join this channel.",
      );
    }

    // Check if user already has a channel membership record (active or former)
    const existingMembership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", channel._id).eq("userId", userId),
      )
      .first();

    if (existingMembership && !existingMembership.leftAt) {
      // Already an active member
      return {
        joined: true,
        channelId: channel._id,
        groupId: channel.groupId,
        channelSlug: channel.slug,
      };
    }

    const joinMode = channel.joinMode || "open";

    if (joinMode === "open") {
      const user = await ctx.db.get(userId);
      const now = Date.now();

      if (existingMembership && existingMembership.leftAt) {
        // Reactivate former member
        await ctx.db.patch(existingMembership._id, {
          leftAt: undefined,
          joinedAt: now,
          displayName: user
            ? getDisplayName(user.firstName, user.lastName)
            : undefined,
          profilePhoto: user ? getMediaUrl(user.profilePhoto) : undefined,
        });
      } else {
        // Add new user to channel
        await ctx.db.insert("chatChannelMembers", {
          channelId: channel._id,
          userId,
          role: "member",
          joinedAt: now,
          isMuted: false,
          displayName: user
            ? getDisplayName(user.firstName, user.lastName)
            : undefined,
          profilePhoto: user ? getMediaUrl(user.profilePhoto) : undefined,
        });
      }

      // Update member count
      await ctx.db.patch(channel._id, {
        memberCount: channel.memberCount + 1,
        updatedAt: now,
      });

      return {
        joined: true,
        channelId: channel._id,
        groupId: channel.groupId,
        channelSlug: channel.slug,
      };
    } else {
      // approval_required mode — check for existing requests
      const existingRequest = await ctx.db
        .query("channelJoinRequests")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channel._id).eq("userId", userId),
        )
        .first();

      if (existingRequest) {
        if (existingRequest.status === "pending") {
          return {
            requested: true,
            channelId: channel._id,
            groupId: channel.groupId,
            channelSlug: channel.slug,
          };
        }

        if (existingRequest.status === "declined") {
          const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
          const declinedAt = existingRequest.reviewedAt || existingRequest.requestedAt;
          const timeSinceDecline = Date.now() - declinedAt;

          if (timeSinceDecline < COOLDOWN_MS) {
            throw new ConvexError(
              "Your previous request was declined. Please wait 24 hours before requesting again.",
            );
          }

          // Cooldown passed - update the existing declined request to pending
          await ctx.db.patch(existingRequest._id, {
            status: "pending",
            requestedAt: Date.now(),
            reviewedAt: undefined,
            reviewedById: undefined,
          });

          // Schedule notification to group leaders
          await ctx.scheduler.runAfter(
            0,
            internal.functions.notifications.senders.notifyChannelJoinRequest,
            {
              channelId: channel._id,
              groupId: channel.groupId,
              requesterId: userId,
              channelName: channel.name,
              channelSlug: channel.slug || "",
            },
          );

          return {
            requested: true,
            channelId: channel._id,
            groupId: channel.groupId,
            channelSlug: channel.slug,
          };
        }

        // existingRequest has status "approved" - user was previously approved
        // but left or was removed. Allow them to create a new request.
      }

      // Create join request (only for users without an existing pending/declined request)
      await ctx.db.insert("channelJoinRequests", {
        channelId: channel._id,
        groupId: channel.groupId,
        userId,
        status: "pending",
        requestedAt: Date.now(),
      });

      // Schedule notification to group leaders
      await ctx.scheduler.runAfter(
        0,
        internal.functions.notifications.senders.notifyChannelJoinRequest,
        {
          channelId: channel._id,
          groupId: channel.groupId,
          requesterId: userId,
          channelName: channel.name,
          channelSlug: channel.slug || "",
        },
      );

      return {
        requested: true,
        channelId: channel._id,
        groupId: channel.groupId,
        channelSlug: channel.slug,
      };
    }
  },
});

/**
 * Approve a join request.
 */
export const approveJoinRequest = mutation({
  args: {
    token: v.string(),
    requestId: v.id("channelJoinRequests"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const request = await ctx.db.get(args.requestId);
    if (!request || request.status !== "pending") {
      throw new ConvexError("Join request not found or already processed.");
    }

    const channel = await ctx.db.get(request.channelId);
    if (!channel) throw new ConvexError("Channel not found.");
    if (!channel.groupId) throw new ConvexError("This operation is only valid for group channels");
    const groupId = channel.groupId;

    // Verify user is a group leader
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", userId),
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership || !isLeaderRole(groupMembership.role)) {
      throw new ConvexError("Only group leaders can approve join requests.");
    }

    // Update request
    const now = Date.now();
    await ctx.db.patch(args.requestId, {
      status: "approved",
      reviewedAt: now,
      reviewedById: userId,
    });

    // Check if user already has a channel membership record (active or former)
    const existingMembership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", channel._id).eq("userId", request.userId),
      )
      .first();

    if (existingMembership) {
      if (existingMembership.leftAt) {
        // Reactivate former member
        const requestUser = await ctx.db.get(request.userId);
        await ctx.db.patch(existingMembership._id, {
          leftAt: undefined,
          joinedAt: now,
          displayName: requestUser
            ? getDisplayName(requestUser.firstName, requestUser.lastName)
            : undefined,
          profilePhoto: requestUser
            ? getMediaUrl(requestUser.profilePhoto)
            : undefined,
        });

        // Update member count
        await ctx.db.patch(channel._id, {
          memberCount: channel.memberCount + 1,
          updatedAt: now,
        });
      }
      // If already an active member, skip (request is still marked approved)
    } else {
      // Add user to channel
      const requestUser = await ctx.db.get(request.userId);
      await ctx.db.insert("chatChannelMembers", {
        channelId: channel._id,
        userId: request.userId,
        role: "member",
        joinedAt: now,
        isMuted: false,
        displayName: requestUser
          ? getDisplayName(requestUser.firstName, requestUser.lastName)
          : undefined,
        profilePhoto: requestUser
          ? getMediaUrl(requestUser.profilePhoto)
          : undefined,
      });

      // Update member count
      await ctx.db.patch(channel._id, {
        memberCount: channel.memberCount + 1,
        updatedAt: now,
      });
    }

    // Notify requester
    await ctx.scheduler.runAfter(
      0,
      internal.functions.notifications.senders.notifyChannelJoinRequestApproved,
      {
        userId: request.userId,
        channelId: channel._id,
        groupId: channel.groupId,
        channelName: channel.name,
        channelSlug: channel.slug || "",
      },
    );
  },
});

/**
 * Decline a join request.
 */
export const declineJoinRequest = mutation({
  args: {
    token: v.string(),
    requestId: v.id("channelJoinRequests"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const request = await ctx.db.get(args.requestId);
    if (!request || request.status !== "pending") {
      throw new ConvexError("Join request not found or already processed.");
    }

    const channel = await ctx.db.get(request.channelId);
    if (!channel) throw new ConvexError("Channel not found.");
    if (!channel.groupId) throw new ConvexError("This operation is only valid for group channels");
    const groupId = channel.groupId;

    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", userId),
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership || !isLeaderRole(groupMembership.role)) {
      throw new ConvexError("Only group leaders can decline join requests.");
    }

    await ctx.db.patch(args.requestId, {
      status: "declined",
      reviewedAt: Date.now(),
      reviewedById: userId,
    });

    // Notify requester
    await ctx.scheduler.runAfter(
      0,
      internal.functions.notifications.senders.notifyChannelJoinRequestDeclined,
      {
        userId: request.userId,
        channelId: channel._id,
        groupId: channel.groupId,
        channelName: channel.name,
      },
    );
  },
});

/**
 * Bulk approve all pending requests for a channel.
 */
export const bulkApproveRequests = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  returns: v.object({ approvedCount: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const channel = await ctx.db.get(args.channelId);
    if (!channel) throw new ConvexError("Channel not found");
    if (!channel.groupId) throw new ConvexError("This operation is only valid for group channels");
    const groupId = channel.groupId;

    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", userId),
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership || !isLeaderRole(groupMembership.role)) {
      throw new ConvexError("Only group leaders can approve join requests.");
    }

    const requests = await ctx.db
      .query("channelJoinRequests")
      .withIndex("by_channel_status", (q) =>
        q.eq("channelId", args.channelId).eq("status", "pending"),
      )
      .collect();

    const now = Date.now();
    let addedCount = 0;

    for (const request of requests) {
      // Update request
      await ctx.db.patch(request._id, {
        status: "approved",
        reviewedAt: now,
        reviewedById: userId,
      });

      // Check if user already has a channel membership record (active or former)
      const existingMembership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channel._id).eq("userId", request.userId),
        )
        .first();

      if (existingMembership) {
        if (existingMembership.leftAt) {
          // Reactivate former member
          const requestUser = await ctx.db.get(request.userId);
          await ctx.db.patch(existingMembership._id, {
            leftAt: undefined,
            joinedAt: now,
            displayName: requestUser
              ? getDisplayName(requestUser.firstName, requestUser.lastName)
              : undefined,
            profilePhoto: requestUser
              ? getMediaUrl(requestUser.profilePhoto)
              : undefined,
          });
          addedCount++;
        }
        // If already an active member, skip (request is still marked approved)
      } else {
        // Add user to channel
        const requestUser = await ctx.db.get(request.userId);
        await ctx.db.insert("chatChannelMembers", {
          channelId: channel._id,
          userId: request.userId,
          role: "member",
          joinedAt: now,
          isMuted: false,
          displayName: requestUser
            ? getDisplayName(requestUser.firstName, requestUser.lastName)
            : undefined,
          profilePhoto: requestUser
            ? getMediaUrl(requestUser.profilePhoto)
            : undefined,
        });
        addedCount++;
      }

      // Notify each requester
      await ctx.scheduler.runAfter(
        0,
        internal.functions.notifications.senders
          .notifyChannelJoinRequestApproved,
        {
          userId: request.userId,
          channelId: channel._id,
          groupId: channel.groupId,
          channelName: channel.name,
          channelSlug: channel.slug || "",
        },
      );
    }

    // Update member count
    if (addedCount > 0) {
      await ctx.db.patch(channel._id, {
        memberCount: channel.memberCount + addedCount,
        updatedAt: now,
      });
    }

    return { approvedCount: requests.length };
  },
});

/**
 * Cancel a pending join request (by the requester).
 */
export const cancelJoinRequest = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const request = await ctx.db
      .query("channelJoinRequests")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", userId),
      )
      .filter((q) => q.eq(q.field("status"), "pending"))
      .first();

    if (!request) {
      throw new ConvexError("No pending request found.");
    }

    // Delete the request
    await ctx.db.delete(request._id);
  },
});
