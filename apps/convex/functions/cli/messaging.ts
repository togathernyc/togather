/**
 * CLI-specific messaging functions with stricter rate limits.
 *
 * These wrap the standard messaging functions but enforce tighter
 * rate limits for agent/CLI callers:
 * - Send: 1 message per minute per user
 * - Read: 10 requests per minute per user
 * - Channels: 10 requests per minute per user
 */

import { v } from "convex/values";
import { mutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { requireAuth } from "../../lib/auth";
import { checkRateLimit } from "../../lib/rateLimit";
import {
  isCustomChannel,
  channelIsLeaderEnabled,
  isLeaderRole,
} from "../../lib/helpers";
import { getDisplayName, getMediaUrl } from "../../lib/utils";

// ============================================================================
// CLI Rate Limits
// ============================================================================

const CLI_SEND_LIMIT = 1; // 1 per minute
const CLI_READ_LIMIT = 10; // 10 per minute
const RATE_WINDOW_MS = 60_000; // 1 minute

// ============================================================================
// Queries
// ============================================================================

/**
 * List channels the user is a member of (CLI rate limited).
 */
export const getUserChannels = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // CLI rate limit: 10 reads per minute
    await checkRateLimit(ctx, `cli:read:${userId}`, CLI_READ_LIMIT, RATE_WINDOW_MS);

    // Get all channel memberships
    const memberships = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    const groupMemberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();
    const roleByGroupId = new Map(
      groupMemberships.map((m) => [m.groupId, m.role])
    );

    const channelIds = memberships.map((m) => m.channelId);
    const channels = await Promise.all(channelIds.map((id) => ctx.db.get(id)));

    return channels
      .filter((c): c is NonNullable<typeof c> => {
        if (c === null || c.isArchived) return false;
        const role = roleByGroupId.get(c.groupId);
        const isLeader = isLeaderRole(role);
        if (
          (isCustomChannel(c.channelType) || c.channelType === "pco_services") &&
          !channelIsLeaderEnabled(c) &&
          !isLeader
        ) {
          return false;
        }
        return true;
      })
      .map((channel) => ({
        _id: channel._id,
        name: channel.name,
        channelType: channel.channelType,
        lastMessagePreview: channel.lastMessagePreview,
        lastMessageAt: channel.lastMessageAt,
      }));
  },
});

/**
 * Read messages from a channel (CLI rate limited).
 */
export const getMessages = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const limit = Math.min(args.limit ?? 25, 50);

    // CLI rate limit: 10 reads per minute
    await checkRateLimit(ctx, `cli:read:${userId}`, CLI_READ_LIMIT, RATE_WINDOW_MS);

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }

    // Check channel membership
    const channelMembership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", channel.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!channelMembership && !isLeaderRole(groupMembership?.role)) {
      throw new Error("Not a member of this channel");
    }

    if (
      (isCustomChannel(channel.channelType) || channel.channelType === "pco_services") &&
      !channelIsLeaderEnabled(channel) &&
      !isLeaderRole(groupMembership?.role)
    ) {
      throw new Error("Channel is not available");
    }

    // Get blocked users
    const blockedUsers = await ctx.db
      .query("chatUserBlocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", userId))
      .collect();
    const blockedUserIds = new Set(blockedUsers.map((b) => b.blockedId));

    // Get messages ordered by creation time (newest first), paginated
    let query = ctx.db
      .query("chatMessages")
      .withIndex("by_channel_createdAt", (q) => q.eq("channelId", args.channelId))
      .order("desc");

    // Fetch extra to account for filtered messages, then paginate
    const fetchLimit = (limit + 1) * 3; // over-fetch to handle filters
    const rawMessages = await query.take(fetchLimit);

    let topLevelMessages = rawMessages
      .filter((m) => !m.isDeleted && (!m.senderId || !blockedUserIds.has(m.senderId)) && !m.parentMessageId);

    if (args.cursor) {
      const cursorIndex = topLevelMessages.findIndex((m) => m._id === args.cursor);
      if (cursorIndex >= 0) {
        topLevelMessages = topLevelMessages.slice(cursorIndex + 1);
      }
    }

    const hasMore = topLevelMessages.length > limit;
    const page = topLevelMessages.slice(0, limit);
    const cursor = page.length > 0 ? page[page.length - 1]!._id : undefined;

    return {
      messages: page.map((m) => ({
        _id: m._id,
        senderId: m.senderId,
        senderName: m.senderName,
        content: m.content,
        createdAt: m.createdAt,
        editedAt: m.editedAt,
        attachments: m.attachments,
      })),
      hasMore,
      cursor,
    };
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Send a message to a channel (CLI rate limited).
 */
export const sendMessage = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // CLI rate limit: 1 send per minute (on top of global 20/min)
    await checkRateLimit(ctx, `cli:send:${userId}`, CLI_SEND_LIMIT, RATE_WINDOW_MS);

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

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }

    if (
      (isCustomChannel(channel.channelType) || channel.channelType === "pco_services") &&
      !channelIsLeaderEnabled(channel)
    ) {
      throw new Error("This channel is disabled");
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const senderName = getDisplayName(user.firstName, user.lastName);
    const senderProfilePhoto = getMediaUrl(user.profilePhoto);
    const now = Date.now();

    const messageId = await ctx.db.insert("chatMessages", {
      channelId: args.channelId,
      senderId: userId,
      content: args.content,
      contentType: "text",
      createdAt: now,
      isDeleted: false,
      senderName,
      senderProfilePhoto,
      lastActivityAt: now,
    });

    // Update channel with last message info
    const preview =
      args.content.length > 100
        ? args.content.slice(0, 100) + "..."
        : args.content;

    await ctx.db.patch(args.channelId, {
      lastMessageAt: now,
      lastMessagePreview: preview,
      lastMessageSenderId: userId,
      lastMessageSenderName: senderName,
      updatedAt: now,
    });

    // Trigger notification and unread count logic
    await ctx.scheduler.runAfter(0, internal.functions.messaging.events.onMessageSent, {
      messageId,
      channelId: args.channelId,
      senderId: userId,
    });

    return messageId;
  },
});
