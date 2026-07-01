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
      teamId: world.teamId,
      segment: "after",
      title: "Tear down",
      howToType: "none",
    });
    const before1 = await t.mutation(api.functions.scheduling.eventTasks.createTask, {
      token: leaderToken,
      planId,
      teamId: world.teamId,
      roleId: world.roleId,
      segment: "before",
      title: "Set up drums",
      howToType: "text",
      howToText: "Assemble the kit",
    });
    const before2 = await t.mutation(api.functions.scheduling.eventTasks.createTask, {
      token: leaderToken,
      planId,
      teamId: world.teamId,
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
    // Role name is hydrated; team-level task has null roleName.
    const setUp = list.find((x) => x.title === "Set up drums")!;
    expect(setUp.roleName).toBe("Drums");
    expect(setUp.teamName).toBe("Worship Team");
    expect(list.find((x) => x.title === "Sound check")!.roleName).toBeNull();

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
        teamId: world.teamId,
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
        teamId: world.teamId,
        roleId: world.roleId,
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
        teamId: world.teamId,
        roleId: world.roleId,
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
        teamId: world.teamId,
        roleId: world.roleId,
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
        teamId: world.teamId,
        roleId: world.roleId,
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
        teamId: world.teamId,
        roleId: world.roleId,
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
      teamId: world.teamId,
      roleId: world.roleId,
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
        teamId: world.teamId,
        roleId: world.roleId,
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
      teamId: world.teamId,
      roleId: world.roleId,
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
        teamId: world.teamId,
        roleId: world.roleId,
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
