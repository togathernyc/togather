/**
 * Group member queries
 *
 * Simple queries for fetching group members and checking membership status.
 *
 * NOTE ON FILE ORGANIZATION:
 * - This file contains simple membership CHECK queries (getLeaders, isLeader, getMembership)
 * - The root-level `groupMembers.ts` contains:
 *   - MUTATIONS (add, remove, updateRole, createJoinRequest, cancelJoinRequest)
 *   - PAGINATED LIST query (list - with cursor-based pagination)
 *   - Public preview query (getMemberPreview)
 *
 * Mobile app usage:
 * - Uses `api.functions.groupMembers.list` for paginated member lists
 * - Uses `api.functions.groups.getLeaders` and `api.functions.groups.isLeader` from this file
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import { getMediaUrl } from "../../lib/utils";
import { getOptionalAuth } from "../../lib/auth";
import { isCommunityAdmin } from "../../lib/permissions";
import { isLeaderRole } from "../../lib/helpers";

/**
 * Get group leaders
 * NOTE: Consider adding a composite index `by_group_role` on (groupId, role) for better performance
 *
 * SECURITY: Only returns leaders if the caller is a group member or community admin.
 * Non-members receive an empty array to prevent leader list data leakage.
 */
export const getLeaders = query({
  args: {
    groupId: v.id("groups"),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get group to check community
    const group = await ctx.db.get(args.groupId);
    if (!group) return [];

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

    // SECURITY: Only members and community admins can see leader list
    if (!isGroupMember && !isCommAdmin) {
      return [];
    }

    // Add safety limit to prevent unbounded queries
    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) =>
        q.and(
          q.eq(q.field("leftAt"), undefined),
          q.eq(q.field("role"), "leader")
        )
      )
      .take(50);

    if (memberships.length === 0) return [];

    // Batch fetch all users
    const userIds = memberships.map((m) => m.userId);
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const userMap = new Map(
      users
        .filter((u): u is NonNullable<typeof u> => u !== null)
        .map((u) => [u._id, u])
    );

    // Build result using the map for O(1) lookup
    return memberships
      .map((membership) => {
        const user = userMap.get(membership.userId);
        return user
          ? {
              ...user,
              role: membership.role,
            }
          : null;
      })
      .filter(Boolean);
  },
});

/**
 * Check if current user is a member of a group
 */
export const getMembership = query({
  args: {
    token: v.optional(v.string()),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuth(ctx, args.token);
    if (!userId) return null;

    return await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .first();
  },
});

/**
 * Check if user is a leader of a group
 */
export const isLeader = query({
  args: {
    token: v.optional(v.string()),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuth(ctx, args.token);
    if (!userId) return { isLeader: false };

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .first();

    if (!membership || membership.leftAt) {
      return { isLeader: false };
    }

    return {
      isLeader: isLeaderRole(membership.role),
    };
  },
});

/**
 * Get groups where the current user has leader/admin role
 * Used for selecting which group to create events for
 */
export const myLeaderGroups = query({
  args: {
    token: v.optional(v.string()),
    communityId: v.optional(v.id("communities")),
  },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuth(ctx, args.token);
    if (!userId) return [];

    // Get user's leader/admin memberships with safety limit
    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) =>
        q.and(
          q.eq(q.field("leftAt"), undefined),
          q.or(
            q.eq(q.field("role"), "leader"),
            q.eq(q.field("role"), "admin")
          )
        )
      )
      .take(100);

    if (memberships.length === 0) return [];

    // Batch fetch all groups first
    const groupIds = memberships.map((m) => m.groupId);
    const allGroups = await Promise.all(groupIds.map((id) => ctx.db.get(id)));

    // Filter valid groups and build map
    const validGroups = allGroups.filter(
      (g): g is NonNullable<typeof g> =>
        g !== null &&
        !g.isArchived &&
        (!args.communityId || g.communityId === args.communityId)
    );

    if (validGroups.length === 0) return [];

    // Collect unique groupTypeIds and batch fetch them
    const groupTypeIds = [
      ...new Set(
        validGroups
          .map((g) => g.groupTypeId)
          .filter((id): id is NonNullable<typeof id> => id !== undefined)
      ),
    ];
    const groupTypes = await Promise.all(
      groupTypeIds.map((id) => ctx.db.get(id))
    );
    const groupTypeMap = new Map(
      groupTypes
        .filter((gt): gt is NonNullable<typeof gt> => gt !== null)
        .map((gt) => [gt._id, gt])
    );

    // Build result using the map for O(1) lookup
    const result = validGroups.map((group) => {
      const groupType = group.groupTypeId
        ? groupTypeMap.get(group.groupTypeId)
        : null;
      return {
        id: group._id,
        name: group.name,
        groupTypeName: groupType?.name || "Group",
        preview: getMediaUrl(group.preview),
      };
    });

    // Sort by name
    return result.sort((a, b) => a.name.localeCompare(b.name));
  },
});
