/**
 * Scheduling — Event Tasks + personal serving tasks
 *
 * Event tasks (`eventTasks`) are the shared, leader-authored checklist for a
 * plan: a team (or a specific role on that team) needs to do X "before" /
 * "during" / "after" the event. Completion is per-serving-person
 * (`eventTaskCompletions`); "during" tasks are completed once per service time.
 *
 * Personal serving tasks (`personalServingTasks`) are ad-hoc, single-user rows
 * a volunteer adds for themselves in serving mode. They never touch the shared
 * template, are excluded from readiness rollups, and are not copied on
 * duplication.
 *
 * Auth note: this module is part of the token-based Convex auth scheme used
 * across the backend (there is no ambient `ctx.auth` identity — see
 * `lib/auth.ts`), so every function takes a JWT `token` and resolves the
 * current user via `requireAuth`.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { requireGroupMember, requirePlanScheduler } from "./permissions";

/** When a task happens relative to the event's service times. */
const segmentValidator = v.union(
  v.literal("before"),
  v.literal("during"),
  v.literal("after"),
);

/** The kind of "how to" guidance attached to a task. */
const howToTypeValidator = v.union(
  v.literal("none"),
  v.literal("text"),
  v.literal("link"),
  v.literal("media"),
  v.literal("doc"),
);

/** before < during < after ordering rank for a task/segment. */
const SEGMENT_RANK: Record<string, number> = { before: 0, during: 1, after: 2 };

/**
 * Load a plan or throw. Shared by task functions that key off a `planId`.
 */
async function requirePlan(
  ctx: QueryCtx | MutationCtx,
  planId: Id<"eventPlans">,
): Promise<Doc<"eventPlans">> {
  const plan = await ctx.db.get(planId);
  if (!plan) {
    throw new ConvexError("Event not found");
  }
  return plan;
}

/**
 * Confirmed assignees of a role (or, for a team-level task with no role, of the
 * whole team) on a plan. Used both for readiness "expected completions" and to
 * decide whether the current user is on the hook for a template task.
 */
function assigneesForTask(
  assignments: Doc<"roleAssignments">[],
  task: Pick<Doc<"eventTasks">, "teamId" | "roleId">,
): Doc<"roleAssignments">[] {
  return assignments.filter((a) => {
    if (a.status !== "confirmed") return false;
    if (task.roleId) return a.roleId === task.roleId;
    // Team-level task (no roleId): any confirmed role on that team.
    return a.teamId === task.teamId;
  });
}

/**
 * List all tasks for a plan, ordered by (segment, then sortOrder), each
 * enriched with its `teamName` and `roleName` (null for team-level tasks).
 *
 * Auth: an active member of the plan's community.
 */
export const listPlanTasks = query({
  args: { token: v.string(), planId: v.id("eventPlans") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const plan = await requirePlan(ctx, args.planId);
    // Community membership is the read gate — everyone serving on the plan can
    // see the shared checklist. Group membership implies community membership.
    await requireGroupMember(ctx, plan.groupId, userId);

    const tasks = await ctx.db
      .query("eventTasks")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .collect();

    tasks.sort(
      (a, b) =>
        (SEGMENT_RANK[a.segment] ?? 1) - (SEGMENT_RANK[b.segment] ?? 1) ||
        a.sortOrder - b.sortOrder,
    );

    const teamNames = new Map<string, string>();
    const roleNames = new Map<string, string>();
    return Promise.all(
      tasks.map(async (task) => {
        if (!teamNames.has(task.teamId)) {
          const team = await ctx.db.get(task.teamId);
          teamNames.set(task.teamId, team?.name ?? "Team");
        }
        let roleName: string | null = null;
        if (task.roleId) {
          if (!roleNames.has(task.roleId)) {
            const role = await ctx.db.get(task.roleId);
            roleNames.set(task.roleId, role?.name ?? "Role");
          }
          roleName = roleNames.get(task.roleId)!;
        }
        return {
          _id: task._id,
          planId: task.planId,
          teamId: task.teamId,
          roleId: task.roleId ?? null,
          teamName: teamNames.get(task.teamId)!,
          roleName,
          segment: task.segment,
          title: task.title,
          howToType: task.howToType,
          howToText: task.howToText,
          howToUrl: task.howToUrl,
          howToMediaPath: task.howToMediaPath,
          howToDoc: task.howToDoc,
          sortOrder: task.sortOrder,
        };
      }),
    );
  },
});

