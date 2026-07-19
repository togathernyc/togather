/**
 * Tests for serving-mode queries (serving.ts) — the "Team" roster grid
 * (`getServingTeamRoster`) and serving eligibility (`getServingEligibility`).
 * Verifies plan/team grouping, the non-declined predicate (unconfirmed people
 * appear, badged; only declined are hidden), the same-day eligibility window,
 * per-person fields (name, role, phone, isSelf, status), de-duplication, and
 * that unconfirmed volunteers are eligible-to-enter but never auto-entered.
 */

import { describe, it, expect, afterEach } from "vitest";
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

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Insert a plan directly (avoids reminder scheduling); `startsAt` = eventDate. */
async function insertPlan(
  t: ReturnType<typeof convexTest>,
  world: Awaited<ReturnType<typeof setup>>["world"],
  title: string,
  eventDate: number,
) {
  return (await t.run(async (ctx: any) =>
    ctx.db.insert("eventPlans", {
      groupId: world.groupId,
      communityId: world.communityId,
      title,
      eventDate,
      times: [{ label: "9 AM", startsAt: eventDate }],
      status: "published",
      createdAt: Date.now(),
      createdById: world.groupLeaderId,
      updatedAt: Date.now(),
    }),
  )) as Id<"eventPlans">;
}

async function insertTeam(
  t: ReturnType<typeof convexTest>,
  world: Awaited<ReturnType<typeof setup>>["world"],
  name: string,
) {
  return (await t.run(async (ctx: any) =>
    ctx.db.insert("teams", {
      groupId: world.groupId,
      communityId: world.communityId,
      name,
      createdAt: Date.now(),
      createdById: world.groupLeaderId,
      updatedAt: Date.now(),
    }),
  )) as Id<"teams">;
}

async function insertRole(
  t: ReturnType<typeof convexTest>,
  world: Awaited<ReturnType<typeof setup>>["world"],
  teamId: Id<"teams">,
  name: string,
  color?: string,
) {
  return (await t.run(async (ctx: any) =>
    ctx.db.insert("teamRoles", {
      teamId,
      communityId: world.communityId,
      name,
      color,
      sortOrder: 0,
      createdAt: Date.now(),
      createdById: world.groupLeaderId,
    }),
  )) as Id<"teamRoles">;
}

async function insertAssignment(
  t: ReturnType<typeof convexTest>,
  world: Awaited<ReturnType<typeof setup>>["world"],
  args: {
    planId: Id<"eventPlans">;
    teamId: Id<"teams">;
    roleId: Id<"teamRoles">;
    userId: Id<"users">;
    eventDate: number;
    status: "confirmed" | "unconfirmed" | "declined";
  },
) {
  await t.run(async (ctx: any) =>
    ctx.db.insert("roleAssignments", {
      ...args,
      assignedById: world.groupLeaderId,
      assignedAt: Date.now(),
    }),
  );
}

/**
 * Insert a fresh user who was once in the group but has since left
 * (`groupMembers.leftAt` set) — the only membership row they hold.
 */
async function insertFormerGroupMember(
  t: ReturnType<typeof convexTest>,
  world: Awaited<ReturnType<typeof setup>>["world"],
) {
  return (await t.run(async (ctx: any) => {
    const userId = await ctx.db.insert("users", {
      firstName: "Former",
      lastName: "Member",
      phone: "+12025559999",
    });
    await ctx.db.insert("groupMembers", {
      groupId: world.groupId,
      userId,
      role: "member",
      joinedAt: Date.now(),
      leftAt: Date.now(),
      notificationsEnabled: true,
    });
    return userId;
  })) as Id<"users">;
}

describe("serving access after leaving the group", () => {
  it("excludes a former group member with a stale unconfirmed assignment", async () => {
    // `groupMembers.remove` soft-deletes (sets leftAt) but leaves the
    // roleAssignments row intact. A never-answered assignment stays
    // "unconfirmed", so widening serving to non-declined must NOT re-grant
    // serving access (and teammate phone numbers) to someone who left.
    const { t, world } = await setup();
    const formerId = await insertFormerGroupMember(t, world);
    const formerTok = (await generateTokens(formerId)).accessToken;
    const today = Date.now();
    const plan = await insertPlan(t, world, "Sunday Service", today);

    await insertAssignment(t, world, {
      planId: plan,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: formerId,
      eventDate: today,
      status: "unconfirmed",
    });

    const eligibility = await t.query(
      api.functions.scheduling.serving.getServingEligibility,
      { token: formerTok },
    );
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.plans).toEqual([]);

    const roster = await t.query(
      api.functions.scheduling.serving.getServingTeamRoster,
      { token: formerTok },
    );
    expect(roster.plans).toEqual([]);
  });
});

