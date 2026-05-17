/**
 * Notification Query Functions
 *
 * Functions for listing and counting notifications.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import { requireAuth } from "../../lib/auth";

/**
 * Notification types that represent chat messages. These are deliberately
 * excluded from the in-app notifications feed and its Inbox row — the user
 * already finds these in the channels themselves, so surfacing them again
 * here would just be noise.
 */
const CHAT_NOTIFICATION_TYPES = new Set(["new_message", "mention"]);

const isFeedNotification = (n: { notificationType: string }): boolean =>
  !CHAT_NOTIFICATION_TYPES.has(n.notificationType);

/**
 * List notifications for a user with pagination and filtering.
 * Chat-message notifications are excluded — see CHAT_NOTIFICATION_TYPES.
 */
export const list = query({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const limit = Math.min(args.limit ?? 50, 100);
    const offset = args.offset ?? 0;

    // Build the query
    let notificationsQuery = ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc");

    // Drop chat-message notifications — they belong in the channels.
    let notifications = (await notificationsQuery.collect()).filter(
      isFeedNotification,
    );

    if (args.unreadOnly) {
      notifications = notifications.filter((n) => !n.isRead);
    }

    // Get unread count
    const unreadCount = notifications.filter((n) => !n.isRead).length;

    // Apply pagination
    const paginatedNotifications = notifications.slice(offset, offset + limit);

    return {
      notifications: paginatedNotifications.map((n) => ({
        id: n._id,
        notificationType: n.notificationType,
        title: n.title,
        body: n.body,
        data: n.data || {},
        isRead: n.isRead,
        createdAt: n.createdAt,
        readAt: n.readAt || null,
        groupId: n.groupId,
        communityId: n.communityId,
      })),
      unreadCount,
      totalCount: paginatedNotifications.length,
    };
  },
});

/**
 * Inbox summary for a user.
 *
 * Returns just what the Inbox "Notifications" row needs: the single most
 * recent notification (for the preview line + a sort timestamp competing with
 * channels' lastMessageAt) and the unread count. Returns `latest: null` when
 * the user has no notifications so the Inbox can hide the row entirely.
 */
export const inboxSummary = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Newest-first; exclude chat-message notifications (see
    // CHAT_NOTIFICATION_TYPES) so the row mirrors the feed exactly.
    const feed = (
      await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .order("desc")
        .collect()
    ).filter(isFeedNotification);

    const latest = feed[0] ?? null;
    const unread = feed.filter((n) => !n.isRead);

    return {
      latest: latest
        ? {
            id: latest._id,
            notificationType: latest.notificationType,
            title: latest.title,
            body: latest.body,
            createdAt: latest.createdAt,
            isRead: latest.isRead,
          }
        : null,
      unreadCount: unread.length,
    };
  },
});

/**
 * Get unread notification count for a user
 */
export const unreadCount = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user_read_created", (q) =>
        q.eq("userId", userId).eq("isRead", false)
      )
      .collect();

    return { unreadCount: notifications.length };
  },
});
