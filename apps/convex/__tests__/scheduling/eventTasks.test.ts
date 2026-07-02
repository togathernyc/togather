/**
 * Tests for the Event Tasks + Serving Mode backend (Agent A).
 *
 * Covers task CRUD + reorder, per-person completion toggle, the readiness
 * rollup math (including the "during" × times expansion and personal-task
 * exclusion), duplicateEvent copying tasks but not completions/personal tasks,
 * and getMyServingTasks merging assigned template + personal tasks.
 */

import { describe, it, expect, afterEach } from "vitest";
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
});

async function setupSchedulingWorld() {
  const t = convexTest(schema, modules);
  activeHandle = t;
  const world = await buildSchedulingWorld(t);
  return { t, world };
}

const DAY = 86400000;

/** Create a published-ish event with two service times and 3 Drums needed. */
async function createEvent(
  t: ReturnType<typeof convexTest>,
  world: Awaited<ReturnType<typeof buildSchedulingWorld>>,
  leaderToken: string,
) {
  const eventDate = Date.now() + 7 * DAY;
  const { planId } = await t.mutation(
    api.functions.scheduling.events.createEvent,
    {
      token: leaderToken,
      groupId: world.groupId,
      title: "Sunday",
      eventDate,
      times: [
        { label: "9 AM", startsAt: eventDate },
        { label: "11 AM", startsAt: eventDate + 2 * 60 * 60 * 1000 },
      ],
    },
  );
  await t.mutation(api.functions.scheduling.events.setNeededRoles, {
    token: leaderToken,
    planId,
    roles: [{ teamId: world.teamId, roleId: world.roleId, count: 3 }],
  });
  return { planId, eventDate };
}

/** Assign a user to the world's Drums role and confirm them. */
async function assignAndConfirm(
  t: ReturnType<typeof convexTest>,
  world: Awaited<ReturnType<typeof buildSchedulingWorld>>,
  leaderToken: string,
  planId: Id<"eventPlans">,
  userId: Id<"users">,
) {
  const { assignmentId } = await t.mutation(
    api.functions.scheduling.assignments.assignRole,
    {
      token: leaderToken,
      planId,
      teamId: world.teamId,
      roleId: world.roleId,
      userId,
    },
  );
  await t.mutation(api.functions.scheduling.assignments.respondToAssignment, {
    token: (await generateTokens(userId)).accessToken,
    assignmentId,
    status: "confirmed",
  });
  return assignmentId;
}

describe("eventTasks CRUD + reorder", () => {
  it("creates, lists ordered, and reorders tasks", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const { planId } = await createEvent(t, world, leaderToken);

    // Create in mixed segments to prove before < during < after ordering.
    const after = await t.mutation(api.functions.scheduling.eventTasks.createTask, {
      token: leaderToken,
      planId,
      teamIds: [world.teamId],
      segment: "after",
      title: "Tear down",
      howToType: "none",
    });
    const before1 = await t.mutation(api.functions.scheduling.eventTasks.createTask, {
      token: leaderToken,
      planId,
      teamIds: [world.teamId],
      roleIds: [world.roleId],
      segment: "before",
      title: "Set up drums",
      howToType: "text",
      howToText: "Assemble the kit",
    });
    const before2 = await t.mutation(api.functions.scheduling.eventTasks.createTask, {
      token: leaderToken,
      planId,
      teamIds: [world.teamId],
      segment: "before",
      title: "Sound check",
      howToType: "none",
    });

    const list = await t.query(api.functions.scheduling.eventTasks.listPlanTasks, {
      token: leaderToken,
      planId,
    });
    expect(list.map((x) => x.title)).toEqual([
      "Set up drums",
      "Sound check",
      "Tear down",
    ]);
    // Role names are hydrated; team-level task has an empty roleNames array.
    const setUp = list.find((x) => x.title === "Set up drums")!;
    expect(setUp.roleNames).toEqual(["Drums"]);
    expect(setUp.teamNames).toEqual(["Worship Team"]);
    expect(list.find((x) => x.title === "Sound check")!.roleNames).toEqual([]);

    // Reorder: put "Sound check" before "Set up drums".
    await t.mutation(api.functions.scheduling.eventTasks.reorderTasks, {
      token: leaderToken,
      planId,
      orderedIds: [before2.taskId, before1.taskId, after.taskId],
    });
    const reordered = await t.query(
      api.functions.scheduling.eventTasks.listPlanTasks,
      { token: leaderToken, planId },
    );
    expect(reordered.map((x) => x.title)).toEqual([
      "Sound check",
      "Set up drums",
      "Tear down",
    ]);
  });

  it("rejects task creation from a non-leader", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const { planId } = await createEvent(t, world, leaderToken);

    await expect(
      t.mutation(api.functions.scheduling.eventTasks.createTask, {
        token: memberToken,
        planId,
        teamIds: [world.teamId],
        segment: "before",
        title: "Nope",
        howToType: "none",
      }),
    ).rejects.toThrow();
  });

  it("deletes a task and its completions", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const { planId } = await createEvent(t, world, leaderToken);
    await assignAndConfirm(t, world, leaderToken, planId, world.channelMemberId);

    const { taskId } = await t.mutation(
      api.functions.scheduling.eventTasks.createTask,
      {
        token: leaderToken,
        planId,
        teamIds: [world.teamId],
        roleIds: [world.roleId],
        segment: "before",
        title: "Set up",
        howToType: "none",
      },
    );
    await t.mutation(api.functions.scheduling.eventTasks.toggleTaskCompletion, {
      token: memberToken,
      taskId,
      completed: true,
    });

    await t.mutation(api.functions.scheduling.eventTasks.deleteTask, {
      token: leaderToken,
      taskId,
    });

    const remaining = await t.run(async (ctx) =>
      ctx.db
        .query("eventTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .collect(),
    );
    expect(remaining).toHaveLength(0);
  });
});

