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
import {
  isCustomChannel,
  channelIsLeaderEnabled,
  channelEffectiveEnabledForGroup,
  isLeaderRole,
} from "../../lib/helpers";
import { getDisplayName, getMediaUrl } from "../../lib/utils";
import { isCommunityAdmin } from "../../lib/permissions";
import { DOMAIN_CONFIG } from "@togather/shared/config";

// ============================================================================
// Constants
// ============================================================================

const MAX_PREVIEW_LENGTH = 100;
const DEFAULT_PAGE_SIZE = 50;

// Message type for preview generation (minimal interface for preview logic)
interface MessageForPreview {
  content: string;
  attachments?: Array<{
    type: string;
    url: string;
    name?: string;
    size?: number;
    mimeType?: string;
    thumbnailUrl?: string;
    waveform?: number[];
    duration?: number;
  }>;
}

/**
 * Generate a smart preview for a message based on its content and attachments.
 * Used for channel lastMessagePreview to show user-friendly strings like
 * "Sent a photo", "Sent a file", "Shared an event", etc.
 */
function generateMessagePreview(message: MessageForPreview): string {
  const content = message.content;
  const attachments = message.attachments;

  if (attachments && attachments.length > 0) {
    const imageCount = attachments.filter((a) => a.type === "image").length;
    const fileCount = attachments.filter((a) =>
      a.type === "file" || a.type === "document" || a.type === "audio" || a.type === "video"
    ).length;
    const audioCount = attachments.filter((a) => a.type === "audio").length;
    const videoCount = attachments.filter((a) => a.type === "video").length;

    if (imageCount > 0 && content.trim()) {
      // Has both images and text - show text
      return content.slice(0, MAX_PREVIEW_LENGTH);
    } else if (imageCount > 0) {
      // Only images
      return imageCount === 1 ? "Sent a photo" : `Sent ${imageCount} photos`;
    } else if (audioCount > 0) {
      // Audio files
      return audioCount === 1 ? "Sent an audio message" : `Sent ${audioCount} audio files`;
    } else if (videoCount > 0) {
      // Video files
      return videoCount === 1 ? "Sent a video" : `Sent ${videoCount} videos`;
    } else if (fileCount > 0) {
      // Documents and other files
      return fileCount === 1 ? "Sent a file" : `Sent ${fileCount} files`;
    } else {
      return content.slice(0, MAX_PREVIEW_LENGTH);
    }
  } else if (DOMAIN_CONFIG.eventLinkRegexSingle().test(content)) {
    // Event link shared
    return content.trim() === content.match(DOMAIN_CONFIG.eventLinkRegexSingle())?.[0]
      ? "Shared an event"
      : content.slice(0, MAX_PREVIEW_LENGTH);
  } else if (DOMAIN_CONFIG.toolLinkRegexSingle().test(content)) {
    // Tool link shared (Run Sheet, Resource)
    return content.trim() === content.match(DOMAIN_CONFIG.toolLinkRegexSingle())?.[0]
      ? "Shared a tool"
      : content.slice(0, MAX_PREVIEW_LENGTH);
  } else if (DOMAIN_CONFIG.groupLinkRegexSingle().test(content)) {
    // Group link shared
    return content.trim() === content.match(DOMAIN_CONFIG.groupLinkRegexSingle())?.[0]
      ? "Shared a group"
      : content.slice(0, MAX_PREVIEW_LENGTH);
  } else {
    return content.slice(0, MAX_PREVIEW_LENGTH);
  }
}

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
    /** Group context from the chat route (required for shared-channel visibility rules). */
    viewingGroupId: v.optional(v.id("groups")),
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

    const contextGroupId = args.viewingGroupId ?? channel.groupId;
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", contextGroupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    // If not a channel member, only group leaders/admins may load messages
    if (!channelMembership && !isLeaderRole(groupMembership?.role)) {
      throw new Error("Not a member of this channel");
    }

    const isLeaderOrAdmin = isLeaderRole(groupMembership?.role);
    const effectiveEnabled = args.viewingGroupId
      ? channelEffectiveEnabledForGroup(channel, args.viewingGroupId)
      : channelIsLeaderEnabled(channel);
    if (
      (isCustomChannel(channel.channelType) || channel.channelType === "pco_services") &&
      !effectiveEnabled &&
      !isLeaderOrAdmin
    ) {
      throw new Error("Channel is not available");
    }

    // Get blocked users to filter out their messages
    const blockedUsers = await ctx.db
      .query("chatUserBlocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", userId))
      .collect();

    const blockedUserIds = new Set(blockedUsers.map((b) => b.blockedId));

    // Get all messages for this channel
    let allMessages = await ctx.db
      .query("chatMessages")
      .withIndex("by_channel_createdAt", (q) => q.eq("channelId", args.channelId))
      .collect();

    // Filter out deleted, blocked users, and thread replies
    // Bot messages (no senderId) are never blocked
    let topLevelMessages = allMessages
      .filter((m) => !m.isDeleted && (!m.senderId || !blockedUserIds.has(m.senderId)) && !m.parentMessageId);

    // Sort by lastActivityAt descending (thread bump ordering)
    // Fall back to createdAt for messages without lastActivityAt (pre-migration)
    topLevelMessages.sort((a, b) => {
      const aTime = a.lastActivityAt ?? a.createdAt;
      const bTime = b.lastActivityAt ?? b.createdAt;
      return bTime - aTime;
    });

    // If cursor provided, find cursor position and slice after it
    if (args.cursor) {
      const cursorIndex = topLevelMessages.findIndex((m) => m._id === args.cursor);
      if (cursorIndex >= 0) {
        topLevelMessages = topLevelMessages.slice(cursorIndex + 1);
      }
    }

    const hasMore = topLevelMessages.length > limit;
    const pageMessages = topLevelMessages.slice(0, limit);

    // Get cursor for pagination (oldest-activity message in this batch)
    const cursor = pageMessages.length > 0
      ? pageMessages[pageMessages.length - 1]._id
      : undefined;

    // Reverse to chronological order (oldest first, newest at bottom)
    // This is the expected order for chat UIs
    const chronologicalMessages = [...pageMessages].reverse();

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
          waveform: v.optional(v.array(v.number())),
          duration: v.optional(v.number()),
        })
      )
    ),
    parentMessageId: v.optional(v.id("chatMessages")),
    mentionedUserIds: v.optional(v.array(v.id("users"))),
    hideLinkPreview: v.optional(v.boolean()),
    viewingGroupId: v.optional(v.id("groups")),
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

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }
    if (args.viewingGroupId) {
      const gm = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", args.viewingGroupId!).eq("userId", userId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();
      const isLeaderOrAdmin = isLeaderRole(gm?.role);
      if (
        (isCustomChannel(channel.channelType) || channel.channelType === "pco_services") &&
        !channelEffectiveEnabledForGroup(channel, args.viewingGroupId) &&
        !isLeaderOrAdmin
      ) {
        throw new Error("This channel is disabled");
      }
    } else {
      if (
        (isCustomChannel(channel.channelType) || channel.channelType === "pco_services") &&
        !channelIsLeaderEnabled(channel)
      ) {
        throw new Error("This channel is disabled");
      }
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
      // Set lastActivityAt for top-level messages (used for thread bump ordering)
      ...(!args.parentMessageId ? { lastActivityAt: now } : {}),
    });

    // Update channel with last message info (for inbox preview)
    // Generate smart preview based on content type
    const preview = generateMessagePreview({
      content: args.content,
      attachments: args.attachments,
    });

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
          lastActivityAt: now,
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
    let isCommunityAdminUser = false;

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

      // Community admins (ADMIN or PRIMARY_ADMIN) can delete any message in groups within their community
      const group = await ctx.db.get(channel.groupId);
      if (group?.communityId) {
        isCommunityAdminUser = await isCommunityAdmin(ctx, group.communityId, userId);
      }
    }

    if (!isOwner && !isChannelModerator && !isGroupLeader && !isCommunityAdminUser) {
      throw new Error("You can only delete your own messages");
    }

    const now = Date.now();

    await ctx.db.patch(args.messageId, {
      isDeleted: true,
      deletedAt: now,
      deletedById: userId,
    });

    // Update channel preview if the deleted message was the most recent
    // Re-read channel (already fetched above, but re-read for freshest lastMessageAt)
    const freshChannel = await ctx.db.get(message.channelId);
    if (freshChannel && freshChannel.lastMessageAt && message.createdAt >= freshChannel.lastMessageAt) {
      const previousMessage = await ctx.db
        .query("chatMessages")
        .withIndex("by_channel_createdAt", (q) => q.eq("channelId", message.channelId))
        .order("desc")
        .filter((q) =>
          q.and(
            q.eq(q.field("isDeleted"), false),
            q.neq(q.field("_id"), args.messageId),
            q.eq(q.field("parentMessageId"), undefined)
          )
        )
        .first();

      if (previousMessage) {
        const preview = generateMessagePreview({
          content: previousMessage.content,
          attachments: previousMessage.attachments,
        });
        await ctx.db.patch(message.channelId, {
          lastMessageAt: previousMessage.createdAt,
          lastMessagePreview: preview,
          lastMessageSenderId: previousMessage.senderId,
          lastMessageSenderName: previousMessage.senderName,
          updatedAt: now,
        });
      } else {
        await ctx.db.patch(message.channelId, {
          lastMessageAt: undefined,
          lastMessagePreview: undefined,
          lastMessageSenderId: undefined,
          lastMessageSenderName: undefined,
          updatedAt: now,
        });
      }
    }
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
      lastActivityAt: now,
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
