/**
 * Helpers for the `notificationEnabledCounter` running tally.
 *
 * The counter tracks distinct users with ≥1 push token, per environment, so
 * the admin dashboard and daily snapshot can read in O(1) instead of
 * scanning the full pushTokens table (which would hit Convex transaction
 * scan limits at scale).
 *
 * Maintained by mutations on the token write paths:
 *   - `tokens.registerToken`         → +1 when user transitions 0 → 1 token
 *   - `tokens.unregisterToken`       → -1 when user's last token in env is deleted
 *   - `preferences.updatePreferences` (disable) → -1 if user had ≥1 token
 *   - `users.deleteUser` cascade     → -1 per env where user had ≥1 token
 *
 * Seeded by `dailyEnabledSnapshot.backfillEnabledCounter` on first deploy.
 */

import type { MutationCtx, QueryCtx } from "../../_generated/server";

/**
 * Atomically adjust the counter for `environment` by `delta` (typically +1
 * or -1). Clamps to 0 — concurrent writes or replay errors should never
 * produce a negative count.
 */
export async function adjustEnabledCounter(
  ctx: MutationCtx,
  environment: string,
  delta: number,
): Promise<void> {
  if (delta === 0) return;

  const existing = await ctx.db
    .query("notificationEnabledCounter")
    .withIndex("by_environment", (q) => q.eq("environment", environment))
    .unique();

  const next = Math.max(0, (existing?.count ?? 0) + delta);
  if (existing) {
    await ctx.db.patch(existing._id, {
      count: next,
      updatedAt: Date.now(),
    });
  } else if (delta > 0) {
    await ctx.db.insert("notificationEnabledCounter", {
      environment,
      count: next,
      updatedAt: Date.now(),
    });
  }
  // If counter row doesn't exist and delta is negative, no-op (clamped to 0).
}

/** Read current count for an environment. Returns 0 if no row exists yet. */
export async function readEnabledCount(
  ctx: QueryCtx | MutationCtx,
  environment: string,
): Promise<number> {
  const row = await ctx.db
    .query("notificationEnabledCounter")
    .withIndex("by_environment", (q) => q.eq("environment", environment))
    .unique();
  return row?.count ?? 0;
}