describe("per-person completion toggle", () => {
  it("upserts and deletes a completion for the current user", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const { planId } = await createEvent(t, world, leaderToken);
    await assignAndConfirm(t, world, leaderToken, planId, world.channelMemberId);

    const { taskId } = await t.mutation(
      api.functions.scheduling.eventTasks.createTask,
      {
        token: leaderToken,
        planId,
        teamIds: [world.teamId],
        roleIds: [world.roleId],
        segment: "before",
        title: "Set up",
        howToType: "none",
      },
    );

    await t.mutation(api.functions.scheduling.eventTasks.toggleTaskCompletion, {
      token: memberToken,
      taskId,
      completed: true,
    });
    let rows = await t.run(async (ctx) =>
      ctx.db
        .query("eventTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .collect(),
    );
    expect(rows).toHaveLength(1);

    // Idempotent: toggling completed again does not add a second row.
    await t.mutation(api.functions.scheduling.eventTasks.toggleTaskCompletion, {
      token: memberToken,
      taskId,
      completed: true,
    });
    rows = await t.run(async (ctx) =>
      ctx.db
        .query("eventTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .collect(),
    );
    expect(rows).toHaveLength(1);

    // Un-complete removes it.
    await t.mutation(api.functions.scheduling.eventTasks.toggleTaskCompletion, {
      token: memberToken,
      taskId,
      completed: false,
    });
    rows = await t.run(async (ctx) =>
      ctx.db
        .query("eventTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .collect(),
    );
    expect(rows).toHaveLength(0);
  });

  it("keeps per-timeLabel completions distinct for during tasks", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const { planId } = await createEvent(t, world, leaderToken);
    await assignAndConfirm(t, world, leaderToken, planId, world.channelMemberId);

    const { taskId } = await t.mutation(
      api.functions.scheduling.eventTasks.createTask,
      {
        token: leaderToken,
        planId,
        teamIds: [world.teamId],
        roleIds: [world.roleId],
        segment: "during",
        title: "Play",
        howToType: "none",
      },
    );

    await t.mutation(api.functions.scheduling.eventTasks.toggleTaskCompletion, {
      token: memberToken,
      taskId,
      timeLabel: "9 AM",
      completed: true,
    });
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("eventTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].timeLabel).toBe("9 AM");
  });
});

describe("getPlanTaskReadiness rollup math", () => {
  it("expands during tasks by service times and excludes personal tasks", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const modToken = (await generateTokens(world.channelModeratorId)).accessToken;
    const { planId } = await createEvent(t, world, leaderToken);

    // Two confirmed assignees on the Drums role.
    await assignAndConfirm(t, world, leaderToken, planId, world.channelMemberId);
    await assignAndConfirm(
      t,
      world,
      leaderToken,
      planId,
      world.channelModeratorId,
    );

    // A "before" role task: expected = 2 confirmed people.
    const beforeTask = await t.mutation(
      api.functions.scheduling.eventTasks.createTask,
      {
        token: leaderToken,
        planId,
        teamIds: [world.teamId],
        roleIds: [world.roleId],
        segment: "before",
        title: "Set up",
        howToType: "none",
      },
    );
    // A "during" role task: expected = 2 people × 2 times = 4.
    const duringTask = await t.mutation(
      api.functions.scheduling.eventTasks.createTask,
      {
        token: leaderToken,
        planId,
        teamIds: [world.teamId],
        roleIds: [world.roleId],
        segment: "during",
        title: "Play",
        howToType: "none",
      },
    );

    // A personal task must NOT appear in the rollup.
    await t.mutation(api.functions.scheduling.eventTasks.addPersonalTask, {
      token: memberToken,
      planId,
      segment: "before",
      title: "Bring water",
    });

    let readiness = await t.query(
      api.functions.scheduling.eventTasks.getPlanTaskReadiness,
      { token: leaderToken, planId },
    );
    expect(readiness.overall.total).toBe(2 + 4); // before(2) + during(2*2)
    expect(readiness.overall.done).toBe(0);
    expect(readiness.bySegment.before.total).toBe(2);
    expect(readiness.bySegment.during.total).toBe(4);
    expect(readiness.byTeam).toHaveLength(1);
    expect(readiness.byTeam[0].total).toBe(6);

    // Member completes the before task and one during time.
    await t.mutation(api.functions.scheduling.eventTasks.toggleTaskCompletion, {
      token: memberToken,
      taskId: beforeTask.taskId,
      completed: true,
    });
    await t.mutation(api.functions.scheduling.eventTasks.toggleTaskCompletion, {
      token: memberToken,
      taskId: duringTask.taskId,
      timeLabel: "9 AM",
      completed: true,
    });
    // Moderator completes the before task too.
    await t.mutation(api.functions.scheduling.eventTasks.toggleTaskCompletion, {
      token: modToken,
      taskId: beforeTask.taskId,
      completed: true,
    });

    readiness = await t.query(
      api.functions.scheduling.eventTasks.getPlanTaskReadiness,
      { token: leaderToken, planId },
    );
    expect(readiness.bySegment.before.done).toBe(2);
    expect(readiness.bySegment.during.done).toBe(1);
    expect(readiness.overall.done).toBe(3);
    expect(readiness.overall.total).toBe(6);
  });
});

describe("getMyServingTasks merges assigned + personal", () => {
  it("returns assigned template tasks (during expanded) and personal tasks", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const { planId } = await createEvent(t, world, leaderToken);
    await assignAndConfirm(t, world, leaderToken, planId, world.channelMemberId);

    // A before role task and a during role task the member is confirmed for.
    await t.mutation(api.functions.scheduling.eventTasks.createTask, {
      token: leaderToken,
      planId,
      teamIds: [world.teamId],
      roleIds: [world.roleId],
      segment: "before",
      title: "Set up",
      howToType: "text",
      howToText: "kit",
    });
    const during = await t.mutation(
      api.functions.scheduling.eventTasks.createTask,
      {
        token: leaderToken,
        planId,
        teamIds: [world.teamId],
        roleIds: [world.roleId],
        segment: "during",
        title: "Play",
        howToType: "none",
      },
    );

    // Personal task for the member.
    await t.mutation(api.functions.scheduling.eventTasks.addPersonalTask, {
      token: memberToken,
      planId,
      segment: "after",
      title: "Pack up my sticks",
      note: "in the black bag",
    });

    // Complete one during time so completed resolves per timeLabel.
    await t.mutation(api.functions.scheduling.eventTasks.toggleTaskCompletion, {
      token: memberToken,
      taskId: during.taskId,
      timeLabel: "9 AM",
      completed: true,
    });

    const mine = await t.query(
      api.functions.scheduling.eventTasks.getMyServingTasks,
      { token: memberToken, planId },
    );

    expect(mine.before).toHaveLength(1);
    expect(mine.before[0].isPersonal).toBe(false);
    // During expands to one entry per service time (2).
    expect(mine.during).toHaveLength(2);
    const at9 = mine.during.find((x) => x.timeLabel === "9 AM")!;
    const at11 = mine.during.find((x) => x.timeLabel === "11 AM")!;
    expect(at9.completed).toBe(true);
    expect(at11.completed).toBe(false);
    // Personal task shows in "after".
    expect(mine.after).toHaveLength(1);
    expect(mine.after[0].isPersonal).toBe(true);
    expect(mine.after[0].note).toBe("in the black bag");
  });

  it("omits template tasks the user is not confirmed for", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const { planId } = await createEvent(t, world, leaderToken);
    // Member is NOT assigned/confirmed.

    await t.mutation(api.functions.scheduling.eventTasks.createTask, {
      token: leaderToken,
      planId,
      teamIds: [world.teamId],
      roleIds: [world.roleId],
      segment: "before",
      title: "Set up",
      howToType: "none",
    });

    const mine = await t.query(
      api.functions.scheduling.eventTasks.getMyServingTasks,
      { token: memberToken, planId },
    );
    expect(mine.before).toHaveLength(0);
  });
});

