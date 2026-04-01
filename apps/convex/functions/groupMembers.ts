/**
 * Group Members functions
 *
 * Handles group membership MUTATIONS and PAGINATED QUERIES:
 * - list: Paginated member list with cursor (used by mobile app)
 * - getMemberPreview: Public preview of group members
 * - add/remove: Membership mutations
 * - updateRole: Change member roles
 * - createJoinRequest/cancelJoinRequest: Join request workflow
 *
 * NOTE ON FILE ORGANIZATION:
 * - This file contains MUTATIONS and the main PAGINATED LIST query
 * - The `groups/members.ts` file contains simple CHECK queries:
 *   - getLeaders, isLeader, getMembership, myLeaderGroups
 *
 * Mobile app usage:
 * - Uses `api.functions.groupMembers.list` for paginated member lists
 * - Uses `api.functions.groupMembers.add/remove/updateRole` for mutations
 * - Uses `api.functions.groups.getLeaders` and `api.functions.groups.isLeader` for checks
 */

import { v } from "convex/values";
import { query, mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { now, normalizePagination, getDisplayName, getMediaUrl } from "../lib/utils";
import { paginationArgs, groupRoleValidator, memberStatusValidator } from "../lib/validators";
import { requireAuth, getOptionalAuth } from "../lib/auth";
import { isCommunityAdmin, ADMIN_ROLE_THRESHOLD } from "../lib/permissions";
import { syncUserChannelMembershipsLogic } from "./sync/memberships";
import { isActiveMembership, isActiveLeader, hasLeft } from "../lib/helpers";

// ============================================================================
// Member Queries
// ============================================================================

/**
 * Search members of a group for autocomplete (mentions)
 * Searches first name, last name, email, and phone
 */
export const search = query({
  args: {
    groupId: v.id("groups"),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const searchLimit = Math.min(args.limit ?? 10, 50);
    const searchTerm = args.query.toLowerCase();

    // Get active members of the group
    // Note: We collect all members for a group because:
    // 1. Groups typically have <100 members (most are <50)
    // 2. We need to search across user fields (name, email, phone) which requires fetching user data
    // 3. The alternative (text search index) would require denormalizing user data to groupMembers
    const members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    // Batch fetch all users upfront
    const userIds = members.map((m) => m.userId);
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));

    // Build userId -> user map for O(1) lookup
    const userMap = new Map<string, typeof users[0]>();
    users.forEach((user, i) => {
      if (user) {
        userMap.set(userIds[i], user);
      }
    });

    // Filter users by search term
    const matchingMembers = [];
    for (const member of members) {
      const user = userMap.get(member.userId);
      if (!user) continue;

      const firstName = (user.firstName || "").toLowerCase();
      const lastName = (user.lastName || "").toLowerCase();
      const email = (user.email || "").toLowerCase();
      const phone = (user.phone || "").toLowerCase();

      if (
        firstName.includes(searchTerm) ||
        lastName.includes(searchTerm) ||
        email.includes(searchTerm) ||
        phone.includes(searchTerm)
      ) {
        matchingMembers.push({
          id: user._id,
          firstName: user.firstName || "",
          lastName: user.lastName || "",
          profileImage: getMediaUrl(user.profilePhoto),
        });
      }

      if (matchingMembers.length >= searchLimit) break;
    }

    return matchingMembers;
  },
});

/**
 * List members of a group with pagination
 *
 * SECURITY: Only returns members if the caller is a group member or community admin.
 * Non-members receive an empty response to prevent member list data leakage.
 */
