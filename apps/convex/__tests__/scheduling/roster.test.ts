/**
 * Tests for the rostering matrix (roster.ts) — the joined payload behind the
 * leader roster grid. Verifies role-centric cells (fill/open/occupants),
 * people-centric cells (availability + assignments), double-booking, the
 * per-event tallies, and the scheduler gate.
 */

import { describe, it, expect, afterEach } from "vitest";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { generateTokens } from "../../lib/auth";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { buildSchedulingWorld } from "./fixtures";

let activeHandle: ReturnType<typeof convexTest> | null = null;
afterEach(async () => {
  if (activeHandle) {
    await activeHandle.finishInProgressScheduledFunctions();
    activeHandle = null;
  }
});
async function setup() {
  const t = convexTest(schema, modules);
  activeHandle = t;
  const world = await buildSchedulingWorld(t);
  return { t, world };
}

const DAY = 86400000;

async function createPlan(
  t: ReturnType<typeof convexTest>,
  token: string,
  groupId: Id<"groups">,
  title: string,
  eventDate: number,
) {
  const { planId } = await t.mutation(
    api.functions.scheduling.events.createEvent,
    { token, groupId, title, eventDate, times: [{ label: "9 AM", startsAt: eventDate }] },
  );
  return planId as Id<"eventPlans">;
}

