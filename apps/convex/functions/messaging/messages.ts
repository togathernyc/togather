/**
 * Message Functions for Convex-Native Messaging
 *
 * Send, edit, delete, and list messages with pagination.
 */

import { v } from "convex/values";
import { query, mutation, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { getDisplayName, getMediaUrl } from "../../lib/utils";
import { DOMAIN_CONFIG } from "@togather/shared/config";

// ============================================================================
// Constants
// ============================================================================

const MAX_PREVIEW_LENGTH = 100;
const DEFAULT_PAGE_SIZE = 50;

// ============================================================================
// Queries
// ============================================================================

/**
 * Get a single message by ID.
 */
export const getMessage = query({
  args: {
    token: v.string(),
    messageId: v.id("chatMessages"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    try {
      const message = await ctx.db.get(args.messageId);
      if (!message || message.isDeleted) {
        return null;
      }

      // Check if user has access to the channel
      const membership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", message.channelId).eq("userId", userId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();

      if (!membership) {
        return null;
      }

      return message;
    } catch {
      return null;
    }
  },
});

/**
 * Get messages for a channel with pagination.
 */
export const getMessages = query({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const limit = args.limit ?? DEFAULT_PAGE_SIZE;

    // Get the channel to check group membership
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

    // If not a channel member, check if user is a group leader/admin
    if (!channelMembership) {
      const groupMembership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", channel.groupId).eq("userId", userId)
        )
        .filter((q) =>
          q.and(
            q.eq(q.field("leftAt"), undefined),
            q.or(
              q.eq(q.field("role"), "leader"),
              q.eq(q.field("role"), "admin")
            )
          )
        )
        .first();

      if (!groupMembership) {
        throw new Error("Not a member of this channel");
      }
    }

    // Get blocked users to filter out their messages
    const blockedUsers = await ctx.db
      .query("chatUserBlocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", userId))
      .collect();

    const blockedUserIds = new Set(blockedUsers.map((b) => b.blockedId));

    // Get messages
    let allMessages = await ctx.db
      .query("chatMessages")
      .withIndex("by_channel_createdAt", (q) => q.eq("channelId", args.channelId))
      .order("desc")
      .collect();

    // If cursor provided, filter messages older than cursor
    if (args.cursor) {
      const cursorIndex = allMessages.findIndex((m) => m._id === args.cursor);
      if (cursorIndex >= 0) {
        allMessages = allMessages.slice(cursorIndex + 1);
      }
    }

    // Filter out deleted, blocked users, and thread replies
    // Bot messages (no senderId) are never blocked
    const filteredMessages = allMessages
      .filter((m) => !m.isDeleted && (!m.senderId || !blockedUserIds.has(m.senderId)) && !m.parentMessageId)
      .slice(0, limit);

    // Determine if there are more messages
    const remainingMessages = allMessages
      .filter((m) => !m.isDeleted && (!m.senderId || !blockedUserIds.has(m.senderId)) && !m.parentMessageId);
    const hasMore = remainingMessages.length > limit;

    // Get cursor for pagination (oldest message in this batch, for loading older messages)
    const cursor = filteredMessages.length > 0
      ? filteredMessages[filteredMessages.length - 1]._id
      : undefined;

    // Reverse to chronological order (oldest first, newest at bottom)
    // This is the expected order for chat UIs
    const chronologicalMessages = [...filteredMessages].reverse();

    return {
      messages: chronologicalMessages,
      hasMore,
      cursor,
    };
  },
});

/**
 * Get thread replies for a parent message.
 */