export const list = query({
  args: {
    groupId: v.id("groups"),
    token: v.optional(v.string()),
    includeInactive: v.optional(v.boolean()),
    role: v.optional(groupRoleValidator),
    ...paginationArgs,
  },
  handler: async (ctx, args) => {
    // Get group to check community
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      return { items: [], totalCount: 0, hasMore: false };
    }

    // Check authorization
    const userId = await getOptionalAuth(ctx, args.token);

    // Check if user is a community admin
    const isCommAdmin = userId
      ? await isCommunityAdmin(ctx, group.communityId, userId)
      : false;

    // Check if user is a member of this group
    let isGroupMember = false;
    if (userId) {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", args.groupId).eq("userId", userId)
        )
        .first();
      isGroupMember = !!(membership && !membership.leftAt &&
        (!membership.requestStatus || membership.requestStatus === "accepted"));
    }

    // SECURITY: Only members and community admins can see member list
    if (!isGroupMember && !isCommAdmin) {
      return { items: [], totalCount: 0, hasMore: false };
    }

    const { limit } = normalizePagination(args);
    const cursorIndex = args.cursor ? parseInt(args.cursor, 10) : 0;

    // Get all members for this group
    // Note: We collect all members because:
    // 1. Groups typically have <100 members (most are <50)
    // 2. We need to filter by active status and optionally by role
    // 3. We need to sort by role priority and join date
    // For very large groups (>500 members), consider adding denormalized indexes
    let members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    // Filter by active status
    if (!args.includeInactive) {
      members = members.filter((m) => m.leftAt === undefined);
    }

    // Filter by role if specified
    if (args.role) {
      members = members.filter((m) => m.role === args.role);
    }

    // Sort by role (leaders first), then by user name
    // We need to fetch users first to sort by name, so we'll sort by role and joinedAt for now
    // and let the final sorting happen after user data is fetched
    members = members.sort((a, b) => {
      // Role priority: leader > member
      const roleOrder: Record<string, number> = { leader: 0, member: 1 };
      const roleA = roleOrder[a.role] ?? 2;
      const roleB = roleOrder[b.role] ?? 2;
      if (roleA !== roleB) return roleA - roleB;
      // Then by join date
      return a.joinedAt - b.joinedAt;
    });

    // Get total count before pagination
    const totalCount = members.length;

    // Apply cursor-based pagination
    const paginatedMembers = members.slice(cursorIndex, cursorIndex + limit);
    const hasMore = cursorIndex + limit < totalCount;
    const nextCursor = hasMore ? String(cursorIndex + limit) : undefined;

    // Batch fetch all users upfront
    const userIds = paginatedMembers.map((m) => m.userId);
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));

    // Build userId -> user map for O(1) lookup
    const userMap = new Map<string, typeof users[0]>();
    users.forEach((user, i) => {
      if (user) {
        userMap.set(userIds[i], user);
      }
    });

    // Map members to response with user details
    const membersWithUsers = paginatedMembers.map((member) => {
      const user = userMap.get(member.userId);
      return {
        id: member._id,
        odUserId: member.userId,
        role: member.role,
        joinedAt: member.joinedAt,
        leftAt: member.leftAt,
        notificationsEnabled: member.notificationsEnabled,
        user: user
          ? {
              id: user._id,
              firstName: user.firstName || "",
              lastName: user.lastName || "",
              email: user.email || "",
              profileImage: getMediaUrl(user.profilePhoto),
            }
          : null,
      };
    });

    const items = membersWithUsers.filter((m) => m.user !== null);

    return {
      items,
      totalCount,
      nextCursor,
      hasMore,
    };
  },
});

/**
 * Get a public preview of group members
 * Returns first few members' basic info (name, avatar) and total count
 * Accessible to anyone - used to show member preview to non-members
 */
