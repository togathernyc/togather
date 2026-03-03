import { format, isToday, isTomorrow, parseISO } from "date-fns";

/**
 * Formats a date string for detailed display
 * Returns "Today at X:XX", "Tomorrow at X:XX", or "EEEE, MMMM d, yyyy 'at' h:mm a"
 */
export function formatDateDisplay(dateString: string | null | undefined): string {
  if (!dateString) return "";
  try {
    const date = parseISO(dateString);
    if (isToday(date)) {
      return `Today at ${format(date, "h:mm a")}`;
    } else if (isTomorrow(date)) {
      return `Tomorrow at ${format(date, "h:mm a")}`;
    } else {
      return format(date, "EEEE, MMMM d, yyyy 'at' h:mm a");
    }
  } catch {
    return format(new Date(dateString), "EEEE, MMMM d, yyyy");
  }
}

