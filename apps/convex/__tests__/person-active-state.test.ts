/**
 * Tests for computePersonActiveState (communityScoreComputation.ts).
 *
 * The daily score job uses this to auto-archive inactive people and reactivate
 * returning ones. Rules:
 *   - Active people are archived after 60 days of no activity. Activity
 *     (lastActivityTs) is the most recent of: opening the app, attending a
 *     meeting, or serving (PCO + native rostering). People with no recorded
 *     activity fall back to their addedAt date.
 *   - An archive (manual or auto) sticks. The job never resurrects it on its own.
 *   - The one thing that reactivates an archived person is fresh activity AFTER
 *     they were archived (lastActivityTs > archivedAt).
 */

import { describe, expect, test } from "vitest";
import {
  computePersonActiveState,
  mostRecentTimestamp,
  INACTIVITY_THRESHOLD_MS,
} from "../functions/communityScoreComputation";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => NOW - n * DAY;

describe("computePersonActiveState", () => {
  test("keeps a recently-active person active", () => {
    const r = computePersonActiveState({
      nowTs: NOW,
      lastActivityTs: daysAgo(5),
      addedAt: daysAgo(400),
      currentIsActive: true,
    });
    expect(r.isActive).toBe(true);
    expect(r.archivedAt).toBeUndefined();
  });

  test("auto-archives an active person who has gone quiet for >60 days", () => {
    const r = computePersonActiveState({
      nowTs: NOW,
      lastActivityTs: daysAgo(75),
      addedAt: daysAgo(400),
      currentIsActive: true,
    });
    expect(r.isActive).toBe(false);
    expect(r.archivedAt).toBe(NOW);
  });

  test("uses addedAt for someone who never opened the app", () => {
    const recent = computePersonActiveState({
      nowTs: NOW,
      lastActivityTs: undefined,
      addedAt: daysAgo(10),
      currentIsActive: undefined,
    });
    expect(recent.isActive).toBe(true);

    const old = computePersonActiveState({
      nowTs: NOW,
      lastActivityTs: undefined,
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
      lastActivityTs: daysAgo(5),
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
      lastActivityTs: daysAgo(1), // opened the app yesterday
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
      lastActivityTs: undefined,
      addedAt: daysAgo(400),
      currentIsActive: false,
      currentArchivedAt: daysAgo(30),
    });
    expect(r.isActive).toBe(false);
  });

  test("legacy archived record (no archivedAt) reactivates on recent app activity", () => {
    const r = computePersonActiveState({
      nowTs: NOW,
      lastActivityTs: daysAgo(3),
      addedAt: daysAgo(400),
      currentIsActive: false,
      currentArchivedAt: undefined,
    });
    expect(r.isActive).toBe(true);
  });

  test("threshold boundary is inclusive of exactly 60 days", () => {
    const r = computePersonActiveState({
      nowTs: NOW,
      lastActivityTs: NOW - INACTIVITY_THRESHOLD_MS, // exactly 60 days
      currentIsActive: true,
    });
    expect(r.isActive).toBe(true);
  });

  test("recent attendance/serving keeps a never-opened person active", () => {
    // No app open, added long ago, but attended recently → stays active.
    const lastActivityTs = mostRecentTimestamp(
      undefined, // never opened the app
      daysAgo(3), // attended a meeting 3 days ago
      daysAgo(120), // last served 120 days ago
    );
    const r = computePersonActiveState({
      nowTs: NOW,
      lastActivityTs,
      addedAt: daysAgo(400),
      currentIsActive: true,
    });
    expect(r.isActive).toBe(true);
  });

  // A manual unarchive (or a form submission) records `reactivatedAt`, which
  // counts as activity so the 60-day clock restarts from that moment.
  test("a manual unarchive keeps a long-inactive person active", () => {
    // Last real activity was 200 days ago, but they were unarchived yesterday.
    const r = computePersonActiveState({
      nowTs: NOW,
      lastActivityTs: daysAgo(200),
      reactivatedAt: daysAgo(1),
      addedAt: daysAgo(400),
      currentIsActive: true,
    });
    expect(r.isActive).toBe(true);
    expect(r.archivedAt).toBeUndefined();
  });

  test("a manually-unarchived person is re-archived once the unarchive itself goes stale", () => {
    // Both the last activity and the unarchive are now older than 60 days.
    const r = computePersonActiveState({
      nowTs: NOW,
      lastActivityTs: daysAgo(200),
      reactivatedAt: daysAgo(75),
      addedAt: daysAgo(400),
      currentIsActive: true,
    });
    expect(r.isActive).toBe(false);
    expect(r.archivedAt).toBe(NOW);
  });

  test("a form submission (reactivatedAt) reactivates a previously archived person", () => {
    // Archived 30 days ago, no app activity since, but just submitted a form.
    const r = computePersonActiveState({
      nowTs: NOW,
      lastActivityTs: daysAgo(120),
      reactivatedAt: NOW, // submission timestamp
      addedAt: daysAgo(400),
      currentIsActive: false,
      currentArchivedAt: daysAgo(30),
    });
    expect(r.isActive).toBe(true);
    expect(r.archivedAt).toBeUndefined();
  });

  test("a stale reactivatedAt does not resurrect an archive that came after it", () => {
    // Unarchived long ago, then re-archived more recently → stays archived.
    const r = computePersonActiveState({
      nowTs: NOW,
      lastActivityTs: daysAgo(200),
      reactivatedAt: daysAgo(90),
      addedAt: daysAgo(400),
      currentIsActive: false,
      currentArchivedAt: daysAgo(20),
    });
    expect(r.isActive).toBe(false);
    expect(r.archivedAt).toBe(daysAgo(20));
  });
});

describe("mostRecentTimestamp", () => {
  test("returns the largest timestamp, ignoring undefined", () => {
    expect(mostRecentTimestamp(undefined, 100, undefined, 250, 90)).toBe(250);
  });

  test("returns undefined when all inputs are undefined", () => {
    expect(mostRecentTimestamp(undefined, undefined)).toBeUndefined();
  });
});
