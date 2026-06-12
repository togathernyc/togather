/**
 * Tests for the automatic "you're still unconfirmed" reminders that fire
 * 4 days and 1 day before a published event (rostering nudges).
 *
 * On publish, `markPublished` schedules `sendUnconfirmedReminders` at
 * `eventDate - 4d` and `eventDate - 1d` (only the ones still in the future)
 * and stores the job IDs on the plan. At fire time the action re-queries the
 * roster, so a volunteer who has confirmed/declined/been unassigned in the
 * meantime gets nothing. Re-scheduling (event-date change) and delete cancel
 * the jobs.
 *
 * The `sendSMS` Twilio path is best-effort (wrapped in try/catch), and there
 * are no `pushTokens` in the fixture world, so we assert the DB side effects
 * — inbox `notifications` rows, the `reminder*Sent` flags, and the stored
 * job IDs — rather than mocking Expo/Twilio.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { generateTokens } from "../../lib/auth";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { buildSchedulingWorld, type SchedulingWorld } from "./fixtures";

let activeHandle: ReturnType<typeof convexTest> | null = null;

afterEach(async () => {
  if (activeHandle) {
    await activeHandle.finishInProgressScheduledFunctions();
    activeHandle = null;
  }
  vi.useRealTimers();
});

async function setupSchedulingWorld() {
  const t = convexTest(schema, modules);
  activeHandle = t;
  const world = await buildSchedulingWorld(t);
  return { t, world };
}

const DAY = 86400000;

/** Create a draft event `dayOffset` days from now and return its planId. */
async function makeEvent(
  t: ReturnType<typeof convexTest>,
  world: SchedulingWorld,
  leaderToken: string,
  dayOffset: number,
  title = "Sunday Service",
): Promise<Id<"eventPlans">> {
  const eventDate = Date.now() + dayOffset * DAY;
  const { planId } = await t.mutation(
    api.functions.scheduling.events.createEvent,
    {
      token: leaderToken,
      groupId: world.groupId,
      title,
      eventDate,
      times: [{ label: "9 AM", startsAt: eventDate }],
    },
  );
  return planId;
}

/** Assign a user to the team's role and return the assignment id. */
async function assign(
  t: ReturnType<typeof convexTest>,
  world: SchedulingWorld,
  leaderToken: string,
  planId: Id<"eventPlans">,
  userId: Id<"users">,
): Promise<Id<"roleAssignments">> {
  const { assignmentId } = await t.mutation(
    api.functions.scheduling.assignments.assignRole,
    { token: leaderToken, planId, teamId: world.teamId, roleId: world.roleId, userId },
  );
  return assignmentId;
}

/** Count inbox notifications of the scheduling-request type for a user. */
async function inboxCount(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
): Promise<number> {
  return t.run(async (ctx) => {
    const rows = await ctx.db
      .query("notifications")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), userId),
          q.eq(q.field("notificationType"), "scheduling_assignment_request"),
        ),
      )
      .collect();
    return rows.length;
  });
}

/** The newest scheduling-request inbox title for a user (or null). */
async function latestInboxTitle(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
): Promise<string | null> {
  return t.run(async (ctx) => {
    const rows = await ctx.db
      .query("notifications")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), userId),
          q.eq(q.field("notificationType"), "scheduling_assignment_request"),
        ),
      )
      .collect();
    if (rows.length === 0) return null;
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return rows[0].title;
  });
}

