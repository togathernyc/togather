/**
 * Tests for the team-channel auto-sync engine (teamChannelSync.ts).
 *
 * A team channel's membership is derived from `roleAssignments` whose
 * `eventDate` lands inside the rotation window (added ~5 days before the
 * event, removed ~1 day after). These tests drive `reconcileTeamChannel`
 * directly so the rotation window is exercised deterministically; they also
 * verify the assignment-mutation triggers fire a reconcile via the scheduler.
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

/**
 * Most-recently-created test handle. The assignment-mutation triggers enqueue
 * a deferred reconcile via `ctx.scheduler.runAfter(0, ...)`; the `afterEach`
 * below drains it so a pending scheduled function does not leak into the next
 * test ("test began while previous transaction was still open").
 */
let activeHandle: ReturnType<typeof convexTest> | null = null;

afterEach(async () => {
  if (activeHandle) {
    await activeHandle.finishInProgressScheduledFunctions();
    activeHandle = null;
  }
});

/** Spin up a convex-test handle and seed the scheduling world into it. */
async function setupSchedulingWorld() {
  const t = convexTest(schema, modules);
  activeHandle = t;
  const world = await buildSchedulingWorld(t);
  return { t, world };
}

const DAY = 86400000;

/** Create a draft event for a given day offset and return its planId. */
async function makeEvent(
  t: ReturnType<typeof import("convex-test").convexTest>,
  world: SchedulingWorld,
  leaderToken: string,
  dayOffset: number,
  title = "Event",
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

/**
 * Insert a `roleAssignments` row directly (bypassing the assignRole mutation
 * and its scheduler trigger) so the reconcile engine can be tested in
 * isolation with a precise event date.
 */
async function insertAssignment(
  t: ReturnType<typeof import("convex-test").convexTest>,
  world: SchedulingWorld,
  opts: {
    planId: Id<"eventPlans">;
    userId: Id<"users">;
    eventDate: number;
    status?: "unconfirmed" | "confirmed" | "declined";
  },
): Promise<Id<"roleAssignments">> {
  return t.run((ctx) =>
    ctx.db.insert("roleAssignments", {
      planId: opts.planId,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: opts.userId,
      eventDate: opts.eventDate,
      status: opts.status ?? "unconfirmed",
      assignedById: world.groupLeaderId,
      assignedAt: Date.now(),
    }),
  );
}

/** Active (non-left) auto-synced member userIds for the world's channel. */
async function syncedMemberIds(
  t: ReturnType<typeof import("convex-test").convexTest>,
  world: SchedulingWorld,
): Promise<Set<string>> {
  const rows = await t.run((ctx) =>
    ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_syncSource", (q) =>
        q.eq("channelId", world.channelId).eq("syncSource", "event_plan"),
      )
      .collect(),
  );
  return new Set(
    rows.filter((r) => r.leftAt === undefined).map((r) => r.userId as string),
  );
}

async function reconcile(
  t: ReturnType<typeof import("convex-test").convexTest>,
  world: SchedulingWorld,
) {
  return t.mutation(
    internal.functions.scheduling.teamChannelSync.reconcileTeamChannel,
    { teamId: world.teamId },
  );
}

