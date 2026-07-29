/**
 * waListTimestamp — the right-column timestamp format for WhatsApp-style
 * lists (WA-VISUAL-DELTAS.md, per-screen §1.6).
 *
 * WhatsApp never shows an elapsed-duration timestamp in the Chats list. It
 * shows *when*, at decreasing precision as the message ages:
 *
 * | age                  | shown        |
 * | -------------------- | ------------ |
 * | today                | `3:42 PM`    |
 * | yesterday            | `Yesterday`  |
 * | 2-6 calendar days    | `Sunday`     |
 * | older                | `7/3/26`     |
 *
 * Togather showed `now` / `12m` / `4h` / `4d` / `Jul 3` instead — a different
 * mental model (how long ago) from the one the rest of the row uses.
 *
 * Two deliberate notes on the shape:
 * - **Calendar days, not elapsed hours.** A 23:55 message read at 00:05 is
 *   "Yesterday", not "today" — bucketing on `Date.now() - ts` gets this
 *   wrong every night. Every boundary here is a local-midnight boundary.
 * - **Locale-aware time and date.** The delta list writes the buckets as
 *   `HH:MM` and `M/D/YY`; those are its shorthand for "time of day" and
 *   "numeric short date", and WhatsApp itself follows the device's 12/24-hour
 *   and date-order settings. So both go through `Intl` rather than being
 *   hand-formatted — on `en-US` that yields exactly `3:42 PM` and `7/3/26`.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Local-midnight-anchored day index, so comparisons are calendar-day ones. */
function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Format a millisecond timestamp for a WhatsApp-style list row's right column.
 *
 * @param timestamp Message/activity time, in epoch milliseconds.
 * @param now Injectable "current time" — tests pass a fixed clock; callers
 *   should omit it.
 */
export function formatWaListTimestamp(timestamp: number, now: number = Date.now()): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';

  const dayDelta = Math.round(
    (startOfLocalDay(new Date(now)) - startOfLocalDay(date)) / MS_PER_DAY
  );

  // Future-dated rows (clock skew, or a scheduled item) read as "today"
  // rather than as a negative-age weekday.
  if (dayDelta <= 0) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (dayDelta === 1) return 'Yesterday';
  if (dayDelta < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });

  return date.toLocaleDateString(undefined, {
    year: '2-digit',
    month: 'numeric',
    day: 'numeric',
  });
}
