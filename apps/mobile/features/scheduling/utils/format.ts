/**
 * Scheduling — display formatting helpers.
 *
 * Small, pure functions shared across the scheduler and volunteer screens.
 */

/** Default role swatch colors offered when creating a role. */
export const ROLE_COLORS = [
  "#E5484D",
  "#F76808",
  "#FFB224",
  "#46A758",
  "#12A594",
  "#0091FF",
  "#6E56CF",
  "#D6409F",
];

/** Fallback color for a role with no `color` set. */
export const DEFAULT_ROLE_COLOR = "#6E7781";

/** "Sun, May 17" — the compact event-date label used everywhere. */
export function formatEventDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "Sunday, May 17, 2026" — the long form for detail screens. */
export function formatEventDateLong(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** "May 17" date-group heading for My Schedule. */
export function formatDateHeading(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** A YYYY-MM-DD key for grouping assignments by calendar day. */
export function dateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Status pill copy + intent for an assignment status. */
export function assignmentStatusLabel(status: string): string {
  switch (status) {
    case "confirmed":
      return "Confirmed";
    case "declined":
      return "Declined";
    default:
      return "Awaiting";
  }
}
