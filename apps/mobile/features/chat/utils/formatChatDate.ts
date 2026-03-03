import { format, isToday, isYesterday, parseISO } from "date-fns";

/**
 * Formats a chat date for display in message bubbles
 * - Today: "h:mm a" (e.g., "2:30 PM")
 * - Yesterday: "Yesterday h:mm a" (e.g., "Yesterday 2:30 PM")
 * - Older: "MMM d, yyyy h:mm a" (e.g., "Jan 15, 2024 2:30 PM")
 */
export function formatChatDate(dateString: string | Date | null | undefined): string {
  if (!dateString) return "";
  try {
    const date = typeof dateString === "string" ? parseISO(dateString) : new Date(dateString);
    if (isToday(date)) {
      return format(date, "h:mm a");
    } else if (isYesterday(date)) {
      return `Yesterday ${format(date, "h:mm a")}`;
    } else {
      return format(date, "MMM d, yyyy h:mm a");
    }
  } catch {
    return "";
  }
}

