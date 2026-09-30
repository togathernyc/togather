/**
 * Display helpers for the Slack bot's weekly schedule.
 *
 * The bot's crons compare against the current day/hour in America/New_York
 * (see createWeeklyThreads in apps/convex/functions/slackServiceBot/actions.ts),
 * so "next run" has to be worked out on the ET calendar, not the viewer's.
 */

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** 9 -> "9am", 12 -> "12pm", 15 -> "3pm". */
export function formatHour(hour: number): string {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour > 12 ? `${hour - 12}pm` : `${hour}am`;
}

/** (2, 10) -> "Tuesdays at 10am ET". */
export function formatSchedule(dayOfWeek: number, hourET: number): string {
  return `${DAY_NAMES_LONG[dayOfWeek]}s at ${formatHour(hourET)} ET`;
}

/**
 * The date the next weekly run happens, e.g. "Tue, Oct 6", or null if this
 * JS engine can't resolve ET (older Hermes builds ship partial Intl). A run
 * scheduled for today whose hour has already arrived counts as done, matching
 * the hourly cron which fires once at the top of `hourET`.
 */
export function describeNextRun(now: Date, dayOfWeek: number, hourET: number): string | null {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        hour12: false,
        weekday: "short",
      })
        .formatToParts(now)
        .map((p) => [p.type, p.value]),
    );
    const today = DAY_NAMES.indexOf(parts.weekday);
    // Some engines render midnight as "24" with hour12: false.
    const hour = Number(parts.hour) % 24;
    if (today < 0 || Number.isNaN(hour)) return null;

    let daysAhead = (dayOfWeek - today + 7) % 7;
    if (daysAhead === 0 && hour >= hourET) daysAhead = 7;

    // Do the calendar arithmetic in UTC so the viewer's own timezone can't shift it.
    const target = new Date(
      Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + daysAhead),
    );
    return target.toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return null;
  }
}
