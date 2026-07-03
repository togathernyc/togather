/**
 * Tests for fill-summary math and the deleteEvent cascade (ADR-023).
 *
 * Fill summary counts `confirmed` + `unconfirmed` as filled; `declined` does
 * NOT count, so a declined slot stays open.
 */

import { describe, it, expect, afterEach } from "vitest";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { generateTokens } from "../../lib/auth";
import { api, internal } from "../../_generated/api";
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
      roles: [{ teamId: world.teamId, roleId: world.roleId, count: 3 }],
    });

    // Assign 3 people: one confirms, one declines, one stays unconfirmed.
    const assign = async (userId: Id<"users">) =>
      (
        await t.mutation(api.functions.scheduling.assignments.assignRole, {
          token: leaderToken,
          planId,
          teamId: world.teamId,
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
      roles: [{ teamId: world.teamId, roleId: world.roleId, count: 2 }],
    });
    await t.mutation(api.functions.scheduling.assignments.assignRole, {
      token: leaderToken,
      planId,
      teamId: world.teamId,
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
      roles: [{ teamId: world.teamId, roleId: world.roleId, count: 3 }],
    });
    // Source has an assignment that must NOT be copied.
    await t.mutation(api.functions.scheduling.assignments.assignRole, {
      token: leaderToken,
      planId,
      teamId: world.teamId,
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

  it("rolls a past plan's copy forward to the next upcoming occurrence", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const WEEK = 7 * DAY;
    // A plan three weeks in the past — naive +1 week would still be past.
    const eventDate = Date.now() - 3 * WEEK;
    const { planId } = await t.mutation(
      api.functions.scheduling.events.createEvent,
      {
        token: leaderToken,
        groupId: world.groupId,
        title: "Sunday Service",
        eventDate,
        times: [{ label: "9 AM", startsAt: eventDate }],
      },
    );

    const { planId: copyId } = await t.mutation(
      api.functions.scheduling.events.duplicateEvent,
      { token: leaderToken, planId },
    );

    const copy = await t.run(async (ctx) => ctx.db.get(copyId));
    expect(copy).not.toBeNull();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const cutoff = todayStart.getTime();

    // Lands in the future, on the same weekday (whole weeks from the source),
    // and is the *next* such occurrence (one week earlier would still be past).
    expect((copy!.eventDate - eventDate) % WEEK).toBe(0);
    expect(copy!.eventDate).toBeGreaterThanOrEqual(cutoff);
    expect(copy!.eventDate - WEEK).toBeLessThan(cutoff);

    // Times shift with the date; the label is preserved.
    const delta = copy!.eventDate - eventDate;
    expect(copy!.times[0].startsAt).toBe(eventDate + delta);
    expect(copy!.times[0].label).toBe("9 AM");
  });
});

describe("updateEvent reschedule realigns times", () => {
  it("shifts times[].startsAt onto the new date when only eventDate changes", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const HOUR = 3600000;
    const eventDate = Date.now() + 7 * DAY;
    const { planId } = await t.mutation(
      api.functions.scheduling.events.createEvent,
      {
        token: leaderToken,
        groupId: world.groupId,
        title: "Sunday Service",
        eventDate,
        times: [
          { label: "9:00 AM", startsAt: eventDate },
          { label: "11:00 AM", startsAt: eventDate + 2 * HOUR },
        ],
      },
    );

    // Reschedule two weeks out, sending ONLY the new date — this mirrors every
    // date-picker client (EventEditorScreen / EventEditorPanel /
    // DateColumnHeaderEditor all send eventDate alone).
    const newEventDate = eventDate + 14 * DAY;
    await t.mutation(api.functions.scheduling.events.updateEvent, {
      token: leaderToken,
      planId,
      eventDate: newEventDate,
    });

    const plan = await t.run(async (ctx) => ctx.db.get(planId));
    expect(plan!.eventDate).toBe(newEventDate);
    // Each service time moved by the same delta so it stays on the event's new
    // day (labels preserved) — not stranded on the old date, which is what used
    // to decouple the serving window from the real event date.
    expect(plan!.times[0].startsAt).toBe(newEventDate);
    expect(plan!.times[0].label).toBe("9:00 AM");
    expect(plan!.times[1].startsAt).toBe(newEventDate + 2 * HOUR);
    expect(plan!.times[1].label).toBe("11:00 AM");
  });

  it("uses caller-supplied times verbatim when both eventDate and times change", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const HOUR = 3600000;
    const eventDate = Date.now() + 7 * DAY;
    const { planId } = await t.mutation(
      api.functions.scheduling.events.createEvent,
      {
        token: leaderToken,
        groupId: world.groupId,
        title: "Sunday Service",
        eventDate,
        times: [{ label: "9:00 AM", startsAt: eventDate }],
      },
    );

    const newEventDate = eventDate + 7 * DAY;
    const explicitStart = newEventDate + 5 * HOUR;
    await t.mutation(api.functions.scheduling.events.updateEvent, {
      token: leaderToken,
      planId,
      eventDate: newEventDate,
      times: [{ label: "2:00 PM", startsAt: explicitStart }],
    });

    const plan = await t.run(async (ctx) => ctx.db.get(planId));
    expect(plan!.times).toHaveLength(1);
    expect(plan!.times[0].startsAt).toBe(explicitStart);
    expect(plan!.times[0].label).toBe("2:00 PM");
  });
});