describe("team channel auto-sync — reconcileTeamChannel", () => {
  it("adds a user assigned within the rotation window", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 3);

    // Event is 3 days out — inside the 5-day add window.
    await insertAssignment(t, world, {
      planId,
      userId: world.outsiderId,
      eventDate: Date.now() + 3 * DAY,
    });

    const result = await reconcile(t, world);
    expect(result.added).toBe(1);

    const members = await syncedMemberIds(t, world);
    expect(members.has(world.outsiderId)).toBe(true);
  });

  it("does not add a user whose event is beyond the add window", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 30);

    // Event is 30 days out — well past the 5-day add window.
    await insertAssignment(t, world, {
      planId,
      userId: world.outsiderId,
      eventDate: Date.now() + 30 * DAY,
    });

    await reconcile(t, world);

    const members = await syncedMemberIds(t, world);
    expect(members.has(world.outsiderId)).toBe(false);
  });

  it("removes a user once the rotation window has passed", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    // Event is 3 days out — user enters the channel.
    const planId = await makeEvent(t, world, leaderToken, 3);
    const assignmentId = await insertAssignment(t, world, {
      planId,
      userId: world.outsiderId,
      eventDate: Date.now() + 3 * DAY,
    });

    await reconcile(t, world);
    expect((await syncedMemberIds(t, world)).has(world.outsiderId)).toBe(true);

    // Move the event 5 days into the past — beyond the 1-day remove window.
    await t.run((ctx) =>
      ctx.db.patch(assignmentId, { eventDate: Date.now() - 5 * DAY }),
    );

    const result = await reconcile(t, world);
    expect(result.removed).toBe(1);
    expect((await syncedMemberIds(t, world)).has(world.outsiderId)).toBe(false);
  });

  it("declined assignments never put a user in the channel", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 3);

    await insertAssignment(t, world, {
      planId,
      userId: world.outsiderId,
      eventDate: Date.now() + 3 * DAY,
      status: "declined",
    });

    const result = await reconcile(t, world);
    expect(result.added).toBe(0);
    expect((await syncedMemberIds(t, world)).has(world.outsiderId)).toBe(false);
  });

  it("removes a user when their in-window assignment is declined", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 3);

    const assignmentId = await insertAssignment(t, world, {
      planId,
      userId: world.outsiderId,
      eventDate: Date.now() + 3 * DAY,
    });
    await reconcile(t, world);
    expect((await syncedMemberIds(t, world)).has(world.outsiderId)).toBe(true);

    // The volunteer declines — they should leave the channel.
    await t.run((ctx) =>
      ctx.db.patch(assignmentId, { status: "declined" }),
    );
    const result = await reconcile(t, world);
    expect(result.removed).toBe(1);
    expect((await syncedMemberIds(t, world)).has(world.outsiderId)).toBe(false);
  });

  it("never removes non-synced (manual / creator) members", async () => {
    const { t, world } = await setupSchedulingWorld();

    // The fixture seeds channelAdmin/moderator/member as manual members
    // (no syncSource). Run a reconcile with no in-window assignments at all.
    const beforeCount = await t.run((ctx) =>
      ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", world.channelId))
        .collect()
        .then((rows) => rows.filter((r) => r.leftAt === undefined).length),
    );
    expect(beforeCount).toBe(3);

    const result = await reconcile(t, world);
    expect(result.removed).toBe(0);

    const afterRows = await t.run((ctx) =>
      ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", world.channelId))
        .collect(),
    );
    const activeManual = afterRows.filter(
      (r) => r.leftAt === undefined && r.syncSource === undefined,
    );
    expect(activeManual.length).toBe(3);
  });

  it("re-adds a user whose only prior channel row is soft-left", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 3);

    // The user once had a channel membership but was removed — only a
    // soft-left row (leftAt set) remains, so they are NOT in the channel.
    await t.run((ctx) =>
      ctx.db.insert("chatChannelMembers", {
        channelId: world.channelId,
        userId: world.outsiderId,
        role: "member",
        joinedAt: Date.now() - 30 * DAY,
        isMuted: false,
        leftAt: Date.now() - 20 * DAY,
      }),
    );

    // They are now assigned to an in-window event.
    await insertAssignment(t, world, {
      planId,
      userId: world.outsiderId,
      eventDate: Date.now() + 3 * DAY,
    });

    const result = await reconcile(t, world);
    expect(result.added).toBe(1);

    // The user is back in the channel.
    expect((await syncedMemberIds(t, world)).has(world.outsiderId)).toBe(true);

    // No duplicate row: exactly one row for the user, active and synced.
    const rows = await t.run((ctx) =>
      ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", world.channelId).eq("userId", world.outsiderId),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].leftAt).toBeUndefined();
    expect(rows[0].syncSource).toBe("event_plan");
  });

  it("a manually-present member assigned to a role is left as a manual member", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 3);

    // channelMemberId is already a manual channel member in the fixture.
    await insertAssignment(t, world, {
      planId,
      userId: world.channelMemberId,
      eventDate: Date.now() + 3 * DAY,
    });
    await reconcile(t, world);

    const rows = await t.run((ctx) =>
      ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q
            .eq("channelId", world.channelId)
            .eq("userId", world.channelMemberId),
        )
        .collect(),
    );
    // No duplicate row created; the original manual row is untouched.
    expect(rows.length).toBe(1);
    expect(rows[0].syncSource).toBeUndefined();
  });
});

describe("team channel auto-sync — triggerTeamChannelSync (public)", () => {
  it("reconciles the channel for a scheduler", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 3);

    // Event is 3 days out — inside the 5-day add window.
    await insertAssignment(t, world, {
      planId,
      userId: world.outsiderId,
      eventDate: Date.now() + 3 * DAY,
    });

    const result = await t.mutation(
      api.functions.scheduling.teamChannelSync.triggerTeamChannelSync,
      { token: leaderToken, teamId: world.teamId },
    );
    expect(result.addedCount).toBe(1);
    expect(result.removedCount).toBe(0);

    const members = await syncedMemberIds(t, world);
    expect(members.has(world.outsiderId)).toBe(true);
  });

  it("rejects a non-scheduler with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    // The outsider has no channel/group/community role — not a scheduler.
    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;

    await expect(
      t.mutation(
        api.functions.scheduling.teamChannelSync.triggerTeamChannelSync,
        { token: outsiderToken, teamId: world.teamId },
      ),
    ).rejects.toThrow(ConvexError);
  });
});

/**
 * Names of `_scheduled_functions` rows currently pending — used to assert a
 * mutation enqueued a deferred reconcile. (We assert enqueueing rather than
 * draining the scheduler, to avoid fake timers leaking across test files.)
 */
async function pendingScheduledNames(
  t: ReturnType<typeof import("convex-test").convexTest>,
): Promise<string[]> {
  const rows = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  return rows.map((r) => r.name);
}

describe("team channel auto-sync — assignment triggers", () => {
  it("assignRole enqueues a team-channel reconcile", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 3);

    await t.mutation(api.functions.scheduling.assignments.assignRole, {
      token: leaderToken,
      planId,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.groupLeaderId,
    });

    const names = await pendingScheduledNames(t);
    expect(
      names.some((n) => n.includes("teamChannelSync") && n.includes("reconcileTeamChannel")),
    ).toBe(true);

    // Run the deferred reconcile directly and confirm the effect.
    await reconcile(t, world);
    expect((await syncedMemberIds(t, world)).has(world.groupLeaderId)).toBe(true);
  });

  it("unassign enqueues a reconcile that removes the volunteer", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 3);

    const { assignmentId } = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      {
        token: leaderToken,
        planId,
        teamId: world.teamId,
        roleId: world.roleId,
        userId: world.groupLeaderId,
      },
    );
    await reconcile(t, world);
    expect((await syncedMemberIds(t, world)).has(world.groupLeaderId)).toBe(true);

    await t.mutation(api.functions.scheduling.assignments.unassign, {
      token: leaderToken,
      assignmentId,
    });
    const names = await pendingScheduledNames(t);
    expect(
      names.some((n) => n.includes("teamChannelSync") && n.includes("reconcileTeamChannel")),
    ).toBe(true);

    await reconcile(t, world);
    expect((await syncedMemberIds(t, world)).has(world.outsiderId)).toBe(false);
  });
});
