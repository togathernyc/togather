/**
 * Shared Date Formatting Utilities
 *
 * Centralized date formatting functions used across features.
 * Replaces duplicate date formatting logic in individual features.
 */

import { format, parseISO, isToday, isTomorrow, isYesterday } from 'date-fns';

/**
 * Formats date for chat/message display
 * Shows "Today", "Tomorrow", "Yesterday", or formatted date
 *
 * @param dateString - ISO date string or Date object
 * @returns Formatted date string
 */
export function formatChatDate(dateString: string | Date | null | undefined): string {
  if (!dateString) return '';
  try {
    const date = typeof dateString === 'string' ? parseISO(dateString) : new Date(dateString);
    if (isToday(date)) return 'Today';
    if (isTomorrow(date)) return 'Tomorrow';
    if (isYesterday(date)) return 'Yesterday';
    return format(date, 'MMM d, yyyy');
  } catch {
    return '';
  }
}

/**
 * Formats time for message display
 * Returns time in "h:mm a" format (e.g., "2:30 PM")
 *
 * @param dateString - ISO date string
 * @returns Formatted time string
 */
export function formatMessageTime(dateString: string | null | undefined): string {
  if (!dateString) return '';
  try {
    const date = parseISO(dateString);
    return format(date, 'h:mm a');
  } catch {
    return '';
  }
}

/**
 * Formats date for chat message bubbles
 * - Today: "h:mm a" (e.g., "2:30 PM")
 * - Yesterday: "Yesterday h:mm a" (e.g., "Yesterday 2:30 PM")
 * - Older: "MMM d, h:mm a" (e.g., "Jan 15, 2:30 PM")
 *
 * @param dateString - ISO date string or Date object
 * @returns Formatted date string
 */
export function formatChatMessageDate(dateString: string | Date | null | undefined): string {
  if (!dateString) return '';
  try {
    const date = typeof dateString === 'string' ? parseISO(dateString) : new Date(dateString);
    if (isToday(date)) {
      return format(date, 'h:mm a');
    } else if (isYesterday(date)) {
      return `Yesterday ${format(date, 'h:mm a')}`;
    } else {
      return format(date, 'MMM d, h:mm a');
    }
  } catch {
    return '';
  }
}

/**
 * Formats date for next meeting display
 * Returns "Today at X:XX", "Tomorrow at X:XX", or "MMM d, h:mm a"
 *
 * @param dateString - ISO date string
 * @returns Formatted date string or null
 */
export function formatNextMeeting(dateString: string | null | undefined): string | null {
  if (!dateString) return null;
  try {
    const date = parseISO(dateString);
    if (isToday(date)) {
      return `Today at ${format(date, 'h:mm a')}`;
    } else if (isTomorrow(date)) {
      return `Tomorrow at ${format(date, 'h:mm a')}`;
    } else {
      return format(date, 'MMM d, h:mm a');
    }
  } catch {
    return null;
  }
}