/**
 * Next append `sortOrder` within a (plan, team, segment) bucket.
 */
async function nextTaskSortOrder(
  ctx: MutationCtx,
  planId: Id<"eventPlans">,
  teamId: Id<"teams">,
  segment: "before" | "during" | "after",
): Promise<number> {
  const siblings = await ctx.db
    .query("eventTasks")
    .withIndex("by_plan_team", (q) =>
      q.eq("planId", planId).eq("teamId", teamId),
    )
    .collect();
  const inSegment = siblings.filter((t) => t.segment === segment);
  if (inSegment.length === 0) return 0;
  return Math.max(...inSegment.map((t) => t.sortOrder)) + 1;
}

/**
 * Create a task on a plan.
 *
 * Auth: group leader / community admin for the plan's group.
 */
export const createTask = mutation({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
    teamId: v.id("teams"),
    roleId: v.optional(v.id("teamRoles")),
    segment: segmentValidator,
    title: v.string(),
    howToType: howToTypeValidator,
    howToText: v.optional(v.string()),
    howToUrl: v.optional(v.string()),
    howToMediaPath: v.optional(v.string()),
    howToDoc: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const { plan } = await requirePlanScheduler(ctx, args.planId, userId);

    const team = await ctx.db.get(args.teamId);
    if (!team || team.groupId !== plan.groupId) {
      throw new ConvexError("Team does not belong to this event's group");
    }
    if (args.roleId) {
      const role = await ctx.db.get(args.roleId);
      if (!role || role.teamId !== args.teamId) {
        throw new ConvexError("Role does not belong to the specified team");
      }
    }

    const title = args.title.trim();
    if (!title) {
      throw new ConvexError("Task title cannot be empty");
    }

    const nowMs = Date.now();
    const sortOrder = await nextTaskSortOrder(
      ctx,
      args.planId,
      args.teamId,
      args.segment,
    );

    const taskId = await ctx.db.insert("eventTasks", {
      planId: args.planId,
      communityId: plan.communityId,
      teamId: args.teamId,
      roleId: args.roleId,
      segment: args.segment,
      title,
      howToType: args.howToType,
      howToText: args.howToText,
      howToUrl: args.howToUrl,
      howToMediaPath: args.howToMediaPath,
      howToDoc: args.howToDoc,
      sortOrder,
      createdById: userId,
      createdAt: nowMs,
      updatedAt: nowMs,
    });

    return { taskId };
  },
});

/**
 * Update a task's editable fields. Only provided fields change.
 *
 * Auth: group leader / community admin for the plan's group.
 */
export const updateTask = mutation({
  args: {
    token: v.string(),
    taskId: v.id("eventTasks"),
    title: v.optional(v.string()),
    roleId: v.optional(v.id("teamRoles")),
    segment: v.optional(segmentValidator),
    // Set true to convert a role-scoped task back to a team-level task. Needed
    // because an omitted `roleId` and a "clear the role" intent both look like
    // `undefined` on the wire.
    clearRole: v.optional(v.boolean()),
    howToType: v.optional(howToTypeValidator),
    howToText: v.optional(v.string()),
    howToUrl: v.optional(v.string()),
    howToMediaPath: v.optional(v.string()),
    howToDoc: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new ConvexError("Task not found");
    }
    await requirePlanScheduler(ctx, task.planId, userId);

    if (args.roleId !== undefined) {
      const role = await ctx.db.get(args.roleId);
      if (!role || role.teamId !== task.teamId) {
        throw new ConvexError("Role does not belong to the task's team");
      }
    }

    const patch: Partial<Doc<"eventTasks">> = { updatedAt: Date.now() };
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) {
        throw new ConvexError("Task title cannot be empty");
      }
      patch.title = title;
    }
    if (args.clearRole) patch.roleId = undefined;
    else if (args.roleId !== undefined) patch.roleId = args.roleId;
    if (args.segment !== undefined) patch.segment = args.segment;
    if (args.howToType !== undefined) patch.howToType = args.howToType;
    if (args.howToText !== undefined) patch.howToText = args.howToText;
    if (args.howToUrl !== undefined) patch.howToUrl = args.howToUrl;
    if (args.howToMediaPath !== undefined)
      patch.howToMediaPath = args.howToMediaPath;
    if (args.howToDoc !== undefined) patch.howToDoc = args.howToDoc;

    await ctx.db.patch(args.taskId, patch);
    return { taskId: args.taskId };
  },
});

