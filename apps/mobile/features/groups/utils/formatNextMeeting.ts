import { format, isToday, isTomorrow, parseISO } from "date-fns";

/**
 * Formats a date string for display as "Today at X:XX", "Tomorrow at X:XX", or "MMM d, h:mm a"
 */
export function formatNextMeeting(dateString: string | null | undefined): string | null {
  if (!dateString) return null;
  try {
    const date = parseISO(dateString);
    if (isToday(date)) {
      return `Today at ${format(date, "h:mm a")}`;
    } else if (isTomorrow(date)) {
      return `Tomorrow at ${format(date, "h:mm a")}`;
    } else {
      return format(date, "MMM d, h:mm a");
    }
  } catch {
    return null;
  }
}

