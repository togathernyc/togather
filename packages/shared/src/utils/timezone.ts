import { format, toZonedTime } from 'date-fns-tz';

/**
 * Format a date/time with timezone abbreviation
 * e.g., "7:00 PM EST"
 */
export function formatTimeWithTimezone(
  date: Date | string,
  timezone: string
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const zonedDate = toZonedTime(dateObj, timezone);
  return format(zonedDate, 'h:mm a zzz', { timeZone: timezone });
}

/**
 * Format a full date and time with timezone abbreviation
 * e.g., "Dec 25, 2024 at 7:00 PM EST"
 */
export function formatDateTimeWithTimezone(
  date: Date | string,
  timezone: string
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const zonedDate = toZonedTime(dateObj, timezone);
  return format(zonedDate, "MMM d, yyyy 'at' h:mm a zzz", { timeZone: timezone });
}

/**
 * Format a short date with timezone abbreviation
 * e.g., "Dec 25 at 7:00 PM EST"
 */
export function formatShortDateTimeWithTimezone(
  date: Date | string,
  timezone: string
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const zonedDate = toZonedTime(dateObj, timezone);
  return format(zonedDate, "MMM d 'at' h:mm a zzz", { timeZone: timezone });
}

/**
 * Get timezone abbreviation for a given date and timezone
 * e.g., "EST", "PST", "ACST"
 */
export function getTimezoneAbbreviation(
  timezone: string,
  date: Date = new Date()
): string {
  const zonedDate = toZonedTime(date, timezone);
  return format(zonedDate, 'zzz', { timeZone: timezone });
}

/**
 * Get the display name for a timezone
 * e.g., "America/New_York" -> "Eastern Time (ET)"
 */
export function getTimezoneDisplayName(timezone: string): string {
  const displayNames = TIMEZONE_DISPLAY_NAMES[timezone];
  if (displayNames) {
    return displayNames;
  }
  // Fallback: format the timezone ID
  return timezone.replace(/_/g, ' ').replace(/\//g, ' - ');
}

/**
 * Format just the date part in a timezone
 * e.g., "Wednesday, December 25"
 */
export function formatDateInTimezone(
  date: Date | string,
  timezone: string
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const zonedDate = toZonedTime(dateObj, timezone);
  return format(zonedDate, 'EEEE, MMMM d', { timeZone: timezone });
}

/**
 * Format just the time part in a timezone
 * e.g., "7:00 PM"
 */
export function formatTimeInTimezone(
  date: Date | string,
  timezone: string
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const zonedDate = toZonedTime(dateObj, timezone);
  return format(zonedDate, 'h:mm a', { timeZone: timezone });
}

// Display names for common timezones
const TIMEZONE_DISPLAY_NAMES: Record<string, string> = {
  'America/New_York': 'Eastern Time (ET)',
  'America/Chicago': 'Central Time (CT)',
  'America/Denver': 'Mountain Time (MT)',
  'America/Los_Angeles': 'Pacific Time (PT)',
  'America/Anchorage': 'Alaska Time (AKT)',
  'Pacific/Honolulu': 'Hawaii Time (HT)',
  'America/Phoenix': 'Arizona Time (MST)',
  'Europe/London': 'London (GMT/BST)',
  'Europe/Paris': 'Central European Time (CET)',
  'Europe/Berlin': 'Central European Time (CET)',
  'Asia/Tokyo': 'Japan Standard Time (JST)',
  'Asia/Shanghai': 'China Standard Time (CST)',
  'Asia/Kolkata': 'India Standard Time (IST)',
  'Australia/Sydney': 'Australian Eastern Time (AET)',
  'Australia/Perth': 'Australian Western Time (AWT)',
  'Australia/Adelaide': 'Australian Central Time (ACT)',
  'Pacific/Auckland': 'New Zealand Time (NZT)',
  'UTC': 'Coordinated Universal Time (UTC)',
};

/**
 * List of common timezones for the timezone picker
 * Ordered roughly by UTC offset (west to east)
 */
export const COMMON_TIMEZONES: { value: string; label: string; offset: string }[] = [
  // North America
  { value: 'Pacific/Honolulu', label: 'Hawaii', offset: 'UTC-10' },
  { value: 'America/Anchorage', label: 'Alaska', offset: 'UTC-9' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (Los Angeles)', offset: 'UTC-8/-7' },
  { value: 'America/Phoenix', label: 'Arizona (No DST)', offset: 'UTC-7' },
  { value: 'America/Denver', label: 'Mountain Time (Denver)', offset: 'UTC-7/-6' },
  { value: 'America/Chicago', label: 'Central Time (Chicago)', offset: 'UTC-6/-5' },
  { value: 'America/New_York', label: 'Eastern Time (New York)', offset: 'UTC-5/-4' },

  // South America
  { value: 'America/Sao_Paulo', label: 'Sao Paulo', offset: 'UTC-3' },
  { value: 'America/Buenos_Aires', label: 'Buenos Aires', offset: 'UTC-3' },

  // Europe & Africa
  { value: 'UTC', label: 'UTC', offset: 'UTC+0' },
  { value: 'Europe/London', label: 'London', offset: 'UTC+0/+1' },
  { value: 'Europe/Paris', label: 'Paris', offset: 'UTC+1/+2' },
  { value: 'Europe/Berlin', label: 'Berlin', offset: 'UTC+1/+2' },
  { value: 'Africa/Johannesburg', label: 'Johannesburg', offset: 'UTC+2' },
  { value: 'Europe/Moscow', label: 'Moscow', offset: 'UTC+3' },

  // Middle East
  { value: 'Asia/Dubai', label: 'Dubai', offset: 'UTC+4' },

  // Asia
  { value: 'Asia/Kolkata', label: 'India (Mumbai)', offset: 'UTC+5:30' },
  { value: 'Asia/Bangkok', label: 'Bangkok', offset: 'UTC+7' },
  { value: 'Asia/Singapore', label: 'Singapore', offset: 'UTC+8' },
  { value: 'Asia/Shanghai', label: 'China (Shanghai)', offset: 'UTC+8' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong', offset: 'UTC+8' },
  { value: 'Asia/Tokyo', label: 'Tokyo', offset: 'UTC+9' },
  { value: 'Asia/Seoul', label: 'Seoul', offset: 'UTC+9' },

  // Australia & Pacific
  { value: 'Australia/Perth', label: 'Perth', offset: 'UTC+8' },
  { value: 'Australia/Adelaide', label: 'Adelaide', offset: 'UTC+9:30/+10:30' },
  { value: 'Australia/Sydney', label: 'Sydney', offset: 'UTC+10/+11' },
  { value: 'Australia/Brisbane', label: 'Brisbane (No DST)', offset: 'UTC+10' },
  { value: 'Pacific/Auckland', label: 'Auckland', offset: 'UTC+12/+13' },
];

/**
 * Get all IANA timezones (comprehensive list)
 * Use COMMON_TIMEZONES for a curated picker, this for search/advanced
 * Note: Falls back to COMMON_TIMEZONES values if Intl.supportedValuesOf is not available
 */
export function getAllTimezones(): string[] {
  // Intl.supportedValuesOf is a newer API, not available in all environments
  if (typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl) {
    return (Intl as any).supportedValuesOf('timeZone');
  }
  // Fallback to common timezones
  return COMMON_TIMEZONES.map(tz => tz.value);
}

/**
 * Validate if a string is a valid IANA timezone
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