describe("scheduling reminders — schedule on publish", () => {
  it("schedules both 4d and 1d reminders at the right times with stored ids", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-06-01T12:00:00.000Z").getTime();
    vi.setSystemTime(now);

    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 10);
    await assign(t, world, leaderToken, planId, world.channelMemberId);

    await t.action(api.functions.scheduling.assignments.publishEvent, {
      token: leaderToken,
      planId,
    });

    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.status).toBe("published");
    expect(plan?.reminder4dJobId).toBeDefined();
    expect(plan?.reminder1dJobId).toBeDefined();
    expect(plan?.reminder4dSent).toBeFalsy();
    expect(plan?.reminder1dSent).toBeFalsy();

    // Stored job IDs should be scheduled at eventDate - 4d and - 1d.
    const eventDate = plan!.eventDate;
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const fourDayJob = jobs.find((j) => j._id === plan!.reminder4dJobId);
    const oneDayJob = jobs.find((j) => j._id === plan!.reminder1dJobId);
    expect(fourDayJob?.scheduledTime).toBe(eventDate - 4 * DAY);
    expect(oneDayJob?.scheduledTime).toBe(eventDate - 1 * DAY);
  });

  it("schedules only the 1-day reminder when published less than 4 days out", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z").getTime());

    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    // Event is 2 days out: the 4d fire time is in the past, the 1d is future.
    const planId = await makeEvent(t, world, leaderToken, 2);
    await assign(t, world, leaderToken, planId, world.channelMemberId);

    await t.action(api.functions.scheduling.assignments.publishEvent, {
      token: leaderToken,
      planId,
    });

    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.reminder4dJobId).toBeUndefined();
    expect(plan?.reminder1dJobId).toBeDefined();
  });

  it("schedules neither reminder when published less than 1 day out", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z").getTime());

    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    // Event is ~12 hours out.
    const eventDate = Date.now() + DAY / 2;
    const { planId } = await t.mutation(
      api.functions.scheduling.events.createEvent,
      {
        token: leaderToken,
        groupId: world.groupId,
        title: "Tonight",
        eventDate,
        times: [{ label: "9 PM", startsAt: eventDate }],
      },
    );
    await assign(t, world, leaderToken, planId, world.channelMemberId);

    await t.action(api.functions.scheduling.assignments.publishEvent, {
      token: leaderToken,
      planId,
    });

    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.reminder4dJobId).toBeUndefined();
    expect(plan?.reminder1dJobId).toBeUndefined();
  });
});

