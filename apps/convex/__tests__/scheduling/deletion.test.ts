/**
 * Tests for destructive team/role deletion (deletion.ts) — the roster-grid
 * right-click "Delete role" / "Delete team" flow.
 *
 * Verifies the cascade (archives the team/role; hard-deletes its `neededRoles`
 * + `roleAssignments` across plans), the notification fan-out (one scheduled
 * `notifyRoleRemovals` job per delete that touched staffed people, none when
 * nobody is staffed), and the scheduler auth gate.
 *
 * The `sendSMS` Twilio path is best-effort (try/catch) and self-bypasses for
 * test phones, so — like the publish/reminder tests — we assert the DB side
 * effects (cascade + the scheduled job + the action's `smsSent` count) rather
 * than mocking Twilio. The fixture phones are stubbed into
 * `OTP_TEST_PHONE_NUMBERS` so the drained action's sends "succeed".
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { generateTokens } from "../../lib/auth";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { buildSchedulingWorld } from "./fixtures";

let activeHandle: ReturnType<typeof convexTest> | null = null;
afterEach(async () => {
  if (activeHandle) {
    await activeHandle.finishInProgressScheduledFunctions();
    activeHandle = null;
  }
  vi.unstubAllEnvs();
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
): Promise<Id<"eventPlans">> {
  const { planId } = await t.mutation(
    api.functions.scheduling.events.createEvent,
    {
      token,
      groupId,
      title,
      eventDate,
      times: [{ label: "9 AM", startsAt: eventDate }],
    },
  );
  return planId as Id<"eventPlans">;
}

/** Count pending `notifyRoleRemovals` jobs in the scheduler queue. */
async function pendingNotifyJobs(
  t: ReturnType<typeof convexTest>,
): Promise<number> {
  return t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    return jobs.filter((j) =>
      String(j.name).includes("notifyRoleRemovals"),
    ).length;
  });
}