/**
 * Delete a single task and its completion records.
 *
 * Auth: group leader / community admin for the plan's group.
 */
export const deleteTask = mutation({
  args: { token: v.string(), taskId: v.id("eventTasks") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new ConvexError("Task not found");
    }
    await requirePlanScheduler(ctx, task.planId, userId);

    const completions = await ctx.db
      .query("eventTaskCompletions")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .collect();
    await Promise.all(completions.map((c) => ctx.db.delete(c._id)));
    await ctx.db.delete(args.taskId);

    return { deletedCompletions: completions.length };
  },
});

/**
 * Reorder a plan's tasks by index over `orderedIds`. Ids that don't belong to
 * the plan are ignored so a stale client list can't rewrite foreign rows.
 *
 * Auth: group leader / community admin for the plan's group.
 */
export const reorderTasks = mutation({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
    orderedIds: v.array(v.id("eventTasks")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requirePlanScheduler(ctx, args.planId, userId);

    const nowMs = Date.now();
    let index = 0;
    for (const taskId of args.orderedIds) {
      const task = await ctx.db.get(taskId);
      if (!task || task.planId !== args.planId) continue;
      await ctx.db.patch(taskId, { sortOrder: index, updatedAt: nowMs });
      index += 1;
    }
    return { reordered: index };
  },
});

/**
 * Toggle the current user's completion of a task. `timeLabel` is meaningful
 * only for "during" tasks (one completion per service time).
 *
 * Auth: any authenticated user (completion is personal). We still verify the
 * caller can see the plan.
 */
export const toggleTaskCompletion = mutation({
  args: {
    token: v.string(),
    taskId: v.id("eventTasks"),
    timeLabel: v.optional(v.string()),
    completed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new ConvexError("Task not found");
    }
    const plan = await requirePlan(ctx, task.planId);
    await requireGroupMember(ctx, plan.groupId, userId);

    // timeLabel is only meaningful for "during" tasks; ignore it otherwise so
    // "before"/"after" completions are keyed purely on (task, user).
    const timeLabel = task.segment === "during" ? args.timeLabel : undefined;

    const existingRows = await ctx.db
      .query("eventTaskCompletions")
      .withIndex("by_task_user", (q) =>
        q.eq("taskId", args.taskId).eq("userId", userId),
      )
      .collect();
    const match = existingRows.find((r) => r.timeLabel === timeLabel);

    if (args.completed) {
      if (!match) {
        await ctx.db.insert("eventTaskCompletions", {
          taskId: args.taskId,
          planId: task.planId,
          communityId: task.communityId,
          userId,
          timeLabel,
          completedAt: Date.now(),
        });
      }
    } else if (match) {
      await ctx.db.delete(match._id);
    }

    return { taskId: args.taskId, completed: args.completed };
  },
});

/**
 * Aggregate readiness for a plan: overall done/total, per-segment, and
 * per-team. "Expected completions" for a task is the number of confirmed
 * assignees of its role (team-level tasks => confirmed assignees of the team).
 * A "during" task multiplies that expectation by the number of service times.
 * Personal serving tasks are excluded entirely.
 *
 * Auth: an active member of the plan's community.
 */
