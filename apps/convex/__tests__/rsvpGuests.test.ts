/**
 * Unit tests for shared RSVP plus-one helpers.
 *
 * Covers the label-based heuristic that decides which RSVP option
 * counts as "Going" — regressions here silently mis-categorize RSVPs
 * and inflate or deflate headcounts.
 */

import { describe, expect, test } from "vitest";
import {
  MAX_GUESTS_PER_RSVP,
  getMaxGuestsForMeeting,
  isGoingOption,
  normalizeGuestCount,
} from "../lib/rsvpGuests";

describe("isGoingOption", () => {
  test("accepts canonical affirmative labels", () => {
    expect(isGoingOption({ id: 1, label: "Going" })).toBe(true);
    expect(isGoingOption({ id: 1, label: "going" })).toBe(true);
    expect(isGoingOption({ id: 1, label: "Going 👍" })).toBe(true);
    expect(isGoingOption({ id: 1, label: "  Going  " })).toBe(true);
    expect(isGoingOption({ id: 1, label: "I'm going" })).toBe(true);
  });

  test("rejects decline variants that also contain 'going'", () => {
    expect(isGoingOption({ id: 1, label: "Not Going" })).toBe(false);
    expect(isGoingOption({ id: 1, label: "not going" })).toBe(false);
    expect(isGoingOption({ id: 1, label: "Can't Go" })).toBe(false);
    expect(isGoingOption({ id: 1, label: "Cannot Go" })).toBe(false);
    expect(isGoingOption({ id: 1, label: "Not Attending" })).toBe(false);
  });

  test("rejects unrelated or empty labels", () => {
    expect(isGoingOption(null)).toBe(false);
    expect(isGoingOption(undefined)).toBe(false);
    expect(isGoingOption({ id: 1, label: "Maybe" })).toBe(false);
    expect(isGoingOption({ id: 1, label: "Yes" })).toBe(false);
    expect(isGoingOption({ id: 1, label: "No" })).toBe(false);
    expect(isGoingOption({ id: 1, label: "Attending" })).toBe(false);
  });
});

describe("getMaxGuestsForMeeting", () => {
  test("falls back to the global default when unset", () => {
    expect(getMaxGuestsForMeeting({})).toBe(MAX_GUESTS_PER_RSVP);
  });

  test("uses the per-meeting override when provided", () => {
    expect(getMaxGuestsForMeeting({ maxGuestsPerRsvp: 5 })).toBe(5);
  });
});

describe("normalizeGuestCount", () => {
  const going = { id: 1, label: "Going" };
  const notGoing = { id: 2, label: "Not Going" };
  const maybe = { id: 3, label: "Maybe" };

  test("returns 0 for missing or zero counts", () => {
    expect(normalizeGuestCount(undefined, going, 3)).toBe(0);
    expect(normalizeGuestCount(0, going, 3)).toBe(0);
  });

  test("allows in-range counts on Going", () => {
    expect(normalizeGuestCount(1, going, 3)).toBe(1);
    expect(normalizeGuestCount(3, going, 3)).toBe(3);
  });

  test("rejects non-integer or negative counts", () => {
    expect(() => normalizeGuestCount(-1, going, 3)).toThrow(
      "Guest count must be a non-negative integer"
    );
    expect(() => normalizeGuestCount(1.5, going, 3)).toThrow(
      "Guest count must be a non-negative integer"
    );
  });

  test("rejects counts over the meeting cap", () => {
    expect(() => normalizeGuestCount(4, going, 3)).toThrow(
      "You can bring at most 3 guests"
    );
  });

  test("rejects non-zero counts on non-Going options", () => {
    expect(() => normalizeGuestCount(1, notGoing, 3)).toThrow(
      "Guests can only be added when RSVPing as 'Going'"
    );
    expect(() => normalizeGuestCount(1, maybe, 3)).toThrow(
      "Guests can only be added when RSVPing as 'Going'"
    );
  });

  test("silently zeroes a 0 count on non-Going options", () => {
    expect(normalizeGuestCount(0, notGoing, 3)).toBe(0);
    expect(normalizeGuestCount(undefined, maybe, 3)).toBe(0);
  });
});