export const getThreadReplies = query({
  args: {
    token: v.string(),
    parentMessageId: v.id("chatMessages"),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const limit = args.limit ?? DEFAULT_PAGE_SIZE;

    const parentMessage = await ctx.db.get(args.parentMessageId);
    if (!parentMessage) {
      throw new Error("Parent message not found");
    }

    // Check channel membership
    const membership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", parentMessage.channelId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!membership) {
      throw new Error("Not a member of this channel");
    }

    const replies = await ctx.db
      .query("chatMessages")
      .withIndex("by_parentMessage", (q) => q.eq("parentMessageId", args.parentMessageId))
      .filter((q) => q.eq(q.field("isDeleted"), false))
      .order("asc")
      .take(limit);

    const hasMore = replies.length === limit;
    const cursor = replies.length > 0 ? replies[replies.length - 1]._id : undefined;

    return {
      messages: replies,
      hasMore,
      cursor,
    };
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Send a message to a channel.
 */
export const sendMessage = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    content: v.string(),
    attachments: v.optional(
      v.array(
        v.object({
          type: v.string(),
          url: v.string(),
          name: v.optional(v.string()),
          size: v.optional(v.number()),
          mimeType: v.optional(v.string()),
          thumbnailUrl: v.optional(v.string()),
        })
      )
    ),
    parentMessageId: v.optional(v.id("chatMessages")),
    mentionedUserIds: v.optional(v.array(v.id("users"))),
    hideLinkPreview: v.optional(v.boolean()),
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

    // Get user info for denormalized fields
    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const senderName = getDisplayName(user.firstName, user.lastName);
    const senderProfilePhoto = getMediaUrl(user.profilePhoto);

    const now = Date.now();

    // Determine content type
    let contentType = "text";
    if (args.attachments && args.attachments.length > 0) {
      const hasImage = args.attachments.some((a) => a.type === "image");
      const hasFile = args.attachments.some((a) => a.type === "file");
      if (hasImage) contentType = "image";
      else if (hasFile) contentType = "file";
    }

    const messageId = await ctx.db.insert("chatMessages", {
      channelId: args.channelId,
      senderId: userId,
      content: args.content,
      contentType,
      attachments: args.attachments,
      parentMessageId: args.parentMessageId,
      createdAt: now,
      isDeleted: false,
      senderName,
      senderProfilePhoto,
      mentionedUserIds: args.mentionedUserIds,
      hideLinkPreview: args.hideLinkPreview,
    });

    // Update channel with last message info (for inbox preview)
    // Generate smart preview based on content type
    let preview: string;
    if (args.attachments && args.attachments.length > 0) {
      const imageCount = args.attachments.filter((a) => a.type === "image").length;
      // Count all non-image attachment types: file, document, audio, video
      const fileCount = args.attachments.filter((a) =>
        a.type === "file" || a.type === "document" || a.type === "audio" || a.type === "video"
      ).length;
      const audioCount = args.attachments.filter((a) => a.type === "audio").length;
      const videoCount = args.attachments.filter((a) => a.type === "video").length;

      if (imageCount > 0 && args.content.trim()) {
        // Has both images and text - show text
        preview = args.content.slice(0, MAX_PREVIEW_LENGTH);
      } else if (imageCount > 0) {
        // Only images
        preview = imageCount === 1 ? "Sent a photo" : `Sent ${imageCount} photos`;
      } else if (audioCount > 0) {
        // Audio files
        preview = audioCount === 1 ? "Sent an audio message" : `Sent ${audioCount} audio files`;
      } else if (videoCount > 0) {
        // Video files
        preview = videoCount === 1 ? "Sent a video" : `Sent ${videoCount} videos`;
      } else if (fileCount > 0) {
        // Documents and other files
        preview = fileCount === 1 ? "Sent a file" : `Sent ${fileCount} files`;
      } else {
        preview = args.content.slice(0, MAX_PREVIEW_LENGTH);
      }
    } else if (DOMAIN_CONFIG.eventLinkRegexSingle().test(args.content)) {
      // Event link shared
      preview = args.content.trim() === args.content.match(DOMAIN_CONFIG.eventLinkRegexSingle())?.[0]
        ? "Shared an event"
        : args.content.slice(0, MAX_PREVIEW_LENGTH);
    } else if (DOMAIN_CONFIG.toolLinkRegexSingle().test(args.content)) {
      // Tool link shared (Run Sheet, Resource)
      preview = args.content.trim() === args.content.match(DOMAIN_CONFIG.toolLinkRegexSingle())?.[0]
        ? "Shared a tool"
        : args.content.slice(0, MAX_PREVIEW_LENGTH);
    } else if (DOMAIN_CONFIG.groupLinkRegexSingle().test(args.content)) {
      // Group link shared
      preview = args.content.trim() === args.content.match(DOMAIN_CONFIG.groupLinkRegexSingle())?.[0]
        ? "Shared a group"
        : args.content.slice(0, MAX_PREVIEW_LENGTH);
    } else {
      preview = args.content.slice(0, MAX_PREVIEW_LENGTH);
    }

    await ctx.db.patch(args.channelId, {
      lastMessageAt: now,
      lastMessagePreview: preview,
      lastMessageSenderId: userId,
      lastMessageSenderName: senderName,
      updatedAt: now,
    });

    // If this is a thread reply, update parent message
    if (args.parentMessageId) {
      const parentMessage = await ctx.db.get(args.parentMessageId);
      if (parentMessage) {
        await ctx.db.patch(args.parentMessageId, {
          threadReplyCount: (parentMessage.threadReplyCount || 0) + 1,
        });
      }
    }

    // Trigger notification and unread count logic
    await ctx.scheduler.runAfter(0, internal.functions.messaging.events.onMessageSent, {
      messageId,
      channelId: args.channelId,
      senderId: userId,
    });

    return messageId;
  },
});

