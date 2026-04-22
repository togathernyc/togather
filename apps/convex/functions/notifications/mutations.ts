/**
 * Notification Mutation Functions
 *
 * Functions for marking notifications as read and creating notification records.
 */

import { v } from "convex/values";
import { mutation, internalMutation } from "../../_generated/server";
import { now } from "../../lib/utils";
import { requireAuth } from "../../lib/auth";

/**
 * Mark a specific notification as read
 */
export const markRead = mutation({
  args: {
    token: v.string(),
    notificationId: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const notification = await ctx.db.get(args.notificationId);

    if (!notification || notification.userId !== userId) {
      return {
        success: false,
        unreadCount: 0,
      };
    }

    if (!notification.isRead) {
      await ctx.db.patch(args.notificationId, {
        isRead: true,
        readAt: now(),
      });
    }

    // Get updated unread count
    const unreadNotifications = await ctx.db
      .query("notifications")
      .withIndex("by_user_read_created", (q) =>
        q.eq("userId", userId).eq("isRead", false)
      )
      .collect();

    return {
      success: true,
      unreadCount: unreadNotifications.length,
    };
  },
});

/**
 * Mark all notifications as read for a user
 *
 * Performance: Uses .take(500) limit to prevent unbounded reads.
 * If user has more than 500 unread notifications, they may need to call this multiple times.
 * The response indicates if there may be more to mark.
 */
export const markAllRead = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const timestamp = now();

    // Limit to 500 notifications per call to prevent unbounded reads/writes
    const MAX_BATCH_SIZE = 500;
    const unreadNotifications = await ctx.db
      .query("notifications")
      .withIndex("by_user_read_created", (q) =>
        q.eq("userId", userId).eq("isRead", false)
      )
      .take(MAX_BATCH_SIZE);

    // Batch the patches for better performance
    const patchPromises = unreadNotifications.map((notification) =>
      ctx.db.patch(notification._id, {
        isRead: true,
        readAt: timestamp,
      })
    );
    await Promise.all(patchPromises);

    // Check if there may be more unread notifications
    const hasMore = unreadNotifications.length === MAX_BATCH_SIZE;

    return {
      success: true,
      markedCount: unreadNotifications.length,
      unreadCount: hasMore ? undefined : 0, // undefined signals there may be more
      hasMore,
    };
  },
});

/**
 * Create a notification record
 * Called internally by actions after sending push notifications
 */
export const createNotification = internalMutation({
  args: {
    userId: v.id("users"),
    communityId: v.optional(v.id("communities")),
    groupId: v.optional(v.id("groups")),
    notificationType: v.string(),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.any()),
    status: v.string(),
    trackingId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const timestamp = now();

    const id = await ctx.db.insert("notifications", {
      userId: args.userId,
      communityId: args.communityId,
      groupId: args.groupId,
      notificationType: args.notificationType,
      title: args.title,
      body: args.body,
      data: args.data || {},
      status: args.status,
      isRead: false,
      createdAt: timestamp,
      sentAt: args.status === "sent" ? timestamp : undefined,
      trackingId: args.trackingId,
    });

    return id;
  },
});

/**
 * Create multiple notification records in a single transaction
 * Called internally by actions to atomically create notifications for multiple users.
 * This ensures all notifications are created together or none are (atomicity).
 */
export const createNotificationsBatch = internalMutation({
  args: {
    notifications: v.array(
      v.object({
        userId: v.id("users"),
        communityId: v.optional(v.id("communities")),
        groupId: v.optional(v.id("groups")),
        notificationType: v.string(),
        title: v.string(),
        body: v.string(),
        data: v.optional(v.any()),
        status: v.string(),
        trackingId: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const timestamp = now();
    const insertedIds = [];

    for (const notification of args.notifications) {
      const id = await ctx.db.insert("notifications", {
        userId: notification.userId,
        communityId: notification.communityId,
        groupId: notification.groupId,
        notificationType: notification.notificationType,
        title: notification.title,
        body: notification.body,
        data: notification.data || {},
        status: notification.status,
        isRead: false,
        createdAt: timestamp,
        sentAt: notification.status === "sent" ? timestamp : undefined,
        trackingId: notification.trackingId,
      });
      insertedIds.push(id);
    }

    return insertedIds;
  },
});

/**
 * Record that a notification was displayed on the user's device
 */
export const recordImpression = mutation({
  args: { token: v.string(), trackingId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const notification = await ctx.db
      .query("notifications")
      .withIndex("by_trackingId", (q) => q.eq("trackingId", args.trackingId))
      .first();
    if (!notification || notification.userId !== userId) return;
    if (!notification.impressedAt) {
      const ts = now();
      await ctx.db.patch(notification._id, { impressedAt: ts });
    }
  },
});

/**
 * Record that a user tapped on a notification
 */
export const recordClick = mutation({
  args: { token: v.string(), trackingId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const notification = await ctx.db
      .query("notifications")
      .withIndex("by_trackingId", (q) => q.eq("trackingId", args.trackingId))
      .first();
    if (!notification || notification.userId !== userId) return;
    const ts = now();
    const updates: Record<string, number> = { clickedAt: ts };
    const firstImpression = !notification.impressedAt;
    if (firstImpression) updates.impressedAt = ts;
    await ctx.db.patch(notification._id, updates);
  },
});
