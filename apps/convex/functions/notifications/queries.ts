/**
 * Notification Query Functions
 *
 * Functions for listing and counting notifications.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import { requireAuthWithArchivedStatus } from "../../lib/auth";

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
    const { userId, isArchivedCommunity } = await requireAuthWithArchivedStatus(
      ctx,
      args.token,
    );
    // This query is mounted unconditionally at app boot (via the Inbox and
    // notifications feed), so a token scoped to an archived community must
    // get benign empty data rather than the strict requireAuth rejection —
    // see requireAuthWithArchivedStatus.
    if (isArchivedCommunity) {
      return { notifications: [], unreadCount: 0, totalCount: 0 };
    }

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
    const { userId, isArchivedCommunity } = await requireAuthWithArchivedStatus(
      ctx,
      args.token,
    );
    // Mounted unconditionally at app boot (Inbox row) — see unreadCount below
    // for why an archived-community token gets benign empty data.
    if (isArchivedCommunity) {
      return { latest: null, unreadCount: 0 };
    }

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
    const { userId, isArchivedCommunity } = await requireAuthWithArchivedStatus(
      ctx,
      args.token,
    );
    // This query mounts unconditionally as soon as any token exists
    // (NotificationProvider) — before the user can navigate away from an
    // archived community. requireAuth's strict throw would crash render
    // (see requireAuthWithArchivedStatus doc), so return a benign 0 instead.
    if (isArchivedCommunity) {
      return { unreadCount: 0 };
    }

    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user_read_created", (q) =>
        q.eq("userId", userId).eq("isRead", false)
      )
      .collect();

    // Exclude chat-message notifications so the global badge matches the
    // feed (and its Inbox row), which also drop them — see the feed query.
    return { unreadCount: notifications.filter(isFeedNotification).length };
  },
});