describe("personal task ownership", () => {
  it("blocks toggling another user's personal task", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const modToken = (await generateTokens(world.channelModeratorId)).accessToken;
    const { planId } = await createEvent(t, world, leaderToken);

    const { taskId } = await t.mutation(
      api.functions.scheduling.eventTasks.addPersonalTask,
      { token: memberToken, planId, segment: "before", title: "Mine" },
    );

    await expect(
      t.mutation(api.functions.scheduling.eventTasks.togglePersonalTask, {
        token: modToken,
        taskId,
        completed: true,
      }),
    ).rejects.toThrow();

    await t.mutation(api.functions.scheduling.eventTasks.togglePersonalTask, {
      token: memberToken,
      taskId,
      completed: true,
    });
    const row = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(row!.completedAt).toBeDefined();
  });
});

describe("duplicateEvent copies tasks but not completions/personal", () => {
  it("copies eventTasks to the new plan, excluding completions and personal tasks", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const { planId } = await createEvent(t, world, leaderToken);
    await assignAndConfirm(t, world, leaderToken, planId, world.channelMemberId);

    const { taskId } = await t.mutation(
      api.functions.scheduling.eventTasks.createTask,
      {
        token: leaderToken,
        planId,
        teamIds: [world.teamId],
        roleIds: [world.roleId],
        segment: "before",
        title: "Set up",
        howToType: "text",
        howToText: "kit",
      },
    );
    await t.mutation(api.functions.scheduling.eventTasks.toggleTaskCompletion, {
      token: memberToken,
      taskId,
      completed: true,
    });
    await t.mutation(api.functions.scheduling.eventTasks.addPersonalTask, {
      token: memberToken,
      planId,
      segment: "after",
      title: "Personal",
    });

    const { planId: newPlanId } = await t.mutation(
      api.functions.scheduling.events.duplicateEvent,
      { token: leaderToken, planId },
    );

    const copied = await t.run(async (ctx) =>
      ctx.db
        .query("eventTasks")
        .withIndex("by_plan", (q) => q.eq("planId", newPlanId))
        .collect(),
    );
    expect(copied).toHaveLength(1);
    expect(copied[0].title).toBe("Set up");
    expect(copied[0].howToText).toBe("kit");

    // No completions copied.
    const completions = await t.run(async (ctx) =>
      ctx.db
        .query("eventTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", copied[0]._id))
        .collect(),
    );
    expect(completions).toHaveLength(0);

    // No personal tasks copied.
    const personal = await t.run(async (ctx) =>
      ctx.db
        .query("personalServingTasks")
        .withIndex("by_plan_user", (q) =>
          q.eq("planId", newPlanId).eq("userId", world.channelMemberId),
        )
        .collect(),
    );
    expect(personal).toHaveLength(0);
  });
});

