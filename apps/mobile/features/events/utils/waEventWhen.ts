/**
 * waEventWhen — the WhatsApp-style "when" label for a flag-on Events row.
 *
 * `components/wa/waListTimestamp.ts` is the same idea for the Chats list, but
 * it is built for the PAST (today → time, yesterday, weekday, numeric date)
 * and collapses every future timestamp into "today". Event rows are almost
 * always future-dated, so this is its mirror image: decreasing precision as
 * the event gets further AWAY.
 *
 * | when                    | shown             |
 * | ----------------------- | ----------------- |
 * | today                   | `Today 7:00 PM`   |
 * | tomorrow                | `Tomorrow 7:00 PM`|
 * | 2-6 days out            | `Wed 7:00 PM`     |
 * | further out / past      | `Wed, Aug 12 7:00 PM` |
 *
 * Two deliberate notes:
 * - **Calendar days in the viewer's timezone, not elapsed hours.** An event at
 *   23:30 tonight is "Today" at 22:00 and "Yesterday"-shaped (so: dated) after
 *   midnight; bucketing on `ts - now` gets this wrong every night.
 * - **No timezone abbreviation.** `formatTimeWithTimezone` renders
 *   "7:00 PM EST"; WhatsApp never puts a timezone in a list subtitle, and the
 *   label is already rendered in the viewer's own zone. The event detail screen
 *   still shows the full zoned time, so nothing is lost.
 */
import { format, toZonedTime } from 'date-fns-tz';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Calendar-day index in `timeZone`, so comparisons are day boundaries there. */
function zonedDayIndex(date: Date, timeZone: string): number {
  const zoned = toZonedTime(date, timeZone);
  return (
    Date.UTC(zoned.getFullYear(), zoned.getMonth(), zoned.getDate()) / MS_PER_DAY
  );
}

/** The day half of the label — "Today" / "Tomorrow" / "Wed" / "Wed, Aug 12". */
export function formatWaEventDay(
  scheduledAt: string | number | Date,
  timeZone: string,
  now: number = Date.now()
): string {
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) return '';

  const dayDelta = zonedDayIndex(date, timeZone) - zonedDayIndex(new Date(now), timeZone);
  if (dayDelta === 0) return 'Today';
  if (dayDelta === 1) return 'Tomorrow';

  const zoned = toZonedTime(date, timeZone);
  if (dayDelta > 1 && dayDelta < 7) return format(zoned, 'EEE', { timeZone });
  return format(zoned, 'EEE, MMM d', { timeZone });
}

/**
 * Full row label: the day bucket above plus a 12/24-hour-agnostic clock time.
 *
 * @param scheduledAt Event start (ISO string, epoch ms, or Date).
 * @param timeZone Viewer's timezone.
 * @param now Injectable clock — tests pass a fixed value; callers omit it.
 */
export function formatWaEventWhen(
  scheduledAt: string | number | Date,
  timeZone: string,
  now: number = Date.now()
): string {
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) return '';

  const day = formatWaEventDay(date, timeZone, now);
  const time = format(toZonedTime(date, timeZone), 'h:mm a', { timeZone });
  return day ? `${day} ${time}` : time;
}
