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
 * Default reminder time offset: 2 hours before meeting.
 * Used to schedule reminder push notifications.
 */
export const DEFAULT_REMINDER_OFFSET_MS = 2 * 60 * 60 * 1000; // 2 hours

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

/**
 * Grace window after an event's start time during which it should still be
 * treated as "active" — visible in the events list, openable from the detail
 * page, and accepting RSVPs. Without this, late arrivals immediately stop
 * seeing events they could still attend.
 */
export const PAST_EVENT_BUFFER_MS = 3 * 60 * 60 * 1000; // 3 hours

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

/**
 * RSVP option IDs whose responders are considered "attending enough" to:
 *   - be seated in the event chat channel (and thus get update notifications)
 *   - receive host text blasts
 *
 * 1 = "Going", 2 = "Maybe" (see DEFAULT_RSVP_OPTIONS). "Can't Go" (3) is
 * excluded. These are matched by id, so events using custom option labels are
 * still keyed off the conventional Going/Maybe slots.
 */
export const NOTIFIED_RSVP_OPTION_IDS: number[] = [1, 2];

/** Whether an RSVP option id grants chat membership + blast/update delivery. */
export function isNotifiedRsvpOptionId(optionId: number): boolean {
  return NOTIFIED_RSVP_OPTION_IDS.includes(optionId);
}
