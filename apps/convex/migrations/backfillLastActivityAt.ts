import { internalMutation } from "../_generated/server";

/**
 * Migration to backfill lastActivityAt on existing top-level chatMessages.
 *
 * Sets lastActivityAt = createdAt for top-level messages (no parentMessageId)
 * that don't already have it. This is required so the new
 * by_channel_lastActivityAt index sorts all messages correctly.
 *
 * Run with: npx convex run migrations/backfillLastActivityAt:backfillLastActivityAt
 */
export const backfillLastActivityAt = internalMutation({
  handler: async (ctx) => {
    const messages = await ctx.db.query("chatMessages").collect();

    let migratedCount = 0;
    let skippedCount = 0;

    for (const msg of messages) {
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

    console.log(
      `Migration complete: ${migratedCount} messages backfilled, ${skippedCount} skipped (total: ${messages.length})`,
    );

    return { migratedCount, skippedCount, total: messages.length };
  },
});