export const getPlanTaskReadiness = query({
  args: { token: v.string(), planId: v.id("eventPlans") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const plan = await requirePlan(ctx, args.planId);
    await requireGroupMember(ctx, plan.groupId, userId);

    const [tasks, assignments] = await Promise.all([
      ctx.db
        .query("eventTasks")
        .withIndex("by_plan", (q) => q.eq("planId", args.planId))
        .collect(),
      ctx.db
        .query("roleAssignments")
        .withIndex("by_plan", (q) => q.eq("planId", args.planId))
        .collect(),
    ]);

    const timesCount = Math.max(1, plan.times.length);
    const validTimeLabels = new Set(plan.times.map((t) => t.label));

    const overall = { done: 0, total: 0 };
    const bySegment = {
      before: { done: 0, total: 0 },
      during: { done: 0, total: 0 },
      after: { done: 0, total: 0 },
    };
    const byTeam = new Map<
      string,
      { teamId: string; teamName: string; done: number; total: number }
    >();

    for (const task of tasks) {
      const expected = assigneesForTask(assignments, task);
      // Distinct users: a volunteer confirmed for two roles on the same team is
      // one expected completer for a team-level task, not two (and
      // getMyServingTasks shows it to them once), so dedupe before counting.
      const expectedUserIds = new Set(expected.map((a) => a.userId as string));
      const expectedPeople = expectedUserIds.size;
      const total =
        task.segment === "during"
          ? expectedPeople * timesCount
          : expectedPeople;

      // Count only completions from people who are currently expected to do
      // this task (a since-removed assignee, or anyone calling the mutation
      // directly, must not push readiness forward), and — for "during" tasks —
      // only completions tagged with a real service time. Capped at total as a
      // final guard against duplicate rows.
      const completions = await ctx.db
        .query("eventTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", task._id))
        .collect();
      const validCompletions = completions.filter((c) => {
        if (!expectedUserIds.has(c.userId as string)) return false;
        if (task.segment === "during") {
          // No configured times => a single unlabeled slot (mirrors
          // getMyServingTasks), so accept the null-label completion.
          if (plan.times.length === 0) return c.timeLabel == null;
          return c.timeLabel != null && validTimeLabels.has(c.timeLabel);
        }
        return true;
      });
      const done = Math.min(validCompletions.length, total);

      overall.total += total;
      overall.done += done;
      bySegment[task.segment].total += total;
      bySegment[task.segment].done += done;

      const teamKey = task.teamId as string;
      let teamEntry = byTeam.get(teamKey);
      if (!teamEntry) {
        const team = await ctx.db.get(task.teamId);
        teamEntry = {
          teamId: teamKey,
          teamName: team?.name ?? "Team",
          done: 0,
          total: 0,
        };
        byTeam.set(teamKey, teamEntry);
      }
      teamEntry.total += total;
      teamEntry.done += done;
    }

    return {
      overall,
      bySegment,
      byTeam: Array.from(byTeam.values()),
    };
  },
});

/** A serving-task item as returned to the current user, per segment. */
type ServingTaskItem = {
  /** Unique per row — a "during" template task expands to one row per time. */
  key: string;
  /** The real eventTasks / personalServingTasks id, for completion mutations. */
  taskId: string;
  title: string;
  segment: "before" | "during" | "after";
  isPersonal: boolean;
  howToType?: string;
  howToText?: string;
  howToUrl?: string;
  howToMediaPath?: string;
  howToDoc?: string;
  note?: string;
  timeLabel?: string;
  completed: boolean;
};

/**
 * The current user's serving tasks for a plan, grouped by segment. Merges:
 *   (a) template tasks (`eventTasks`) whose role the user is confirmed for on
 *       this plan (team-level tasks => any confirmed role on that team), and
 *   (b) the user's personal serving tasks (`personalServingTasks`).
 *
 * "during" template tasks expand to one entry per service time (timeLabel set),
 * with `completed` resolved per (task, user, timeLabel). Personal "during"
 * tasks keep their own timeLabel.
 *
 * Auth: an active member of the plan's community.
 */
