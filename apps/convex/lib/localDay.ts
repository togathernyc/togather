/**
 * Local calendar-day helpers.
 *
 * Timestamps in this codebase are UTC epoch ms, but "is this the same day?" is
 * always a LOCAL-time question for a church: a 9 AM and an 11 AM service on the
 * same Sunday are one day, while a Saturday 11 PM and a Sunday 1 AM plan are
 * two — and flooring by 86_400_000 (the `utcDayBucket` shortcut used by the
 * per-person double-booking check) gets both of those wrong outside UTC. For
 * an ET church, Sat 11 PM and Sun 1 AM are 04:00Z and 06:00Z on the SAME UTC
 * day, so a UTC bucket would call them one day.
 *
 * `Intl` is deterministic inside Convex (see the note in `functions/demo.ts`),
 * so formatting to the community's zone is safe in a query or mutation.
 */

/** Every community without an explicit zone is treated as Eastern. */
export const DEFAULT_TIMEZONE = "America/New_York";

/**
 * Validate an IANA timezone string, falling back to {@link DEFAULT_TIMEZONE}.
 * Mirrors `resolveTimeZone` in `functions/admin/stats.ts` — `Intl` throws a
 * RangeError on an unknown zone, and a bad `communities.timezone` value must
 * never break a mutation.
 */
export function resolveTimeZone(tz: string | undefined | null): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * Constructing an `Intl.DateTimeFormat` is ~100× the cost of using one (500
 * calls: 55 ms constructed per call vs 0.5 ms hoisted). `assertPlanDateFree`
 * formats EVERY sibling plan of a group on every create/duplicate/date-update,
 * and `rosterMatrix` formats every plan on every re-run of a reactive query —
 * so the formatters are built once per zone and reused. A church has one
 * timezone, so these maps hold one entry each.
 */
const dayKeyFormatters = new Map<string, Intl.DateTimeFormat>();
const dayLabelFormatters = new Map<string, Intl.DateTimeFormat>();

function dayKeyFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = dayKeyFormatters.get(timeZone);
  if (!fmt) {
    // "en-CA" formats as YYYY-MM-DD, which is both the key and sort order.
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayKeyFormatters.set(timeZone, fmt);
  }
  return fmt;
}

function dayLabelFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = dayLabelFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    dayLabelFormatters.set(timeZone, fmt);
  }
  return fmt;
}

/**
 * The key returned for a timestamp that isn't a real instant.
 *
 * `eventDate` is a Convex `v.number()`, i.e. a float64 — `NaN`, `±Infinity`
 * and out-of-range values all pass validation, and `Intl.DateTimeFormat.format`
 * throws `RangeError: Invalid time value` on every one of them. One such row
 * (a bad client, an import, a migration) would otherwise take down plan
 * creation AND the roster grid for its whole group, since both map this over
 * every plan. Callers MUST treat this key as "unknown day": never a match, in
 * either direction. {@link isValidDayKey} is the check.
 */
export const INVALID_DAY_KEY = "invalid-date";

/** False for the {@link INVALID_DAY_KEY} sentinel — never compare those. */
export function isValidDayKey(key: string): boolean {
  return key !== INVALID_DAY_KEY;
}

/**
 * The calendar day `atMs` falls on in `timeZone`, as a sortable `YYYY-MM-DD`
 * key. Two timestamps share a local day iff their keys are equal AND the key
 * is valid — see {@link INVALID_DAY_KEY}.
 *
 * @param atMs Unix ms instant.
 * @param timeZone An already-resolved IANA zone (see {@link resolveTimeZone}).
 */
export function localDayKey(atMs: number, timeZone: string): string {
  if (!Number.isFinite(atMs)) return INVALID_DAY_KEY;
  try {
    return dayKeyFormatter(timeZone).format(new Date(atMs));
  } catch {
    // |atMs| > 8.64e15 is finite but outside the Date range.
    return INVALID_DAY_KEY;
  }
}

/** "Sun, Aug 3" in `timeZone` — for user-facing collision messages. */
export function localDayLabel(atMs: number, timeZone: string): string {
  if (!Number.isFinite(atMs)) return "an unknown date";
  try {
    return dayLabelFormatter(timeZone).format(new Date(atMs));
  } catch {
    return "an unknown date";
  }
}
