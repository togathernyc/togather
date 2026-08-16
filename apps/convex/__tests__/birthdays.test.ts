/**
 * Tests for the shared "is it their birthday today" helper.
 *
 * Run with: cd apps/convex && pnpm test __tests__/birthdays.test.ts
 */

import { expect, test, describe } from "vitest";
import { isBirthdayToday, todayMonthDay } from "../lib/birthdays";

/** 14 March 1994, stored the way `updateProfile` stores it (date-only, UTC). */
const MAR_14_1994 = Date.UTC(1994, 2, 14);

/** 14 March 2026, 15:00 UTC — same calendar day in New York and in London. */
const MAR_14_AFTERNOON = Date.UTC(2026, 2, 14, 15, 0);

describe("todayMonthDay", () => {
  test("falls back to the community default zone, not UTC", () => {
    // 14 March 02:00 UTC is still 13 March in Eastern. A community with no
    // timezone set must land on the same day its birthday bot does, and the bot
    // defaults `community.timezone` to America/New_York.
    const justAfterUtcMidnight = Date.UTC(2026, 2, 14, 2, 0);

    expect(todayMonthDay(undefined, justAfterUtcMidnight)).toEqual({
      month: 3,
      day: 13,
    });
    expect(todayMonthDay("UTC", justAfterUtcMidnight)).toEqual({
      month: 3,
      day: 14,
    });
  });

  test("reads the date in the given timezone", () => {
    // 14 March 01:00 UTC is still 13 March in New York.
    const justAfterUtcMidnight = Date.UTC(2026, 2, 14, 1, 0);
    expect(todayMonthDay("America/New_York", justAfterUtcMidnight)).toEqual({
      month: 3,
      day: 13,
    });
    expect(todayMonthDay("UTC", justAfterUtcMidnight)).toEqual({
      month: 3,
      day: 14,
    });
  });

  test("falls back for an unrecognised timezone instead of throwing", () => {
    // A bad `communities.timezone` value must never break an inbox query.
    const justAfterUtcMidnight = Date.UTC(2026, 2, 14, 2, 0);
    expect(todayMonthDay("Not/AZone", justAfterUtcMidnight)).toEqual({
      month: 3,
      day: 13,
    });
  });
});

describe("isBirthdayToday", () => {
  test("matches the private dateOfBirth", () => {
    expect(
      isBirthdayToday({ dateOfBirth: MAR_14_1994 }, "UTC", MAR_14_AFTERNOON),
    ).toBe(true);
  });

  test("matches the public month/day pair", () => {
    expect(
      isBirthdayToday(
        { birthdayMonth: 3, birthdayDay: 14 },
        "UTC",
        MAR_14_AFTERNOON,
      ),
    ).toBe(true);
  });

  test("matches when only one of the two sources lines up", () => {
    // Someone whose profile M/D says something different from their sign-up
    // date still counts on both days — either is a real claim about them.
    expect(
      isBirthdayToday(
        { dateOfBirth: Date.UTC(1994, 6, 2), birthdayMonth: 3, birthdayDay: 14 },
        "UTC",
        MAR_14_AFTERNOON,
      ),
    ).toBe(true);
  });

  test("is false on any other day", () => {
    expect(
      isBirthdayToday(
        { dateOfBirth: MAR_14_1994, birthdayMonth: 3, birthdayDay: 14 },
        "UTC",
        Date.UTC(2026, 2, 15, 15, 0),
      ),
    ).toBe(false);
  });

  test("is false for a user with no birthday at all", () => {
    expect(isBirthdayToday({}, "UTC", MAR_14_AFTERNOON)).toBe(false);
  });

  test("ignores a half-set profile pair", () => {
    expect(
      isBirthdayToday({ birthdayMonth: 3 }, "UTC", MAR_14_AFTERNOON),
    ).toBe(false);
    expect(isBirthdayToday({ birthdayDay: 14 }, "UTC", MAR_14_AFTERNOON)).toBe(
      false,
    );
  });

  test("ignores the birth year — only the month and day matter", () => {
    expect(
      isBirthdayToday(
        { dateOfBirth: Date.UTC(1950, 2, 14) },
        "UTC",
        MAR_14_AFTERNOON,
      ),
    ).toBe(true);
  });

  test("uses the community timezone to decide which day it is", () => {
    // 14 March 01:00 UTC — already the 14th in London, still the 13th in NY.
    const justAfterUtcMidnight = Date.UTC(2026, 2, 14, 1, 0);
    const user = { dateOfBirth: MAR_14_1994 };

    expect(isBirthdayToday(user, "UTC", justAfterUtcMidnight)).toBe(true);
    expect(isBirthdayToday(user, "America/New_York", justAfterUtcMidnight)).toBe(
      false,
    );
  });

  test("does not shift the date for a birth timestamp near midnight", () => {
    // Stored date-only timestamps sit at 00:00 UTC; reading them locally on a
    // negative-offset server would roll them back a day.
    expect(
      isBirthdayToday(
        { dateOfBirth: Date.UTC(1994, 2, 14, 0, 0) },
        "UTC",
        MAR_14_AFTERNOON,
      ),
    ).toBe(true);
  });
});