describe("rosterMatrix", () => {
  it("builds role + people cells, tallies, and double-booking", async () => {
    const { t, world } = await setup();
    const leader = (await generateTokens(world.groupLeaderId)).accessToken;
    const member = (await generateTokens(world.channelMemberId)).accessToken;
    const adminTok = (await generateTokens(world.channelAdminId)).accessToken;

    const sameDay = Date.now() + 7 * DAY;
    const planA = await createPlan(t, leader, world.groupId, "Service A", sameDay);
    const planB = await createPlan(t, leader, world.groupId, "Service B", sameDay);

    // Need 2 Drums on A, 1 on B.
    await t.mutation(api.functions.scheduling.events.setNeededRoles, {
      token: leader,
      planId: planA,
      roles: [{ teamId: world.teamId, roleId: world.roleId, count: 2 }],
    });
    await t.mutation(api.functions.scheduling.events.setNeededRoles, {
      token: leader,
      planId: planB,
      roles: [{ teamId: world.teamId, roleId: world.roleId, count: 1 }],
    });

    // channelMember serves Drums on BOTH same-day plans → double-booked.
    await t.mutation(api.functions.scheduling.assignments.assignRole, {
      token: leader,
      planId: planA,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.channelMemberId,
    });
    await t.mutation(api.functions.scheduling.assignments.assignRole, {
      token: leader,
      planId: planB,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.channelMemberId,
    });
    // channelAdmin marks available for A but isn't assigned.
    await t.mutation(api.functions.scheduling.availability.setMyAvailability, {
      token: adminTok,
      planId: planA,
      status: "available",
    });

    const m = await t.query(api.functions.scheduling.roster.rosterMatrix, {
      token: leader,
      groupId: world.groupId,
    });

    // Columns + role rows.
    expect(m.events.map((e) => e.title)).toEqual(["Service A", "Service B"]);
    expect(m.roles.some((r) => r.roleName === "Drums")).toBe(true);

    // Role-centric cell for Drums on A: needed 2, filled 1, one open.
    const cellA = m.roleCells[`${world.roleId}:${planA}`];
    expect(cellA.needed).toBe(2);
    expect(cellA.filled).toBe(1);
    expect(cellA.open).toBe(1);
    expect(cellA.occupants).toHaveLength(1);
    expect(cellA.occupants[0].userId).toBe(world.channelMemberId);

    // Event tally for A: 2 needed, 1 open slot, 1 available responder.
    expect(m.eventCounts[planA].neededTotal).toBe(2);
    expect(m.eventCounts[planA].openSlots).toBe(1);
    expect(m.eventCounts[planA].available).toBe(1);

    // People-centric: the member is assigned on both and flagged double-booked.
    const row = m.members.find((mm) => mm.userId === world.channelMemberId);
    expect(row?.cells[planA].assignments[0].roleName).toBe("Drums");
    expect(row?.cells[planA].doubleBooked).toBe(true);
    expect(row?.cells[planB].doubleBooked).toBe(true);
    expect(row?.load).toBe(2);

    // channelAdmin: available on A, no assignment.
    const adminRow = m.members.find((mm) => mm.userId === world.channelAdminId);
    expect(adminRow?.cells[planA].availability).toBe("available");
    expect(adminRow?.cells[planA].assignments).toHaveLength(0);
    expect(adminRow?.availableCount).toBe(1);
  });

  it("windows columns: upcoming by default, pastLimit leads with recent past", async () => {
    const { t, world } = await setup();
    const leader = (await generateTokens(world.groupLeaderId)).accessToken;

    // Two past plans (older + recent) and two upcoming plans.
    await createPlan(t, leader, world.groupId, "Past old", Date.now() - 21 * DAY);
    await createPlan(t, leader, world.groupId, "Past recent", Date.now() - 7 * DAY);
    await createPlan(t, leader, world.groupId, "Soon", Date.now() + 7 * DAY);
    await createPlan(t, leader, world.groupId, "Later", Date.now() + 21 * DAY);

    // Default: upcoming only, chronological.
    const def = await t.query(api.functions.scheduling.roster.rosterMatrix, {
      token: leader,
      groupId: world.groupId,
    });
    expect(def.events.map((e) => e.title)).toEqual(["Soon", "Later"]);

    // pastLimit 1: lead with the single most-recent past plan, then upcoming.
    const one = await t.query(api.functions.scheduling.roster.rosterMatrix, {
      token: leader,
      groupId: world.groupId,
      pastLimit: 1,
    });
    expect(one.events.map((e) => e.title)).toEqual(["Past recent", "Soon", "Later"]);

    // pastLimit beyond the available past plans includes them all (recent-first
    // order preserved chronologically), never duplicating or erroring.
    const many = await t.query(api.functions.scheduling.roster.rosterMatrix, {
      token: leader,
      groupId: world.groupId,
      pastLimit: 5,
    });
    expect(many.events.map((e) => e.title)).toEqual([
      "Past old",
      "Past recent",
      "Soon",
      "Later",
    ]);
  });

  it("pendingCount counts assignments orphaned by a removed needed role", async () => {
    const { t, world } = await setup();
    const leader = (await generateTokens(world.groupLeaderId)).accessToken;
    const eventDate = Date.now() + 7 * DAY;
    const plan = await createPlan(t, leader, world.groupId, "Service", eventDate);

    await t.mutation(api.functions.scheduling.events.setNeededRoles, {
      token: leader,
      planId: plan,
      roles: [{ teamId: world.teamId, roleId: world.roleId, count: 1 }],
    });
    await t.mutation(api.functions.scheduling.assignments.assignRole, {
      token: leader,
      planId: plan,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.channelMemberId,
    });

    // Baseline: one unconfirmed assignment, surfaced as a cell AND in pendingCount.
    let m = await t.query(api.functions.scheduling.roster.rosterMatrix, {
      token: leader,
      groupId: world.groupId,
    });
    expect(m.roleCells[`${world.roleId}:${plan}`]?.occupants).toHaveLength(1);
    expect(m.events.find((e) => e._id === plan)?.pendingCount).toBe(1);

    // Remove the needed role: deletes the neededRoles row but leaves the
    // assignment orphaned (no cell). `markPublished` still notifies that
    // volunteer (it counts by_plan), so pendingCount must stay 1 — otherwise
    // the grid's publish confirm dialog would undercount the fan-out.
    await t.mutation(api.functions.scheduling.events.setNeededRoles, {
      token: leader,
      planId: plan,
      roles: [],
    });

    m = await t.query(api.functions.scheduling.roster.rosterMatrix, {
      token: leader,
      groupId: world.groupId,
    });
    expect(m.roleCells[`${world.roleId}:${plan}`]).toBeUndefined();
    expect(m.events.find((e) => e._id === plan)?.pendingCount).toBe(1);
  });

  it("includes a brand-new team + role with no needed-roles or assignments", async () => {
    const { t, world } = await setup();
    const leader = (await generateTokens(world.groupLeaderId)).accessToken;

    // A plan exists, but the freshly-added team/role below are NEVER referenced
    // by any needed-role or assignment — exactly the inline "＋ Add team" /
    // "＋ Add role" case. They must still surface as empty assignable rows.
    const eventDate = Date.now() + 7 * DAY;
    const plan = await createPlan(t, leader, world.groupId, "Service", eventDate);

    const { emptyTeamId, emptyRoleId } = await t.run(async (ctx) => {
      const emptyTeamId = await ctx.db.insert("teams", {
        groupId: world.groupId,
        communityId: world.communityId,
        name: "Hospitality",
        isArchived: false,
        createdAt: Date.now(),
        createdById: world.groupLeaderId,
        updatedAt: Date.now(),
      });
      const emptyRoleId = await ctx.db.insert("teamRoles", {
        teamId: emptyTeamId,
        communityId: world.communityId,
        name: "Greeter",
        sortOrder: 0,
        defaultNeeded: 1,
        isArchived: false,
        createdAt: Date.now(),
        createdById: world.groupLeaderId,
      });
      return { emptyTeamId, emptyRoleId };
    });

    const m = await t.query(api.functions.scheduling.roster.rosterMatrix, {
      token: leader,
      groupId: world.groupId,
    });

    // The empty team + role appear as rows even with no needed-roles / assigns.
    expect(m.teams.some((tm) => tm.teamId === emptyTeamId)).toBe(true);
    const greeter = m.roles.find((r) => r.roleId === emptyRoleId);
    expect(greeter).toBeDefined();
    expect(greeter?.teamId).toBe(emptyTeamId);
    expect(greeter?.roleName).toBe("Greeter");

    // No roleCell (0 needed) and it contributes 0 to the plan's needed tally.
    expect(m.roleCells[`${emptyRoleId}:${plan}`]).toBeUndefined();
    expect(m.eventCounts[plan].neededTotal).toBe(0);
    expect(m.eventCounts[plan].openSlots).toBe(0);
  });

  it("rejects a non-scheduler", async () => {
    const { t, world } = await setup();
    const member = (await generateTokens(world.channelMemberId)).accessToken;
    await expect(
      t.query(api.functions.scheduling.roster.rosterMatrix, {
        token: member,
        groupId: world.groupId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("roster group filter", () => {
  /**
   * Add a second group in the world's community with the given members, and an
   * announcement group + an archived group the leader is also in — to prove the
   * filter list excludes those. Returns the "production" group's id and the
   * member it shares with the rostered group.
   */
  async function seedFilterGroups(
    t: ReturnType<typeof convexTest>,
    world: Awaited<ReturnType<typeof buildSchedulingWorld>>,
  ) {
    return t.run(async (ctx) => {
      const groupTypeId = await ctx.db.insert("groupTypes", {
        communityId: world.communityId,
        name: "Team",
        slug: "team",
        isActive: true,
        createdAt: Date.now(),
        displayOrder: 2,
      });
      const make = async (
        name: string,
        extra: Record<string, unknown> = {},
      ) =>
        ctx.db.insert("groups", {
          communityId: world.communityId,
          groupTypeId,
          name,
          isArchived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          ...extra,
        });

      const productionId = await make("Production");
      const announceId = await make("Announcements", {
        isAnnouncementGroup: true,
      });
      const archivedId = await make("Old Group", { isArchived: true });

      // The leader belongs to all three. channelMember also serves Production
      // (the overlap the filter should surface); channelAdmin does not.
      for (const groupId of [productionId, announceId, archivedId]) {
        await ctx.db.insert("groupMembers", {
          groupId,
          userId: world.groupLeaderId,
          role: "leader",
          joinedAt: Date.now(),
          notificationsEnabled: true,
        });
      }
      await ctx.db.insert("groupMembers", {
        groupId: productionId,
        userId: world.channelMemberId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });

      return { productionId, announceId, archivedId };
    });
  }

  it("lists the leader's other groups, excluding self/announcement/archived", async () => {
    const { t, world } = await setup();
    const leader = (await generateTokens(world.groupLeaderId)).accessToken;
    const { productionId } = await seedFilterGroups(t, world);

    const groups = await t.query(
      api.functions.scheduling.roster.rosterFilterGroups,
      { token: leader, groupId: world.groupId },
    );

    // Only the non-announcement, non-archived OTHER group is offered.
    expect(groups.map((g) => g.name)).toEqual(["Production"]);
    expect(groups[0].id).toBe(productionId);
  });

  it("rejects rosterFilterGroups for a non-scheduler", async () => {
    const { t, world } = await setup();
    const member = (await generateTokens(world.channelMemberId)).accessToken;
    await expect(
      t.query(api.functions.scheduling.roster.rosterFilterGroups, {
        token: member,
        groupId: world.groupId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("returns active member ids of a filter group the caller belongs to", async () => {
    const { t, world } = await setup();
    const leader = (await generateTokens(world.groupLeaderId)).accessToken;
    const { productionId } = await seedFilterGroups(t, world);

    const ids = await t.query(
      api.functions.scheduling.roster.rosterFilterMemberIds,
      { token: leader, groupId: productionId },
    );

    expect(new Set(ids)).toEqual(
      new Set([world.groupLeaderId, world.channelMemberId]),
    );
  });

  it("rejects rosterFilterMemberIds for a non-member of the filter group", async () => {
    const { t, world } = await setup();
    const { productionId } = await seedFilterGroups(t, world);
    // channelAdmin is in the rostered group but NOT in Production.
    const outsiderToProduction = (
      await generateTokens(world.channelAdminId)
    ).accessToken;
    await expect(
      t.query(api.functions.scheduling.roster.rosterFilterMemberIds, {
        token: outsiderToProduction,
        groupId: productionId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});
