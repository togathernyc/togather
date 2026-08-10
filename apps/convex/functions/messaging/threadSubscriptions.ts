/**
 * Thread Notification Subscriptions
 *
 * Per-user notification preference for a chat thread (a parent message and its
 * replies). By default a member is only notified about a reply when they are
 * @mentioned; these functions let a member override that for a specific thread:
 *
 *   - "all":     notify on every reply, even without a mention
 *   - "none":    never notify, even when @mentioned
 *   - "default": fall back to the mention-only behavior (stored as no row)
 *
 * The reply notification fanout in `events.ts` reads these rows. See
 * `decideRecipientBucket` there for how the preference is applied.
 */

import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import { requireAuth } from "../../lib/auth";

/** A user's notification preference for a thread, including the implicit default. */
const threadNotificationState = v.union(
  v.literal("all"),
  v.literal("none"),
  v.literal("default"),
);

/**
 * Read the current user's notification preference for a thread.
 * Returns "default" when no explicit preference is stored.
 */
export const getThreadSubscription = query({
  args: {
    token: v.string(),
    threadId: v.id("chatMessages"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const subscription = await ctx.db
      .query("chatThreadSubscriptions")
      .withIndex("by_thread_user", (q) =>
        q.eq("threadId", args.threadId).eq("userId", userId),
      )
      .first();

    return {
      threadId: args.threadId,
      state: subscription?.state ?? "default",
    };
  },
});

/**
 * Set (or clear) the current user's notification preference for a thread.
 * Passing "default" removes any stored override so the thread falls back to the
 * mention-only default.
 */
export const setThreadSubscription = mutation({
  args: {
    token: v.string(),
    threadId: v.id("chatMessages"),
    state: threadNotificationState,
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const thread = await ctx.db.get(args.threadId);
    if (!thread) {
      throw new Error("Thread not found");
    }

    // Only members of the thread's channel may set a preference for it.
    const membership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", thread.channelId).eq("userId", userId),
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!membership) {
      throw new Error("Not a member of this channel");
    }

    const existing = await ctx.db
      .query("chatThreadSubscriptions")
      .withIndex("by_thread_user", (q) =>
        q.eq("threadId", args.threadId).eq("userId", userId),
      )
      .first();

    if (args.state === "default") {
      // No explicit override needed — remove any stored row.
      if (existing) {
        await ctx.db.delete(existing._id);
      }
    } else if (existing) {
      await ctx.db.patch(existing._id, {
        state: args.state,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("chatThreadSubscriptions", {
        threadId: args.threadId,
        userId,
        state: args.state,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    return { threadId: args.threadId, state: args.state };
  },
});