/**
 * Insert a second serving team (+ one role) in the world's group, so
 * multi-team / multi-role tasks can be exercised. Assignment only needs a valid
 * team/role pair in the group + an active group member, so no channel/needed
 * roles are required.
 */
async function addSecondTeam(
  t: ReturnType<typeof convexTest>,
  world: Awaited<ReturnType<typeof buildSchedulingWorld>>,
) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const teamId = await ctx.db.insert("teams", {
      groupId: world.groupId,
      communityId: world.communityId,
      name: "Hospitality",
      isArchived: false,
      createdAt: now,
      createdById: world.groupLeaderId,
      updatedAt: now,
    });
    const roleId = await ctx.db.insert("teamRoles", {
      teamId,
      communityId: world.communityId,
      name: "Greeter",
      sortOrder: 0,
      defaultNeeded: 1,
      isArchived: false,
      createdAt: now,
      createdById: world.groupLeaderId,
    });
    return { teamId, roleId };
  });
}

/** Assign a user to an arbitrary team/role on a plan and confirm them. */
async function assignConfirm(
  t: ReturnType<typeof convexTest>,
  leaderToken: string,
  planId: Id<"eventPlans">,
  teamId: Id<"teams">,
  roleId: Id<"teamRoles">,
  userId: Id<"users">,
) {
  const { assignmentId } = await t.mutation(
    api.functions.scheduling.assignments.assignRole,
    { token: leaderToken, planId, teamId, roleId, userId },
  );
  await t.mutation(api.functions.scheduling.assignments.respondToAssignment, {
    token: (await generateTokens(userId)).accessToken,
    assignmentId,
    status: "confirmed",
  });
}