export const getMemberPreview = query({
  args: {
    groupId: v.id("groups"),
    limit: v.optional(v.number()), // How many members to show (default 5)
  },
  handler: async (ctx, args) => {
    const previewLimit = args.limit ?? 5;

    // Get group to verify it exists
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      return { members: [], totalCount: 0 };
    }

    // Get all active members for this group
    // Note: We collect all members because:
    // 1. Groups typically have <100 members (most are <50)
    // 2. We need to filter by active status and request status
    // 3. We only return a small preview (default 5 members)
    let members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    // Filter to active members only (include both "accepted" and "approved" status for join requests)
    members = members.filter((m) => !m.leftAt && (!m.requestStatus || m.requestStatus === "accepted" || m.requestStatus === "approved"));

    const totalCount = members.length;

    // Sort by role (leaders first), then by join date
    members = members.sort((a, b) => {
      const roleOrder: Record<string, number> = { leader: 0, member: 1 };
      const roleA = roleOrder[a.role] ?? 2;
      const roleB = roleOrder[b.role] ?? 2;
      if (roleA !== roleB) return roleA - roleB;
      return a.joinedAt - b.joinedAt;
    });

    // Take only the preview limit
    const previewMembers = members.slice(0, previewLimit);

    // Batch fetch users
    const userIds = previewMembers.map((m) => m.userId);
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));

    // Build response with limited public info only
    const membersPreview = previewMembers
      .map((member, i) => {
        const user = users[i];
        if (!user) return null;
        return {
          id: user._id,
          firstName: user.firstName || "",
          lastName: user.lastName || "",
          profileImage: getMediaUrl(user.profilePhoto),
          role: member.role,
        };
      })
      .filter(Boolean);

    return {
      members: membersPreview,
      totalCount,
    };
  },
});

// ============================================================================
// Member Mutations
// ============================================================================

/**
 * Add a member to a group
 */
export const add = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    userId: v.id("users"),
    role: v.optional(groupRoleValidator),
  },
  handler: async (ctx, args) => {
    const addedBy = await requireAuth(ctx, args.token);
    const timestamp = now();

    // Get the group to check community admin status
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new Error("Group not found");
    }

    // Verify caller is a leader of this group
    const callerMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", addedBy)
      )
      .first();

    const isGroupLeaderOrAdmin = isActiveLeader(callerMembership);

    // Check if user is a community admin
    const isCommAdmin = await isCommunityAdmin(ctx, group.communityId, addedBy);

    if (!isGroupLeaderOrAdmin && !isCommAdmin) {
      throw new Error("Only group leaders or community admins can add members");
    }

    // Check if user exists
    const userToAdd = await ctx.db.get(args.userId);
    if (!userToAdd) {
      throw new Error("User not found");
    }

    // Check if user is already an active member
    const existingMember = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", args.userId)
      )
      .first();

    // Check if already an active member (avoid type guard narrowing issue)
    if (existingMember && !existingMember.leftAt) {
      throw new Error("User is already a member of this group");
    }

    // If previous membership exists (but inactive), reactivate it
    if (existingMember) {
      await ctx.db.patch(existingMember._id, {
        role: args.role || "member",
        leftAt: undefined,
        joinedAt: timestamp,
        notificationsEnabled: true,
      });

      // Sync channel memberships (transactional - prevents race conditions)
      await syncUserChannelMembershipsLogic(ctx, args.userId, args.groupId);

      // Check and sync to PCO auto-channels (background job)
      // Delay allows any PCO person linking to complete first
      await ctx.scheduler.runAfter(
        2000,
        internal.functions.pcoServices.rotation.checkAndSyncUserToAutoChannels,
        { userId: args.userId, groupId: args.groupId }
      );

      // Create followup score doc for reactivated member
      await ctx.scheduler.runAfter(
        0,
        internal.functions.followupScoreComputation.computeSingleMemberScore,
        { groupId: args.groupId, groupMemberId: existingMember._id }
      );

      // Recompute community score for reactivated member
      await ctx.scheduler.runAfter(
        0,
        internal.functions.communityScoreComputation.recomputeForGroupMember,
        { groupId: args.groupId, userId: args.userId }
      );

      // userToAdd was already fetched and validated above
      return {
        id: existingMember._id,
        odUserId: existingMember.userId,
        role: args.role || "member",
        joinedAt: timestamp,
        notificationsEnabled: true,
        user: {
          id: userToAdd._id,
          firstName: userToAdd.firstName || "",
          lastName: userToAdd.lastName || "",
          email: userToAdd.email || "",
          profileImage: getMediaUrl(userToAdd.profilePhoto),
        },
      };
    }

    // Create new membership
    const memberId = await ctx.db.insert("groupMembers", {
      groupId: args.groupId,
      userId: args.userId,
      role: args.role || "member",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    // Trigger welcome bot for NEW members only (non-blocking)
    // Returning members are handled in the if-block above (they don't reach this code)
    await ctx.scheduler.runAfter(
      0,
      internal.functions.scheduledJobs.sendWelcomeMessage,
      {
        groupId: args.groupId,
        userId: args.userId,
      }
    );

    // Sync channel memberships (transactional - prevents race conditions)
    await syncUserChannelMembershipsLogic(ctx, args.userId, args.groupId);

    // Check and sync to PCO auto-channels (background job)
    // Delay allows any PCO person linking to complete first
    await ctx.scheduler.runAfter(
      2000,
      internal.functions.pcoServices.rotation.checkAndSyncUserToAutoChannels,
      { userId: args.userId, groupId: args.groupId }
    );

    // Create followup score doc for new member
    await ctx.scheduler.runAfter(
      0,
      internal.functions.followupScoreComputation.computeSingleMemberScore,
      { groupId: args.groupId, groupMemberId: memberId }
    );

    // Recompute community score for new member
    await ctx.scheduler.runAfter(
      0,
      internal.functions.communityScoreComputation.recomputeForGroupMember,
      { groupId: args.groupId, userId: args.userId }
    );

    return {
      id: memberId,
      odUserId: args.userId,
      role: args.role || "member",
      joinedAt: timestamp,
      notificationsEnabled: true,
      user: {
        id: userToAdd._id,
        firstName: userToAdd.firstName || "",
        lastName: userToAdd.lastName || "",
        email: userToAdd.email || "",
        profileImage: getMediaUrl(userToAdd.profilePhoto),
      },
    };
  },
});

