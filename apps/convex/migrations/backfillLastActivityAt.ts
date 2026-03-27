import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

/**
 * Migration to backfill lastActivityAt on existing top-level chatMessages.
 *
 * Sets lastActivityAt = createdAt for top-level messages (no parentMessageId)
 * that don't already have it. This is required so the new
 * by_channel_lastActivityAt index sorts all messages correctly.
 *
 * Processes in batches to avoid Convex function timeout/memory limits.
 * Each invocation processes up to `batchSize` messages, then self-schedules
 * the next batch if more remain.
 *
 * Run with: npx convex run migrations/backfillLastActivityAt:backfillLastActivityAt
 */
export const backfillLastActivityAt = internalMutation({
  args: {
    afterCreationTime: v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 500;

    // Use by_createdAt index to scan in order, resuming from where we left off
    let q = ctx.db.query("chatMessages").withIndex("by_createdAt");
    if (args.afterCreationTime !== undefined) {
      q = ctx.db
        .query("chatMessages")
        .withIndex("by_createdAt", (idx) =>
          idx.gt("createdAt", args.afterCreationTime!)
        );
    }

    const batch = await q.order("asc").take(batchSize);

    if (batch.length === 0) {
      console.log("Migration complete — no more messages to process.");
      return { migratedCount: 0, skippedCount: 0, isDone: true };
    }

    let migratedCount = 0;
    let skippedCount = 0;

    for (const msg of batch) {
      // Only backfill top-level messages (not thread replies)
      if (msg.parentMessageId) {
        skippedCount++;
        continue;
      }

      // Skip if already has lastActivityAt
      if (msg.lastActivityAt !== undefined) {
        skippedCount++;
        continue;
      }

      await ctx.db.patch(msg._id, { lastActivityAt: msg.createdAt });
      migratedCount++;
    }

    const lastCreatedAt = batch[batch.length - 1].createdAt;
    const isDone = batch.length < batchSize;

    console.log(
      `Batch: ${migratedCount} migrated, ${skippedCount} skipped. ${isDone ? "DONE" : "Scheduling next batch..."}`,
    );

    // Self-schedule the next batch if more messages remain
    if (!isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillLastActivityAt.backfillLastActivityAt,
        { afterCreationTime: lastCreatedAt, batchSize },
      );
    }

    return { migratedCount, skippedCount, isDone };
  },
});
