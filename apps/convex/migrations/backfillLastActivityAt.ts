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
    lastProcessedId: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 500;

    // Use by_createdAt index to scan in order, resuming from where we left off.
    // We use gte (not gt) to avoid skipping messages that share the boundary
    // timestamp, then skip any we've already processed by checking lastProcessedId.
    let batch;
    if (args.afterCreationTime !== undefined) {
      batch = await ctx.db
        .query("chatMessages")
        .withIndex("by_createdAt", (idx) =>
          idx.gte("createdAt", args.afterCreationTime!)
        )
        .order("asc")
        .take(batchSize + 100); // over-fetch to account for skipped duplicates
    } else {
      batch = await ctx.db
        .query("chatMessages")
        .withIndex("by_createdAt")
        .order("asc")
        .take(batchSize);
    }

    // Skip messages we already processed in the previous batch (same timestamp boundary)
    if (args.lastProcessedId) {
      const skipIdx = batch.findIndex((m) => m._id === args.lastProcessedId);
      if (skipIdx >= 0) {
        batch = batch.slice(skipIdx + 1);
      }
    }

    // Trim back to batch size
    batch = batch.slice(0, batchSize);

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

    const lastMsg = batch[batch.length - 1];
    const isDone = batch.length < batchSize;

    console.log(
      `Batch: ${migratedCount} migrated, ${skippedCount} skipped. ${isDone ? "DONE" : "Scheduling next batch..."}`,
    );

    // Self-schedule the next batch if more messages remain
    if (!isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillLastActivityAt.backfillLastActivityAt,
        {
          afterCreationTime: lastMsg.createdAt,
          lastProcessedId: lastMsg._id,
          batchSize,
        },
      );
    }

    return { migratedCount, skippedCount, isDone };
  },
});
