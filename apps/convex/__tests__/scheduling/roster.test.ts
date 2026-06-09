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
