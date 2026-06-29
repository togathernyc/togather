/**
 * Tests for the serving-request history + per-person re-send, and the new
 * leader notification when a volunteer accepts/declines.
 *
 * - `assignmentRequestLog` is append-only: the request fan-out logs an
 *   `initial` row per recipient, then a `resend` row on any later send. The log
 *   outlives the assignment, so a removed assignment still shows in history with
 *   `currentStatus: "removed"`.
 * - `assignmentRequestHistory` joins those rows with each recipient's current
 *   assignment status; it is scheduler-gated.
 * - `respondToAssignment` schedules `notifyLeadersOfResponse`, which notifies the
 *   event's leaders (inbox + push). The responder is never notified about their
 *   own response.
 *
 * convex-test does not auto-run `scheduler.runAfter` jobs, so — exactly like
 * reminders.test.ts — we invoke the internal fan-out actions directly and assert
 * the DB side effects (`assignmentRequestLog` and inbox `notifications` rows).
 * There are no `pushTokens` in the fixture world and the Twilio path is
 * best-effort, so push/SMS delivery is not mocked.
 */

import { describe, it, expect, afterEach } from "vitest";
import { ConvexError } from "convex/values";
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
});

async function setupSchedulingWorld() {
  const t = convexTest(schema, modules);
  activeHandle = t;
  const world = await buildSchedulingWorld(t);
  return { t, world };
}

const DAY = 86400000;

async function makeEvent(
  t: ReturnType<typeof convexTest>,
  world: SchedulingWorld,
  leaderToken: string,
  dayOffset = 10,
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

/**
 * Run the initial request fan-out directly. convex-test doesn't auto-run the
 * `scheduler.runAfter` job that `publishEvent` enqueues — and chaining a second
 * action would drain it nondeterministically — so we invoke the fan-out action
 * itself (which is all `publishEvent` ultimately does, minus the status flip
 * that none of these code paths depend on). Mirrors reminders.test.ts.
 */
async function sendInitialRequests(
  t: ReturnType<typeof convexTest>,
  world: SchedulingWorld,
  planId: Id<"eventPlans">,
) {
  await t.action(
    internal.functions.scheduling.assignments.sendAssignmentRequests,
    { planId, publisherId: world.groupLeaderId },
  );
}

/** All request-log rows for an assignment, oldest first. */
async function logRowsForAssignment(
  t: ReturnType<typeof convexTest>,
  assignmentId: Id<"roleAssignments">,
) {
  return t.run(async (ctx) => {
    const rows = await ctx.db
      .query("assignmentRequestLog")
      .withIndex("by_assignment", (q) => q.eq("assignmentId", assignmentId))
      .collect();
    rows.sort((a, b) => a._creationTime - b._creationTime);
    return rows;
  });
}

/** Count inbox notifications of a given type for a user. */
async function inboxCount(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  notificationType: string,
): Promise<number> {
  return t.run(async (ctx) => {
    const rows = await ctx.db
      .query("notifications")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), userId),
          q.eq(q.field("notificationType"), notificationType),
        ),
      )
      .collect();
    return rows.length;
  });
}

/** Newest inbox notification of a type for a user (or null). */
async function latestInbox(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  notificationType: string,
) {
  return t.run(async (ctx) => {
    const rows = await ctx.db
      .query("notifications")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), userId),
          q.eq(q.field("notificationType"), notificationType),
        ),
      )
      .collect();
    if (rows.length === 0) return null;
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return rows[0];
  });
}