describe("multi-team / multi-role event tasks", () => {
  it("shows a 2-role/2-team task in Mine for people in either role, per-person", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const modToken = (await generateTokens(world.channelModeratorId)).accessToken;
    const adminToken = (await generateTokens(world.channelAdminId)).accessToken;
    const { planId } = await createEvent(t, world, leaderToken);
    const team2 = await addSecondTeam(t, world);

    // Member confirmed for Drums (team1); Moderator confirmed for Greeter (team2).
    await assignConfirm(t, leaderToken, planId, world.teamId, world.roleId, world.channelMemberId);
    await assignConfirm(t, leaderToken, planId, team2.teamId, team2.roleId, world.channelModeratorId);

    const { taskId } = await t.mutation(
      api.functions.scheduling.eventTasks.createTask,
      {
        token: leaderToken,
        planId,
        teamIds: [world.teamId, team2.teamId],
        roleIds: [world.roleId, team2.roleId],
        segment: "before",
        title: "Grab your gear",
        howToType: "none",
      },
    );

    // Both confirmed people see it; the unassigned admin does not.
    const mineMember = await t.query(
      api.functions.scheduling.eventTasks.getMyServingTasks,
      { token: memberToken, planId },
    );
    const mineMod = await t.query(
      api.functions.scheduling.eventTasks.getMyServingTasks,
      { token: modToken, planId },
    );
    const mineAdmin = await t.query(
      api.functions.scheduling.eventTasks.getMyServingTasks,
      { token: adminToken, planId },
    );
    expect(mineMember.before.map((x) => x.title)).toContain("Grab your gear");
    expect(mineMod.before.map((x) => x.title)).toContain("Grab your gear");
    expect(mineAdmin.before).toHaveLength(0);

    // Per-person completion: each toggles independently.
    await t.mutation(api.functions.scheduling.eventTasks.toggleTaskCompletion, {
      token: memberToken,
      taskId,
      completed: true,
    });
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("eventTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(world.channelMemberId);

    // The moderator's Mine still shows it incomplete (per-person, not shared).
    const modAfter = await t.query(
      api.functions.scheduling.eventTasks.getMyServingTasks,
      { token: modToken, planId },
    );
    expect(modAfter.before.find((x) => x.title === "Grab your gear")!.completed).toBe(false);
  });

  it("treats a 2-team team-level task as ONE shared completion any teammate can toggle", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const modToken = (await generateTokens(world.channelModeratorId)).accessToken;
    const adminToken = (await generateTokens(world.channelAdminId)).accessToken;
    const { planId } = await createEvent(t, world, leaderToken);
    const team2 = await addSecondTeam(t, world);

    await assignConfirm(t, leaderToken, planId, world.teamId, world.roleId, world.channelMemberId);
    await assignConfirm(t, leaderToken, planId, team2.teamId, team2.roleId, world.channelModeratorId);

    // Team-level (no roles) task spanning BOTH teams.
    const { taskId } = await t.mutation(
      api.functions.scheduling.eventTasks.createTask,
      {
        token: leaderToken,
        planId,
        teamIds: [world.teamId, team2.teamId],
        roleIds: [],
        segment: "before",
        title: "Lock the doors",
        howToType: "none",
      },
    );

    // A member of EITHER team sees the single shared task.
    const sharedMember = await t.query(
      api.functions.scheduling.eventTasks.getSharedTeamTasks,
      { token: memberToken, planId },
    );
    const sharedMod = await t.query(
      api.functions.scheduling.eventTasks.getSharedTeamTasks,
      { token: modToken, planId },
    );
    expect(sharedMember).toHaveLength(1);
    expect(sharedMod).toHaveLength(1);
    expect([...sharedMember[0].teamIds].sort()).toEqual(
      [world.teamId as string, team2.teamId as string].sort(),
    );
    // It's excluded from Mine (team-level lives on the Shared surface).
    const mine = await t.query(
      api.functions.scheduling.eventTasks.getMyServingTasks,
      { token: memberToken, planId },
    );
    expect(mine.before).toHaveLength(0);

    // Member (team1) marks it done → exactly one shared row.
    await t.mutation(api.functions.scheduling.eventTasks.toggleSharedTeamTask, {
      token: memberToken,
      planId,
      taskId,
      completed: true,
    });
    let shared = await t.run(async (ctx) =>
      ctx.db
        .query("sharedTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .collect(),
    );
    expect(shared).toHaveLength(1);
    // Moderator (team2) now sees it as done — one shared state across teams.
    const sharedModDone = await t.query(
      api.functions.scheduling.eventTasks.getSharedTeamTasks,
      { token: modToken, planId },
    );
    expect(sharedModDone[0].completed).toBe(true);

    // Moderator (the OTHER team) can toggle the same shared checkbox off.
    await t.mutation(api.functions.scheduling.eventTasks.toggleSharedTeamTask, {
      token: modToken,
      planId,
      taskId,
      completed: false,
    });
    shared = await t.run(async (ctx) =>
      ctx.db
        .query("sharedTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .collect(),
    );
    expect(shared).toHaveLength(0);

    // Someone on neither team cannot toggle it.
    await expect(
      t.mutation(api.functions.scheduling.eventTasks.toggleSharedTeamTask, {
        token: adminToken,
        planId,
        taskId,
        completed: true,
      }),
    ).rejects.toThrow();
  });

  it("keeps readiness counts sane across multi-team role + team-level tasks", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const { planId } = await createEvent(t, world, leaderToken);
    const team2 = await addSecondTeam(t, world);

    await assignConfirm(t, leaderToken, planId, world.teamId, world.roleId, world.channelMemberId);
    await assignConfirm(t, leaderToken, planId, team2.teamId, team2.roleId, world.channelModeratorId);

    // A "before" role task across both roles/teams: 1 person per team → total 2.
    const roleTask = await t.mutation(
      api.functions.scheduling.eventTasks.createTask,
      {
        token: leaderToken,
        planId,
        teamIds: [world.teamId, team2.teamId],
        roleIds: [world.roleId, team2.roleId],
        segment: "before",
        title: "Setup",
        howToType: "none",
      },
    );
    // A team-level task across both teams: a single shared slot.
    await t.mutation(api.functions.scheduling.eventTasks.createTask, {
      token: leaderToken,
      planId,
      teamIds: [world.teamId, team2.teamId],
      roleIds: [],
      segment: "before",
      title: "Sweep",
      howToType: "none",
    });

    let readiness = await t.query(
      api.functions.scheduling.eventTasks.getPlanTaskReadiness,
      { token: leaderToken, planId },
    );
    // Role task (2) + team-level task (1) = 3 total slots overall.
    expect(readiness.overall.total).toBe(3);
    expect(readiness.overall.done).toBe(0);
    // Per-team: role task splits 1+1 by team; team-level credits 1 to EACH team.
    const t1 = readiness.byTeam.find((x) => x.teamId === (world.teamId as string))!;
    const t2 = readiness.byTeam.find((x) => x.teamId === (team2.teamId as string))!;
    expect(t1.total).toBe(2);
    expect(t2.total).toBe(2);

    // Member (team1) completes the role task → overall +1, team1 +1.
    await t.mutation(api.functions.scheduling.eventTasks.toggleTaskCompletion, {
      token: memberToken,
      taskId: roleTask.taskId,
      completed: true,
    });
    readiness = await t.query(
      api.functions.scheduling.eventTasks.getPlanTaskReadiness,
      { token: leaderToken, planId },
    );
    expect(readiness.overall.done).toBe(1);
    expect(
      readiness.byTeam.find((x) => x.teamId === (world.teamId as string))!.done,
    ).toBe(1);
    expect(
      readiness.byTeam.find((x) => x.teamId === (team2.teamId as string))!.done,
    ).toBe(0);
  });

  it("backfillTaskAssignmentArrays populates arrays from legacy columns", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const { planId } = await createEvent(t, world, leaderToken);

    // Insert a LEGACY-shaped task directly (single teamId/roleId, no arrays).
    const legacyRoleTaskId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("eventTasks", {
        planId,
        communityId: world.communityId,
        teamId: world.teamId,
        roleId: world.roleId,
        segment: "before",
        title: "Legacy role task",
        howToType: "none",
        sortOrder: 0,
        createdById: world.groupLeaderId,
        createdAt: now,
        updatedAt: now,
      });
    });
    const legacyTeamTaskId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("eventTasks", {
        planId,
        communityId: world.communityId,
        teamId: world.teamId,
        segment: "before",
        title: "Legacy team task",
        howToType: "none",
        sortOrder: 1,
        createdById: world.groupLeaderId,
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.mutation(
      internal.functions.scheduling.eventTasks.backfillTaskAssignmentArrays,
      {},
    );

    const role = await t.run(async (ctx) => ctx.db.get(legacyRoleTaskId));
    const team = await t.run(async (ctx) => ctx.db.get(legacyTeamTaskId));
    expect(role!.teamIds).toEqual([world.teamId]);
    expect(role!.roleIds).toEqual([world.roleId]);
    expect(team!.teamIds).toEqual([world.teamId]);
    expect(team!.roleIds).toEqual([]);
  });
});

