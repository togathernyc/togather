/**
 * Notification Preferences Functions
 *
 * Functions for managing notification preferences including group notification settings
 * and channel preferences (push, email, SMS).
 */

import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { getCurrentEnvironment } from "../../lib/notifications/send";

// ============================================================================
// Group Notification Settings
// ============================================================================

/**
 * Toggle group notifications on/off
 * Updates groupMember.notificationsEnabled for the current user's membership
 */
export const setGroupNotifications = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!membership) {
      throw new Error("Group membership not found");
    }

    await ctx.db.patch(membership._id, {
      notificationsEnabled: args.enabled,
    });

    return {
      groupId: args.groupId,
      notificationsEnabled: args.enabled,
    };
  },
});

/**
 * Get group notification setting for a user
 */
export const getGroupNotifications = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    return {
      groupId: args.groupId,
      notificationsEnabled: membership?.notificationsEnabled ?? false,
    };
  },
});

// ============================================================================
// Global Notification Preferences
// ============================================================================

/**
 * Get notification preferences for a user
 *
 * Simplified model: Token existence = push enabled.
 *
 * Performance: Uses batch fetching for groups and groupTypes with Map lookups
 * to avoid N+1 queries. Also adds safety limits on membership queries.
 */
export const preferences = query({
  args: {
    token: v.string(),
    communityId: v.optional(v.id("communities")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const environment = getCurrentEnvironment();

    // Check if user has a push token for current environment
    // Token existence = push enabled (isActive is ignored)
    const pushToken = await ctx.db
      .query("pushTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("environment"), environment))
      .first();

    const notificationsEnabled = pushToken !== null;

    // Get user's groups with notification settings (limit to 200 for safety)
    const groupMemberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) =>
        q.and(
          q.eq(q.field("leftAt"), undefined),
          q.or(
            q.eq(q.field("requestStatus"), undefined),
            q.eq(q.field("requestStatus"), "accepted")
          )
        )
      )
      .take(200);

    if (groupMemberships.length === 0) {
      return {
        notificationsEnabled,
        isLeader: false,
        groups: [],
      };
    }

    // Batch fetch all groups at once
    const groupIds = groupMemberships.map((gm) => gm.groupId);
    const groupDocs = await Promise.all(groupIds.map((id) => ctx.db.get(id)));

    // Build group lookup map for O(1) access
    const groupMap = new Map<string, NonNullable<typeof groupDocs[number]>>();
    const groupTypeIds = new Set<Id<"groupTypes">>();

    for (let i = 0; i < groupIds.length; i++) {
      const group = groupDocs[i];
      if (group) {
        // Filter by community if specified
        if (args.communityId && group.communityId !== args.communityId) {
          continue;
        }
        groupMap.set(groupIds[i], group);
        if (group.groupTypeId) {
          groupTypeIds.add(group.groupTypeId);
        }
      }
    }

    // Batch fetch all group types at once
    const groupTypeIdArray = Array.from(groupTypeIds);
    const groupTypeDocs = await Promise.all(
      groupTypeIdArray.map((id) => ctx.db.get(id))
    );

    // Build group type lookup map for O(1) access
    const groupTypeMap = new Map<string, string>();
    for (let i = 0; i < groupTypeIdArray.length; i++) {
      const groupType = groupTypeDocs[i];
      if (groupType) {
        groupTypeMap.set(groupTypeIdArray[i], groupType.name || "");
      }
    }

    // Build final groups array
    const filteredGroups: Array<{
      id: Id<"groups">;
      name: string;
      groupType: string;
      notificationsEnabled: boolean | undefined;
      role: string | undefined;
    }> = [];

    for (const gm of groupMemberships) {
      const group = groupMap.get(gm.groupId);
      if (!group) continue;

      const groupTypeName = group.groupTypeId
        ? groupTypeMap.get(group.groupTypeId) || ""
        : "";

      filteredGroups.push({
        id: group._id,
        name: group.name || "",
        groupType: groupTypeName,
        notificationsEnabled: gm.notificationsEnabled,
        role: gm.role,
      });
    }

    // Check if user is a leader in any group
    const isLeader = filteredGroups.some((g) => g.role === "leader");

    return {
      notificationsEnabled,
      isLeader,
      groups: filteredGroups.map((g) => ({
        id: g.id,
        name: g.name,
        groupType: g.groupType,
        notificationsEnabled: g.notificationsEnabled,
      })),
    };
  },
});

