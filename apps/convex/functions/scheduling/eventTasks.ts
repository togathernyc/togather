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

    const [completions, sharedCompletions] = await Promise.all([
      ctx.db
        .query("eventTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
        .collect(),
      ctx.db
        .query("sharedTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
        .collect(),
    ]);
    await Promise.all([
      ...completions.map((c) => ctx.db.delete(c._id)),
      ...sharedCompletions.map((c) => ctx.db.delete(c._id)),
    ]);
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
    // Tolerate a stale/deleted activePlanId: return the empty shape rather than
    // throwing, so the serving Tasks tab degrades gracefully (like getEvent)
    // instead of dropping to the error boundary. Auth is unchanged when the
    // plan exists.
    const plan = await ctx.db.get(args.planId);
    if (!plan) return { before: [], during: [], after: [] };
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
// Serving-mode read surfaces (Phase 2): Shared / Crew / All-teams.
//
// These sit alongside `getMyServingTasks` (the personal "mine" list). Where the
// personal + readiness views count completion, they reuse the existing
// semantics:
//   • Assigned (role) tasks are completed PER-USER via `eventTaskCompletions`
//     (one row per user, per task, per service time for "during" tasks).
//   • Team-level tasks (roleId == null) additionally get a TEAM-WIDE shared
//     completion via `sharedTaskCompletions` (one row per task — see below).
// ============================================================================

/** Resolve a user's display name, matching the roster convention. */
async function resolveUserName(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<string> {
  const u = await ctx.db.get(userId);
  return `${u?.firstName ?? ""} ${u?.lastName ?? ""}`.trim() || "Someone";
}

/** The current user's confirmed role assignments on a plan. */
async function myConfirmedAssignments(
  ctx: QueryCtx | MutationCtx,
  planId: Id<"eventPlans">,
  userId: Id<"users">,
): Promise<Doc<"roleAssignments">[]> {
  const rows = await ctx.db
    .query("roleAssignments")
    .withIndex("by_plan", (q) => q.eq("planId", planId))
    .filter((q) => q.eq(q.field("userId"), userId))
    .collect();
  return rows.filter((a) => a.status === "confirmed");
}

/**
 * A team-level (whole-team, no assignee) shared task with its team-wide
 * completion state. Reuses the `ServingTaskItem` How-To fields.
 */
type SharedTeamTaskItem = {
  taskId: string;
  teamId: string;
  teamName: string;
  title: string;
  segment: "before" | "during" | "after";
  howToType: string;
  howToText?: string;
  howToUrl?: string;
  howToMediaPath?: string;
  howToDoc?: string;
  /** Team-wide: true if ANY teammate has marked this task done. */
  completed: boolean;
  /** Who last flipped it done (only set when `completed`). */
  completedByName?: string;
  completedAt?: number;
};

/**
 * The "Shared" surface: team-level tasks (roleId == null) for the CURRENT
 * user's confirmed team(s) on a plan. These are "the whole team is responsible,
 * no single assignee" — so completion is TEAM-WIDE (`sharedTaskCompletions`),
 * not per-user: any confirmed teammate marking it done marks it done for
 * everyone. Returned as a flat array (each item carries its `segment`), ordered
 * before → during → after, then by the task's sortOrder.
 *
 * Auth: an active member of the plan's group (community read gate). Only the
 * user's own confirmed teams are included.
 */
export const getSharedTeamTasks = query({
  args: { token: v.string(), planId: v.id("eventPlans") },
  handler: async (ctx, args): Promise<SharedTeamTaskItem[]> => {
    const userId = await requireAuth(ctx, args.token);
    // Tolerate a stale/deleted activePlanId: return empty rather than throwing,
    // so the serving Tasks tab degrades gracefully instead of erroring. Auth is
    // unchanged when the plan exists.
    const plan = await ctx.db.get(args.planId);
    if (!plan) return [];
    await requireGroupMember(ctx, plan.groupId, userId);

    const confirmed = await myConfirmedAssignments(ctx, args.planId, userId);
    const myTeamIds = new Set(confirmed.map((a) => a.teamId as string));
    if (myTeamIds.size === 0) return [];

    const [tasks, sharedRows] = await Promise.all([
      ctx.db
        .query("eventTasks")
        .withIndex("by_plan", (q) => q.eq("planId", args.planId))
        .collect(),
      ctx.db
        .query("sharedTaskCompletions")
        .withIndex("by_plan", (q) => q.eq("planId", args.planId))
        .collect(),
    ]);
    const completionByTask = new Map(
      sharedRows.map((r) => [r.taskId as string, r]),
    );

    // Team-level tasks (no role) on a team the user is confirmed for.
    const teamTasks = tasks.filter(
      (t) => !t.roleId && myTeamIds.has(t.teamId as string),
    );
    teamTasks.sort(
      (a, b) =>
        (SEGMENT_RANK[a.segment] ?? 1) - (SEGMENT_RANK[b.segment] ?? 1) ||
        a.sortOrder - b.sortOrder,
    );

    const teamNames = new Map<string, string>();
    const userNames = new Map<string, string>();
    const items: SharedTeamTaskItem[] = [];
    for (const task of teamTasks) {
      const teamKey = task.teamId as string;
      if (!teamNames.has(teamKey)) {
        const team = await ctx.db.get(task.teamId);
        teamNames.set(teamKey, team?.name ?? "Team");
      }
      const completion = completionByTask.get(task._id as string);
      let completedByName: string | undefined;
      if (completion) {
        const uKey = completion.completedByUserId as string;
        if (!userNames.has(uKey)) {
          userNames.set(
            uKey,
            await resolveUserName(ctx, completion.completedByUserId),
          );
        }
        completedByName = userNames.get(uKey);
      }
      items.push({
        taskId: task._id as string,
        teamId: teamKey,
        teamName: teamNames.get(teamKey)!,
        title: task.title,
        segment: task.segment,
        howToType: task.howToType,
        howToText: task.howToText,
        howToUrl: task.howToUrl,
        howToMediaPath: task.howToMediaPath,
        howToDoc: task.howToDoc,
        completed: !!completion,
        completedByName,
        completedAt: completion?.completedAt,
      });
    }
    return items;
  },
});

/**
 * Toggle the TEAM-WIDE shared completion of a team-level task. Any confirmed
 * member of the task's team may flip it; the state is shared (one row per task
 * in `sharedTaskCompletions`, not per-user). For a "during" team-level task
 * this is a single whole-task state (it is deliberately NOT split per service
 * time — the Shared surface tracks "the team handled this", not per-slot).
 *
 * Auth: the caller must be a confirmed member of the task's team on the plan.
 */
export const toggleSharedTeamTask = mutation({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
    taskId: v.id("eventTasks"),
    completed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.planId !== args.planId) {
      throw new ConvexError("Task not found");
    }
    if (task.roleId) {
      throw new ConvexError(
        "Only team-level tasks can be completed for the whole team",
      );
    }
    const plan = await requirePlan(ctx, args.planId);
    await requireGroupMember(ctx, plan.groupId, userId);

    // Gate: the caller must be a confirmed member of THIS task's team.
    const confirmed = await myConfirmedAssignments(ctx, args.planId, userId);
    const onTeam = confirmed.some((a) => a.teamId === task.teamId);
    if (!onTeam) {
      throw new ConvexError("You must be serving on this team to update it");
    }

    const existing = await ctx.db
      .query("sharedTaskCompletions")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .unique();

    if (args.completed) {
      if (existing) {
        // Refresh who/when so the "completed by" label reflects the latest tap.
        await ctx.db.patch(existing._id, {
          completedByUserId: userId,
          completedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("sharedTaskCompletions", {
          taskId: args.taskId,
          planId: task.planId,
          communityId: task.communityId,
          completedByUserId: userId,
          completedAt: Date.now(),
        });
      }
    } else if (existing) {
      await ctx.db.delete(existing._id);
    }

    return { taskId: args.taskId, completed: args.completed };
  },
});

/** A teammate (or the current user) and their assigned work, for the Crew tab. */
type CrewMemberEntry = {
  userId: string;
  name: string;
  roleId: string;
  roleName: string;
  teamId: string;
  teamName: string;
  /** True for the current viewer's own row. */
  isCurrentUser: boolean;
  /** Completed / total completion "slots" (per-user, matching the personal view). */
  done: number;
  total: number;
  tasks: Array<{
    taskId: string;
    title: string;
    segment: "before" | "during" | "after";
    /** For "during" tasks: true only when every service-time slot is done. */
    completed: boolean;
    howToType: string;
  }>;
};

/**
 * The "Crew" surface: the current user's confirmed teammates (and the user
 * themselves) on a plan, with each person's ROLE-assigned tasks, READ-ONLY.
 * One entry per (member, role). "Assigned tasks" are the plan's role tasks
 * (`eventTasks.roleId` set) whose role the member is confirmed for — team-level
 * tasks live on the Shared surface, not here.
 *
 * `done`/`total` count completion the same way the personal `getMyServingTasks`
 * view does: per-user `eventTaskCompletions`, with "during" tasks counted once
 * per service time (so a member serving one "during" task across two services
 * has total 2). A task's `completed` flag is true only when all of its slots
 * are done.
 *
 * Auth: an active member of the plan's group. Only teams the current user is
 * confirmed for are included.
 */
export const getCrewTasks = query({
  args: { token: v.string(), planId: v.id("eventPlans") },
  handler: async (ctx, args): Promise<CrewMemberEntry[]> => {
    const userId = await requireAuth(ctx, args.token);
    // Tolerate a stale/deleted activePlanId: return empty rather than throwing,
    // so the serving Tasks tab degrades gracefully instead of erroring. Auth is
    // unchanged when the plan exists.
    const plan = await ctx.db.get(args.planId);
    if (!plan) return [];
    await requireGroupMember(ctx, plan.groupId, userId);

    const myConfirmed = await myConfirmedAssignments(ctx, args.planId, userId);
    const myTeamIds = new Set(myConfirmed.map((a) => a.teamId as string));
    if (myTeamIds.size === 0) return [];

    const [allAssignments, tasks] = await Promise.all([
      ctx.db
        .query("roleAssignments")
        .withIndex("by_plan", (q) => q.eq("planId", args.planId))
        .collect(),
      ctx.db
        .query("eventTasks")
        .withIndex("by_plan", (q) => q.eq("planId", args.planId))
        .collect(),
    ]);

    // Role tasks grouped by roleId (team-level tasks excluded — Shared surface).
    const tasksByRole = new Map<string, Doc<"eventTasks">[]>();
    for (const t of tasks) {
      if (!t.roleId) continue;
      const key = t.roleId as string;
      const list = tasksByRole.get(key) ?? [];
      list.push(t);
      tasksByRole.set(key, list);
    }

    const timesCount = Math.max(1, plan.times.length);

    // Crew = confirmed assignments on a team the current user is confirmed for.
    const crew = allAssignments.filter(
      (a) => a.status === "confirmed" && myTeamIds.has(a.teamId as string),
    );

    const teamNames = new Map<string, string>();
    const roleNames = new Map<string, string>();
    const userNames = new Map<string, string>();
    // Per-user completion keys ("taskId::timeLabel"), fetched once per member.
    const completionsByUser = new Map<string, Set<string>>();
    const completionKey = (taskId: string, timeLabel?: string) =>
      `${taskId}::${timeLabel ?? ""}`;

    const entries = new Map<string, CrewMemberEntry>();
    for (const a of crew) {
      const memberKey = `${a.userId}::${a.roleId}`;
      if (entries.has(memberKey)) continue; // one entry per (member, role)

      const teamKey = a.teamId as string;
      if (!teamNames.has(teamKey)) {
        const team = await ctx.db.get(a.teamId);
        teamNames.set(teamKey, team?.name ?? "Team");
      }
      const roleKey = a.roleId as string;
      if (!roleNames.has(roleKey)) {
        const role = await ctx.db.get(a.roleId);
        roleNames.set(roleKey, role?.name ?? "Role");
      }
      const userKey = a.userId as string;
      if (!userNames.has(userKey)) {
        userNames.set(userKey, await resolveUserName(ctx, a.userId));
      }
      if (!completionsByUser.has(userKey)) {
        const rows = await ctx.db
          .query("eventTaskCompletions")
          .withIndex("by_plan_user", (q) =>
            q.eq("planId", args.planId).eq("userId", a.userId),
          )
          .collect();
        completionsByUser.set(
          userKey,
          new Set(rows.map((r) => completionKey(r.taskId, r.timeLabel))),
        );
      }
      const done = completionsByUser.get(userKey)!;

      const roleTasks = tasksByRole.get(roleKey) ?? [];
      roleTasks.sort(
        (x, y) =>
          (SEGMENT_RANK[x.segment] ?? 1) - (SEGMENT_RANK[y.segment] ?? 1) ||
          x.sortOrder - y.sortOrder,
      );

      let doneCount = 0;
      let totalCount = 0;
      const taskList: CrewMemberEntry["tasks"] = [];
      for (const t of roleTasks) {
        if (t.segment === "during") {
          const slots: (string | undefined)[] =
            plan.times.length > 0
              ? plan.times.map((s) => s.label)
              : [undefined];
          let slotDone = 0;
          for (const label of slots) {
            if (done.has(completionKey(t._id as string, label))) slotDone += 1;
          }
          totalCount += timesCount;
          doneCount += slotDone;
          taskList.push({
            taskId: t._id as string,
            title: t.title,
            segment: t.segment,
            completed: slotDone === slots.length,
            howToType: t.howToType,
          });
        } else {
          const isDone = done.has(completionKey(t._id as string, undefined));
          totalCount += 1;
          if (isDone) doneCount += 1;
          taskList.push({
            taskId: t._id as string,
            title: t.title,
            segment: t.segment,
            completed: isDone,
            howToType: t.howToType,
          });
        }
      }

      entries.set(memberKey, {
        userId: userKey,
        name: userNames.get(userKey)!,
        roleId: roleKey,
        roleName: roleNames.get(roleKey)!,
        teamId: teamKey,
        teamName: teamNames.get(teamKey)!,
        isCurrentUser: a.userId === userId,
        done: doneCount,
        total: totalCount,
        tasks: taskList,
      });
    }

    // Current user first, then by name for a stable, useful ordering.
    return Array.from(entries.values()).sort((x, y) => {
      if (x.isCurrentUser !== y.isCurrentUser) return x.isCurrentUser ? -1 : 1;
      return x.name.localeCompare(y.name);
    });
  },
});

/** A team's task rollup for the All-teams overview. */
type AllTeamsEntry = {
  teamId: string;
  teamName: string;
  taskCount: number;
  done: number;
  total: number;
  tasks: Array<{
    taskId: string;
    title: string;
    segment: "before" | "during" | "after";
    roleName: string | null;
    completed: boolean;
    howToType: string;
  }>;
};

/**
 * The "All-teams" surface: a READ-ONLY overview of every team on the plan and
 * its tasks, so a volunteer can see the whole event's shape and progress.
 *
 * `done`/`total` here use the plan-wide READINESS semantics (same as
 * `getPlanTaskReadiness`): a task's `total` is the number of confirmed
 * assignees expected to complete it (× the number of service times for
 * "during" tasks), and `done` counts valid completions from those assignees. A
 * task's `completed` flag is true when it is fully satisfied (done >= total,
 * total > 0). Team-level tasks additionally count their team-wide shared
 * completion as satisfying the whole task.
 *
 * Auth: an active member of the plan's group (any serving participant).
 */
export const getAllTeamsTasks = query({
  args: { token: v.string(), planId: v.id("eventPlans") },
  handler: async (ctx, args): Promise<AllTeamsEntry[]> => {
    const userId = await requireAuth(ctx, args.token);
    // Tolerate a stale/deleted activePlanId: return empty rather than throwing,
    // so the serving Tasks tab degrades gracefully instead of erroring. Auth is
    // unchanged when the plan exists.
    const plan = await ctx.db.get(args.planId);
    if (!plan) return [];
    await requireGroupMember(ctx, plan.groupId, userId);

    const [tasks, assignments, sharedRows] = await Promise.all([
      ctx.db
        .query("eventTasks")
        .withIndex("by_plan", (q) => q.eq("planId", args.planId))
        .collect(),
      ctx.db
        .query("roleAssignments")
        .withIndex("by_plan", (q) => q.eq("planId", args.planId))
        .collect(),
      ctx.db
        .query("sharedTaskCompletions")
        .withIndex("by_plan", (q) => q.eq("planId", args.planId))
        .collect(),
    ]);
    const sharedByTask = new Set(sharedRows.map((r) => r.taskId as string));

    tasks.sort(
      (a, b) =>
        (SEGMENT_RANK[a.segment] ?? 1) - (SEGMENT_RANK[b.segment] ?? 1) ||
        a.sortOrder - b.sortOrder,
    );

    const timesCount = Math.max(1, plan.times.length);
    const validTimeLabels = new Set(plan.times.map((t) => t.label));

    const teamNames = new Map<string, string>();
    const roleNames = new Map<string, string>();
    const byTeam = new Map<string, AllTeamsEntry>();

    for (const task of tasks) {
      // Readiness "expected completers" for this task.
      const expected = assigneesForTask(assignments, task);
      const expectedUserIds = new Set(expected.map((a) => a.userId as string));
      const expectedPeople = expectedUserIds.size;
      const total =
        task.segment === "during"
          ? expectedPeople * timesCount
          : expectedPeople;

      const completions = await ctx.db
        .query("eventTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", task._id))
        .collect();
      const validCompletions = completions.filter((c) => {
        if (!expectedUserIds.has(c.userId as string)) return false;
        if (task.segment === "during") {
          if (plan.times.length === 0) return c.timeLabel == null;
          return c.timeLabel != null && validTimeLabels.has(c.timeLabel);
        }
        return true;
      });
      const done = Math.min(validCompletions.length, total);

      // A team-level task the team marked shared-done counts as fully complete.
      const sharedDone = !task.roleId && sharedByTask.has(task._id as string);
      const completed = sharedDone || (total > 0 && done >= total);
      // Keep the aggregate consistent with the row's checkmark: a shared-done
      // team-level task is fully satisfied, so contribute its full slot count to
      // the team's `done` (not the sparse per-user completions) — otherwise the
      // row shows done while the team card reads e.g. 0/6.
      const doneForEntry = sharedDone ? total : done;

      const teamKey = task.teamId as string;
      if (!teamNames.has(teamKey)) {
        const team = await ctx.db.get(task.teamId);
        teamNames.set(teamKey, team?.name ?? "Team");
      }
      let entry = byTeam.get(teamKey);
      if (!entry) {
        entry = {
          teamId: teamKey,
          teamName: teamNames.get(teamKey)!,
          taskCount: 0,
          done: 0,
          total: 0,
          tasks: [],
        };
        byTeam.set(teamKey, entry);
      }

      let roleName: string | null = null;
      if (task.roleId) {
        const roleKey = task.roleId as string;
        if (!roleNames.has(roleKey)) {
          const role = await ctx.db.get(task.roleId);
          roleNames.set(roleKey, role?.name ?? "Role");
        }
        roleName = roleNames.get(roleKey)!;
      }

      entry.taskCount += 1;
      entry.total += total;
      entry.done += doneForEntry;
      entry.tasks.push({
        taskId: task._id as string,
        title: task.title,
        segment: task.segment,
        roleName,
        completed,
        howToType: task.howToType,
      });
    }

    return Array.from(byTeam.values()).sort((a, b) =>
      a.teamName.localeCompare(b.teamName),
    );
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
  handler: async (ctx, args): Promise<string[]> => {
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
    return row?.checkedKeys ?? [];
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
    itemKey: v.string(),
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

    const current = new Set(row?.checkedKeys ?? []);
    if (args.checked) current.add(args.itemKey);
    else current.delete(args.itemKey);
    const checkedKeys = Array.from(current).sort();

    const nowMs = Date.now();
    if (row) {
      await ctx.db.patch(row._id, { checkedKeys, updatedAt: nowMs });
    } else {
      await ctx.db.insert("howToDocChecks", {
        userId,
        taskId: args.taskId,
        checkedKeys,
        updatedAt: nowMs,
      });
    }

    return { taskId: args.taskId, itemKey: args.itemKey, checked: args.checked };
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