describe("completion cleanup on convert / role-drop / delete", () => {
  it("does not resurrect a shared completion across a team-level → role → team-level round trip", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const { planId } = await createEvent(t, world, leaderToken);
    await assignAndConfirm(t, world, leaderToken, planId, world.channelMemberId);

    // Team-level task, marked done team-wide.
    const { taskId } = await t.mutation(
      api.functions.scheduling.eventTasks.createTask,
      {
        token: leaderToken,
        planId,
        teamIds: [world.teamId],
        roleIds: [],
        segment: "before",
        title: "Lock up",
        howToType: "none",
      },
    );
    await t.mutation(api.functions.scheduling.eventTasks.toggleSharedTeamTask, {
      token: memberToken,
      planId,
      taskId,
      completed: true,
    });
    const sharedCount = async () =>
      (
        await t.run(async (ctx) =>
          ctx.db
            .query("sharedTaskCompletions")
            .withIndex("by_task", (q) => q.eq("taskId", taskId))
            .collect(),
        )
      ).length;
    expect(await sharedCount()).toBe(1);

    // Convert to a role task → the stale shared completion is dropped.
    await t.mutation(api.functions.scheduling.eventTasks.updateTask, {
      token: leaderToken,
      taskId,
      roleIds: [world.roleId],
    });
    expect(await sharedCount()).toBe(0);

    // Convert BACK to team-level → must NOT be done again (no resurrection).
    await t.mutation(api.functions.scheduling.eventTasks.updateTask, {
      token: leaderToken,
      taskId,
      roleIds: [],
    });
    expect(await sharedCount()).toBe(0);
    const shared = await t.query(
      api.functions.scheduling.eventTasks.getSharedTeamTasks,
      { token: memberToken, planId },
    );
    expect(shared.find((s) => s.taskId === (taskId as string))!.completed).toBe(
      false,
    );
  });

  it("drops completions from users no longer covered when a role is removed", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const modToken = (await generateTokens(world.channelModeratorId)).accessToken;
    const { planId } = await createEvent(t, world, leaderToken);
    const team2 = await addSecondTeam(t, world);

    // Member confirmed for Drums (role1); Moderator confirmed for Greeter (role2).
    await assignConfirm(t, leaderToken, planId, world.teamId, world.roleId, world.channelMemberId);
    await assignConfirm(t, leaderToken, planId, team2.teamId, team2.roleId, world.channelModeratorId);

    const { taskId } = await t.mutation(
      api.functions.scheduling.eventTasks.createTask,
      {
        token: leaderToken,
        planId,
        teamIds: [world.teamId, team2.teamId],
        roleIds: [world.roleId, team2.roleId],
        segment: "before",
        title: "Prep",
        howToType: "none",
      },
    );

    // Both complete it (per-person).
    await t.mutation(api.functions.scheduling.eventTasks.toggleTaskCompletion, {
      token: memberToken,
      taskId,
      completed: true,
    });
    await t.mutation(api.functions.scheduling.eventTasks.toggleTaskCompletion, {
      token: modToken,
      taskId,
      completed: true,
    });
    let rows = await t.run(async (ctx) =>
      ctx.db
        .query("eventTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .collect(),
    );
    expect(rows).toHaveLength(2);

    // Remove role1 (Drums). The member was only in role1 → their completion is
    // dropped; the moderator (still in role2) keeps theirs.
    await t.mutation(api.functions.scheduling.eventTasks.updateTask, {
      token: leaderToken,
      taskId,
      roleIds: [team2.roleId],
    });
    rows = await t.run(async (ctx) =>
      ctx.db
        .query("eventTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(world.channelModeratorId);
  });

  it("cascades sharedTaskCompletions and howToDocChecks on plan deletion", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const { planId } = await createEvent(t, world, leaderToken);
    await assignAndConfirm(t, world, leaderToken, planId, world.channelMemberId);

    // Team-level task with a team-wide shared completion.
    const teamLevel = await t.mutation(
      api.functions.scheduling.eventTasks.createTask,
      {
        token: leaderToken,
        planId,
        teamIds: [world.teamId],
        roleIds: [],
        segment: "before",
        title: "Sweep",
        howToType: "none",
      },
    );
    await t.mutation(api.functions.scheduling.eventTasks.toggleSharedTeamTask, {
      token: memberToken,
      planId,
      taskId: teamLevel.taskId,
      completed: true,
    });

    // A role task with a per-user "doc" How-To check.
    const roleTask = await t.mutation(
      api.functions.scheduling.eventTasks.createTask,
      {
        token: leaderToken,
        planId,
        teamIds: [world.teamId],
        roleIds: [world.roleId],
        segment: "before",
        title: "Checklist",
        howToType: "doc",
        howToDoc: "- [ ] step one",
      },
    );
    await t.mutation(api.functions.scheduling.eventTasks.setHowToDocCheck, {
      token: memberToken,
      taskId: roleTask.taskId,
      itemKey: "step-one",
      checked: true,
    });

    // Sanity: the rows exist before deletion.
    const sharedBefore = await t.run(async (ctx) =>
      ctx.db
        .query("sharedTaskCompletions")
        .withIndex("by_plan", (q) => q.eq("planId", planId))
        .collect(),
    );
    expect(sharedBefore).toHaveLength(1);

    await t.mutation(api.functions.scheduling.events.deleteEvent, {
      token: leaderToken,
      planId,
    });

    const sharedAfter = await t.run(async (ctx) =>
      ctx.db
        .query("sharedTaskCompletions")
        .withIndex("by_plan", (q) => q.eq("planId", planId))
        .collect(),
    );
    const docChecksAfter = await t.run(async (ctx) =>
      ctx.db
        .query("howToDocChecks")
        .withIndex("by_task", (q) => q.eq("taskId", roleTask.taskId))
        .collect(),
    );
    expect(sharedAfter).toHaveLength(0);
    expect(docChecksAfter).toHaveLength(0);
  });
});

