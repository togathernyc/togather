/**
 * Shared scheduling utilities for bot scheduling functions.
 * Used by both groupBots.ts and scheduledJobs.ts.
 */

/** Map of weekday abbreviations to day numbers (0=Sunday) */
const DAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Get the current day of week (0=Sunday) in a given timezone.
 */
function getCurrentDayInTimezone(timezone: string, date: Date = new Date()): number {
  const dayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  });
  const dayStr = dayFormatter.format(date);
  return DAY_MAP[dayStr] ?? 0;
}

/**
 * Get the current hour in a given timezone.
 */
function getCurrentHourInTimezone(timezone: string, date: Date = new Date()): number {
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  });
  const timeParts = timeFormatter.formatToParts(date);
  return parseInt(timeParts.find((p) => p.type === "hour")?.value || "0", 10);
}

/**
 * Check if a schedule is due now (within the current hour).
 * Used by the hourly cron to determine if a message should be sent.
 *
 * NOTE: The `minute` field is intentionally not used for scheduling.
 * Since the cron runs hourly, all messages scheduled for a given hour
 * are sent when the cron fires. The minute field is stored for UI display
 * purposes but does not affect actual send time.
 *
 * @param schedule - Object with dayOfWeek (0=Sunday), hour, minute
 * @param timezone - IANA timezone string
 * @returns true if the schedule falls within the current hour
 */
export function isScheduleDueNow(
  schedule: { dayOfWeek: number; hour: number; minute: number },
  timezone: string
): boolean {
  const { dayOfWeek, hour } = schedule;
  const nowDate = new Date();

  // Check day of week
  const currentDay = getCurrentDayInTimezone(timezone, nowDate);
  if (currentDay !== dayOfWeek) {
    return false;
  }

  // Check hour
  const currentHour = getCurrentHourInTimezone(timezone, nowDate);
  return currentHour === hour;
}

/**
 * Calculate the next scheduled time for a specific day of week and time.
 * Used by communication bot for weekly scheduling.
 *
 * @param schedule - Object with dayOfWeek (0=Sunday), hour, minute
 * @param timezone - IANA timezone string
 * @returns Unix timestamp in milliseconds
 */
export function calculateNextScheduledTimeForDayOfWeek(
  schedule: { dayOfWeek: number; hour: number; minute: number },
  timezone: string
): number {
  const { dayOfWeek, hour, minute } = schedule;
  const nowDate = new Date();

  // Create formatters for the timezone
  const dayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  });

  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  // Get current day of week in the timezone (0=Sunday)
  const dayStr = dayFormatter.format(nowDate);
  const currentDay = DAY_MAP[dayStr] ?? 0;

  // Get current time in the timezone
  const timeParts = timeFormatter.formatToParts(nowDate);
  const currentHour = parseInt(
    timeParts.find((p) => p.type === "hour")?.value || "0",
    10
  );
  const currentMinute = parseInt(
    timeParts.find((p) => p.type === "minute")?.value || "0",
    10
  );

  // Calculate days until next occurrence
  let daysUntil = dayOfWeek - currentDay;
  if (daysUntil < 0) {
    daysUntil += 7; // Next week
  } else if (daysUntil === 0) {
    // Same day - check if time has passed
    const currentTimeMinutes = currentHour * 60 + currentMinute;
    const targetTimeMinutes = hour * 60 + minute;
    if (currentTimeMinutes >= targetTimeMinutes) {
      daysUntil = 7; // Same day but time passed, schedule for next week
    }
  }

  // Calculate target date
  const targetDate = new Date(nowDate);
  targetDate.setDate(targetDate.getDate() + daysUntil);

  // Get the date components in the target timezone
  const parts = dateFormatter.formatToParts(targetDate);
  const year = parseInt(parts.find((p) => p.type === "year")?.value || "2024");
  const month = parseInt(parts.find((p) => p.type === "month")?.value || "1");
  const day = parseInt(parts.find((p) => p.type === "day")?.value || "1");

  // Calculate timezone offset to convert target time to UTC
  // Strategy: Compare the same instant in UTC and the target timezone
  // to determine the offset, then apply it to our target time
  const targetTimeStr = `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}T${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}:00`;

  // Create a Date object treating the target time as if it were UTC
  const estimatedUTC = new Date(`${targetTimeStr}Z`);

  // Get the hour in the target timezone for this UTC time
  const tzHourFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  });
  const tzHour = parseInt(tzHourFormatter.format(estimatedUTC), 10);

  // The offset is the difference between the timezone hour and UTC hour
  // If UTC is 10:00 and timezone shows 15:00, offset is +5 hours
  // We need to find UTC time T such that T in timezone = target time
  // If timezone is ahead of UTC, we need a later UTC time
  let offsetHours = tzHour - hour;

  // Handle day boundary wraparound
  if (offsetHours > 12) {
    offsetHours -= 24;
  } else if (offsetHours < -12) {
    offsetHours += 24;
  }

  // Create the final UTC timestamp
  // Target time in timezone = UTC + offset
  // So UTC = Target time - offset
  const utcTime = new Date(`${targetTimeStr}Z`);
  utcTime.setHours(utcTime.getHours() - offsetHours);

  return utcTime.getTime();
}

/**
 * Type for communication bot message schedule
 */
export interface ScheduledMessage {
  id: string;
  message: string;
  schedule: { dayOfWeek: number; hour: number; minute: number };
  targetChannelSlug: string;
  enabled: boolean;
}

/**
 * Calculate the next scheduled time for a communication bot config.
 * Handles both new format (messages array) and legacy format (single schedule).
 *
 * For multi-message format, finds the earliest next scheduled time across all enabled messages.
 *
 * @param config - Bot config object (new or legacy format)
 * @param timezone - IANA timezone string
 * @returns Unix timestamp in milliseconds, or undefined if no schedule
 */
export function calculateCommunicationBotNextSchedule(
  config: {
    messages?: ScheduledMessage[];
    schedule?: { dayOfWeek: number; hour: number; minute: number };
  },
  timezone: string
): number | undefined {
  // Check for new multi-message format
  if (config.messages && config.messages.length > 0) {
    // Find earliest among all enabled messages with content
    const enabledMessages = config.messages.filter(m => m.enabled && m.message.trim());
    if (enabledMessages.length > 0) {
      const scheduledTimes = enabledMessages.map(m =>
        calculateNextScheduledTimeForDayOfWeek(m.schedule, timezone)
      );
      return Math.min(...scheduledTimes);
    }
  } else if (config.schedule) {
    // Legacy format: single schedule
    return calculateNextScheduledTimeForDayOfWeek(config.schedule, timezone);
  }

  return undefined;
}
