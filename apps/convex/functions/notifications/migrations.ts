/**
 * Migration Functions
 *
 * Functions for migrating data from Supabase to Convex and legacy ID lookups.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../_generated/server";
import { now } from "../../lib/utils";

/**
 * Upsert a push token from legacy Supabase data
 * Returns the Convex ID (creates new or updates existing)
 *
 * Note: isActive is accepted for migration compatibility but is ignored
 * when querying tokens. Token existence = push enabled.
 */
export const upsertPushTokenFromLegacy = internalMutation({
  args: {
    legacyId: v.string(),
    userId: v.id("users"),
    token: v.string(),
    platform: v.string(),
    deviceId: v.optional(v.string()),
    bundleId: v.optional(v.string()),
    environment: v.optional(v.string()),
    isActive: v.boolean(),
    lastUsedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Check if push token already exists by legacyId
    const existing = await ctx.db
      .query("pushTokens")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.legacyId))
      .first();

    const timestamp = now();
    const data = {
      legacyId: args.legacyId,
      userId: args.userId,
      token: args.token,
      platform: args.platform,
      deviceId: args.deviceId,
      bundleId: args.bundleId,
      environment: args.environment,
      isActive: args.isActive,
      lastUsedAt: args.lastUsedAt ?? timestamp,
      createdAt: args.createdAt ?? timestamp,
      updatedAt: args.updatedAt ?? timestamp,
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
      return existing._id;
    }

    return await ctx.db.insert("pushTokens", data);
  },
});

/**
 * Look up Convex user ID from legacy user ID
 */
export const getUserByLegacyId = internalQuery({
  args: {
    legacyId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.legacyId))
      .first();

    return user;
  },
});

/**
 * Get group by legacy ID
 */
export const getGroupByLegacyId = internalQuery({
  args: {
    legacyId: v.string(),
  },
  handler: async (ctx, args) => {
    const group = await ctx.db
      .query("groups")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.legacyId))
      .first();

    if (!group) {
      return null;
    }

    return {
      id: group._id,
      name: group.name,
    };
  },
});

/**
 * Get multiple users by legacy IDs
 */
export const getUsersByLegacyIds = internalQuery({
  args: {
    legacyIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const users: Array<{
      legacyId: string;
      convexId: string;
      firstName?: string;
      lastName?: string;
    }> = [];

    for (const legacyId of args.legacyIds) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_legacyId", (q) => q.eq("legacyId", legacyId))
        .first();

      if (user) {
        users.push({
          legacyId,
          convexId: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
        });
      }
    }

    return users;
  },
});

/**
 * Get group members with notifications enabled
 *
 * Performance: Uses .take(500) limit and batch fetches users to avoid N+1 queries
 */
export const getGroupMembersWithNotifications = internalQuery({
  args: {
    groupLegacyId: v.string(),
    excludeUserLegacyIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // Find group by legacy ID
    const group = await ctx.db
      .query("groups")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.groupLegacyId))
      .first();

    if (!group) {
      return { members: [], groupName: null, groupId: null };
    }

    // Get active members with notifications enabled (limit to 500 to prevent unbounded reads)
    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", group._id))
      .filter((q) =>
        q.and(
          q.eq(q.field("leftAt"), undefined),
          q.eq(q.field("notificationsEnabled"), true)
        )
      )
      .take(500);

    if (memberships.length === 0) {
      return { members: [], groupName: group.name, groupId: group._id };
    }

    // Batch fetch all users at once to avoid N+1 queries
    const userIds = memberships.map((m) => m.userId);
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));

    // Build user lookup map for O(1) access
    const userMap = new Map<string, { legacyId?: string }>();
    for (let i = 0; i < userIds.length; i++) {
      const user = users[i];
      if (user) {
        userMap.set(userIds[i], { legacyId: user.legacyId });
      }
    }

    // Build exclusion set from legacy IDs
    const excludeSet = new Set(args.excludeUserLegacyIds);

    // Filter and build member list
    const members: Array<{
      convexUserId: string;
      legacyUserId: string | undefined;
    }> = [];

    for (const membership of memberships) {
      const user = userMap.get(membership.userId);
      if (!user) continue;

      // Skip if user is in exclude list (by legacy ID)
      if (user.legacyId && excludeSet.has(user.legacyId)) continue;

      members.push({
        convexUserId: membership.userId,
        legacyUserId: user.legacyId,
      });
    }

    return {
      members,
      groupName: group.name,
      groupId: group._id,
    };
  },
});
