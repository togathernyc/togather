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
 * The calendar day `atMs` falls on in `timeZone`, as a sortable `YYYY-MM-DD`
 * key. Two timestamps share a local day iff their keys are equal.
 *
 * @param atMs Unix ms instant.
 * @param timeZone An already-resolved IANA zone (see {@link resolveTimeZone}).
 */
export function localDayKey(atMs: number, timeZone: string): string {
  // "en-CA" formats as YYYY-MM-DD, which is both the key and sort order.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(atMs));
}

/** "Sun, Aug 3" in `timeZone` — for user-facing collision messages. */
export function localDayLabel(atMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(atMs));
}
