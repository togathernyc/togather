/**
 * Debug Query Functions
 *
 * Debug queries for troubleshooting push tokens, notifications, and channel memberships.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import { getCurrentEnvironment } from "../../lib/notifications/send";

/**
 * Debug query to check push token for a user (for troubleshooting)
 *
 * Simplified model:
 * - 1 token per user per environment
 * - Token existence = push enabled
 * - isActive field is ignored
 */
export const debugTokensForUser = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const currentEnv = getCurrentEnvironment();

    const user = await ctx.db.get(args.userId);

    // Get ALL tokens for the user (regardless of environment)
    const allTokens = await ctx.db
      .query("pushTokens")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Categorize tokens
    const legacyTokens = allTokens.filter((t) => !t.environment);
    const matchingTokens = allTokens.filter((t) => t.environment === currentEnv);

    // Build diagnosis
    let diagnosis: string;
    let action: string | null = null;

    if (!user) {
      diagnosis = "USER_NOT_FOUND: User does not exist";
    } else if (legacyTokens.length > 0) {
      diagnosis = `LEGACY_TOKENS: ${legacyTokens.length} tokens without environment need cleanup`;
      action = "cleanup_legacy";
    } else if (allTokens.length === 0) {
      diagnosis = "NO_TOKENS: No push tokens registered. Open app to register device.";
    } else if (matchingTokens.length === 0) {
      diagnosis = `ENV_MISMATCH: ${allTokens.length} tokens exist but none match ${currentEnv}`;
      action = "reregister";
    } else if (matchingTokens.length > 1) {
      diagnosis = `MULTIPLE_TOKENS: ${matchingTokens.length} tokens for ${currentEnv} (expected 1)`;
      action = "cleanup_duplicates";
    } else {
      diagnosis = `OK: 1 token for ${currentEnv}`;
    }

    // Push is enabled if there's a token for current environment
    const pushEnabled = matchingTokens.length > 0;

    return {
      currentEnvironment: currentEnv,
      pushEnabled,
      pushEnabledReason: pushEnabled
        ? "Token exists for this environment"
        : "No token for this environment",
      legacyTokenCount: legacyTokens.length,
      totalTokens: allTokens.length,
      matchingTokens: matchingTokens.length,
      tokens: allTokens.map((t) => ({
        id: t._id,
        token: t.token.substring(0, 30) + "...",
        platform: t.platform,
        environment: t.environment || "LEGACY (needs cleanup)",
        matchesCurrentEnv: t.environment === currentEnv,
        createdAt: new Date(t.createdAt).toISOString(),
        updatedAt: new Date(t.updatedAt).toISOString(),
      })),
      diagnosis,
      suggestedAction: action,
    };
  },
});

/**
 * Debug query to check recent notifications for a user
 */
export const debugRecentNotifications = query({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(limit);

    return {
      userId: args.userId,
      count: notifications.length,
      notifications: notifications.map((n) => ({
        id: n._id,
        type: n.notificationType,
        title: n.title,
        body: n.body,
        status: n.status,
        createdAt: new Date(n.createdAt).toISOString(),
        readAt: n.readAt ? new Date(n.readAt).toISOString() : null,
      })),
    };
  },
});

/**
 * Debug query to check if any new_message notifications exist
 */
export const debugMessageNotifications = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    // Get all recent notifications
    const allNotifications = await ctx.db
      .query("notifications")
      .order("desc")
      .take(limit);

    const messageNotifications = allNotifications.filter(
      (n) => n.notificationType === "new_message" || n.notificationType === "mention"
    );

    return {
      totalRecentNotifications: allNotifications.length,
      messageNotificationCount: messageNotifications.length,
      messageNotifications: messageNotifications.map((n) => ({
        id: n._id,
        type: n.notificationType,
        userId: n.userId,
        title: n.title,
        body: n.body,
        status: n.status,
        createdAt: new Date(n.createdAt).toISOString(),
      })),
      notificationTypes: [...new Set(allNotifications.map((n) => n.notificationType))],
    };
  },
});

/**
 * Debug query to check channel memberships for a user
 * Helps diagnose why notifications might not be received
 */
export const debugChannelMembership = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Get all channel memberships for this user
    const memberships = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Get channel details for each membership
    const channelDetails = await Promise.all(
      memberships.map(async (m) => {
        const channel = await ctx.db.get(m.channelId);
        const group = channel?.groupId ? await ctx.db.get(channel.groupId) : null;
        return {
          channelId: m.channelId,
          channelName: channel?.name || "Unknown",
          channelType: channel?.channelType || "Unknown",
          groupName: group?.name || "No group",
          role: m.role,
          isMuted: m.isMuted,
          leftAt: m.leftAt,
          isActive: !m.leftAt && !m.isMuted,
        };
      })
    );

    return {
      userId: args.userId,
      totalMemberships: memberships.length,
      activeMemberships: channelDetails.filter((c) => c.isActive).length,
      mutedChannels: channelDetails.filter((c) => c.isMuted).length,
      leftChannels: channelDetails.filter((c) => c.leftAt).length,
      channels: channelDetails,
    };
  },
});
