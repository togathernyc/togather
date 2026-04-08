import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { communityPeopleAggregate } from "../lib/aggregates";

/**
 * Backfill the communityPeople aggregate B-Tree from existing table data.
 *
 * Processes in batches to avoid Convex function timeout/memory limits.
 * Each invocation processes up to `batchSize` records, then self-schedules
 * the next batch if more remain.
 *
 * Run with:
 *   npx convex run migrations/backfillCommunityPeopleAggregate:backfill
 *
 * To clear and re-run (if aggregate drifted):
 *   npx convex run migrations/backfillCommunityPeopleAggregate:clear
 *   npx convex run migrations/backfillCommunityPeopleAggregate:backfill
 */
export const backfill = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    totalInserted: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 500;
    const totalInserted = args.totalInserted ?? 0;

    // Paginate using _creationTime + _id cursor
    let query = ctx.db
      .query("communityPeople")
      .withIndex("by_creation_time")
      .order("asc");

    const batch = await query.take(batchSize + 1);

    // Skip to cursor position
    let startIdx = 0;
    if (args.cursor) {
      const cursorIdx = batch.findIndex((doc) => doc._id === args.cursor);
      if (cursorIdx >= 0) {
        startIdx = cursorIdx + 1;
      }
    }

    const toProcess = batch.slice(startIdx, startIdx + batchSize);

    if (toProcess.length === 0) {
      console.log(
        `Backfill complete — ${totalInserted} communityPeople records inserted into aggregate.`
      );
      return { totalInserted, isDone: true };
    }

    let inserted = 0;
    for (const doc of toProcess) {
      try {
        await communityPeopleAggregate.insert(ctx, doc);
        inserted++;
      } catch (e) {
        // Record may already exist in aggregate (idempotency on re-run)
        console.warn(
          `Skipped ${doc._id} (may already exist in aggregate): ${e}`
        );
      }
    }

    const lastDoc = toProcess[toProcess.length - 1];
    const newTotal = totalInserted + inserted;

    console.log(
      `Batch done: inserted ${inserted} records (total: ${newTotal}), cursor: ${lastDoc._id}`
    );

    // Self-schedule next batch
    await ctx.scheduler.runAfter(0, internal.migrations.backfillCommunityPeopleAggregate.backfill, {
      cursor: lastDoc._id,
      batchSize,
      totalInserted: newTotal,
    });

    return { totalInserted: newTotal, isDone: false };
  },
});

/**
 * Clear the aggregate (useful before re-running backfill if data drifted).
 */
export const clear = internalMutation({
  args: {},
  handler: async (ctx) => {
    await communityPeopleAggregate.clearAll(ctx);
    console.log("Aggregate cleared.");
  },
});
