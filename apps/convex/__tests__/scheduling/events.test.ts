/**
 * Tests for fill-summary math and the deleteEvent cascade (ADR-023).
 *
 * Fill summary counts `confirmed` + `unconfirmed` as filled; `declined` does
 * NOT count, so a declined slot stays open.
 */

import { describe, it, expect, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { generateTokens } from "../../lib/auth";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { buildSchedulingWorld } from "./fixtures";

/**
 * Most-recently-created test handle. Scheduling mutations now enqueue a
 * deferred team-channel reconcile via `ctx.scheduler.runAfter(0, ...)`; the
 * `afterEach` below drains it so a pending scheduled function does not leak
 * into the next test ("test began while previous transaction was still open").
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

describe("fill summary", () => {
  it("counts confirmed + unconfirmed as filled, excludes declined", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const eventDate = Date.now() + 7 * DAY;
    const { planId } = await t.mutation(
      api.functions.scheduling.events.createEvent,
      {
        token: leaderToken,
        groupId: world.groupId,
        title: "Sunday",
        eventDate,
        times: [{ label: "9 AM", startsAt: eventDate }],
      },
    );

    // Need 3 Drums.
    await t.mutation(api.functions.scheduling.events.setNeededRoles, {
      token: leaderToken,
      planId,
      roles: [{ channelId: world.channelId, roleId: world.roleId, count: 3 }],
    });

    // Assign 3 people: one confirms, one declines, one stays unconfirmed.
    const assign = async (userId: Id<"users">) =>
      (
        await t.mutation(api.functions.scheduling.assignments.assignRole, {
          token: leaderToken,
          planId,
          channelId: world.channelId,
          roleId: world.roleId,
          userId,
        })
      ).assignmentId;

    const a1 = await assign(world.channelMemberId);
    const a2 = await assign(world.channelModeratorId);
    await assign(world.channelAdminId); // left unconfirmed

    await t.mutation(api.functions.scheduling.assignments.respondToAssignment, {
      token: (await generateTokens(world.channelMemberId)).accessToken,
      assignmentId: a1,
      status: "confirmed",
    });
    await t.mutation(api.functions.scheduling.assignments.respondToAssignment, {
      token: (await generateTokens(world.channelModeratorId)).accessToken,
      assignmentId: a2,
      status: "declined",
    });

    const event = await t.query(api.functions.scheduling.events.getEvent, {
      token: leaderToken,
      planId,
    });

    expect(event).not.toBeNull();
    const drums = event!.roles.find((r) => r.roleId === world.roleId)!;
    // confirmed (1) + unconfirmed (1) = 2 filled; declined excluded.
    expect(drums.needed).toBe(3);
    expect(drums.filled).toBe(2);
    expect(drums.open).toBe(1);
  });

  it("reflects fill in listEvents summary", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const eventDate = Date.now() + 7 * DAY;
    const { planId } = await t.mutation(
      api.functions.scheduling.events.createEvent,
      {
        token: leaderToken,
        groupId: world.groupId,
        title: "Sunday",
        eventDate,
        times: [{ label: "9 AM", startsAt: eventDate }],
      },
    );
    await t.mutation(api.functions.scheduling.events.setNeededRoles, {
      token: leaderToken,
      planId,
      roles: [{ channelId: world.channelId, roleId: world.roleId, count: 2 }],
    });
    await t.mutation(api.functions.scheduling.assignments.assignRole, {
      token: leaderToken,
      planId,
      channelId: world.channelId,
      roleId: world.roleId,
      userId: world.channelMemberId,
    });

    const events = await t.query(api.functions.scheduling.events.listEvents, {
      token: leaderToken,
      groupId: world.groupId,
    });
    const summary = events.find((e) => e._id === planId)!.fillSummary;
    expect(summary.totalNeeded).toBe(2);
    expect(summary.totalFilled).toBe(1);
  });
});

describe("duplicateEvent", () => {
  it("structure-only copies: draft status, +7d date, same roles, no assignments", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const eventDate = Date.now() + 7 * DAY;
    const { planId } = await t.mutation(
      api.functions.scheduling.events.createEvent,
      {
        token: leaderToken,
        groupId: world.groupId,
        title: "Sunday Service",
        eventDate,
        times: [{ label: "9 AM", startsAt: eventDate }],
        notes: "Bring music stands",
      },
    );
    await t.mutation(api.functions.scheduling.events.setNeededRoles, {
      token: leaderToken,
      planId,
      roles: [{ channelId: world.channelId, roleId: world.roleId, count: 3 }],
    });
    // Source has an assignment that must NOT be copied.
    await t.mutation(api.functions.scheduling.assignments.assignRole, {
      token: leaderToken,
      planId,
      channelId: world.channelId,
      roleId: world.roleId,
      userId: world.channelMemberId,
    });

    const { planId: copyId } = await t.mutation(
      api.functions.scheduling.events.duplicateEvent,
      { token: leaderToken, planId },
    );

    const copy = await t.query(api.functions.scheduling.events.getEvent, {
      token: leaderToken,
      planId: copyId,
    });
    expect(copy).not.toBeNull();
    expect(copy!.status).toBe("draft");
    expect(copy!.title).toBe("Sunday Service");
    expect(copy!.notes).toBe("Bring music stands");
    expect(copy!.eventDate).toBe(eventDate + 7 * DAY);

    // Same needed role, fully open — zero assignments copied.
    expect(copy!.roles).toHaveLength(1);
    const role = copy!.roles[0];
    expect(role.roleId).toBe(world.roleId);
    expect(role.needed).toBe(3);
    expect(role.filled).toBe(0);
    expect(role.assignments).toHaveLength(0);

    // No roleAssignments rows leaked onto the copy.
    await t.run(async (ctx) => {
      const assignments = await ctx.db
        .query("roleAssignments")
        .withIndex("by_plan", (q) => q.eq("planId", copyId))
        .collect();
      expect(assignments).toHaveLength(0);
    });
  });
});

describe("deleteEvent cascade", () => {
  it("deletes the plan, its neededRoles, and its roleAssignments", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const eventDate = Date.now() + 7 * DAY;
    const { planId } = await t.mutation(
      api.functions.scheduling.events.createEvent,
      {
        token: leaderToken,
        groupId: world.groupId,
        title: "Sunday",
        eventDate,
        times: [{ label: "9 AM", startsAt: eventDate }],
      },
    );
    await t.mutation(api.functions.scheduling.events.setNeededRoles, {
      token: leaderToken,
      planId,
      roles: [{ channelId: world.channelId, roleId: world.roleId, count: 2 }],
    });
    await t.mutation(api.functions.scheduling.assignments.assignRole, {
      token: leaderToken,
      planId,
      channelId: world.channelId,
      roleId: world.roleId,
      userId: world.channelMemberId,
    });

    const res = await t.mutation(api.functions.scheduling.events.deleteEvent, {
      token: leaderToken,
      planId,
    });
    expect(res.deletedNeededRoles).toBe(1);
    expect(res.deletedAssignments).toBe(1);

    // Nothing left behind.
    await t.run(async (ctx) => {
      expect(await ctx.db.get(planId)).toBeNull();
      const needed = await ctx.db
        .query("neededRoles")
        .withIndex("by_plan", (q) => q.eq("planId", planId))
        .collect();
      const assignments = await ctx.db
        .query("roleAssignments")
        .withIndex("by_plan", (q) => q.eq("planId", planId))
        .collect();
      expect(needed).toHaveLength(0);
      expect(assignments).toHaveLength(0);
    });
  });
});
