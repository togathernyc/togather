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

/** Sum of item durations (seconds), ignoring negatives. */
export function totalDurationSec(items: TimingItem[]): number {
  return items.reduce((sum, i) => sum + Math.max(0, i.durationSec), 0);
}

/**
 * Clock times for a run sheet split into before / during / after phases:
 *
 *  - **during** cascades forward from the event start (`serviceStartMs`).
 *  - **before** counts BACKWARD so its items lead up to the start — the last
 *    "before" item ends exactly at `serviceStartMs`.
 *  - **after** cascades forward from the event end (start + total "during").
 *
 * Returns one merged map of item id → start time, so a single lookup works
 * regardless of an item's phase.
 */
export function computeSegmentedClockTimes(
  before: TimingItem[],
  during: TimingItem[],
  after: TimingItem[],
  serviceStartMs: number,
): Record<string, number | null> {
  const duringTotalMs = totalDurationSec(during) * 1000;
  const beforeTotalMs = totalDurationSec(before) * 1000;
  const eventEndMs = serviceStartMs + duringTotalMs;
  const beforeStartMs = serviceStartMs - beforeTotalMs;
  return {
    ...computeItemClockTimes(before, beforeStartMs),
    ...computeItemClockTimes(during, serviceStartMs),
    ...computeItemClockTimes(after, eventEndMs),
  };
}

/**
 * Pick which service a multi-service plan's run sheet should anchor to for a
 * given wall-clock `now`, so day-of the sheet re-bases to the service you're
 * actually in (and its live highlight tracks the right rows). Each service `i`
 * owns the window `[startsAt_i − before, startsAt_i + during + after]` — its
 * pre-roll leading in through its post-roll.
 *
 * Selection order:
 *   1. a service whose window contains `now` (the one happening now — if two
 *      overlap, the later-starting wins, since that's the one you're rolling into);
 *   2. else the soonest service still ahead of `now` (its window hasn't opened);
 *   3. else the last service (everything's already over).
 *
 * Returns an index into `times` (0 when empty). Durations are in seconds.
 */
export function pickActiveServiceIndex(
  times: Array<{ startsAt: number }>,
  now: number,
  beforeSec: number,
  duringSec: number,
  afterSec: number,
): number {
  if (times.length === 0) return 0;
  const beforeMs = Math.max(0, beforeSec) * 1000;
  const tailMs = (Math.max(0, duringSec) + Math.max(0, afterSec)) * 1000;

  let containing = -1;
  let nextUpcoming = -1;
  let last = 0;
  for (let i = 0; i < times.length; i++) {
    const winStart = times[i].startsAt - beforeMs;
    const winEnd = times[i].startsAt + tailMs;
    if (now >= winStart && now < winEnd) {
      if (containing === -1 || times[i].startsAt > times[containing].startsAt) {
        containing = i;
      }
    }
    if (winStart > now) {
      if (nextUpcoming === -1 || times[i].startsAt < times[nextUpcoming].startsAt) {
        nextUpcoming = i;
      }
    }
    if (times[i].startsAt > times[last].startsAt) last = i;
  }

  if (containing !== -1) return containing;
  if (nextUpcoming !== -1) return nextUpcoming;
  return last;
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
