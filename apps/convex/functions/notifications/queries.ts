/**
 * Notification Query Functions
 *
 * Functions for listing and counting notifications.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import { requireAuth } from "../../lib/auth";

/**
 * List notifications for a user with pagination and filtering
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

    // Apply unread filter if needed
    let notifications = await notificationsQuery.collect();

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