/**
 * Remove a member from a group (soft delete)
 */
export const remove = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const removedBy = await requireAuth(ctx, args.token);

    // Check if this is an announcement group
    const group = await ctx.db.get(args.groupId);
    if (group?.isAnnouncementGroup) {
      throw new Error(
        `You cannot leave ${group.name}. To leave, go to Settings and leave the community.`
      );
    }

    // Allow users to remove themselves (leave group) without being a leader
    const isSelfRemoval = removedBy === args.userId;

    if (!isSelfRemoval) {
      // Verify the requesting user is a leader of this group
      const leaderMembership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", args.groupId).eq("userId", removedBy)
        )
        .first();

      if (!isActiveLeader(leaderMembership)) {
        throw new Error("Only group leaders can remove other members");
      }
    }

    // Find active membership
    const member = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", args.userId)
      )
      .first();

    if (!isActiveMembership(member)) {
      throw new Error("Member not found or already removed");
    }

    // Soft delete by setting leftAt
    await ctx.db.patch(member._id, {
      leftAt: now(),
    });

    // Delete followup score doc for this member
    await ctx.scheduler.runAfter(
      0,
      internal.functions.followupScoreComputation.deleteScoreDoc,
      { groupMemberId: member._id }
    );

    // Sync channel memberships (transactional - prevents race conditions)
    await syncUserChannelMembershipsLogic(ctx, args.userId, args.groupId);

    return { success: true };
  },
});

/**
 * Update a member's role
 */
