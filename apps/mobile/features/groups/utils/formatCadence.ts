/**
 * Formats group schedule/cadence for display
 * Returns format like "Wednesdays at 2:31pm" or null if no schedule
 */

import type { Group } from "../types";

// Day arrays follow JavaScript's getDay() convention: Sunday = 0, Monday = 1, ..., Saturday = 6
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const DAY_NAMES_PLURAL = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
];

/**
 * Formats time string (HH:MM:SS or HH:MM) to 12-hour format with am/pm
 */
function formatTime(timeString: string | null | undefined): string | null {
  if (!timeString) return null;

  try {
    // Handle both "HH:MM:SS" and "HH:MM" formats
    const parts = timeString.split(":");
    if (parts.length < 2) return null;

    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);

    if (isNaN(hours) || isNaN(minutes)) return null;

    const period = hours >= 12 ? "pm" : "am";
    const displayHours = hours % 12 || 12;
    const displayMinutes = minutes.toString().padStart(2, "0");

    return `${displayHours}:${displayMinutes}${period}`;
  } catch {
    return null;
  }
}

/**
 * Formats cadence from group data
 * Returns format like "Wednesdays at 2:31pm" or null
 */
export function formatCadence(group: Group | null | undefined): string | null {
  if (!group) return null;

  // Try to get day and time from group directly
  // Handle both old API format (day/start_time) and new API format (default_day/default_start_time)
  let day: number | undefined = (group.day ?? group.default_day) ?? undefined;
  let time: string | undefined = (group.start_time ?? group.default_start_time) ?? undefined;

  // If not available, try to extract from first_meeting_date in schedule
  const schedule = group.group_schedule_details || group.group_schedule;
  if (schedule?.first_meeting_date && (!day || !time)) {
    try {
      const date = new Date(schedule.first_meeting_date);
      if (!isNaN(date.getTime())) {
        // Get day of week - matches our array indexing (Sunday = 0)
        day = date.getDay();

        // Format time
        const hours = date.getHours();
        const minutes = date.getMinutes();
        time = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:00`;
      }
    } catch {
      // Ignore date parsing errors
    }
  }

  // If still no day or time, return null
  if (day === undefined || day === null || !time) {
    return null;
  }

  // Validate day is in range
  if (day < 0 || day > 6) {
    return null;
  }

  const dayName = DAY_NAMES_PLURAL[day];
  const formattedTime = formatTime(time);

  if (!dayName || !formattedTime) {
    return null;
  }

  return `${dayName} at ${formattedTime}`;
}

