/**
 * Blocking Functions for Convex-Native Messaging
 *
 * User blocking and unblocking functionality.
 */

import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";

// ============================================================================
// Queries
// ============================================================================

/**
 * Get list of users blocked by the current user.
 */
export const getBlockedUsers = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const blocks = await ctx.db
      .query("chatUserBlocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", userId))
      .collect();

    const blockedUserIds = blocks.map((b) => b.blockedId);
    const users = await Promise.all(blockedUserIds.map((id) => ctx.db.get(id)));

    return users.filter((u): u is NonNullable<typeof u> => u !== null);
  },
});

/**
 * Check if a specific user is blocked by the current user.
 */
export const isBlocked = query({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const currentUserId = await requireAuth(ctx, args.token);

    const block = await ctx.db
      .query("chatUserBlocks")
      .withIndex("by_blocker_blocked", (q) =>
        q.eq("blockerId", currentUserId).eq("blockedId", args.userId)
      )
      .first();

    return block !== null;
  },
});

/**
 * Check if the current user is blocked by another user.
 */
export const isBlockedBy = query({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const currentUserId = await requireAuth(ctx, args.token);

    const block = await ctx.db
      .query("chatUserBlocks")
      .withIndex("by_blocker_blocked", (q) =>
        q.eq("blockerId", args.userId).eq("blockedId", currentUserId)
      )
      .first();

    return block !== null;
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Block a user.
 */
export const blockUser = mutation({
  args: {
    token: v.string(),
    blockedId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Cannot block self
    if (userId === args.blockedId) {
      throw new Error("Cannot block yourself");
    }

    // Check if already blocked
    const existingBlock = await ctx.db
      .query("chatUserBlocks")
      .withIndex("by_blocker_blocked", (q) =>
        q.eq("blockerId", userId).eq("blockedId", args.blockedId)
      )
      .first();

    if (existingBlock) {
      // Already blocked, update reason if provided
      if (args.reason) {
        await ctx.db.patch(existingBlock._id, { reason: args.reason });
      }
      return;
    }

    const now = Date.now();
    await ctx.db.insert("chatUserBlocks", {
      blockerId: userId,
      blockedId: args.blockedId,
      createdAt: now,
      reason: args.reason,
    });

    // Auto-decline any pending ad-hoc chat request between the blocker and the blocked.
    // Only the blocker's own membership row is touched — the blocked user's view is
    // unaffected (silent block). Without this, pending requests would linger in the
    // blocker's inbox after they explicitly opted out of further contact.
    const myMemberships = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_user_requestState", (q) =>
        q.eq("userId", userId).eq("requestState", "pending"),
      )
      .collect();
    for (const m of myMemberships) {
      if (m.invitedById !== args.blockedId) continue;
      if (m.leftAt !== undefined) continue;
      await ctx.db.patch(m._id, {
        requestState: "declined",
        requestRespondedAt: now,
        leftAt: now,
      });
    }
  },
});

/**
 * Unblock a user.
 */
export const unblockUser = mutation({
  args: {
    token: v.string(),
    blockedId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const block = await ctx.db
      .query("chatUserBlocks")
      .withIndex("by_blocker_blocked", (q) =>
        q.eq("blockerId", userId).eq("blockedId", args.blockedId)
      )
      .first();

    if (block) {
      await ctx.db.delete(block._id);
    }
  },
});