export const getMyServingTasks = query({
  args: { token: v.string(), planId: v.id("eventPlans") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const plan = await requirePlan(ctx, args.planId);
    await requireGroupMember(ctx, plan.groupId, userId);

    const result: Record<
      "before" | "during" | "after",
      ServingTaskItem[]
    > = { before: [], during: [], after: [] };

    // The roles / teams the user is confirmed for on this plan.
    const myAssignments = await ctx.db
      .query("roleAssignments")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();
    const myConfirmed = myAssignments.filter((a) => a.status === "confirmed");
    const confirmedRoleIds = new Set(myConfirmed.map((a) => a.roleId as string));
    const confirmedTeamIds = new Set(myConfirmed.map((a) => a.teamId as string));

    // (a) Assigned template tasks.
    const tasks = await ctx.db
      .query("eventTasks")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .collect();

    // Completions for this user on this plan, indexed by (taskId, timeLabel).
    const myCompletions = await ctx.db
      .query("eventTaskCompletions")
      .withIndex("by_plan_user", (q) =>
        q.eq("planId", args.planId).eq("userId", userId),
      )
      .collect();
    const completionKey = (taskId: string, timeLabel?: string) =>
      `${taskId}::${timeLabel ?? ""}`;
    const completed = new Set(
      myCompletions.map((c) => completionKey(c.taskId, c.timeLabel)),
    );

    for (const task of tasks) {
      const mine = task.roleId
        ? confirmedRoleIds.has(task.roleId as string)
        : confirmedTeamIds.has(task.teamId as string);
      if (!mine) continue;

      const base = {
        title: task.title,
        segment: task.segment,
        isPersonal: false as const,
        howToType: task.howToType,
        howToText: task.howToText,
        howToUrl: task.howToUrl,
        howToMediaPath: task.howToMediaPath,
        howToDoc: task.howToDoc,
      };

      if (task.segment === "during") {
        // One entry per service time. A plan with no configured times still
        // gets a single unlabeled slot so the task remains completable (and its
        // readiness expectation, which also uses one slot, can be met).
        const slots: (string | undefined)[] =
          plan.times.length > 0 ? plan.times.map((t) => t.label) : [undefined];
        for (const label of slots) {
          result.during.push({
            key: `${task._id}::${label ?? ""}`,
            taskId: task._id as string,
            ...base,
            timeLabel: label,
            completed: completed.has(completionKey(task._id, label)),
          });
        }
      } else {
        result[task.segment].push({
          key: task._id as string,
          taskId: task._id as string,
          ...base,
          completed: completed.has(completionKey(task._id, undefined)),
        });
      }
    }

    // (b) Personal serving tasks for this user on this plan.
    const personal = await ctx.db
      .query("personalServingTasks")
      .withIndex("by_plan_user", (q) =>
        q.eq("planId", args.planId).eq("userId", userId),
      )
      .collect();
    for (const p of personal) {
      result[p.segment].push({
        key: p._id as string,
        taskId: p._id as string,
        title: p.title,
        segment: p.segment,
        isPersonal: true,
        note: p.note,
        timeLabel: p.timeLabel,
        completed: p.completedAt !== undefined,
      });
    }

    return result;
  },
});

// ============================================================================
// Interactive "doc" How-To checklist — per-user checked state.
// ============================================================================

/**
 * The current user's checked checklist-item indices for a task's "doc" How-To.
 * Returns `[]` when nothing is checked, or when the task/plan no longer exists
 * (so a stale viewer degrades to an all-unchecked checklist rather than
 * erroring).
 *
 * Auth: an active member of the task's plan's group.
 */
export const getHowToDocChecks = query({
  args: { token: v.string(), taskId: v.id("eventTasks") },
  handler: async (ctx, args): Promise<number[]> => {
    const userId = await requireAuth(ctx, args.token);
    const task = await ctx.db.get(args.taskId);
    if (!task) return [];
    const plan = await ctx.db.get(task.planId);
    if (!plan) return [];
    await requireGroupMember(ctx, plan.groupId, userId);

    const row = await ctx.db
      .query("howToDocChecks")
      .withIndex("by_user_task", (q) =>
        q.eq("userId", userId).eq("taskId", args.taskId),
      )
      .unique();
    return row?.checkedIndices ?? [];
  },
});

/**
 * Toggle a single checklist item in a task's "doc" How-To for the current user.
 * Upserts the (user, task) row and adds/removes `itemIndex` from its set.
 *
 * Auth: an active member of the task's plan's group (same read gate as viewing
 * the task).
 */
