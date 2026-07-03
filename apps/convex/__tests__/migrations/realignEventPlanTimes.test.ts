/**
 * Tests for the realignEventPlanTimes backfill.
 *
 * The migration re-lands each eventPlans.times[].startsAt onto the plan's
 * eventDate calendar day (preserving the label + time-of-day) by rounding the
 * eventDate↔startsAt gap to whole days. Aligned plans are left untouched and
 * the migration is idempotent.
 */

import { describe, it, expect, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { internal } from "../../_generated/api";
import { buildSchedulingWorld } from "../scheduling/fixtures";

let activeHandle: ReturnType<typeof convexTest> | null = null;

afterEach(async () => {
  if (activeHandle) {
    await activeHandle.finishInProgressScheduledFunctions();
    activeHandle = null;
  }
});

const DAY = 86_400_000;
const HOUR = 3_600_000;

describe("realignEventPlanTimes", () => {
  it("shifts drifted times onto eventDate's day, leaves aligned plans alone", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const world = await buildSchedulingWorld(t);

    // eventDate anchor at 9:00 AM local (like real data: default 9 AM).
    const eventDate = Date.UTC(2026, 6, 19, 13, 0, 0); // Jul 19, 13:00 UTC
    const base = {
      groupId: world.groupId,
      communityId: world.communityId,
      status: "published",
      createdAt: 0,
      createdById: world.groupLeaderId,
      updatedAt: 0,
    };

    // Drifted plan: times stranded exactly 28 days before the event (the
    // observed duplicate-of-a-rescheduled-plan signature). Labels/time-of-day
    // are correct; only the date is wrong.
    const driftedId = await t.run((ctx) =>
      ctx.db.insert("eventPlans", {
        ...base,
        title: "Drifted",
        eventDate,
        times: [
          { label: "10:00 AM", startsAt: eventDate - 28 * DAY + 1 * HOUR },
          { label: "12:00 PM", startsAt: eventDate - 28 * DAY + 3 * HOUR },
        ],
      }),
    );

    // Aligned plan: already on the right day → must be untouched.
    const alignedId = await t.run((ctx) =>
      ctx.db.insert("eventPlans", {
        ...base,
        title: "Aligned",
        eventDate,
        times: [{ label: "10:00 AM", startsAt: eventDate + 1 * HOUR }],
      }),
    );

    const res = await t.mutation(
      internal.functions.migrations.realignEventPlanTimes
        .realignEventPlanTimes,
      { communityId: world.communityId },
    );
    expect(res.changedPlans).toBe(1);
    expect(res.changedTimes).toBe(2);

    const drifted = await t.run((ctx) => ctx.db.get(driftedId));
    // Now on the event's day, same time-of-day, labels preserved.
    expect(drifted!.times[0].startsAt).toBe(eventDate + 1 * HOUR);
    expect(drifted!.times[0].label).toBe("10:00 AM");
    expect(drifted!.times[1].startsAt).toBe(eventDate + 3 * HOUR);
    expect(drifted!.times[1].label).toBe("12:00 PM");

    const aligned = await t.run((ctx) => ctx.db.get(alignedId));
    expect(aligned!.times[0].startsAt).toBe(eventDate + 1 * HOUR);

    // Idempotent — a second pass finds nothing to change.
    const again = await t.mutation(
      internal.functions.migrations.realignEventPlanTimes
        .realignEventPlanTimes,
      { communityId: world.communityId },
    );
    expect(again.changedPlans).toBe(0);
    expect(again.changedTimes).toBe(0);
  });

  it("leaves a legitimate same-day late-evening service untouched", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const world = await buildSchedulingWorld(t);

    // eventDate anchored at 9 AM EDT (13:00 UTC). A 10 PM EDT service is 02:00
    // UTC the NEXT UTC day — its raw day-rounded gap is -1, but it's genuinely
    // on the event's local day, so the >=2-day guard must leave it alone.
    const eventDate = Date.UTC(2026, 6, 19, 13, 0, 0);
    const lateService = Date.UTC(2026, 6, 20, 2, 0, 0); // Jul 19, 10 PM EDT
    const planId = await t.run((ctx) =>
      ctx.db.insert("eventPlans", {
        groupId: world.groupId,
        communityId: world.communityId,
        title: "Evening",
        eventDate,
        times: [{ label: "10:00 PM", startsAt: lateService }],
        status: "published",
        createdAt: 0,
        createdById: world.groupLeaderId,
        updatedAt: 0,
      }),
    );

    const res = await t.mutation(
      internal.functions.migrations.realignEventPlanTimes
        .realignEventPlanTimes,
      { communityId: world.communityId },
    );
    expect(res.changedPlans).toBe(0);

    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan!.times[0].startsAt).toBe(lateService);
  });

  it("dryRun reports changes without writing", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const world = await buildSchedulingWorld(t);

    const eventDate = Date.UTC(2026, 6, 12, 13, 0, 0);
    const planId = await t.run((ctx) =>
      ctx.db.insert("eventPlans", {
        groupId: world.groupId,
        communityId: world.communityId,
        title: "Drifted",
        eventDate,
        times: [{ label: "10:00 AM", startsAt: eventDate - 21 * DAY + HOUR }],
        status: "draft",
        createdAt: 0,
        createdById: world.groupLeaderId,
        updatedAt: 0,
      }),
    );

    const res = await t.mutation(
      internal.functions.migrations.realignEventPlanTimes
        .realignEventPlanTimes,
      { communityId: world.communityId, dryRun: true },
    );
    expect(res.dryRun).toBe(true);
    expect(res.changedPlans).toBe(1);

    // Nothing actually written.
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan!.times[0].startsAt).toBe(eventDate - 21 * DAY + HOUR);
  });
});
