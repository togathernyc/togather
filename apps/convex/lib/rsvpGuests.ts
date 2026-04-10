/**
 * Shared helpers for RSVP plus-ones (guest count) logic.
 *
 * Plus-ones are only allowed on the "Going" RSVP option and are
 * capped globally by MAX_GUESTS_PER_RSVP, overridable per-meeting
 * via meetings.maxGuestsPerRsvp (future admin setting).
 */

export const MAX_GUESTS_PER_RSVP = 3;

interface RsvpOptionLike {
  id: number;
  label: string;
  enabled?: boolean;
}

/**
 * Heuristic: is this RSVP option the "Going" option?
 * Matches on the label since the RSVP options schema doesn't
 * include an explicit flag. Mirrors GuestListPreview's detection.
 */
export function isGoingOption(option: RsvpOptionLike | null | undefined): boolean {
  if (!option) return false;
  const label = option.label.toLowerCase();
  return label.includes("going") && !label.includes("can't");
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
