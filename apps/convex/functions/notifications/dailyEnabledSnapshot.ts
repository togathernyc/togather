/**
 * Daily snapshot of "users with notifications enabled at the device level".
 *
 * Why a snapshot instead of computing historically: push tokens are deleted
 * when a user disables notifications, so any past moment's count isn't
 * reconstructible from the current `pushTokens` table. We persist one row per
 * UTC day per environment so the admin dashboard can show "today vs yesterday".
 *
 * Definition of "enabled": user has at least one row in `pushTokens` for the
 * current environment. This matches `notifications.preferences.preferences`
 * which derives `notificationsEnabled` from token existence (the `isActive`
 * field is intentionally ignored — see comment in that query).
 *
 * Cron: runs at 00:05 UTC daily. The snapshot's `date` is the UTC day that
 * just ended (e.g. firing at 00:05 UTC on 2026-04-30 writes a row dated
 * 2026-04-29 representing the count as the day closed).
 *
 * Idempotent: re-running for the same date overwrites the row.
 */

import { internalMutation } from "../../_generated/server";
import { getCurrentEnvironment } from "../../lib/notifications/send";

const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" for a given timestamp in UTC. */
function toUtcDateString(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const environment = getCurrentEnvironment();
    const nowMs = Date.now();
    // Snapshot represents the day that just closed (e.g. fired at 00:05 UTC
    // on 4/30 → this is the count for 4/29 EOD). Subtract a minute so we're
    // squarely inside yesterday's UTC window even with cron timing slop.
    const targetDate = toUtcDateString(nowMs - 60_000);

    // Count distinct userIds with at least one push token in this env.
    // We don't have a per-environment index without a userId prefix, so we
    // page through `pushTokens` and tally a Set. Token volume scales with
    // active users — fine for current scale (low six figures); revisit with
    // a streaming aggregate if this gets slow.
    const distinctUsers = new Set<string>();
    for await (const row of ctx.db.query("pushTokens")) {
      if (row.environment !== environment) continue;
      distinctUsers.add(row.userId);
    }
    const enabledCount = distinctUsers.size;

    // Idempotent upsert keyed by (environment, date).
    const existing = await ctx.db
      .query("dailyNotificationStats")
      .withIndex("by_environment_date", (q) =>
        q.eq("environment", environment).eq("date", targetDate),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabledCount,
        createdAt: nowMs,
      });
    } else {
      await ctx.db.insert("dailyNotificationStats", {
        date: targetDate,
        environment,
        enabledCount,
        createdAt: nowMs,
      });
    }

    return { date: targetDate, environment, enabledCount };
  },
});
