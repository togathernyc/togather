/**
 * Hourly rollup of notification counters.
 *
 * A cron calls `runHourlyRollup` once per hour (at :05 past) to populate
 * `notificationHourlyStats` by scanning the `notifications` table for the
 * previous hour. Replaces the inline `incrementNotificationHourlyStat` calls,
 * which caused OCC conflicts when many notifications landed in the same
 * second (all patching the same shared counter row).
 *
 * Semantics (preserved from the previous inline approach):
 *   - sent:      notifications with status === "sent" and createdAt in the hour
 *   - impressed: notifications whose impressedAt is in the hour
 *   - clicked:   notifications whose clickedAt is in the hour
 *
 * Idempotent: re-running for an hour deletes then re-inserts its rows.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import { internal } from "../../_generated/api";

const HOUR_MS = 60 * 60 * 1000;
const PAGE_SIZE = 1000;
// Cap auto-catch-up per cron run. If the cron is skipped for longer than
// this (e.g. prolonged deploy pause), subsequent hourly runs will keep
// advancing the cursor until the backlog clears.
const MAX_CATCH_UP_HOURS = 24;

// ============================================================================
// Internal queries — paginated scans by event-time index
// ============================================================================

export const pageSent = internalQuery({
  args: {
    hourStartMs: v.number(),
    hourEndMs: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("notifications")
      .withIndex("by_createdAt", (q) =>
        q.gte("createdAt", args.hourStartMs).lt("createdAt", args.hourEndMs)
      )
      .paginate({ cursor: args.cursor, numItems: PAGE_SIZE });

    const types = result.page
      .filter((n) => n.status === "sent")
      .map((n) => n.notificationType);

    return {
      types,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const pageImpressed = internalQuery({
  args: {
    hourStartMs: v.number(),
    hourEndMs: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("notifications")
      .withIndex("by_impressedAt", (q) =>
        q.gte("impressedAt", args.hourStartMs).lt("impressedAt", args.hourEndMs)
      )
      .paginate({ cursor: args.cursor, numItems: PAGE_SIZE });

    return {
      types: result.page.map((n) => n.notificationType),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const pageClicked = internalQuery({
  args: {
    hourStartMs: v.number(),
    hourEndMs: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("notifications")
      .withIndex("by_clickedAt", (q) =>
        q.gte("clickedAt", args.hourStartMs).lt("clickedAt", args.hourEndMs)
      )
      .paginate({ cursor: args.cursor, numItems: PAGE_SIZE });

    return {
      types: result.page.map((n) => n.notificationType),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

// ============================================================================
// Latest-processed-hour probe (for auto catch-up)
// ============================================================================

export const getLatestProcessedHour = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("notificationHourlyStats")
      .withIndex("by_hour")
      .order("desc")
      .first();
    return row?.hourStartMs ?? null;
  },
});

// ============================================================================
// Writer — replaces all rows for a given hour
// ============================================================================

export const writeHourRows = internalMutation({
  args: {
    hourStartMs: v.number(),
    rows: v.array(
      v.object({
        type: v.string(),
        sent: v.number(),
        impressed: v.number(),
        clicked: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("notificationHourlyStats")
      .withIndex("by_hour", (q) => q.eq("hourStartMs", args.hourStartMs))
      .collect();
    for (const row of existing) {
      await ctx.db.delete(row._id);
    }

    const updatedAt = Date.now();
    for (const row of args.rows) {
      await ctx.db.insert("notificationHourlyStats", {
        hourStartMs: args.hourStartMs,
        type: row.type,
        sent: row.sent,
        impressed: row.impressed,
        clicked: row.clicked,
        updatedAt,
      });
    }
  },
});

// ============================================================================
// Orchestrating action
// ============================================================================

/**
 * Roll up notification counters.
 *
 * - Cron usage (no args): catches up from the last row in
 *   `notificationHourlyStats` forward to the hour just completed, processing
 *   up to MAX_CATCH_UP_HOURS per invocation. If the table is empty, rolls
 *   up only the hour just completed (no history backfill).
 * - Explicit backfill: pass `hourStartMs` to reprocess a single specific
 *   hour (idempotent — deletes + re-inserts rows for that hour).
 */
export const runHourlyRollup = internalAction({
  args: { hourStartMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const latestTarget =
      Math.floor(Date.now() / HOUR_MS) * HOUR_MS - HOUR_MS;

    let hoursToProcess: number[];
    if (args.hourStartMs !== undefined) {
      hoursToProcess = [args.hourStartMs];
    } else {
      const lastProcessed: number | null = await ctx.runQuery(
        internal.functions.notifications.rollup.getLatestProcessedHour,
        {}
      );
      if (lastProcessed === null) {
        hoursToProcess = [latestTarget];
      } else {
        const firstPending = lastProcessed + HOUR_MS;
        if (firstPending > latestTarget) {
          hoursToProcess = [];
        } else {
          const pendingCount = Math.floor(
            (latestTarget - firstPending) / HOUR_MS
          ) + 1;
          const count = Math.min(pendingCount, MAX_CATCH_UP_HOURS);
          hoursToProcess = Array.from(
            { length: count },
            (_, i) => firstPending + i * HOUR_MS
          );
        }
      }
    }

    type Page = { types: string[]; isDone: boolean; continueCursor: string };
    type PageQuery =
      | typeof internal.functions.notifications.rollup.pageSent
      | typeof internal.functions.notifications.rollup.pageImpressed
      | typeof internal.functions.notifications.rollup.pageClicked;

    const tally = async (
      query: PageQuery,
      hourStartMs: number,
      hourEndMs: number
    ): Promise<Map<string, number>> => {
      const counts = new Map<string, number>();
      let cursor: string | null = null;
      while (true) {
        const page: Page = await ctx.runQuery(query, {
          hourStartMs,
          hourEndMs,
          cursor,
        });
        for (const type of page.types) {
          counts.set(type, (counts.get(type) ?? 0) + 1);
        }
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      return counts;
    };

    for (const hourStartMs of hoursToProcess) {
      const hourEndMs = hourStartMs + HOUR_MS;

      const [sent, impressed, clicked] = await Promise.all([
        tally(
          internal.functions.notifications.rollup.pageSent,
          hourStartMs,
          hourEndMs
        ),
        tally(
          internal.functions.notifications.rollup.pageImpressed,
          hourStartMs,
          hourEndMs
        ),
        tally(
          internal.functions.notifications.rollup.pageClicked,
          hourStartMs,
          hourEndMs
        ),
      ]);

      const types = new Set<string>([
        ...sent.keys(),
        ...impressed.keys(),
        ...clicked.keys(),
      ]);
      const rows = Array.from(types).map((type) => ({
        type,
        sent: sent.get(type) ?? 0,
        impressed: impressed.get(type) ?? 0,
        clicked: clicked.get(type) ?? 0,
      }));

      await ctx.runMutation(
        internal.functions.notifications.rollup.writeHourRows,
        { hourStartMs, rows }
      );
    }
  },
});