describe("getServingTeamRoster", () => {
  it("groups volunteers by plan then team, with name/role/phone/isSelf/status", async () => {
    const { t, world } = await setup();
    const meTok = (await generateTokens(world.channelMemberId)).accessToken;

    const today = Date.now();
    const plan = await insertPlan(t, world, "Sunday Service", today);

    // The fixture team is "Worship Team" with the "Drums" role. Add a second
    // team "Production" so the grid has two columns (sorts before "Worship Team").
    const worshipTeam = world.teamId; // "Worship Team"
    const drums = world.roleId; // "Drums"
    const production = await insertTeam(t, world, "Production");
    const camera = await insertRole(t, world, production, "Camera", "#7C3AED");

    // Me (the caller) on Worship Team; a teammate on Production; both confirmed.
    await insertAssignment(t, world, {
      planId: plan,
      teamId: worshipTeam,
      roleId: drums,
      userId: world.channelMemberId,
      eventDate: today,
      status: "confirmed",
    });
    await insertAssignment(t, world, {
      planId: plan,
      teamId: production,
      roleId: camera,
      userId: world.channelAdminId,
      eventDate: today,
      status: "confirmed",
    });
    // An UNCONFIRMED assignment is now INCLUDED, tagged status "unconfirmed".
    await insertAssignment(t, world, {
      planId: plan,
      teamId: production,
      roleId: camera,
      userId: world.groupLeaderId,
      eventDate: today,
      status: "unconfirmed",
    });

    const res = await t.query(
      api.functions.scheduling.serving.getServingTeamRoster,
      { token: meTok },
    );

    expect(res.plans).toHaveLength(1);
    const p = res.plans[0];
    expect(p.title).toBe("Sunday Service");
    // Teams sorted by name: Production, Worship Team.
    expect(p.teams.map((tm) => tm.name)).toEqual(["Production", "Worship Team"]);

    const prod = p.teams.find((tm) => tm.name === "Production")!;
    // Both the confirmed camera op AND the unconfirmed leader now appear.
    expect(prod.people).toHaveLength(2);
    const admin = prod.people.find((x) => x.displayName === "Adminda Test")!;
    expect(admin.roleName).toBe("Camera");
    expect(admin.roleColor).toBe("#7C3AED");
    expect(admin.isSelf).toBe(false);
    expect(admin.status).toBe("confirmed");
    // The unconfirmed leader is shown, carrying the "unconfirmed" signifier.
    const leader = prod.people.find((x) => x.status === "unconfirmed")!;
    expect(leader).toBeDefined();
    expect(leader.roleName).toBe("Camera");

    const wor = p.teams.find((tm) => tm.name === "Worship Team")!;
    expect(wor.people).toHaveLength(1);
    expect(wor.people[0].displayName).toBe("Memberly Test");
    expect(wor.people[0].roleName).toBe("Drums");
    expect(wor.people[0].phone).toBe("+12025550003");
    expect(wor.people[0].isSelf).toBe(true);
    expect(wor.people[0].status).toBe("confirmed");
  });

  it("shows the unconfirmed caller their own plan and excludes declined people", async () => {
    const { t, world } = await setup();
    const meTok = (await generateTokens(world.channelMemberId)).accessToken;
    const today = Date.now();
    const plan = await insertPlan(t, world, "Sunday Service", today);

    // Caller is only UNCONFIRMED — they still reach the roster (badged).
    await insertAssignment(t, world, {
      planId: plan,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.channelMemberId,
      eventDate: today,
      status: "unconfirmed",
    });
    // A DECLINED teammate on the same team must NOT appear.
    await insertAssignment(t, world, {
      planId: plan,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.channelAdminId,
      eventDate: today,
      status: "declined",
    });

    const res = await t.query(
      api.functions.scheduling.serving.getServingTeamRoster,
      { token: meTok },
    );

    expect(res.plans).toHaveLength(1);
    const team = res.plans[0].teams[0];
    expect(team.people).toHaveLength(1);
    expect(team.people[0].isSelf).toBe(true);
    expect(team.people[0].status).toBe("unconfirmed");
  });

  it("returns every eligible plan the user serves and excludes out-of-window plans", async () => {
    const { t, world } = await setup();
    const meTok = (await generateTokens(world.channelMemberId)).accessToken;

    const today = Date.now();
    const nextMonth = today + 30 * DAY;

    const planToday = await insertPlan(t, world, "Today Service", today);
    const planFar = await insertPlan(t, world, "Next Month", nextMonth);

    for (const [plan, when] of [
      [planToday, today],
      [planFar, nextMonth],
    ] as const) {
      await insertAssignment(t, world, {
        planId: plan,
        teamId: world.teamId,
        roleId: world.roleId,
        userId: world.channelMemberId,
        eventDate: when,
        status: "confirmed",
      });
    }

    const res = await t.query(
      api.functions.scheduling.serving.getServingTeamRoster,
      { token: meTok },
    );

    // Only the same-day plan is eligible; the next-month one is out of window.
    expect(res.plans.map((p) => p.title)).toEqual(["Today Service"]);
  });

  it("de-dupes identical (user, role, team) rows into a single card", async () => {
    const { t, world } = await setup();
    const meTok = (await generateTokens(world.channelMemberId)).accessToken;
    const today = Date.now();
    const plan = await insertPlan(t, world, "Service", today);

    for (let i = 0; i < 2; i++) {
      await insertAssignment(t, world, {
        planId: plan,
        teamId: world.teamId,
        roleId: world.roleId,
        userId: world.channelMemberId,
        eventDate: today,
        status: "confirmed",
      });
    }

    const res = await t.query(
      api.functions.scheduling.serving.getServingTeamRoster,
      { token: meTok },
    );
    const team = res.plans[0].teams[0];
    expect(team.people).toHaveLength(1);
  });

  it("returns no plans when the user's only assignment is declined", async () => {
    const { t, world } = await setup();
    const meTok = (await generateTokens(world.channelMemberId)).accessToken;
    const today = Date.now();
    const plan = await insertPlan(t, world, "Service", today);
    // A declined assignment doesn't count — the user isn't serving.
    await insertAssignment(t, world, {
      planId: plan,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.channelMemberId,
      eventDate: today,
      status: "declined",
    });

    const res = await t.query(
      api.functions.scheduling.serving.getServingTeamRoster,
      { token: meTok },
    );
    expect(res.plans).toEqual([]);
  });
});