describe("scheduling reminders — fire behavior", () => {
  it("sends a reminder to an unconfirmed volunteer and marks reminder4dSent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z").getTime());

    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 10);
    await assign(t, world, leaderToken, planId, world.channelMemberId);

    await t.action(api.functions.scheduling.assignments.publishEvent, {
      token: leaderToken,
      planId,
    });
    await t.finishInProgressScheduledFunctions();

    // Inbox count from the initial publish request (baseline).
    const baseline = await inboxCount(t, world.channelMemberId);

    await t.action(
      internal.functions.scheduling.assignments.sendUnconfirmedReminders,
      { planId, kind: "4d" },
    );

    const after = await inboxCount(t, world.channelMemberId);
    expect(after).toBe(baseline + 1);

    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.reminder4dSent).toBe(true);
    expect(plan?.reminder1dSent).toBeFalsy();
  });

  it("4d skips a confirmed volunteer but 1d sends them a serving-tomorrow heads-up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z").getTime());

    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 10);
    const assignmentId = await assign(
      t,
      world,
      leaderToken,
      planId,
      world.channelMemberId,
    );

    await t.action(api.functions.scheduling.assignments.publishEvent, {
      token: leaderToken,
      planId,
    });
    await t.finishInProgressScheduledFunctions();
    const baseline = await inboxCount(t, world.channelMemberId);

    // Volunteer confirms before the reminders fire.
    await t.mutation(api.functions.scheduling.assignments.respondToAssignment, {
      token: memberToken,
      assignmentId,
      status: "confirmed",
    });
    await t.finishInProgressScheduledFunctions();

    // 4-day reminder is unconfirmed-only — a confirmed volunteer gets nothing.
    await t.action(
      internal.functions.scheduling.assignments.sendUnconfirmedReminders,
      { planId, kind: "4d" },
    );
    expect(await inboxCount(t, world.channelMemberId)).toBe(baseline);

    // 1-day reminder still goes to them — a serving-tomorrow heads-up, not a
    // confirm/decline ask.
    await t.action(
      internal.functions.scheduling.assignments.sendUnconfirmedReminders,
      { planId, kind: "1d" },
    );
    expect(await inboxCount(t, world.channelMemberId)).toBe(baseline + 1);
    expect(await latestInboxTitle(t, world.channelMemberId)).toContain(
      "Serving tomorrow",
    );
  });

  it("does NOT remind a volunteer who has declined (neither 4d nor 1d)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z").getTime());

    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 10);
    const assignmentId = await assign(
      t,
      world,
      leaderToken,
      planId,
      world.channelMemberId,
    );

    await t.action(api.functions.scheduling.assignments.publishEvent, {
      token: leaderToken,
      planId,
    });
    await t.finishInProgressScheduledFunctions();
    const baseline = await inboxCount(t, world.channelMemberId);

    // Volunteer declines before the reminders fire.
    await t.mutation(api.functions.scheduling.assignments.respondToAssignment, {
      token: memberToken,
      assignmentId,
      status: "declined",
    });
    await t.finishInProgressScheduledFunctions();

    await t.action(
      internal.functions.scheduling.assignments.sendUnconfirmedReminders,
      { planId, kind: "4d" },
    );
    await t.action(
      internal.functions.scheduling.assignments.sendUnconfirmedReminders,
      { planId, kind: "1d" },
    );

    // No new inbox row for either pass — a declined volunteer is excluded.
    expect(await inboxCount(t, world.channelMemberId)).toBe(baseline);
  });

  it("1d reminds both a confirmed and an unconfirmed volunteer, with different copy", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z").getTime());

    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const confirmerToken = (await generateTokens(world.channelMemberId))
      .accessToken;
    const planId = await makeEvent(t, world, leaderToken, 10);
    // channelMemberId will confirm; channelAdminId stays unconfirmed.
    const confirmerAssignmentId = await assign(
      t,
      world,
      leaderToken,
      planId,
      world.channelMemberId,
    );
    await assign(t, world, leaderToken, planId, world.channelAdminId);

    await t.action(api.functions.scheduling.assignments.publishEvent, {
      token: leaderToken,
      planId,
    });
    await t.finishInProgressScheduledFunctions();

    await t.mutation(api.functions.scheduling.assignments.respondToAssignment, {
      token: confirmerToken,
      assignmentId: confirmerAssignmentId,
      status: "confirmed",
    });
    await t.finishInProgressScheduledFunctions();

    const confirmerBaseline = await inboxCount(t, world.channelMemberId);
    const unconfirmedBaseline = await inboxCount(t, world.channelAdminId);

    await t.action(
      internal.functions.scheduling.assignments.sendUnconfirmedReminders,
      { planId, kind: "1d" },
    );

    // Both get a 1-day reminder row.
    expect(await inboxCount(t, world.channelMemberId)).toBe(
      confirmerBaseline + 1,
    );
    expect(await inboxCount(t, world.channelAdminId)).toBe(
      unconfirmedBaseline + 1,
    );

    // The confirmed volunteer gets the serving-tomorrow heads-up; the
    // unconfirmed one still gets the confirm/decline nudge.
    expect(await latestInboxTitle(t, world.channelMemberId)).toContain(
      "Serving tomorrow",
    );
    expect(await latestInboxTitle(t, world.channelAdminId)).toContain(
      "you're scheduled",
    );
  });

  it("skips placeholder users (they can't confirm yet)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z").getTime());

    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 10);
    await assign(t, world, leaderToken, planId, world.placeholderUserId);

    await t.action(api.functions.scheduling.assignments.publishEvent, {
      token: leaderToken,
      planId,
    });
    await t.finishInProgressScheduledFunctions();

    await t.action(
      internal.functions.scheduling.assignments.sendUnconfirmedReminders,
      { planId, kind: "4d" },
    );

    // Placeholders get no inbox row (no app) and no reminder push.
    expect(await inboxCount(t, world.placeholderUserId)).toBe(0);
    // The reminder still marks itself sent so it doesn't re-run.
    const plan = await t.run((ctx) => ctx.db.get(planId));
    expect(plan?.reminder4dSent).toBe(true);
  });

  it("is idempotent — running the action twice does not double-send", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z").getTime());

    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 10);
    await assign(t, world, leaderToken, planId, world.channelMemberId);

    await t.action(api.functions.scheduling.assignments.publishEvent, {
      token: leaderToken,
      planId,
    });
    await t.finishInProgressScheduledFunctions();
    const baseline = await inboxCount(t, world.channelMemberId);

    await t.action(
      internal.functions.scheduling.assignments.sendUnconfirmedReminders,
      { planId, kind: "4d" },
    );
    await t.action(
      internal.functions.scheduling.assignments.sendUnconfirmedReminders,
      { planId, kind: "4d" },
    );

    expect(await inboxCount(t, world.channelMemberId)).toBe(baseline + 1);
  });
});

