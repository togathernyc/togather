/**
 * Shared helpers for RSVP plus-ones (guest count) logic.
 *
 * Plus-ones are only allowed on the "Going" RSVP option and are
 * capped globally by MAX_GUESTS_PER_RSVP, overridable per-meeting
 * via meetings.maxGuestsPerRsvp (future admin setting).
 */

import { GOING_RSVP_OPTION_ID } from "./meetingConfig";

export const MAX_GUESTS_PER_RSVP = 3;

interface RsvpOptionLike {
  id: number;
  label: string;
  enabled?: boolean;
}

/**
 * Is this RSVP option the "Going" option?
 *
 * Matched by id, not label: option ids are stable semantic slots
 * (1 = Going, 2 = Maybe, 3 = Can't Go — see DEFAULT_RSVP_OPTIONS and
 * NOTIFIED_RSVP_OPTION_IDS in meetingConfig.ts). Hosts can freely rename
 * labels ("I'm there 😳"), so any label heuristic breaks on custom labels.
 * Keep in sync with isGoingRsvpOption in EventRsvpSection.tsx.
 */
export function isGoingOption(option: RsvpOptionLike | null | undefined): boolean {
  return option?.id === GOING_RSVP_OPTION_ID;
}

export function getMaxGuestsForMeeting(meeting: {
  maxGuestsPerRsvp?: number | null;
}): number {
  return meeting.maxGuestsPerRsvp ?? MAX_GUESTS_PER_RSVP;
}

/**
 * Clamp + validate a user-submitted guest count.
 * - Must be a non-negative integer.
 * - Must be 0 when the selected option is not "Going".
 * - Must not exceed the meeting's cap.
 */
export function normalizeGuestCount(
  rawGuestCount: number | undefined,
  selectedOption: RsvpOptionLike,
  maxGuests: number,
): number {
  // Reject NaN explicitly — Convex's v.number() accepts any IEEE-754 number,
  // so a malformed client could send NaN and silently coerce to 0 via the
  // falsy check below. Treat it as invalid input instead.
  if (typeof rawGuestCount === "number" && Number.isNaN(rawGuestCount)) {
    throw new Error("Guest count must be a non-negative integer");
  }
  if (!rawGuestCount) return 0;
  if (!Number.isInteger(rawGuestCount) || rawGuestCount < 0) {
    throw new Error("Guest count must be a non-negative integer");
  }
  if (!isGoingOption(selectedOption)) {
    if (rawGuestCount > 0) {
      throw new Error("Guests can only be added when RSVPing as 'Going'");
    }
    return 0;
  }
  if (rawGuestCount > maxGuests) {
    throw new Error(`You can bring at most ${maxGuests} guest${maxGuests === 1 ? "" : "s"}`);
  }
  return rawGuestCount;
}