describe("getServingUpcomingChannels", () => {
  it("resolves a coming-soon team channel for an unconfirmed volunteer", async () => {
    // Team-chat membership already mirrors non-declined volunteers into channels,
    // so an unconfirmed volunteer's "coming soon" channels resolve the same way.
    // The group leader is a group member but not yet a channel member, so the
    // team channel surfaces as upcoming.
    const { t, world } = await setup();
    const leaderTok = (await generateTokens(world.groupLeaderId)).accessToken;
    const today = Date.now();
    const plan = await insertPlan(t, world, "Sunday Service", today);
    await insertAssignment(t, world, {
      planId: plan,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.groupLeaderId,
      eventDate: today,
      status: "unconfirmed",
    });

    const res = await t.query(
      api.functions.scheduling.serving.getServingUpcomingChannels,
      { token: leaderTok, planIds: [plan] },
    );
    expect(res.map((c) => c.channelId)).toContain(world.channelId);
  });

  it("excludes a declined volunteer's channels", async () => {
    const { t, world } = await setup();
    const leaderTok = (await generateTokens(world.groupLeaderId)).accessToken;
    const today = Date.now();
    const plan = await insertPlan(t, world, "Sunday Service", today);
    await insertAssignment(t, world, {
      planId: plan,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.groupLeaderId,
      eventDate: today,
      status: "declined",
    });

    const res = await t.query(
      api.functions.scheduling.serving.getServingUpcomingChannels,
      { token: leaderTok, planIds: [plan] },
    );
    expect(res).toEqual([]);
  });
});

