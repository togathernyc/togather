/**
 * Flagging Functions for Convex-Native Messaging
 *
 * Message and user reporting, moderation workflow.
 */

import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";

// ============================================================================
// Helper Functions
// ============================================================================

async function isUserAdmin(
  ctx: { db: any },
  userId: Id<"users">
): Promise<boolean> {
  const user = await ctx.db.get(userId);
  if (!user) return false;

  // Check if user has admin role
  const roles = user.roles ?? 0;
  return roles >= 3; // Admin or higher
}

async function isUserChannelModerator(
  ctx: { db: any },
  userId: Id<"users">,
  channelId: Id<"chatChannels">
): Promise<boolean> {
  const membership = await ctx.db
    .query("chatChannelMembers")
    .withIndex("by_channel_user", (q: any) =>
      q.eq("channelId", channelId).eq("userId", userId)
    )
    .filter((q: any) => q.eq(q.field("leftAt"), undefined))
    .first();

  return membership?.role === "admin" || membership?.role === "moderator";
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Get all pending flags (message and user).
 */
export const getPendingFlags = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Only admins/moderators can view flags
    const isAdmin = await isUserAdmin(ctx, userId);
    if (!isAdmin) {
      // Check if user is a moderator in any channel
      const memberships = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .filter((q) =>
          q.and(
            q.eq(q.field("leftAt"), undefined),
            q.or(q.eq(q.field("role"), "admin"), q.eq(q.field("role"), "moderator"))
          )
        )
        .collect();

      if (memberships.length === 0) {
        return { messageFlags: [], userFlags: [] };
      }
    }

    const messageFlags = await ctx.db
      .query("chatMessageFlags")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    const userFlags = await ctx.db
      .query("chatUserFlags")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    return { messageFlags, userFlags };
  },
});

/**
 * Get all flags for a specific message.
 */
export const getFlagsForMessage = query({
  args: {
    token: v.string(),
    messageId: v.id("chatMessages"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Only admins/moderators can view flags
    const isAdmin = await isUserAdmin(ctx, userId);

    const message = await ctx.db.get(args.messageId);
    if (!message) {
      return [];
    }

    if (!isAdmin) {
      const isMod = await isUserChannelModerator(ctx, userId, message.channelId);
      if (!isMod) {
        return [];
      }
    }

    return await ctx.db
      .query("chatMessageFlags")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .collect();
  },
});

/**
 * Get all flags for a specific user.
 */
export const getFlagsForUser = query({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const currentUserId = await requireAuth(ctx, args.token);

    // Only admins can view user flags
    const isAdmin = await isUserAdmin(ctx, currentUserId);
    if (!isAdmin) {
      return [];
    }

    return await ctx.db
      .query("chatUserFlags")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Flag a message for review.
 */
export const flagMessage = mutation({
  args: {
    token: v.string(),
    messageId: v.id("chatMessages"),
    reason: v.string(),
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    // Check if user has already flagged this message
    const existingFlag = await ctx.db
      .query("chatMessageFlags")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .filter((q) => q.eq(q.field("reportedById"), userId))
      .first();

    if (existingFlag) {
      // Update existing flag
      await ctx.db.patch(existingFlag._id, {
        reason: args.reason,
        details: args.details,
      });
      return;
    }

    await ctx.db.insert("chatMessageFlags", {
      messageId: args.messageId,
      reportedById: userId,
      reason: args.reason,
      details: args.details,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

/**
 * Flag a user for review.
 */
export const flagUser = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    reason: v.string(),
    details: v.optional(v.string()),
    channelId: v.optional(v.id("chatChannels")),
  },
  handler: async (ctx, args) => {
    const reporterId = await requireAuth(ctx, args.token);

    const targetUser = await ctx.db.get(args.userId);
    if (!targetUser) {
      throw new Error("User not found");
    }

    await ctx.db.insert("chatUserFlags", {
      userId: args.userId,
      reportedById: reporterId,
      reason: args.reason,
      details: args.details,
      channelId: args.channelId,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

/**
 * Review a message flag (admin/moderator action).
 */
export const reviewMessageFlag = mutation({
  args: {
    token: v.string(),
    flagId: v.id("chatMessageFlags"),
    action: v.string(), // "dismissed" | "reviewed" | "actioned"
    actionDetails: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const flag = await ctx.db.get(args.flagId);
    if (!flag) {
      throw new Error("Flag not found");
    }

    const message = await ctx.db.get(flag.messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    // Check authorization
    const isAdmin = await isUserAdmin(ctx, userId);
    const isMod = await isUserChannelModerator(ctx, userId, message.channelId);

    if (!isAdmin && !isMod) {
      throw new Error("Not authorized to review flags");
    }

    await ctx.db.patch(args.flagId, {
      status: args.action,
      reviewedById: userId,
      reviewedAt: Date.now(),
      actionTaken: args.actionDetails,
    });
  },
});

/**
 * Review a user flag (admin action).
 */
export const reviewUserFlag = mutation({
  args: {
    token: v.string(),
    flagId: v.id("chatUserFlags"),
    action: v.string(), // "dismissed" | "reviewed" | "actioned"
    actionDetails: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Only admins can review user flags
    const isAdmin = await isUserAdmin(ctx, userId);
    if (!isAdmin) {
      throw new Error("Only administrators can review user flags");
    }

    const flag = await ctx.db.get(args.flagId);
    if (!flag) {
      throw new Error("Flag not found");
    }

    await ctx.db.patch(args.flagId, {
      status: args.action,
      reviewedById: userId,
      reviewedAt: Date.now(),
      actionTaken: args.actionDetails,
    });
  },
});
