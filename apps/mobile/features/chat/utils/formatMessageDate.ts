import { format, isToday, isThisWeek, parseISO } from "date-fns";

/**
 * Formats a message date for display in chat list
 * - Today: "h:mm a" (e.g., "2:30 PM")
 * - This week: "EEE" (e.g., "Mon")
 * - Older: "MMM dd, yyyy" (e.g., "Jan 15, 2024")
 */
export function formatMessageDate(dateString: string | null | undefined): string {
  if (!dateString) return "";
  try {
    const date = parseISO(dateString);
    if (isToday(date)) {
      return format(date, "h:mm a");
    } else if (isThisWeek(date)) {
      return format(date, "EEE");
    } else {
      return format(date, "MMM dd, yyyy");
    }
  } catch {
    return "";
  }
}

