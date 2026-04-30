/**
 * Daily snapshot of "users with notifications enabled at the device level".
 *
 * Why a snapshot instead of computing historically: the live count comes
 * from `notificationEnabledCounter` (a running tally maintained by the token
 * write paths), but historical "yesterday" comparison needs a frozen value —
 * so we write one row per UTC day per environment.
 *
 * Definition of "enabled": user has at least one row in `pushTokens` for the
 * current environment. Matches `notifications.preferences.preferences`.
 *
 * Cron: runs at 00:05 UTC daily. The snapshot's `date` is the UTC day that
 * just ended (e.g. firing at 00:05 UTC on 2026-04-30 writes a row dated
 * 2026-04-29 representing the count as the day closed).
 *
 * Idempotent: re-running for the same date overwrites the row.
 *
 * Scale: O(1) — reads the running counter rather than scanning pushTokens.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import { getCurrentEnvironment } from "../../lib/notifications/send";
import { readEnabledCount } from "../../lib/notifications/enabledCounter";

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKFILL_PAGE_SIZE = 1000;

/** "YYYY-MM-DD" for a given timestamp in UTC. */
function toUtcDateString(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const environment = getCurrentEnvironment();
    const nowMs = Date.now();
    // Snapshot represents the UTC day that just closed (e.g. fired at 00:05
    // UTC on 4/30 → this is the count for 4/29 EOD).
    const targetDate = toUtcDateString(nowMs - DAY_MS);

    // O(1) read from the running tally maintained by the token write paths.
    const enabledCount = await readEnabledCount(ctx, environment);

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

// ============================================================================
// Backfill: one-time seeding of the running counter from existing pushTokens.
// ============================================================================
//
// The counter is maintained incrementally going forward, but the table
// starts empty when this PR deploys. Run `backfillEnabledCounter` once after
// deploy to seed it from the existing pushTokens rows. Paginated through an
// action so it works regardless of token volume (no transaction-level scan
// limits in actions calling internal queries).

/** Page through pushTokens for backfill — returns one page + cursor. */
export const pagePushTokensForBackfill = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    pageSize: v.number(),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("pushTokens")
      .paginate({ numItems: args.pageSize, cursor: args.cursor });
    return {
      page: result.page.map((r) => ({
        userId: r.userId as string,
        environment: r.environment ?? null,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** Overwrite the counter for `environment` with `count`. Used by backfill. */
export const setEnabledCounter = internalMutation({
  args: {
    environment: v.string(),
    count: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("notificationEnabledCounter")
      .withIndex("by_environment", (q) => q.eq("environment", args.environment))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        count: args.count,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("notificationEnabledCounter", {
        environment: args.environment,
        count: args.count,
        updatedAt: Date.now(),
      });
    }
  },
});

/** Return all environments that currently have a counter row. Used by
 *  backfill to detect rows that need zeroing because their env had no
 *  tokens this scan (full churn of users in that env since last backfill). */
export const listCounterEnvironments = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("notificationEnabledCounter").collect();
    return rows.map((r) => r.environment);
  },
});

/**
 * One-time backfill action — pages through the entire `pushTokens` table,
 * tallies distinct userIds per environment, and writes the resulting counts
 * into `notificationEnabledCounter`. Run from the Convex dashboard once
 * after deploy:
 *
 *   internal.functions.notifications.dailyEnabledSnapshot.backfillEnabledCounter()
 *
 * Idempotent — running it again overwrites with the freshly computed
 * counts. Legacy tokens with `environment === undefined` are skipped (they
 * aren't reachable by env-scoped reads anyway).
 */
export const backfillEnabledCounter = internalAction({
  args: {},
  handler: async (ctx) => {
    const usersByEnv = new Map<string, Set<string>>();
    let cursor: string | null = null;
    let totalRows = 0;

    while (true) {
      const result: {
        page: Array<{ userId: string; environment: string | null }>;
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(
        internal.functions.notifications.dailyEnabledSnapshot.pagePushTokensForBackfill,
        { cursor, pageSize: BACKFILL_PAGE_SIZE },
      );

      for (const row of result.page) {
        if (!row.environment) continue; // skip legacy/unscoped tokens
        let set = usersByEnv.get(row.environment);
        if (!set) {
          set = new Set();
          usersByEnv.set(row.environment, set);
        }
        set.add(row.userId);
      }

      totalRows += result.page.length;
      if (result.isDone) break;
      cursor = result.continueCursor;
    }

    // Zero out any environment that has an existing counter row but no
    // tokens in this scan — without this, `backfillEnabledCounter` would
    // leave stale counts for envs whose users have all churned out, making
    // the function silently non-idempotent and the dashboard permanently
    // overstated for that env.
    const knownEnvs: string[] = await ctx.runQuery(
      internal.functions.notifications.dailyEnabledSnapshot.listCounterEnvironments,
    );
    for (const env of knownEnvs) {
      if (!usersByEnv.has(env)) {
        usersByEnv.set(env, new Set());
      }
    }

    const summary: Array<{ environment: string; count: number }> = [];
    for (const [environment, userSet] of usersByEnv) {
      const count = userSet.size;
      summary.push({ environment, count });
      await ctx.runMutation(
        internal.functions.notifications.dailyEnabledSnapshot.setEnabledCounter,
        { environment, count },
      );
    }

    return { totalRowsScanned: totalRows, environments: summary };
  },
});
