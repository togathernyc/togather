/**
 * Presentation helpers for the in-app Notifications feed.
 *
 * Maps a notification's `notificationType` to an icon and provides a compact
 * relative-time formatter for feed rows and the Inbox preview.
 */
import type { Ionicons } from "@expo/vector-icons";

type IoniconName = keyof typeof Ionicons.glyphMap;

/**
 * Pick an Ionicon for a notification based on its type. Falls back to a
 * generic bell for unrecognized types so new server-side types still render.
 */
export function iconForNotificationType(type: string): IoniconName {
  switch (type) {
    case "join_request_received":
    case "join_request_approved":
      return "person-add";
    case "group_creation_approved":
      return "people-circle";
    case "role_changed":
      return "ribbon";
    case "new_message":
    case "mention":
      return "chatbubble-ellipses";
    case "event_rsvp_received":
      return "checkmark-circle";
    case "event_blast":
    case "event_updated":
    case "meeting_reminder":
      return "calendar";
    case "attendance_confirmation":
      return "hand-left";
    case "followup_assigned":
      return "clipboard";
    case "admin_broadcast":
      return "megaphone";
    default:
      return "notifications";
  }
}

/**
 * Compact relative time: "now", "5m", "3h", "2d", "3w", or an absolute date
 * for anything older than ~4 weeks. Matches the scanning-aid tone used by
 * event rows elsewhere in the inbox.
 */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const diffMs = now - timestamp;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w`;
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