export const updateRole = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    userId: v.id("users"),
    role: groupRoleValidator,
  },
  handler: async (ctx, args) => {
    const updatedBy = await requireAuth(ctx, args.token);

    // Get the group to find the community
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new Error("Group not found");
    }

    // SECURITY: Block role changes in announcement groups
    // Announcement group roles are managed automatically based on community admin status
    if (group.isAnnouncementGroup) {
      throw new Error(
        "Cannot manually change roles in announcement groups. Roles are managed automatically based on community admin status."
      );
    }

    // Check if user is a group leader/admin
    const leaderMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", updatedBy)
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("leftAt"), undefined),
          q.or(
            q.eq(q.field("requestStatus"), undefined),
            q.eq(q.field("requestStatus"), "accepted")
          )
        )
      )
      .first();

    const isGroupLeaderOrAdminRole = isActiveLeader(leaderMembership);

    // Check if user is a community admin
    const isCommAdmin = await isCommunityAdmin(ctx, group.communityId, updatedBy);

    if (!isGroupLeaderOrAdminRole && !isCommAdmin) {
      throw new Error("Only group leaders or community admins can update member roles");
    }

    // Find active membership
    const member = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", args.userId)
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("leftAt"), undefined),
          q.or(
            q.eq(q.field("requestStatus"), undefined),
            q.eq(q.field("requestStatus"), "accepted")
          )
        )
      )
      .first();

    if (!isActiveMembership(member)) {
      throw new Error("Member not found");
    }

    const previousRole = member.role;

    await ctx.db.patch(member._id, {
      role: args.role,
    });

    // Sync channel memberships (transactional - prevents race conditions)
    await syncUserChannelMembershipsLogic(ctx, args.userId, args.groupId);

    // Notify user if they were promoted to leader (non-blocking)
    if (args.role === "leader" && previousRole !== "leader") {
      ctx.scheduler.runAfter(0, internal.functions.notifications.senders.notifyLeaderPromotion, {
        userId: args.userId,
        groupId: args.groupId,
      });
    }

    const user = await ctx.db.get(member.userId);

    return {
      id: member._id,
      odUserId: member.userId,
      role: args.role,
      joinedAt: member.joinedAt,
      notificationsEnabled: member.notificationsEnabled,
      user: user
        ? {
            id: user._id,
            firstName: user.firstName || "",
            lastName: user.lastName || "",
            email: user.email || "",
            profileImage: getMediaUrl(user.profilePhoto),
          }
        : null,
    };
  },
});

// ============================================================================
// Join Requests
// ============================================================================

/**
 * Request status validator
 * Note: "accepted" is used (not "approved") to match query filters in listForUser
 */
const joinRequestStatusValidator = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("declined")
);

/**
 * Create a join request for a group
 */
export const createJoinRequest = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const timestamp = now();

    // Check if already an active member
    const existingMember = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .first();

    if (existingMember && !existingMember.leftAt) {
      throw new Error("You are already a member of this group");
    }

    // Check for existing pending request
    if (existingMember && existingMember.requestStatus === "pending") {
      throw new Error("You already have a pending join request for this group");
    }

    // Update existing record or create new one
    if (existingMember) {
      await ctx.db.patch(existingMember._id, {
        requestStatus: "pending",
        requestedAt: timestamp,
        requestReviewedAt: undefined,
        requestReviewedById: undefined,
      });

      // Schedule notification to community admins (non-blocking)
      ctx.scheduler.runAfter(0, internal.functions.notifications.senders.notifyJoinRequestReceived, {
        groupId: args.groupId,
        requesterId: userId,
      });

      return {
        id: existingMember._id,
        groupId: existingMember.groupId,
        status: "pending",
        requestedAt: timestamp,
      };
    }

    // Create new membership record with pending status
    const memberId = await ctx.db.insert("groupMembers", {
      groupId: args.groupId,
      userId,
      role: "member",
      joinedAt: timestamp,
      leftAt: timestamp, // Mark as left until approved
      notificationsEnabled: true,
      requestStatus: "pending",
      requestedAt: timestamp,
    });

    // Schedule notification to community admins (non-blocking)
    ctx.scheduler.runAfter(0, internal.functions.notifications.senders.notifyJoinRequestReceived, {
      groupId: args.groupId,
      requesterId: userId,
    });

    return {
      id: memberId,
      groupId: args.groupId,
      status: "pending",
      requestedAt: timestamp,
    };
  },
});

/**
 * Cancel own pending join request
 */
export const cancelJoinRequest = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const request = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .first();

    if (!request || request.requestStatus !== "pending") {
      throw new Error("No pending join request found");
    }

    await ctx.db.patch(request._id, {
      requestStatus: "declined",
      requestReviewedAt: now(),
    });

    return { success: true };
  },
});

/**
 * Review (approve or decline) a pending join request
 * Only group leaders or community admins can review requests
 */
