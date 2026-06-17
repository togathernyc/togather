/**
 * Tests for computePersonActiveState (communityScoreComputation.ts).
 *
 * The daily score job uses this to auto-archive inactive people and reactivate
 * returning ones. Rules:
 *   - Active people are archived after 60 days of no activity. Activity is the
 *     last app open (lastActiveAt); people who never opened the app fall back to
 *     their addedAt date.
 *   - An archive (manual or auto) sticks. The job never resurrects it on its own.
 *   - The one thing that reactivates an archived person is opening the app AFTER
 *     they were archived (lastActiveAt > archivedAt).
 */

import { describe, expect, test } from "vitest";
import {
  computePersonActiveState,
  INACTIVITY_THRESHOLD_MS,
} from "../functions/communityScoreComputation";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => NOW - n * DAY;

describe("computePersonActiveState", () => {
  test("keeps a recently-active person active", () => {
    const r = computePersonActiveState({
      nowTs: NOW,
      lastActiveAt: daysAgo(5),
      addedAt: daysAgo(400),
      currentIsActive: true,
    });
    expect(r.isActive).toBe(true);
    expect(r.archivedAt).toBeUndefined();
  });

  test("auto-archives an active person who has gone quiet for >60 days", () => {
    const r = computePersonActiveState({
      nowTs: NOW,
      lastActiveAt: daysAgo(75),
      addedAt: daysAgo(400),
      currentIsActive: true,
    });
    expect(r.isActive).toBe(false);
    expect(r.archivedAt).toBe(NOW);
  });

  test("uses addedAt for someone who never opened the app", () => {
    const recent = computePersonActiveState({
      nowTs: NOW,
      lastActiveAt: undefined,
      addedAt: daysAgo(10),
      currentIsActive: undefined,
    });
    expect(recent.isActive).toBe(true);

    const old = computePersonActiveState({
      nowTs: NOW,
      lastActiveAt: undefined,
      addedAt: daysAgo(90),
      currentIsActive: undefined,
    });
    expect(old.isActive).toBe(false);
    expect(old.archivedAt).toBe(NOW);
  });

  test("a manual archive sticks even if the person was recently active", () => {
    // Archived 2 days ago; their last app open (5 days ago) predates the archive.
    const r = computePersonActiveState({
      nowTs: NOW,
      lastActiveAt: daysAgo(5),
      addedAt: daysAgo(400),
      currentIsActive: false,
      currentArchivedAt: daysAgo(2),
    });
    expect(r.isActive).toBe(false);
    expect(r.archivedAt).toBe(daysAgo(2));
  });

  test("reactivates an archived person who opens the app after archiving", () => {
    const r = computePersonActiveState({
      nowTs: NOW,
      lastActiveAt: daysAgo(1), // opened the app yesterday
      addedAt: daysAgo(400),
      currentIsActive: false,
      currentArchivedAt: daysAgo(10), // archived 10 days ago
    });
    expect(r.isActive).toBe(true);
    expect(r.archivedAt).toBeUndefined();
  });

  test("a never-opened archived person stays archived", () => {
    const r = computePersonActiveState({
      nowTs: NOW,
      lastActiveAt: undefined,
      addedAt: daysAgo(400),
      currentIsActive: false,
      currentArchivedAt: daysAgo(30),
    });
    expect(r.isActive).toBe(false);
  });

  test("legacy archived record (no archivedAt) reactivates on recent app activity", () => {
    const r = computePersonActiveState({
      nowTs: NOW,
      lastActiveAt: daysAgo(3),
      addedAt: daysAgo(400),
      currentIsActive: false,
      currentArchivedAt: undefined,
    });
    expect(r.isActive).toBe(true);
  });

  test("threshold boundary is inclusive of exactly 60 days", () => {
    const r = computePersonActiveState({
      nowTs: NOW,
      lastActiveAt: NOW - INACTIVITY_THRESHOLD_MS, // exactly 60 days
      currentIsActive: true,
    });
    expect(r.isActive).toBe(true);
  });
});
