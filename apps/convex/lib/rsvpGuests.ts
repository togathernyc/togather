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
 *
 * Matches on the label since the RSVP options schema doesn't include an
 * explicit flag. Must reject common decline variants before falling back
 * to a "going" substring check — otherwise labels like "Not Going" and
 * "Can't Go" would match as affirmative. Keep this in sync with
 * isGoingOptionLabel in EventRsvpSection.tsx.
 */
export function isGoingOption(option: RsvpOptionLike | null | undefined): boolean {
  if (!option) return false;
  const label = option.label.toLowerCase().trim();
  // Explicit decline variants: reject first
  if (
    label.includes("can't") ||
    label.includes("cannot") ||
    label.includes("not going") ||
    label.includes("not attending") ||
    label === "no"
  ) {
    return false;
  }
  return label.includes("going");
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