describe("seedNeededRolesFromDefaults", () => {
  it("seeds neededRoles from a team's role defaults", async () => {
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

    // The fixture's Drums role has defaultNeeded: 1.
    const res = await t.mutation(
      api.functions.scheduling.events.seedNeededRolesFromDefaults,
      { token: leaderToken, planId, teamIds: [world.teamId] },
    );
    expect(res.neededRoleCount).toBe(1);
  });

  it("rejects a team from another group with a ConvexError", async () => {
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

    // A serving team belonging to a DIFFERENT group/community.
    const foreignTeamId = await t.run(async (ctx) => {
      const foreignCommunityId = await ctx.db.insert("communities", {
        name: "Other Community",
        slug: "other",
        isPublic: true,
      });
      const foreignGroupTypeId = await ctx.db.insert("groupTypes", {
        communityId: foreignCommunityId,
        name: "Campus",
        slug: "campus",
        isActive: true,
        createdAt: Date.now(),
        displayOrder: 1,
      });
      const foreignGroupId = await ctx.db.insert("groups", {
        communityId: foreignCommunityId,
        groupTypeId: foreignGroupTypeId,
        name: "Foreign Campus",
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const teamId = await ctx.db.insert("teams", {
        groupId: foreignGroupId,
        communityId: foreignCommunityId,
        name: "Foreign Team",
        isArchived: false,
        createdAt: Date.now(),
        createdById: world.groupLeaderId,
        updatedAt: Date.now(),
      });
      await ctx.db.insert("teamRoles", {
        teamId,
        communityId: foreignCommunityId,
        name: "Foreign Drums",
        sortOrder: 0,
        defaultNeeded: 2,
        isArchived: false,
        createdAt: Date.now(),
        createdById: world.groupLeaderId,
      });
      return teamId;
    });

    await expect(
      t.mutation(
        api.functions.scheduling.events.seedNeededRolesFromDefaults,
        { token: leaderToken, planId, teamIds: [foreignTeamId] },
      ),
    ).rejects.toThrow(ConvexError);

    // Nothing seeded.
    await t.run(async (ctx) => {
      const needed = await ctx.db
        .query("neededRoles")
        .withIndex("by_plan", (q) => q.eq("planId", planId))
        .collect();
      expect(needed).toHaveLength(0);
    });
  });
});

describe("event query access control", () => {
  it("listEvents rejects an authenticated outsider with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;

    await expect(
      t.query(api.functions.scheduling.events.listEvents, {
        token: outsiderToken,
        groupId: world.groupId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("listEvents works for a group member", async () => {
    const { t, world } = await setupSchedulingWorld();
    const memberToken = (await generateTokens(world.channelMemberId))
      .accessToken;

    const events = await t.query(
      api.functions.scheduling.events.listEvents,
      { token: memberToken, groupId: world.groupId },
    );
    expect(Array.isArray(events)).toBe(true);
  });

  it("getEvent rejects an authenticated outsider with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;

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

    await expect(
      t.query(api.functions.scheduling.events.getEvent, {
        token: outsiderToken,
        planId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("getEvent works for a group member", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId))
      .accessToken;

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

    const event = await t.query(api.functions.scheduling.events.getEvent, {
      token: memberToken,
      planId,
    });
    expect(event).not.toBeNull();
    expect(event!._id).toBe(planId);
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
      roles: [{ teamId: world.teamId, roleId: world.roleId, count: 2 }],
    });
    await t.mutation(api.functions.scheduling.assignments.assignRole, {
      token: leaderToken,
      planId,
      teamId: world.teamId,
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

  it("schedules a team-channel reconcile that drops synced members", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    // Event 2 days out — inside the rotation window, so the assignee is
    // auto-synced into the team channel.
    const eventDate = Date.now() + 2 * DAY;
    const { planId } = await t.mutation(
      api.functions.scheduling.events.createEvent,
      {
        token: leaderToken,
        groupId: world.groupId,
        title: "Soon",
        eventDate,
        times: [{ label: "9 AM", startsAt: eventDate }],
      },
    );
    await t.mutation(api.functions.scheduling.assignments.assignRole, {
      token: leaderToken,
      planId,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.groupLeaderId,
    });

    const activeSynced = async () => {
      const rows = await t.run(async (ctx) =>
        ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel_syncSource", (q) =>
            q.eq("channelId", world.channelId).eq("syncSource", "event_plan"),
          )
          .collect(),
      );
      return rows.filter(
        (m) => m.userId === world.groupLeaderId && m.leftAt === undefined,
      );
    };

    // Run the assignRole-triggered reconcile so the synced member exists.
    await t.mutation(
      internal.functions.scheduling.teamChannelSync.reconcileTeamChannel,
      { teamId: world.teamId },
    );
    expect(await activeSynced()).toHaveLength(1);

    // Delete the event. It should enqueue a reconcile for the channel.
    await t.mutation(api.functions.scheduling.events.deleteEvent, {
      token: leaderToken,
      planId,
    });
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(
      scheduled.some(
        (r) =>
          r.name.includes("teamChannelSync") &&
          r.name.includes("reconcileTeamChannel"),
      ),
    ).toBe(true);

    // Running that reconcile soft-removes the now-orphaned synced member.
    await t.mutation(
      internal.functions.scheduling.teamChannelSync.reconcileTeamChannel,
      { teamId: world.teamId },
    );
    expect(await activeSynced()).toHaveLength(0);
  });
});