describe("request history + per-person re-send", () => {
  it("logs an `initial` row then a `resend` row for later sends", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leader = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leader);
    const assignmentId = await assign(t, world, leader, planId, world.channelMemberId);

    await sendInitialRequests(t, world, planId);

    let rows = await logRowsForAssignment(t, assignmentId);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("initial");
    expect(rows[0].userId).toBe(world.channelMemberId);
    expect(rows[0].channels).toContain("sms"); // fixture user has a phone

    // A targeted re-send to the one assignment logs a `resend` row.
    await t.action(
      internal.functions.scheduling.assignments.sendAssignmentRequests,
      { planId, publisherId: world.groupLeaderId, assignmentIds: [assignmentId] },
    );

    rows = await logRowsForAssignment(t, assignmentId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.kind)).toEqual(["initial", "resend"]);
  });

  it("resendAssignmentRequest is scheduler-gated and only re-sends to awaiting volunteers", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leader = (await generateTokens(world.groupLeaderId)).accessToken;
    const volunteer = (await generateTokens(world.channelMemberId)).accessToken;
    const confirmer = (await generateTokens(world.channelAdminId)).accessToken;
    const outsider = (await generateTokens(world.outsiderId)).accessToken;
    const planId = await makeEvent(t, world, leader);
    const assignmentId = await assign(t, world, leader, planId, world.channelMemberId);

    await sendInitialRequests(t, world, planId);

    // A non-scheduler cannot re-send.
    await expect(
      t.action(api.functions.scheduling.assignments.resendAssignmentRequest, {
        token: outsider,
        assignmentId,
      }),
    ).rejects.toThrow(ConvexError);

    // A scheduler can re-send to an awaiting volunteer.
    const ok = await t.action(
      api.functions.scheduling.assignments.resendAssignmentRequest,
      { token: leader, assignmentId },
    );
    expect(ok.scheduled).toBe(true);

    // …but not to one who has declined.
    await t.mutation(api.functions.scheduling.assignments.respondToAssignment, {
      token: volunteer,
      assignmentId,
      status: "declined",
    });
    const declined = await t.action(
      api.functions.scheduling.assignments.resendAssignmentRequest,
      { token: leader, assignmentId },
    );
    expect(declined.scheduled).toBe(false);

    // …and not to one who has already confirmed (stale history modal): the
    // fan-out only targets unconfirmed, so report scheduled:false honestly.
    const confirmedAssignmentId = await assign(
      t,
      world,
      leader,
      planId,
      world.channelAdminId,
    );
    await t.mutation(api.functions.scheduling.assignments.respondToAssignment, {
      token: confirmer,
      assignmentId: confirmedAssignmentId,
      status: "confirmed",
    });
    const confirmed = await t.action(
      api.functions.scheduling.assignments.resendAssignmentRequest,
      { token: leader, assignmentId: confirmedAssignmentId },
    );
    expect(confirmed.scheduled).toBe(false);
  });

  it("assignmentRequestHistory reflects the current assignment status", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leader = (await generateTokens(world.groupLeaderId)).accessToken;
    const volunteer = (await generateTokens(world.channelMemberId)).accessToken;
    const planId = await makeEvent(t, world, leader);
    const assignmentId = await assign(t, world, leader, planId, world.channelMemberId);

    await sendInitialRequests(t, world, planId);

    // Before responding: history shows the request as still awaiting.
    let history = await t.query(
      api.functions.scheduling.assignments.assignmentRequestHistory,
      { token: leader, planId },
    );
    expect(history).toHaveLength(1);
    expect(history[0].currentStatus).toBe("unconfirmed");
    expect(history[0].kind).toBe("initial");
    expect(history[0].userName).toContain("Memberly");

    // Volunteer declines with a note → history reflects it.
    await t.mutation(api.functions.scheduling.assignments.respondToAssignment, {
      token: volunteer,
      assignmentId,
      status: "declined",
      declineNote: "Out of town",
    });

    history = await t.query(
      api.functions.scheduling.assignments.assignmentRequestHistory,
      { token: leader, planId },
    );
    expect(history[0].currentStatus).toBe("declined");
    expect(history[0].declineNote).toBe("Out of town");
    expect(history[0].respondedAt).toBeTruthy();
  });

  it("keeps history after the assignment is removed (currentStatus: removed)", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leader = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leader);
    const assignmentId = await assign(t, world, leader, planId, world.channelMemberId);

    await sendInitialRequests(t, world, planId);

    await t.mutation(api.functions.scheduling.assignments.unassign, {
      token: leader,
      assignmentId,
    });

    const history = await t.query(
      api.functions.scheduling.assignments.assignmentRequestHistory,
      { token: leader, planId },
    );
    expect(history).toHaveLength(1);
    expect(history[0].currentStatus).toBe("removed");
  });

  it("assignmentRequestHistory is scheduler-gated", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leader = (await generateTokens(world.groupLeaderId)).accessToken;
    const outsider = (await generateTokens(world.outsiderId)).accessToken;
    const planId = await makeEvent(t, world, leader);
    await assign(t, world, leader, planId, world.channelMemberId);

    await expect(
      t.query(api.functions.scheduling.assignments.assignmentRequestHistory, {
        token: outsider,
        planId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("leader notification on accept/decline", () => {
  it("notifies the event's leaders when a volunteer accepts, excluding the responder", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leader = (await generateTokens(world.groupLeaderId)).accessToken;
    const volunteer = (await generateTokens(world.channelMemberId)).accessToken;
    const planId = await makeEvent(t, world, leader);
    const assignmentId = await assign(t, world, leader, planId, world.channelMemberId);

    await t.mutation(api.functions.scheduling.assignments.respondToAssignment, {
      token: volunteer,
      assignmentId,
      status: "confirmed",
    });
    // Run the scheduled fan-out directly (convex-test doesn't auto-run it).
    await t.action(
      internal.functions.scheduling.assignments.notifyLeadersOfResponse,
      { assignmentId, responderId: world.channelMemberId, status: "confirmed" },
    );

    // The group leader gets a response notification…
    const leaderNote = await latestInbox(
      t,
      world.groupLeaderId,
      "scheduling_assignment_response",
    );
    expect(leaderNote).not.toBeNull();
    expect(leaderNote!.title).toContain("accepted");
    expect((leaderNote!.data as { url?: string }).url).toBe(
      `/rostering/${world.groupId}`,
    );

    // …and the responding volunteer is NOT notified about their own response.
    expect(
      await inboxCount(t, world.channelMemberId, "scheduling_assignment_response"),
    ).toBe(0);
  });

  it("includes the decline note in the leader notification", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leader = (await generateTokens(world.groupLeaderId)).accessToken;
    const volunteer = (await generateTokens(world.channelMemberId)).accessToken;
    const planId = await makeEvent(t, world, leader);
    const assignmentId = await assign(t, world, leader, planId, world.channelMemberId);

    await t.mutation(api.functions.scheduling.assignments.respondToAssignment, {
      token: volunteer,
      assignmentId,
      status: "declined",
      declineNote: "Out of town",
    });
    await t.action(
      internal.functions.scheduling.assignments.notifyLeadersOfResponse,
      {
        assignmentId,
        responderId: world.channelMemberId,
        status: "declined",
        declineNote: "Out of town",
      },
    );

    const leaderNote = await latestInbox(
      t,
      world.groupLeaderId,
      "scheduling_assignment_response",
    );
    expect(leaderNote).not.toBeNull();
    expect(leaderNote!.title).toContain("declined");
    expect(leaderNote!.body).toContain("Out of town");
  });

  it("does not notify a former scheduler who has since left the group", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leader = (await generateTokens(world.groupLeaderId)).accessToken;
    const volunteer = (await generateTokens(world.channelMemberId)).accessToken;
    const planId = await makeEvent(t, world, leader);
    // groupLeader is both the assigner and the plan creator here.
    const assignmentId = await assign(t, world, leader, planId, world.channelMemberId);

    // The leader leaves the group — they can no longer access the event, so they
    // must not receive volunteer names / decline notes for it.
    await t.run(async (ctx) => {
      const m = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", world.groupId).eq("userId", world.groupLeaderId),
        )
        .first();
      if (m) await ctx.db.patch(m._id, { leftAt: Date.now() });
    });

    await t.mutation(api.functions.scheduling.assignments.respondToAssignment, {
      token: volunteer,
      assignmentId,
      status: "confirmed",
    });
    await t.action(
      internal.functions.scheduling.assignments.notifyLeadersOfResponse,
      { assignmentId, responderId: world.channelMemberId, status: "confirmed" },
    );

    // No current scheduler remains → nobody is notified (in particular not the
    // departed assigner/creator).
    expect(
      await inboxCount(t, world.groupLeaderId, "scheduling_assignment_response"),
    ).toBe(0);
  });

  it("never self-notifies a leader who responds to their own assignment", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leader = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leader);
    // Assign the leader to their own role, then have the leader respond.
    const assignmentId = await assign(t, world, leader, planId, world.groupLeaderId);

    await t.mutation(api.functions.scheduling.assignments.respondToAssignment, {
      token: leader,
      assignmentId,
      status: "declined",
      declineNote: "Traveling",
    });
    await t.action(
      internal.functions.scheduling.assignments.notifyLeadersOfResponse,
      {
        assignmentId,
        responderId: world.groupLeaderId,
        status: "declined",
        declineNote: "Traveling",
      },
    );

    // The only leader is also the responder → no self-notification.
    expect(
      await inboxCount(t, world.groupLeaderId, "scheduling_assignment_response"),
    ).toBe(0);
  });
});
