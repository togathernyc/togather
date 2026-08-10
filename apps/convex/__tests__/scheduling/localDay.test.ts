/**
 * `lib/localDay.ts` — the local-calendar-day primitives behind the
 * duplicate-plan-date guard and the roster grid's same-date flag.
 *
 * These are pure, so they get a pure test. The two properties that matter are
 * both defensive: a corrupt `eventDate` must not throw (it is mapped over every
 * plan of a group, so one bad row would brick creation AND the grid), and the
 * formatters must be reused rather than rebuilt per call (they are constructed
 * once per plan per mutation otherwise).
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_TIMEZONE,
  INVALID_DAY_KEY,
  isValidDayKey,
  localDayKey,
  localDayLabel,
  resolveTimeZone,
} from "../../lib/localDay";

const ET = "America/New_York";

describe("resolveTimeZone", () => {
  it("keeps a real zone and falls back for anything else", () => {
    expect(resolveTimeZone(ET)).toBe(ET);
    expect(resolveTimeZone(undefined)).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimeZone("Mars/Olympus_Mons")).toBe(DEFAULT_TIMEZONE);
  });
});

describe("localDayKey", () => {
  it("keys the community-local day, not the UTC one", () => {
    // 03:00Z Sun 2 Aug is Sat 1 Aug in ET.
    expect(localDayKey(Date.UTC(2026, 7, 2, 3, 0), ET)).toBe("2026-08-01");
    // 01:00Z Mon 3 Aug is still Sun 2 Aug in ET.
    expect(localDayKey(Date.UTC(2026, 7, 3, 1, 0), ET)).toBe("2026-08-02");
  });

  it("returns the never-matching sentinel for a date that is not an instant", () => {
    // `eventDate` is a Convex `v.number()` — a float64 — so all of these pass
    // validation and reach the formatter, which throws RangeError on each.
    for (const bad of [NaN, Infinity, -Infinity, 8.64e15 + 1, -8.64e15 - 1]) {
      expect(localDayKey(bad, ET)).toBe(INVALID_DAY_KEY);
      expect(isValidDayKey(localDayKey(bad, ET))).toBe(false);
    }
    expect(isValidDayKey(localDayKey(Date.UTC(2026, 7, 2, 13, 0), ET))).toBe(
      true,
    );
  });

  it("never returns a real day key for a corrupt value", () => {
    // The sentinel must be impossible to produce from a valid instant, so a
    // corrupt row can never be reported as sharing a day with a real one.
    expect(INVALID_DAY_KEY).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("reuses one formatter per zone instead of building one per call", () => {
    // ~100x: constructing an Intl.DateTimeFormat dominates formatting with it,
    // and the guard formats every sibling plan on every create/update.
    const spy = Intl.DateTimeFormat;
    let constructed = 0;
    // @ts-expect-error — deliberately swapping the global for the assertion.
    Intl.DateTimeFormat = function (...args: unknown[]) {
      constructed++;
      // @ts-expect-error — forwarding to the real implementation.
      return new spy(...args);
    };
    try {
      // A zone the memo has certainly not seen yet.
      const zone = "Australia/Adelaide";
      for (let i = 0; i < 50; i++) {
        localDayKey(Date.UTC(2026, 7, 2, 13, 0) + i * 3600000, zone);
      }
      expect(constructed).toBe(1);
    } finally {
      Intl.DateTimeFormat = spy;
    }
  });
});

describe("localDayLabel", () => {
  it("renders the community-local day for a collision message", () => {
    expect(localDayLabel(Date.UTC(2026, 7, 2, 13, 0), ET)).toBe("Sun, Aug 2");
  });

  it("degrades to prose rather than throwing on a corrupt date", () => {
    expect(localDayLabel(NaN, ET)).toBe("an unknown date");
    expect(localDayLabel(Infinity, ET)).toBe("an unknown date");
  });
});
