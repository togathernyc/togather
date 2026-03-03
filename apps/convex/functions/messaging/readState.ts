/**
 * Read State Functions for Convex-Native Messaging
 *
 * Track unread counts and mark messages as read.
 */

import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";

// ============================================================================
// Queries
// ============================================================================

/**
 * Get unread count for a specific channel.
 */
export const getUnreadCount = query({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Check channel membership
    const membership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!membership) {
      return 0;
    }

    // Get read state
    const readState = await ctx.db
      .query("chatReadState")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", userId)
      )
      .first();

    if (!readState) {
      // No read state means count all messages from others
      const messages = await ctx.db
        .query("chatMessages")
        .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
        .filter((q) =>
          q.and(
            q.eq(q.field("isDeleted"), false),
            q.neq(q.field("senderId"), userId)
          )
        )
        .collect();

      return messages.length;
    }

    return readState.unreadCount;
  },
});

/**
 * Get unread counts for all channels the user is a member of.
 */
export const getUnreadCounts = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get all channel memberships
    const memberships = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    const result: Record<string, number> = {};

    for (const membership of memberships) {
      // Get read state for this channel
      const readState = await ctx.db
        .query("chatReadState")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", membership.channelId).eq("userId", userId)
        )
        .first();

      if (readState && readState.unreadCount > 0) {
        result[membership.channelId] = readState.unreadCount;
      } else if (!readState) {
        // Count unread messages if no read state exists
        const messages = await ctx.db
          .query("chatMessages")
          .withIndex("by_channel", (q) => q.eq("channelId", membership.channelId))
          .filter((q) =>
            q.and(
              q.eq(q.field("isDeleted"), false),
              q.neq(q.field("senderId"), userId)
            )
          )
          .collect();

        if (messages.length > 0) {
          result[membership.channelId] = messages.length;
        }
      }
    }

    return result;
  },
});

/**
 * Get read status for a specific message.
 * Returns count of users who have read this message (excluding sender).
 */
export const getMessageReadBy = query({
  args: {
    token: v.string(),
    messageId: v.id("chatMessages"),
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Verify user is a member of the channel
    const membership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!membership) {
      throw new Error("Not a member of this channel");
    }

    // Get the message to find its timestamp and sender
    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    if (message.channelId !== args.channelId) {
      throw new Error("Message does not belong to this channel");
    }

    // Get all active members of the channel (excluding the sender)
    const allMembers = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .filter((q) =>
        q.and(
          q.eq(q.field("leftAt"), undefined),
          q.neq(q.field("userId"), message.senderId)
        )
      )
      .collect();

    const totalMembers = allMembers.length;

    // Get all read states for this channel
    const allReadStates = await ctx.db
      .query("chatReadState")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .filter((q) => q.neq(q.field("userId"), message.senderId))
      .collect();

    // Count users who have read this message
    // A user has read this message if:
    // 1. They have a lastReadMessageId set AND it's this message or later
    // 2. OR their lastReadAt timestamp is >= message.createdAt AND they have no lastReadMessageId
    let readByCount = 0;

    for (const readState of allReadStates) {
      if (readState.lastReadMessageId) {
        // If they have a specific message marked, we need to check if it's this message or later
        const lastReadMsg = await ctx.db.get(readState.lastReadMessageId);
        if (lastReadMsg && lastReadMsg.createdAt >= message.createdAt) {
          readByCount++;
        }
      } else if (readState.lastReadAt >= message.createdAt) {
        // No specific message, so use timestamp comparison
        readByCount++;
      }
    }

    return {
      readByCount,
      totalMembers,
    };
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Mark a channel as read (optionally up to a specific message).
 */
export const markAsRead = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    messageId: v.optional(v.id("chatMessages")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Check channel membership
    const membership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!membership) {
      throw new Error("Not a member of this channel");
    }

    const now = Date.now();

    // Get or create read state
    const existingReadState = await ctx.db
      .query("chatReadState")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", userId)
      )
      .first();

    let unreadCount = 0;

    // If marking up to a specific message, count remaining unread
    if (args.messageId) {
      const message = await ctx.db.get(args.messageId);
      if (message) {
        // Count messages after this one
        const laterMessages = await ctx.db
          .query("chatMessages")
          .withIndex("by_channel_createdAt", (q) => q.eq("channelId", args.channelId))
          .filter((q) =>
            q.and(
              q.eq(q.field("isDeleted"), false),
              q.neq(q.field("senderId"), userId),
              q.gt(q.field("createdAt"), message.createdAt)
            )
          )
          .collect();

        unreadCount = laterMessages.length;
      }
    }

    if (existingReadState) {
      await ctx.db.patch(existingReadState._id, {
        lastReadMessageId: args.messageId,
        lastReadAt: now,
        unreadCount,
      });
    } else {
      await ctx.db.insert("chatReadState", {
        channelId: args.channelId,
        userId,
        lastReadMessageId: args.messageId,
        lastReadAt: now,
        unreadCount,
      });
    }
  },
});

/**
 * Mark all channels as read for the current user.
 */
export const markAllAsRead = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const now = Date.now();

    // Get all channel memberships
    const memberships = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    for (const membership of memberships) {
      const existingReadState = await ctx.db
        .query("chatReadState")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", membership.channelId).eq("userId", userId)
        )
        .first();

      if (existingReadState) {
        await ctx.db.patch(existingReadState._id, {
          lastReadAt: now,
          unreadCount: 0,
        });
      } else {
        await ctx.db.insert("chatReadState", {
          channelId: membership.channelId,
          userId,
          lastReadAt: now,
          unreadCount: 0,
        });
      }
    }
  },
});