describe("serving eligibility", () => {
  it("marks an in-window confirmed plan eligible with resolved channels", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;

    // Event starting in 1 hour → inside the 2h auto-enter window.
    const eventDate = Date.now() + 60 * 60 * 1000;
    const { planId } = await t.mutation(
      api.functions.scheduling.events.createEvent,
      {
        token: leaderToken,
        groupId: world.groupId,
        title: "Now-ish",
        eventDate,
        times: [{ label: "Service", startsAt: eventDate }],
      },
    );
    await t.mutation(api.functions.scheduling.events.setNeededRoles, {
      token: leaderToken,
      planId,
      roles: [{ teamId: world.teamId, roleId: world.roleId, count: 1 }],
    });
    await assignAndConfirm(t, world, leaderToken, planId, world.channelMemberId);

    const result = await t.query(
      api.functions.scheduling.serving.getServingEligibility,
      { token: memberToken },
    );
    expect(result.eligible).toBe(true);
    expect(result.autoEnter).toBe(true);
    expect(result.activePlan).not.toBeNull();
    expect(result.activePlan!.planId).toBe(planId);
    expect(result.activePlan!.teamIds).toContain(world.teamId);
    // The team owns a channel, so it resolves as a team channel.
    expect(result.activePlan!.teamChannelIds).toContain(world.channelId);
  });

  it("is not eligible when the user has no confirmed active plan", async () => {
    const { t, world } = await setupSchedulingWorld();
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const result = await t.query(
      api.functions.scheduling.serving.getServingEligibility,
      { token: memberToken },
    );
    expect(result.eligible).toBe(false);
    expect(result.activePlan).toBeNull();
  });
});
