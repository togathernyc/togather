/**
 * Typing Indicator Functions for Convex-Native Messaging
 *
 * Ephemeral typing indicators with automatic cleanup.
 */

import { v } from "convex/values";
import { query, mutation, internalMutation } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";

// ============================================================================
// Constants
// ============================================================================

const TYPING_INDICATOR_TTL = 5000; // 5 seconds

// ============================================================================
// Queries
// ============================================================================

/**
 * Get users currently typing in a channel.
 */
export const getTypingUsers = query({
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
      return [];
    }

    const now = Date.now();

    // Get all active typing indicators (not expired, not self)
    const indicators = await ctx.db
      .query("chatTypingIndicators")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .filter((q) =>
        q.and(
          q.gt(q.field("expiresAt"), now),
          q.neq(q.field("userId"), userId)
        )
      )
      .collect();

    // Get user info for each typing user
    const userIds = indicators.map((i) => i.userId);
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));

    // Return transformed data with expected shape
    return users
      .filter((u): u is NonNullable<typeof u> => u !== null)
      .map((u) => ({
        userId: u._id,
        firstName: u.firstName ?? 'User',
        lastName: u.lastName,
      }));
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Start typing indicator.
 */
export const startTyping = mutation({
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
      throw new Error("Not a member of this channel");
    }

    const now = Date.now();
    const expiresAt = now + TYPING_INDICATOR_TTL;

    // Check if indicator already exists
    const existingIndicator = await ctx.db
      .query("chatTypingIndicators")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", userId)
      )
      .first();

    if (existingIndicator) {
      // Update existing indicator
      await ctx.db.patch(existingIndicator._id, {
        startedAt: now,
        expiresAt,
      });
    } else {
      // Create new indicator
      await ctx.db.insert("chatTypingIndicators", {
        channelId: args.channelId,
        userId,
        startedAt: now,
        expiresAt,
      });
    }
  },
});

/**
 * Stop typing indicator.
 */
export const stopTyping = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const indicator = await ctx.db
      .query("chatTypingIndicators")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", userId)
      )
      .first();

    if (indicator) {
      await ctx.db.delete(indicator._id);
    }
  },
});

// ============================================================================
// Internal Mutations
// ============================================================================

/**
 * Cleanup expired typing indicators.
 * This should be called periodically by a scheduled job.
 */
export const cleanupExpiredIndicators = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Find all expired indicators
    const expiredIndicators = await ctx.db
      .query("chatTypingIndicators")
      .withIndex("by_expiresAt")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();

    // Delete them
    for (const indicator of expiredIndicators) {
      await ctx.db.delete(indicator._id);
    }

    return { deleted: expiredIndicators.length };
  },
});
