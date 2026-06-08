/**
 * Run sheet timing (ADR-026).
 *
 * Clock times for run sheet items are never stored — they are derived by
 * cascading each item's `durationSec` forward from the selected service start
 * time. This keeps a single run sheet shared across all of a plan's `times`:
 * switching the displayed service time (10am ↔ 12pm) just re-bases everything
 * with no writes.
 *
 * A `header` is a section divider — it carries no duration of its own and
 * simply inherits the clock time of the next non-header item.
 */

/** The minimum an item needs for timing: its id, type, and duration. */
export interface TimingItem {
  _id: string;
  type: string;
  durationSec: number;
}

/**
 * Compute each item's start time (epoch ms) by cascading durations from
 * `serviceStartMs`. Items must already be in display order. Returns a map of
 * item id → start time; a `header` maps to the next non-header item's time, or
 * `null` if no item follows it.
 */
export function computeItemClockTimes(
  items: TimingItem[],
  serviceStartMs: number,
): Record<string, number | null> {
  const times: Record<string, number | null> = {};

  // Forward pass: real items advance the cursor; headers are filled in after.
  let cursor = serviceStartMs;
  for (const item of items) {
    if (item.type === "header") {
      times[item._id] = null;
      continue;
    }
    times[item._id] = cursor;
    cursor += Math.max(0, item.durationSec) * 1000;
  }

  // Second pass: each header inherits the time of the next non-header item.
  for (let i = 0; i < items.length; i++) {
    if (items[i].type !== "header") continue;
    for (let j = i + 1; j < items.length; j++) {
      if (items[j].type !== "header") {
        times[items[i]._id] = times[items[j]._id];
        break;
      }
    }
  }

  return times;
}

/** "10:04 AM" — clock label for a run sheet row. */
export function formatClockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Per-service start–end ranges for the header, e.g.
 * "10:00 AM – 10:37 AM · 12:00 PM – 12:37 PM". The run sheet's order and
 * durations are shared across every service time; only the start differs, so
 * each service ends `totalSec` after its own start.
 */
export function formatServiceRanges(
  times: Array<{ startsAt: number }>,
  totalSec: number,
): string {
  return times
    .map((t) => {
      const end = t.startsAt + Math.max(0, totalSec) * 1000;
      return `${formatClockTime(t.startsAt)} – ${formatClockTime(end)}`;
    })
    .join("  ·  ");
}

/**
 * "5 min" / "1 hr 5 min" / "45 sec" — compact duration label. Returns an empty
 * string for a zero duration (e.g. a header) so callers can hide it.
 */
export function formatDuration(durationSec: number): string {
  const total = Math.max(0, Math.round(durationSec));
  if (total === 0) return "";
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const parts: string[] = [];
  if (hrs > 0) parts.push(`${hrs} hr`);
  if (mins > 0) parts.push(`${mins} min`);
  // Only surface seconds when there's no larger unit, to keep labels short.
  if (secs > 0 && hrs === 0 && mins === 0) parts.push(`${secs} sec`);
  return parts.join(" ");
}
