/**
 * Reaction Functions for Convex-Native Messaging
 *
 * Toggle reactions and get aggregated reaction data.
 */

import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { canAccessEventChannel } from "./eventChat";
import { getUsersWithNotificationsDisabled } from "../../lib/notifications/enabledStatus";

// ============================================================================
// Queries
// ============================================================================

/**
 * Get aggregated reactions for a message.
 */
export const getReactions = query({
  args: {
    token: v.string(),
    messageId: v.id("chatMessages"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const message = await ctx.db.get(args.messageId);
    if (!message) {
      return [];
    }

    // Event channels use RSVP-based access, not chatChannelMembers — RSVPers
    // who haven't explicitly opened the chat can still see and react.
    const channel = await ctx.db.get(message.channelId);
    if (channel?.channelType === "event") {
      if (!(await canAccessEventChannel(ctx, userId, channel))) {
        return [];
      }
    } else {
      // Check channel membership
      const membership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", message.channelId).eq("userId", userId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();

      if (!membership) {
        return [];
      }
    }

    // Get all reactions for this message
    const reactions = await ctx.db
      .query("chatMessageReactions")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .collect();

    // Aggregate by emoji
    const emojiMap = new Map<
      string,
      { count: number; userIds: Id<"users">[]; hasReacted: boolean }
    >();

    for (const reaction of reactions) {
      const existing = emojiMap.get(reaction.emoji);
      if (existing) {
        existing.count++;
        existing.userIds.push(reaction.userId);
        if (reaction.userId === userId) {
          existing.hasReacted = true;
        }
      } else {
        emojiMap.set(reaction.emoji, {
          count: 1,
          userIds: [reaction.userId],
          hasReacted: reaction.userId === userId,
        });
      }
    }

    // Convert to array
    return Array.from(emojiMap.entries()).map(([emoji, data]) => ({
      emoji,
      count: data.count,
      userIds: data.userIds,
      hasReacted: data.hasReacted,
    }));
  },
});

/**
 * Get aggregated reactions for multiple messages at once.
 * This is optimized for fetching reactions for a list of visible messages.
 */
export const getReactionsForMessages = query({
  args: {
    token: v.string(),
    messageIds: v.array(v.id("chatMessages")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    if (args.messageIds.length === 0) {
      return {};
    }

    // Get all messages to check their channels
    const messages = await Promise.all(
      args.messageIds.map((id) => ctx.db.get(id))
    );

    // Get unique channel IDs
    const channelIds = new Set<Id<"chatChannels">>();
    for (const message of messages) {
      if (message) {
        channelIds.add(message.channelId);
      }
    }

    // Check access for all channels. Event channels use RSVP-based access
    // (canAccessEventChannel); non-event channels use chatChannelMembers.
    // One channel fetch + access check per distinct channel id.
    const membershipChecks = await Promise.all(
      Array.from(channelIds).map(async (channelId) => {
        const channel = await ctx.db.get(channelId);
        if (channel?.channelType === "event") {
          const hasAccess = await canAccessEventChannel(ctx, userId, channel);
          return { channelId, isMember: hasAccess };
        }
        const membership = await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", userId)
          )
          .filter((q) => q.eq(q.field("leftAt"), undefined))
          .first();
        return { channelId, isMember: !!membership };
      })
    );

    const memberChannels = new Set(
      membershipChecks
        .filter((m) => m.isMember)
        .map((m) => m.channelId.toString())
    );

    // Filter to only messages in channels user is a member of
    const allowedMessageIds = messages
      .filter((m) => m && memberChannels.has(m.channelId.toString()))
      .map((m) => m!._id);

    if (allowedMessageIds.length === 0) {
      return {};
    }

    // Get all reactions for all messages in a single query
    // We query by each message since there's an index on messageId
    const allReactions = await Promise.all(
      allowedMessageIds.map(async (messageId) => {
        const reactions = await ctx.db
          .query("chatMessageReactions")
          .withIndex("by_message", (q) => q.eq("messageId", messageId))
          .collect();
        return { messageId, reactions };
      })
    );

    // Build result map: messageId -> aggregated reactions
    const result: Record<
      string,
      Array<{ emoji: string; count: number; userIds: Id<"users">[]; hasReacted: boolean }>
    > = {};

    for (const { messageId, reactions } of allReactions) {
      // Aggregate by emoji
      const emojiMap = new Map<
        string,
        { count: number; userIds: Id<"users">[]; hasReacted: boolean }
      >();

      for (const reaction of reactions) {
        const existing = emojiMap.get(reaction.emoji);
        if (existing) {
          existing.count++;
          existing.userIds.push(reaction.userId);
          if (reaction.userId === userId) {
            existing.hasReacted = true;
          }
        } else {
          emojiMap.set(reaction.emoji, {
            count: 1,
            userIds: [reaction.userId],
            hasReacted: reaction.userId === userId,
          });
        }
      }

      // Convert to array
      result[messageId.toString()] = Array.from(emojiMap.entries()).map(
        ([emoji, data]) => ({
          emoji,
          count: data.count,
          userIds: data.userIds,
          hasReacted: data.hasReacted,
        })
      );
    }

    return result;
  },
});

/**
 * Get details for users who reacted with a specific emoji.
 */
export const getReactionDetails = query({
  args: {
    token: v.string(),
    messageId: v.id("chatMessages"),
    emoji: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const message = await ctx.db.get(args.messageId);
    if (!message) {
      return [];
    }

    // Event channels use RSVP-based access, not chatChannelMembers.
    const channel = await ctx.db.get(message.channelId);
    if (channel?.channelType === "event") {
      if (!(await canAccessEventChannel(ctx, userId, channel))) {
        return [];
      }
    } else {
      // Check channel membership
      const membership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", message.channelId).eq("userId", userId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();

      if (!membership) {
        return [];
      }
    }

    // Get all reactions for this message with the specified emoji
    const reactions = await ctx.db
      .query("chatMessageReactions")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .filter((q) => q.eq(q.field("emoji"), args.emoji))
      .collect();

    // Fetch user details for each reactor
    const reactorNotifsDisabled = await getUsersWithNotificationsDisabled(
      ctx,
      reactions.map((r) => r.userId),
    );
    const users = await Promise.all(
      reactions.map(async (reaction) => {
        const user = await ctx.db.get(reaction.userId);
        if (!user) {
          return null;
        }
        // Build display name from firstName + lastName
        const displayName = [user.firstName, user.lastName]
          .filter(Boolean)
          .join(" ") || user.username || "Unknown";
        return {
          userId: reaction.userId,
          displayName,
          profilePhoto: user.profilePhoto ?? null,
          notificationsDisabled: reactorNotifsDisabled.has(reaction.userId),
        };
      })
    );

    // Filter out null users (deleted accounts)
    return users.filter((u): u is NonNullable<typeof u> => u !== null);
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Toggle a reaction on a message.
 */
export const toggleReaction = mutation({
  args: {
    token: v.string(),
    messageId: v.id("chatMessages"),
    emoji: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    if (message.isDeleted) {
      throw new Error("Cannot react to a deleted message");
    }

    // Event channels use RSVP-based access — RSVPers can react without
    // being in chatChannelMembers (they're seated lazily on openEventChat).
    const channel = await ctx.db.get(message.channelId);
    if (channel?.channelType === "event") {
      if (!(await canAccessEventChannel(ctx, userId, channel))) {
        throw new Error("Not a member of this channel");
      }
    } else {
      // Check channel membership
      const membership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", message.channelId).eq("userId", userId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();

      if (!membership) {
        throw new Error("Not a member of this channel");
      }
    }

    // Check if user already has this reaction
    const existingReaction = await ctx.db
      .query("chatMessageReactions")
      .withIndex("by_message_user", (q) =>
        q.eq("messageId", args.messageId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("emoji"), args.emoji))
      .first();

    if (existingReaction) {
      // Remove reaction
      await ctx.db.delete(existingReaction._id);
    } else {
      // Add reaction
      await ctx.db.insert("chatMessageReactions", {
        messageId: args.messageId,
        userId,
        emoji: args.emoji,
        createdAt: Date.now(),
      });
    }
  },
});
