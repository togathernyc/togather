/**
 * Notification rollup counters.
 *
 * Maintains O(hours × types) counter rows in `notificationHourlyStats` so the
 * admin dashboard can read per-day totals without scanning the full
 * notifications table. Hourly granularity lets any viewer timezone slice
 * "today" exactly.
 *
 * Call `incrementNotificationHourlyStat` from any mutation that registers a
 * notification event. No backfill of pre-existing notifications — rollup
 * history starts from the first call.
 */

import type { MutationCtx } from "../_generated/server";

const HOUR_MS = 60 * 60 * 1000;

export type NotificationStatField = "sent" | "impressed" | "clicked";

export async function incrementNotificationHourlyStat(
  ctx: MutationCtx,
  params: { type: string; ts: number; field: NotificationStatField }
): Promise<void> {
  const hourStartMs = Math.floor(params.ts / HOUR_MS) * HOUR_MS;

  const existing = await ctx.db
    .query("notificationHourlyStats")
    .withIndex("by_hour_type", (q) =>
      q.eq("hourStartMs", hourStartMs).eq("type", params.type)
    )
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      [params.field]: (existing[params.field] ?? 0) + 1,
      updatedAt: Date.now(),
    });
    return;
  }

  await ctx.db.insert("notificationHourlyStats", {
    hourStartMs,
    type: params.type,
    sent: params.field === "sent" ? 1 : 0,
    impressed: params.field === "impressed" ? 1 : 0,
    clicked: params.field === "clicked" ? 1 : 0,
    updatedAt: Date.now(),
  });
}