/**
 * Update notification preferences
 *
 * Simplified model:
 * - Disable: Deletes tokens for current environment
 * - Enable: No-op - frontend should call registerToken instead
 *
 * Token existence = push enabled.
 */
export const updatePreferences = mutation({
  args: {
    token: v.string(),
    notificationsEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const environment = getCurrentEnvironment();

    if (args.notificationsEnabled === false) {
      // Disable: delete tokens for this environment
      const tokens = await ctx.db
        .query("pushTokens")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .filter((q) => q.eq(q.field("environment"), environment))
        .collect();

      for (const token of tokens) {
        await ctx.db.delete(token._id);
      }

      console.log(
        `[updatePreferences] Disabled push for user ${userId}: ` +
        `deleted ${tokens.length} token(s) in ${environment}`
      );
    } else {
      // Enable: no-op - frontend should call registerToken
      console.log(
        `[updatePreferences] Enable push requested for user ${userId}: ` +
        `frontend should call registerToken`
      );
    }

    return {
      success: true,
      notificationsEnabled: args.notificationsEnabled,
    };
  },
});

// ============================================================================
// Channel Preferences (Push, Email, SMS)
// ============================================================================

/**
 * Get user's notification channel preferences (push, email, SMS)
 *
 * Simplified model: Token existence = push enabled.
 */
export const getChannelPreferences = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const user = await ctx.db.get(userId);

    if (!user) {
      throw new Error("User not found");
    }

    const currentEnv = getCurrentEnvironment();

    // Push is enabled if user has a token for the current environment
    // Token existence = push enabled (isActive is ignored)
    const token = await ctx.db
      .query("pushTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("environment"), currentEnv))
      .first();

    return {
      push: {
        enabled: token !== null,
        available: true,
      },
      email: {
        enabled: user.emailNotificationsEnabled ?? true,
        available: !!user.email,
      },
      sms: {
        enabled: user.smsNotificationsEnabled ?? true,
        available: !!user.phone,
      },
    };
  },
});

/**
 * Update user's notification channel preferences
 *
 * For push notifications:
 * - Disable (push: false): Deletes the token for current environment
 * - Enable (push: true): No-op - user should call registerToken instead
 *
 * Token existence = push enabled.
 */
export const updateChannelPreferences = mutation({
  args: {
    token: v.string(),
    push: v.optional(v.boolean()),
    email: v.optional(v.boolean()),
    sms: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const currentEnv = getCurrentEnvironment();

    // Handle push preference
    if (args.push !== undefined) {
      if (args.push === false) {
        // Disable push: delete tokens for this environment
        const tokens = await ctx.db
          .query("pushTokens")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .filter((q) => q.eq(q.field("environment"), currentEnv))
          .collect();

        for (const tokenDoc of tokens) {
          await ctx.db.delete(tokenDoc._id);
        }

        console.log(
          `[updateChannelPreferences] Disabled push for user ${userId}: ` +
          `deleted ${tokens.length} token(s) in ${currentEnv}`
        );
      } else {
        // Enable push: no-op here - frontend should call registerToken
        // The token registration happens via NotificationProvider
        console.log(
          `[updateChannelPreferences] Enable push requested for user ${userId}: ` +
          `frontend should call registerToken`
        );
      }
    }

    // Handle email/sms preferences (still use user fields for now)
    const updates: Record<string, boolean | undefined> = {};
    if (args.email !== undefined) {
      updates.emailNotificationsEnabled = args.email;
    }
    if (args.sms !== undefined) {
      updates.smsNotificationsEnabled = args.sms;
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(userId, updates);
    }

    return { success: true };
  },
});
