/**
 * Tests for serving-mode queries (serving.ts) — focused on the "Team" roster
 * grid (`getServingTeamRoster`): the who's-serving payload behind the pinned
 * Team card in the serving inbox. Verifies plan/team grouping, confirmed-only
 * filtering, the same-day eligibility window, per-person fields (name, role,
 * phone, isSelf), and de-duplication.
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

describe("getServingTeamRoster", () => {
  it("groups confirmed volunteers by plan then team, with name/role/phone/isSelf", async () => {
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
    // An UNCONFIRMED assignment must be excluded from the grid.
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
    // Only the confirmed camera op — the unconfirmed leader is excluded.
    expect(prod.people).toHaveLength(1);
    expect(prod.people[0].displayName).toBe("Adminda Test");
    expect(prod.people[0].roleName).toBe("Camera");
    expect(prod.people[0].roleColor).toBe("#7C3AED");
    expect(prod.people[0].isSelf).toBe(false);

    const wor = p.teams.find((tm) => tm.name === "Worship Team")!;
    expect(wor.people).toHaveLength(1);
    expect(wor.people[0].displayName).toBe("Memberly Test");
    expect(wor.people[0].roleName).toBe("Drums");
    expect(wor.people[0].phone).toBe("+12025550003");
    expect(wor.people[0].isSelf).toBe(true);
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

  it("returns no plans when the user has no confirmed assignments", async () => {
    const { t, world } = await setup();
    const meTok = (await generateTokens(world.channelMemberId)).accessToken;
    const today = Date.now();
    const plan = await insertPlan(t, world, "Service", today);
    // Only an unconfirmed assignment — not eligible.
    await insertAssignment(t, world, {
      planId: plan,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.channelMemberId,
      eventDate: today,
      status: "unconfirmed",
    });

    const res = await t.query(
      api.functions.scheduling.serving.getServingTeamRoster,
      { token: meTok },
    );
    expect(res.plans).toEqual([]);
  });
});
