/**
 * Meeting configuration constants
 *
 * Centralized meeting-related constants used across:
 * - meetings/index.ts
 * - meetings/communityEvents.ts
 * - groups/mutations.ts (for auto-spawning meetings)
 * - communityWideEvents.ts
 */

// ============================================================================
// Time Offsets
// ============================================================================

/**
 * Default reminder time offset: 1 hour before meeting.
 * Used to schedule reminder push notifications.
 */
export const DEFAULT_REMINDER_OFFSET_MS = 60 * 60 * 1000; // 1 hour

/**
 * Default meeting duration for calculating attendance confirmation time.
 * Assumed when no explicit end time is provided.
 */
export const DEFAULT_MEETING_DURATION_MS = 60 * 60 * 1000; // 1 hour

/**
 * Default attendance confirmation offset: 30 minutes after meeting end.
 * Used to schedule "Did you attend?" push notifications.
 */
export const DEFAULT_ATTENDANCE_CONFIRMATION_OFFSET_MS = 30 * 60 * 1000; // 30 minutes

// ============================================================================
// RSVP Configuration
// ============================================================================

/**
 * Default RSVP option type definition
 */
export interface RsvpOption {
  id: number;
  label: string;
  enabled: boolean;
}

/**
 * Default RSVP options for events when rsvpEnabled is true.
 * These are the standard response options shown to users.
 */
export const DEFAULT_RSVP_OPTIONS: RsvpOption[] = [
  { id: 1, label: "Going", enabled: true },
  { id: 2, label: "Maybe", enabled: true },
  { id: 3, label: "Can't Go", enabled: true },
];