export const setHowToDocCheck = mutation({
  args: {
    token: v.string(),
    taskId: v.id("eventTasks"),
    itemIndex: v.number(),
    checked: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new ConvexError("Task not found");
    }
    const plan = await requirePlan(ctx, task.planId);
    await requireGroupMember(ctx, plan.groupId, userId);

    const row = await ctx.db
      .query("howToDocChecks")
      .withIndex("by_user_task", (q) =>
        q.eq("userId", userId).eq("taskId", args.taskId),
      )
      .unique();

    const current = new Set(row?.checkedIndices ?? []);
    if (args.checked) current.add(args.itemIndex);
    else current.delete(args.itemIndex);
    const checkedIndices = Array.from(current).sort((a, b) => a - b);

    const nowMs = Date.now();
    if (row) {
      await ctx.db.patch(row._id, { checkedIndices, updatedAt: nowMs });
    } else {
      await ctx.db.insert("howToDocChecks", {
        userId,
        taskId: args.taskId,
        checkedIndices,
        updatedAt: nowMs,
      });
    }

    return { taskId: args.taskId, itemIndex: args.itemIndex, checked: args.checked };
  },
});

// ============================================================================
// Personal (ad-hoc, single-user) serving tasks — never part of the template.
// ============================================================================

/**
 * Load a personal task and assert the current user owns it.
 */
async function requireOwnedPersonalTask(
  ctx: MutationCtx,
  taskId: Id<"personalServingTasks">,
  userId: Id<"users">,
): Promise<Doc<"personalServingTasks">> {
  const task = await ctx.db.get(taskId);
  if (!task) {
    throw new ConvexError("Task not found");
  }
  if (task.userId !== userId) {
    throw new ConvexError("You can only manage your own personal tasks");
  }
  return task;
}

/** Add a personal serving task for the current user on a plan. */
export const addPersonalTask = mutation({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
    segment: segmentValidator,
    title: v.string(),
    note: v.optional(v.string()),
    timeLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const plan = await requirePlan(ctx, args.planId);
    await requireGroupMember(ctx, plan.groupId, userId);

    const title = args.title.trim();
    if (!title) {
      throw new ConvexError("Task title cannot be empty");
    }

    // Append order within this user's tasks on the plan.
    const existing = await ctx.db
      .query("personalServingTasks")
      .withIndex("by_plan_user", (q) =>
        q.eq("planId", args.planId).eq("userId", userId),
      )
      .collect();
    const sortOrder =
      existing.length === 0
        ? 0
        : Math.max(...existing.map((t) => t.sortOrder)) + 1;

    const nowMs = Date.now();
    const taskId = await ctx.db.insert("personalServingTasks", {
      planId: args.planId,
      communityId: plan.communityId,
      userId,
      segment: args.segment,
      title,
      note: args.note,
      timeLabel: args.segment === "during" ? args.timeLabel : undefined,
      sortOrder,
      createdAt: nowMs,
      updatedAt: nowMs,
    });

    return { taskId };
  },
});

/** Update a personal task's editable fields (owner only). */
export const updatePersonalTask = mutation({
  args: {
    token: v.string(),
    taskId: v.id("personalServingTasks"),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    segment: v.optional(segmentValidator),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireOwnedPersonalTask(ctx, args.taskId, userId);

    const patch: Partial<Doc<"personalServingTasks">> = {
      updatedAt: Date.now(),
    };
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) {
        throw new ConvexError("Task title cannot be empty");
      }
      patch.title = title;
    }
    if (args.note !== undefined) patch.note = args.note;
    if (args.segment !== undefined) patch.segment = args.segment;

    await ctx.db.patch(args.taskId, patch);
    return { taskId: args.taskId };
  },
});

/** Delete a personal task (owner only). */
export const deletePersonalTask = mutation({
  args: { token: v.string(), taskId: v.id("personalServingTasks") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireOwnedPersonalTask(ctx, args.taskId, userId);
    await ctx.db.delete(args.taskId);
    return { taskId: args.taskId };
  },
});

/** Toggle inline completion of a personal task for the current user (owner). */
export const togglePersonalTask = mutation({
  args: {
    token: v.string(),
    taskId: v.id("personalServingTasks"),
    completed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireOwnedPersonalTask(ctx, args.taskId, userId);
    await ctx.db.patch(args.taskId, {
      completedAt: args.completed ? Date.now() : undefined,
      updatedAt: Date.now(),
    });
    return { taskId: args.taskId, completed: args.completed };
  },
});