/**
 * Edit a message.
 */
export const editMessage = mutation({
  args: {
    token: v.string(),
    messageId: v.id("chatMessages"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    if (message.isDeleted) {
      throw new Error("Cannot edit a deleted message");
    }

    // Only the sender can edit their own message
    if (message.senderId !== userId) {
      throw new Error("You can only edit your own messages");
    }

    const now = Date.now();

    await ctx.db.patch(args.messageId, {
      content: args.content,
      editedAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Delete a message (soft delete).
 */
export const deleteMessage = mutation({
  args: {
    token: v.string(),
    messageId: v.id("chatMessages"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    if (message.isDeleted) {
      return; // Already deleted
    }

    // Check if user can delete
    const isOwner = message.senderId === userId;

    // Check if user is moderator or admin in channel
    const membership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", message.channelId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    const isChannelModerator =
      membership?.role === "moderator" || membership?.role === "admin";

    // Check if user is leader/admin in the associated group
    // Get the channel to find the groupId
    const channel = await ctx.db.get(message.channelId);
    let isGroupLeader = false;

    if (channel?.groupId) {
      const groupMembership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", channel.groupId).eq("userId", userId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();

      isGroupLeader =
        groupMembership?.role === "leader" || groupMembership?.role === "admin";
    }

    if (!isOwner && !isChannelModerator && !isGroupLeader) {
      throw new Error("You can only delete your own messages");
    }

    const now = Date.now();

    await ctx.db.patch(args.messageId, {
      isDeleted: true,
      deletedAt: now,
      deletedById: userId,
    });
  },
});

/**
 * Send a system message (for notifications, bots, etc.)
 * This is an internal mutation that bypasses auth checks.
 */
export const sendSystemMessage = internalMutation({
  args: {
    channelId: v.id("chatChannels"),
    content: v.string(),
    contentType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Verify channel exists
    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }

    // Create system message (no senderId = system message)
    const messageId = await ctx.db.insert("chatMessages", {
      channelId: args.channelId,
      // senderId is optional in schema for system/bot messages
      content: args.content,
      contentType: args.contentType || "system",
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
    });

    // Update channel metadata
    await ctx.db.patch(args.channelId, {
      lastMessageAt: now,
      lastMessagePreview: args.content.substring(0, MAX_PREVIEW_LENGTH),
      updatedAt: now,
    });

    return messageId;
  },
});
