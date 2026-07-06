/**
 * Unit tests for shared RSVP plus-one helpers.
 *
 * Covers the id-slot rule that decides which RSVP option counts as
 * "Going" — regressions here silently mis-categorize RSVPs and inflate
 * or deflate headcounts.
 */

import { describe, expect, test } from "vitest";
import {
  MAX_GUESTS_PER_RSVP,
  getMaxGuestsForMeeting,
  isGoingOption,
  normalizeGuestCount,
} from "../lib/rsvpGuests";

describe("isGoingOption", () => {
  test("accepts the Going slot (id 1) regardless of label", () => {
    expect(isGoingOption({ id: 1, label: "Going" })).toBe(true);
    expect(isGoingOption({ id: 1, label: "Going 👍" })).toBe(true);
    // Custom labels must still work — hosts rename options freely.
    expect(isGoingOption({ id: 1, label: "I'm there 😳" })).toBe(true);
    expect(isGoingOption({ id: 1, label: "Count me in" })).toBe(true);
  });

  test("rejects other slots regardless of label", () => {
    expect(isGoingOption({ id: 2, label: "Maybe" })).toBe(false);
    expect(isGoingOption({ id: 3, label: "Can't Go" })).toBe(false);
    // Even a label containing "going" is not the Going slot.
    expect(isGoingOption({ id: 3, label: "Not Going" })).toBe(false);
    expect(isGoingOption({ id: 2, label: "Going later" })).toBe(false);
  });

  test("rejects missing options", () => {
    expect(isGoingOption(null)).toBe(false);
    expect(isGoingOption(undefined)).toBe(false);
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
  // Custom label on the Going slot — guest counts must still be allowed.
  const going = { id: 1, label: "I'm there 😳" };
  const maybe = { id: 2, label: "Still deciding 🫣" };
  const notGoing = { id: 3, label: "No can do ☹️" };

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

  test("rejects NaN instead of silently coercing to 0", () => {
    expect(() => normalizeGuestCount(Number.NaN, going, 3)).toThrow(
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