describe("scheduling reminders — reschedule & delete", () => {
  it("updateEvent date change cancels old jobs, resets sent flags, reschedules", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z").getTime());

    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 10);
    await assign(t, world, leaderToken, planId, world.channelMemberId);

    await t.action(api.functions.scheduling.assignments.publishEvent, {
      token: leaderToken,
      planId,
    });

    const before = await t.run((ctx) => ctx.db.get(planId));
    const oldFourId = before!.reminder4dJobId!;
    const oldOneId = before!.reminder1dJobId!;
    // Pretend the 4d reminder already fired before the reschedule.
    await t.run((ctx) => ctx.db.patch(planId, { reminder4dSent: true }));

    const newEventDate = Date.now() + 20 * DAY;
    await t.mutation(api.functions.scheduling.events.updateEvent, {
      token: leaderToken,
      planId,
      eventDate: newEventDate,
    });

    const after = await t.run((ctx) => ctx.db.get(planId));
    // New jobs scheduled at the new event date, sent flags reset.
    expect(after?.reminder4dJobId).toBeDefined();
    expect(after?.reminder1dJobId).toBeDefined();
    expect(after?.reminder4dJobId).not.toBe(oldFourId);
    expect(after?.reminder1dJobId).not.toBe(oldOneId);
    expect(after?.reminder4dSent).toBeFalsy();
    expect(after?.reminder1dSent).toBeFalsy();

    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    // Old jobs are cancelled (no longer pending).
    const oldFour = jobs.find((j) => j._id === oldFourId);
    const oldOne = jobs.find((j) => j._id === oldOneId);
    expect(oldFour?.state.kind).toBe("canceled");
    expect(oldOne?.state.kind).toBe("canceled");
    // New jobs sit at the new event date.
    const newFour = jobs.find((j) => j._id === after!.reminder4dJobId);
    expect(newFour?.scheduledTime).toBe(newEventDate - 4 * DAY);
  });

  it("deleteEvent cancels the reminder jobs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z").getTime());

    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 10);
    await assign(t, world, leaderToken, planId, world.channelMemberId);

    await t.action(api.functions.scheduling.assignments.publishEvent, {
      token: leaderToken,
      planId,
    });
    const before = await t.run((ctx) => ctx.db.get(planId));
    const fourId = before!.reminder4dJobId!;
    const oneId = before!.reminder1dJobId!;

    await t.mutation(api.functions.scheduling.events.deleteEvent, {
      token: leaderToken,
      planId,
    });

    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(jobs.find((j) => j._id === fourId)?.state.kind).toBe("canceled");
    expect(jobs.find((j) => j._id === oneId)?.state.kind).toBe("canceled");
  });
});