describe("getServingEligibility", () => {
  it("makes a confirmed volunteer eligible AND auto-entered on the day", async () => {
    const { t, world } = await setup();
    const meTok = (await generateTokens(world.channelMemberId)).accessToken;
    const today = Date.now();
    const plan = await insertPlan(t, world, "Service", today);
    await insertAssignment(t, world, {
      planId: plan,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.channelMemberId,
      eventDate: today,
      status: "confirmed",
    });

    const res = await t.query(
      api.functions.scheduling.serving.getServingEligibility,
      { token: meTok },
    );
    expect(res.eligible).toBe(true);
    expect(res.autoEnter).toBe(true);
    expect(res.plans).toHaveLength(1);
  });

  it("makes an unconfirmed volunteer eligible but NOT auto-entered", async () => {
    const { t, world } = await setup();
    const meTok = (await generateTokens(world.channelMemberId)).accessToken;
    const today = Date.now();
    const plan = await insertPlan(t, world, "Service", today);
    await insertAssignment(t, world, {
      planId: plan,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.channelMemberId,
      eventDate: today,
      status: "unconfirmed",
    });

    const res = await t.query(
      api.functions.scheduling.serving.getServingEligibility,
      { token: meTok },
    );
    // Eligible to enter (the chip lights up) but never auto-forced in before
    // they accept.
    expect(res.eligible).toBe(true);
    expect(res.autoEnter).toBe(false);
    expect(res.plans).toHaveLength(1);
  });

  it("auto-enters a confirmed volunteer even with an unconfirmed assignment on another same-day plan", async () => {
    // Regression: the global autoEnter must count only *auto-eligible*
    // (confirmed, in-window) plans, not every non-declined plan. A volunteer
    // confirmed on plan A who also holds an unrelated unconfirmed assignment on
    // same-day plan B must still be auto-entered into A (spec: confirmed
    // auto-entry is unchanged).
    const { t, world } = await setup();
    const meTok = (await generateTokens(world.channelMemberId)).accessToken;
    const today = Date.now();
    const planA = await insertPlan(t, world, "Confirmed Service", today);
    const planB = await insertPlan(t, world, "Unconfirmed Service", today);
    await insertAssignment(t, world, {
      planId: planA,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.channelMemberId,
      eventDate: today,
      status: "confirmed",
    });
    await insertAssignment(t, world, {
      planId: planB,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.channelMemberId,
      eventDate: today,
      status: "unconfirmed",
    });

    const res = await t.query(
      api.functions.scheduling.serving.getServingEligibility,
      { token: meTok },
    );
    // Both plans are eligible, but only the confirmed one is auto-eligible, so
    // auto-entry still fires (unambiguous single auto-eligible plan).
    expect(res.eligible).toBe(true);
    expect(res.plans).toHaveLength(2);
    expect(res.autoEnter).toBe(true);
  });

  it("does not auto-enter when two same-day plans are both confirmed (ambiguous)", async () => {
    // Two auto-eligible plans → the choice is ambiguous → no auto-entry (the
    // client offers a manual chip). Pins that the fix didn't loosen this.
    const { t, world } = await setup();
    const meTok = (await generateTokens(world.channelMemberId)).accessToken;
    const today = Date.now();
    const planA = await insertPlan(t, world, "Service A", today);
    const planB = await insertPlan(t, world, "Service B", today);
    for (const plan of [planA, planB]) {
      await insertAssignment(t, world, {
        planId: plan,
        teamId: world.teamId,
        roleId: world.roleId,
        userId: world.channelMemberId,
        eventDate: today,
        status: "confirmed",
      });
    }

    const res = await t.query(
      api.functions.scheduling.serving.getServingEligibility,
      { token: meTok },
    );
    expect(res.eligible).toBe(true);
    expect(res.plans).toHaveLength(2);
    expect(res.autoEnter).toBe(false);
  });

  it("does not make a declined volunteer eligible", async () => {
    const { t, world } = await setup();
    const meTok = (await generateTokens(world.channelMemberId)).accessToken;
    const today = Date.now();
    const plan = await insertPlan(t, world, "Service", today);
    await insertAssignment(t, world, {
      planId: plan,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.channelMemberId,
      eventDate: today,
      status: "declined",
    });

    const res = await t.query(
      api.functions.scheduling.serving.getServingEligibility,
      { token: meTok },
    );
    expect(res.eligible).toBe(false);
    expect(res.autoEnter).toBe(false);
    expect(res.plans).toEqual([]);
  });
});