describe("deleteRole", () => {
  it("archives the role, removes its neededRoles + assignments, and schedules a notification", async () => {
    const { t, world } = await setup();
    // Stub the staffed member's phone so the drained SMS action succeeds.
    vi.stubEnv("OTP_TEST_PHONE_NUMBERS", "+12025550003");
    const leader = (await generateTokens(world.groupLeaderId)).accessToken;

    const planA = await createPlan(t, leader, world.groupId, "Service A", Date.now() + 7 * DAY);
    const planB = await createPlan(t, leader, world.groupId, "Service B", Date.now() + 14 * DAY);

    await t.mutation(api.functions.scheduling.events.setNeededRoles, {
      token: leader,
      planId: planA,
      roles: [{ teamId: world.teamId, roleId: world.roleId, count: 1 }],
    });
    await t.mutation(api.functions.scheduling.assignments.assignRole, {
      token: leader,
      planId: planA,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.channelMemberId,
    });

    const res = await t.mutation(api.functions.scheduling.deletion.deleteRole, {
      token: leader,
      roleId: world.roleId,
    });
    expect(res.notifiedCount).toBe(1);

    // Role archived (still exists, flagged).
    const role = await t.run((ctx) => ctx.db.get(world.roleId));
    expect(role?.isArchived).toBe(true);

    // neededRoles + roleAssignments for the role are gone across all plans.
    const counts = await t.run(async (ctx) => {
      const needed = await ctx.db
        .query("neededRoles")
        .filter((q) => q.eq(q.field("roleId"), world.roleId))
        .collect();
      const assigns = await ctx.db
        .query("roleAssignments")
        .withIndex("by_role", (q) => q.eq("roleId", world.roleId))
        .collect();
      return { needed: needed.length, assigns: assigns.length };
    });
    expect(counts).toEqual({ needed: 0, assigns: 0 });

    // A notify job was scheduled; draining it sends one text.
    expect(await pendingNotifyJobs(t)).toBe(1);
    void planB;
    await t.finishInProgressScheduledFunctions();

    // Role is excluded from the live roster after deletion.
    const m = await t.query(api.functions.scheduling.roster.rosterMatrix, {
      token: leader,
      groupId: world.groupId,
    });
    expect(m.roles.some((r) => r.roleId === world.roleId)).toBe(false);
  });

  it("only purges upcoming assignments + notifies for them; past ones are preserved", async () => {
    const { t, world } = await setup();
    vi.stubEnv("OTP_TEST_PHONE_NUMBERS", "+12025550003");
    const leader = (await generateTokens(world.groupLeaderId)).accessToken;

    // A past plan and an upcoming plan, both staffing the same role.
    const pastPlan = await createPlan(t, leader, world.groupId, "Past Service", Date.now() - 14 * DAY);
    const futurePlan = await createPlan(t, leader, world.groupId, "Future Service", Date.now() + 7 * DAY);

    for (const planId of [pastPlan, futurePlan]) {
      await t.mutation(api.functions.scheduling.events.setNeededRoles, {
        token: leader,
        planId,
        roles: [{ teamId: world.teamId, roleId: world.roleId, count: 1 }],
      });
    }
    // Assign the same member on both plans. A past-event assignment skips the
    // future-event guard, so seed the past row directly.
    await t.mutation(api.functions.scheduling.assignments.assignRole, {
      token: leader,
      planId: futurePlan,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.channelMemberId,
    });
    const pastAssignmentId = await t.run(async (ctx) => {
      const plan = await ctx.db.get(pastPlan);
      return ctx.db.insert("roleAssignments", {
        planId: pastPlan,
        teamId: world.teamId,
        roleId: world.roleId,
        userId: world.channelMemberId,
        eventDate: plan!.eventDate,
        status: "confirmed",
        assignedById: world.groupLeaderId,
        assignedAt: Date.now(),
      });
    });

    const res = await t.mutation(api.functions.scheduling.deletion.deleteRole, {
      token: leader,
      roleId: world.roleId,
    });
    // Only the upcoming assignment is notified.
    expect(res.notifiedCount).toBe(1);
    expect(await pendingNotifyJobs(t)).toBe(1);

    const survived = await t.run(async (ctx) => {
      const past = await ctx.db.get(pastAssignmentId);
      const pastNeeded = await ctx.db
        .query("neededRoles")
        .withIndex("by_plan", (q) => q.eq("planId", pastPlan))
        .collect();
      const futureNeeded = await ctx.db
        .query("neededRoles")
        .withIndex("by_plan", (q) => q.eq("planId", futurePlan))
        .collect();
      const futureAssigns = await ctx.db
        .query("roleAssignments")
        .withIndex("by_plan", (q) => q.eq("planId", futurePlan))
        .collect();
      return {
        pastExists: past !== null,
        pastNeeded: pastNeeded.length,
        futureNeeded: futureNeeded.length,
        futureAssigns: futureAssigns.length,
      };
    });
    // Past assignment + neededRole untouched; upcoming ones purged.
    expect(survived).toEqual({
      pastExists: true,
      pastNeeded: 1,
      futureNeeded: 0,
      futureAssigns: 0,
    });

    await t.finishInProgressScheduledFunctions();
  });

  it("sends no text when nobody is staffed", async () => {
    const { t, world } = await setup();
    const leader = (await generateTokens(world.groupLeaderId)).accessToken;
    const planA = await createPlan(t, leader, world.groupId, "Service A", Date.now() + 7 * DAY);
    await t.mutation(api.functions.scheduling.events.setNeededRoles, {
      token: leader,
      planId: planA,
      roles: [{ teamId: world.teamId, roleId: world.roleId, count: 1 }],
    });

    const res = await t.mutation(api.functions.scheduling.deletion.deleteRole, {
      token: leader,
      roleId: world.roleId,
    });
    expect(res.notifiedCount).toBe(0);
    expect(await pendingNotifyJobs(t)).toBe(0);
  });

  it("does not notify someone who already declined", async () => {
    const { t, world } = await setup();
    const leader = (await generateTokens(world.groupLeaderId)).accessToken;
    const member = (await generateTokens(world.channelMemberId)).accessToken;
    const planA = await createPlan(t, leader, world.groupId, "Service A", Date.now() + 7 * DAY);
    await t.mutation(api.functions.scheduling.events.setNeededRoles, {
      token: leader,
      planId: planA,
      roles: [{ teamId: world.teamId, roleId: world.roleId, count: 1 }],
    });
    const { assignmentId } = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      {
        token: leader,
        planId: planA,
        teamId: world.teamId,
        roleId: world.roleId,
        userId: world.channelMemberId,
      },
    );
    await t.mutation(api.functions.scheduling.assignments.respondToAssignment, {
      token: member,
      assignmentId,
      status: "declined",
    });

    const res = await t.mutation(api.functions.scheduling.deletion.deleteRole, {
      token: leader,
      roleId: world.roleId,
    });
    expect(res.notifiedCount).toBe(0);
    expect(await pendingNotifyJobs(t)).toBe(0);
  });

  it("rejects a non-scheduler", async () => {
    const { t, world } = await setup();
    const outsider = (await generateTokens(world.outsiderId)).accessToken;
    await expect(
      t.mutation(api.functions.scheduling.deletion.deleteRole, {
        token: outsider,
        roleId: world.roleId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("deleteTeam", () => {
  it("archives the team + channel and cascades to all its roles", async () => {
    const { t, world } = await setup();
    vi.stubEnv("OTP_TEST_PHONE_NUMBERS", "+12025550003");
    const leader = (await generateTokens(world.groupLeaderId)).accessToken;

    // Add a second role to the team to prove the cascade spans all roles.
    const { roleId: role2 } = await t.mutation(
      api.functions.scheduling.roles.createRole,
      { token: leader, teamId: world.teamId, name: "Bass" },
    );

    const planA = await createPlan(t, leader, world.groupId, "Service A", Date.now() + 7 * DAY);
    await t.mutation(api.functions.scheduling.events.setNeededRoles, {
      token: leader,
      planId: planA,
      roles: [
        { teamId: world.teamId, roleId: world.roleId, count: 1 },
        { teamId: world.teamId, roleId: role2 as Id<"teamRoles">, count: 1 },
      ],
    });
    await t.mutation(api.functions.scheduling.assignments.assignRole, {
      token: leader,
      planId: planA,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.channelMemberId,
    });
    await t.mutation(api.functions.scheduling.assignments.assignRole, {
      token: leader,
      planId: planA,
      teamId: world.teamId,
      roleId: role2 as Id<"teamRoles">,
      userId: world.channelMemberId,
    });

    const res = await t.mutation(api.functions.scheduling.deletion.deleteTeam, {
      token: leader,
      teamId: world.teamId,
    });
    // Two assignments removed (same user, two roles) → 2 notifications.
    expect(res.notifiedCount).toBe(2);

    const state = await t.run(async (ctx) => {
      const team = await ctx.db.get(world.teamId);
      const channel = team?.channelId ? await ctx.db.get(team.channelId) : null;
      const r1 = await ctx.db.get(world.roleId);
      const r2 = await ctx.db.get(role2 as Id<"teamRoles">);
      const needed = await ctx.db
        .query("neededRoles")
        .withIndex("by_plan_team", (q) =>
          q.eq("planId", planA).eq("teamId", world.teamId),
        )
        .collect();
      const assigns = await ctx.db
        .query("roleAssignments")
        .withIndex("by_plan", (q) => q.eq("planId", planA))
        .collect();
      return {
        teamArchived: team?.isArchived,
        channelArchived: channel?.isArchived,
        r1Archived: r1?.isArchived,
        r2Archived: r2?.isArchived,
        needed: needed.length,
        assigns: assigns.length,
      };
    });
    expect(state).toEqual({
      teamArchived: true,
      channelArchived: true,
      r1Archived: true,
      r2Archived: true,
      needed: 0,
      assigns: 0,
    });

    expect(await pendingNotifyJobs(t)).toBe(1);
    await t.finishInProgressScheduledFunctions();

    // Team gone from the roster.
    const m = await t.query(api.functions.scheduling.roster.rosterMatrix, {
      token: leader,
      groupId: world.groupId,
    });
    expect(m.teams.some((tm) => tm.teamId === world.teamId)).toBe(false);
  });

  it("rejects a non-scheduler", async () => {
    const { t, world } = await setup();
    const member = (await generateTokens(world.channelMemberId)).accessToken;
    await expect(
      t.mutation(api.functions.scheduling.deletion.deleteTeam, {
        token: member,
        teamId: world.teamId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});