export const reviewJoinRequest = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    userId: v.id("users"),
    decision: v.union(v.literal("accepted"), v.literal("declined")),
  },
  handler: async (ctx, args) => {
    const reviewerId = await requireAuth(ctx, args.token);
    const timestamp = now();

    // Get the group
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new Error("Group not found");
    }

    // Verify caller is a group leader or community admin
    const callerMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", reviewerId)
      )
      .first();

    const isGroupLeaderOrAdmin = isActiveLeader(callerMembership);
    const isCommAdmin = await isCommunityAdmin(ctx, group.communityId, reviewerId);

    if (!isGroupLeaderOrAdmin && !isCommAdmin) {
      throw new Error("Only group leaders or community admins can review join requests");
    }

    // Find the pending request
    const request = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", args.userId)
      )
      .first();

    if (!request || request.requestStatus !== "pending") {
      throw new Error("No pending join request found for this user");
    }

    if (args.decision === "accepted") {
      // Same returning-member heuristic as admin/requests.reviewPendingRequest
      const isReturningMember = request.joinedAt !== request.requestedAt;

      // Approve: activate membership
      await ctx.db.patch(request._id, {
        requestStatus: "accepted",
        requestReviewedAt: timestamp,
        requestReviewedById: reviewerId,
        leftAt: undefined, // Clear leftAt to make them an active member
        joinedAt: timestamp,
      });

      // Sync channel memberships for the new member
      await syncUserChannelMembershipsLogic(ctx, args.userId, args.groupId);

      await ctx.scheduler.runAfter(
        0,
        internal.functions.followupScoreComputation.computeSingleMemberScore,
        { groupId: args.groupId, groupMemberId: request._id }
      );

      await ctx.scheduler.runAfter(
        0,
        internal.functions.communityScoreComputation.recomputeForGroupMember,
        { groupId: args.groupId, userId: args.userId }
      );

      if (!isReturningMember) {
        await ctx.scheduler.runAfter(
          0,
          internal.functions.scheduledJobs.sendWelcomeMessage,
          {
            groupId: args.groupId,
            userId: args.userId,
          }
        );
      }

      await ctx.scheduler.runAfter(
        0,
        internal.functions.notifications.senders.notifyJoinRequestApproved,
        {
          userId: args.userId,
          groupId: args.groupId,
        }
      );
    } else {
      // Decline: update status
      await ctx.db.patch(request._id, {
        requestStatus: "declined",
        requestReviewedAt: timestamp,
        requestReviewedById: reviewerId,
      });
    }

    return {
      success: true,
      decision: args.decision,
      userId: args.userId,
      groupId: args.groupId,
    };
  },
});

/**
 * List pending join requests for a group
 * Only community admins can view join requests
 */
export const listJoinRequests = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    ...paginationArgs,
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get the group to find its community
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      return [];
    }

    // Verify caller is a community admin (role >= 3)
    const communityMembership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", group.communityId)
      )
      .first();

    if (!communityMembership || (communityMembership.roles ?? 0) < ADMIN_ROLE_THRESHOLD || communityMembership.status !== 1) {
      // Return empty list for non-admins (don't leak info about requests existing)
      return [];
    }

    const { limit } = normalizePagination(args);

    // Use compound index for efficient pending request lookup
    const requests = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_requestStatus", (q) =>
        q.eq("groupId", args.groupId).eq("requestStatus", "pending")
      )
      .take(limit);

    // Batch fetch all users upfront
    const userIds = requests.map((r) => r.userId);
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));

    // Build userId -> user map for O(1) lookup
    const userMap = new Map<string, typeof users[0]>();
    users.forEach((user, i) => {
      if (user) {
        userMap.set(userIds[i], user);
      }
    });

    // Map requests to response with user details
    const requestsWithUsers = requests.map((request) => {
      const user = userMap.get(request.userId);
      return {
        id: request._id,
        userId: request.userId,
        requestedAt: request.requestedAt,
        user: user
          ? {
              id: user._id,
              firstName: user.firstName || "",
              lastName: user.lastName || "",
              email: user.email || "",
              profileImage: getMediaUrl(user.profilePhoto),
            }
          : null,
      };
    });

    return requestsWithUsers.filter((r) => r.user !== null);
  },
});

