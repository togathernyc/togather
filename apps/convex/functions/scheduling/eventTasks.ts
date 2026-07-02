/**
 * Scheduling — Event Tasks + personal serving tasks
 *
 * Event tasks (`eventTasks`) are the shared, leader-authored checklist for a
 * plan: one or more teams (or specific roles on those teams) need to do X
 * "before" / "during" / "after" the event. A task carries `teamIds` (>= 1) and
 * `roleIds` (may be empty); read them via `taskTeamIds()` / `taskRoleIds()`,
 * which fall back to the legacy single `teamId` / `roleId` columns during the
 * migration window. Completion has two models, keyed on whether the task has
 * any roles:
 *   • Role tasks (`roleIds` non-empty) are completed PER-USER
 *     (`eventTaskCompletions`); "during" tasks are completed once per service
 *     time. Each person confirmed for ANY of `roleIds` sees it in their "Mine"
 *     list and completes it individually.
 *   • Team-level tasks (`roleIds` empty) are TEAM-WIDE, single-source on
 *     `sharedTaskCompletions` (one row per task): any confirmed member of ANY
 *     team in `teamIds` completes it for the whole task. A team-level task
 *     spanning multiple teams is still ONE shared checkbox. They surface on the
 *     Shared tab and count as one slot in readiness / all-teams rollups.
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
import { internalMutation, mutation, query } from "../../_generated/server";
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
 * The team(s) a task belongs to. Reads through the legacy single `teamId`
 * column when the multi-assign `teamIds` array is absent (migration window).
 * Always returns >= 1 id for a well-formed task.
 */
export function taskTeamIds(
  task: Pick<Doc<"eventTasks">, "teamIds" | "teamId">,
): Id<"teams">[] {
  return task.teamIds ?? (task.teamId ? [task.teamId] : []);
}

/**
 * The role(s) responsible for a task. Reads through the legacy single `roleId`
 * column when the multi-assign `roleIds` array is absent (migration window).
 * EMPTY => the task is team-level (whole-team shared completion).
 */
export function taskRoleIds(
  task: Pick<Doc<"eventTasks">, "roleIds" | "roleId">,
): Id<"teamRoles">[] {
  return task.roleIds ?? (task.roleId ? [task.roleId] : []);
}

/** Stable-order dedupe for an id array (preserves first-seen order). */
function dedupeIds<T extends string>(ids: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const id of ids) {
    if (seen.has(id as string)) continue;
    seen.add(id as string);
    out.push(id);
  }
  return out;
}

/** True when a task is team-level (no roles => whole-team shared completion). */
function isTeamLevel(
  task: Pick<Doc<"eventTasks">, "roleIds" | "roleId">,
): boolean {
  return taskRoleIds(task).length === 0;
}

/**
 * Delete all completion state cascading from a task — per-user
 * `eventTaskCompletions`, the team-level `sharedTaskCompletions`, and per-user
 * `howToDocChecks`. Shared by `deleteTask` and by the event-templates
 * propagation (which deletes synced task rows when their template item is
 * removed). Returns the per-user completion count (for `deleteTask`'s result).
 */
export async function cascadeTaskCompletions(
  ctx: MutationCtx,
  taskId: Id<"eventTasks">,
): Promise<number> {
  const [completions, sharedCompletions, docChecks] = await Promise.all([
    ctx.db
      .query("eventTaskCompletions")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect(),
    ctx.db
      .query("sharedTaskCompletions")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect(),
    ctx.db
      .query("howToDocChecks")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect(),
  ]);
  await Promise.all([
    ...completions.map((c) => ctx.db.delete(c._id)),
    ...sharedCompletions.map((c) => ctx.db.delete(c._id)),
    ...docChecks.map((c) => ctx.db.delete(c._id)),
  ]);
  return completions.length;
}

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
  task: Pick<Doc<"eventTasks">, "teamId" | "roleId" | "teamIds" | "roleIds">,
): Doc<"roleAssignments">[] {
  const roleIds = new Set(taskRoleIds(task) as string[]);
  const teamIds = new Set(taskTeamIds(task) as string[]);
  return assignments.filter((a) => {
    if (a.status !== "confirmed") return false;
    // Role tasks: anyone confirmed for ANY of the task's roles.
    if (roleIds.size > 0) return roleIds.has(a.roleId as string);
    // Team-level task (no roles): any confirmed role on ANY of the teams.
    return teamIds.has(a.teamId as string);
  });
}

/**
 * List all tasks for a plan, ordered by (segment, then sortOrder), each
 * enriched with its `teamNames` and `roleNames` (parallel to `teamIds` /
 * `roleIds`; `roleIds`/`roleNames` are empty for team-level tasks).
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
    const teamNameFor = async (id: Id<"teams">): Promise<string> => {
      const key = id as string;
      if (!teamNames.has(key)) {
        const team = await ctx.db.get(id);
        teamNames.set(key, team?.name ?? "Team");
      }
      return teamNames.get(key)!;
    };
    const roleNameFor = async (id: Id<"teamRoles">): Promise<string> => {
      const key = id as string;
      if (!roleNames.has(key)) {
        const role = await ctx.db.get(id);
        roleNames.set(key, role?.name ?? "Role");
      }
      return roleNames.get(key)!;
    };

    return Promise.all(
      tasks.map(async (task) => {
        const teamIds = taskTeamIds(task);
        const roleIds = taskRoleIds(task);
        return {
          _id: task._id,
          planId: task.planId,
          teamIds: teamIds as string[],
          roleIds: roleIds as string[],
          teamNames: await Promise.all(teamIds.map(teamNameFor)),
          roleNames: await Promise.all(roleIds.map(roleNameFor)),
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
 * Next append `sortOrder` within a (plan, segment) bucket. With multi-team
 * tasks a task no longer belongs to a single team, so append order is scoped to
 * the whole plan's segment (the grid re-sorts by team → role for display, and
 * `reorderTasks` rewrites a plan-wide order anyway).
 */
async function nextTaskSortOrder(
  ctx: MutationCtx,
  planId: Id<"eventPlans">,
  segment: "before" | "during" | "after",
): Promise<number> {
  const inSegment = await ctx.db
    .query("eventTasks")
    .withIndex("by_plan_segment", (q) =>
      q.eq("planId", planId).eq("segment", segment),
    )
    .collect();
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
    // >= 1 team. `roleIds` empty (or omitted) => a team-level task.
    teamIds: v.array(v.id("teams")),
    roleIds: v.optional(v.array(v.id("teamRoles"))),
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

    const teamIds = dedupeIds(args.teamIds);
    if (teamIds.length === 0) {
      throw new ConvexError("A task must belong to at least one team");
    }
    const teamIdSet = new Set(teamIds as string[]);
    for (const teamId of teamIds) {
      const team = await ctx.db.get(teamId);
      if (!team || team.groupId !== plan.groupId) {
        throw new ConvexError("Team does not belong to this event's group");
      }
    }
    const roleIds = dedupeIds(args.roleIds ?? []);
    for (const roleId of roleIds) {
      const role = await ctx.db.get(roleId);
      if (!role || !teamIdSet.has(role.teamId as string)) {
        throw new ConvexError(
          "Role does not belong to one of the task's teams",
        );
      }
    }

    const title = args.title.trim();
    if (!title) {
      throw new ConvexError("Task title cannot be empty");
    }

    const nowMs = Date.now();
    const sortOrder = await nextTaskSortOrder(ctx, args.planId, args.segment);

    const taskId = await ctx.db.insert("eventTasks", {
      planId: args.planId,
      communityId: plan.communityId,
      teamIds,
      roleIds,
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
    // Replace the task's team(s). Must stay non-empty. Any role no longer on
    // one of the new teams is dropped (see below).
    teamIds: v.optional(v.array(v.id("teams"))),
    // Replace the task's role(s). An empty array converts the task to
    // team-level (whole-team shared completion). Omit to leave roles unchanged.
    roleIds: v.optional(v.array(v.id("teamRoles"))),
    segment: v.optional(segmentValidator),
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
    const { plan } = await requirePlanScheduler(ctx, task.planId, userId);

    const patch: Partial<Doc<"eventTasks">> = { updatedAt: Date.now() };
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) {
        throw new ConvexError("Task title cannot be empty");
      }
      patch.title = title;
    }

    // Resolve the effective team/role sets after this update so we can validate
    // roles against teams and detect a conversion to team-level.
    const nextTeamIds =
      args.teamIds !== undefined ? dedupeIds(args.teamIds) : taskTeamIds(task);
    if (nextTeamIds.length === 0) {
      throw new ConvexError("A task must belong to at least one team");
    }
    const teamIdSet = new Set(nextTeamIds as string[]);
    if (args.teamIds !== undefined) {
      for (const teamId of nextTeamIds) {
        const team = await ctx.db.get(teamId);
        if (!team || team.groupId !== plan.groupId) {
          throw new ConvexError("Team does not belong to this event's group");
        }
      }
      patch.teamIds = nextTeamIds;
    }

    const prevRoleIds = taskRoleIds(task);
    let nextRoleIds = prevRoleIds;
    if (args.roleIds !== undefined) {
      nextRoleIds = dedupeIds(args.roleIds);
      for (const roleId of nextRoleIds) {
        const role = await ctx.db.get(roleId);
        if (!role || !teamIdSet.has(role.teamId as string)) {
          throw new ConvexError(
            "Role does not belong to one of the task's teams",
          );
        }
      }
      patch.roleIds = nextRoleIds;
    } else if (args.teamIds !== undefined) {
      // Teams changed but roles weren't explicitly set: drop any role that no
      // longer belongs to one of the task's teams.
      const kept: Id<"teamRoles">[] = [];
      for (const roleId of prevRoleIds) {
        const role = await ctx.db.get(roleId);
        if (role && teamIdSet.has(role.teamId as string)) kept.push(roleId);
      }
      if (kept.length !== prevRoleIds.length) {
        nextRoleIds = kept;
        patch.roleIds = kept;
      }
    }

    if (args.segment !== undefined) patch.segment = args.segment;
    if (args.howToType !== undefined) patch.howToType = args.howToType;
    if (args.howToText !== undefined) patch.howToText = args.howToText;
    if (args.howToUrl !== undefined) patch.howToUrl = args.howToUrl;
    if (args.howToMediaPath !== undefined)
      patch.howToMediaPath = args.howToMediaPath;
    if (args.howToDoc !== undefined) patch.howToDoc = args.howToDoc;

    // Event-templates linkage (Phase 3): a local edit that ACTUALLY changes a
    // content field detaches a template-sourced task, so forward propagation
    // stops overwriting the user's change. A no-op edit (e.g. a Phase-4
    // autosave that resends unchanged values) must NOT silently detach it.
    // No-op for tasks with no template source (unlinked plans unaffected).
    if (task.sourceTemplateItemId && !task.templateDetached) {
      const contentPairs: Array<[unknown, unknown]> = [];
      if (patch.title !== undefined) contentPairs.push([patch.title, task.title]);
      if (patch.teamIds !== undefined)
        contentPairs.push([patch.teamIds, taskTeamIds(task)]);
      if (patch.roleIds !== undefined)
        contentPairs.push([patch.roleIds, taskRoleIds(task)]);
      if (patch.segment !== undefined)
        contentPairs.push([patch.segment, task.segment]);
      if (patch.howToType !== undefined)
        contentPairs.push([patch.howToType, task.howToType]);
      if (patch.howToText !== undefined)
        contentPairs.push([patch.howToText, task.howToText]);
      if (patch.howToUrl !== undefined)
        contentPairs.push([patch.howToUrl, task.howToUrl]);
      if (patch.howToMediaPath !== undefined)
        contentPairs.push([patch.howToMediaPath, task.howToMediaPath]);
      if (patch.howToDoc !== undefined)
        contentPairs.push([patch.howToDoc, task.howToDoc]);
      const contentChanged = contentPairs.some(
        ([next, cur]) => JSON.stringify(next ?? null) !== JSON.stringify(cur ?? null),
      );
      if (contentChanged) patch.templateDetached = true;
    }

    // Completion cleanup — kept symmetric so a task can be converted back and
    // forth without resurrecting stale "done" state from the other model. The
    // two completion models are single-source per task kind: role tasks use
    // per-user `eventTaskCompletions`; team-level tasks use `sharedTaskCompletions`.
    const prevIsTeamLevel = prevRoleIds.length === 0;
    const nextIsTeamLevel = nextRoleIds.length === 0;

    if (!prevIsTeamLevel && nextIsTeamLevel) {
      // Role → team-level: the per-user role completions are meaningless as a
      // team-wide completion, so drop them — otherwise the converted task could
      // still read as done from those rows.
      const roleCompletions = await ctx.db
        .query("eventTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
        .collect();
      await Promise.all(roleCompletions.map((c) => ctx.db.delete(c._id)));
    } else if (prevIsTeamLevel && !nextIsTeamLevel) {
      // Team-level → role: drop the stale shared completion, or converting the
      // task BACK to team-level later would resurrect a phantom "done" state.
      const shared = await ctx.db
        .query("sharedTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
        .collect();
      await Promise.all(shared.map((s) => ctx.db.delete(s._id)));
    } else if (!nextIsTeamLevel) {
      // Stayed a role task but a role was removed: per-user completions from
      // people who were only in a dropped role are now orphaned (and would
      // resurrect if the role were re-added). Delete completions whose user is
      // no longer covered by ANY remaining role. Users still covered by a
      // remaining role keep their completion.
      const nextSet = new Set(nextRoleIds as string[]);
      const roleRemoved = prevRoleIds.some((r) => !nextSet.has(r as string));
      if (roleRemoved) {
        const assignments = await ctx.db
          .query("roleAssignments")
          .withIndex("by_plan", (q) => q.eq("planId", task.planId))
          .collect();
        const coveredUserIds = new Set(
          assignments
            .filter(
              (a) =>
                a.status === "confirmed" && nextSet.has(a.roleId as string),
            )
            .map((a) => a.userId as string),
        );
        const completions = await ctx.db
          .query("eventTaskCompletions")
          .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
          .collect();
        await Promise.all(
          completions
            .filter((c) => !coveredUserIds.has(c.userId as string))
            .map((c) => ctx.db.delete(c._id)),
        );
      }
    }

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
    const { plan } = await requirePlanScheduler(ctx, task.planId, userId);

    // Event-templates linkage (Phase 3): deleting a template-sourced task on a
    // linked plan records the removal so forward propagation won't re-add it.
    // No-op for tasks with no template source, so unlinked plans are unaffected.
    if (task.sourceTemplateItemId) {
      const detached = new Set(
        (plan.detachedTaskTemplateItemIds ?? []).map((id) => id as string),
      );
      if (!detached.has(task.sourceTemplateItemId as string)) {
        await ctx.db.patch(plan._id, {
          detachedTaskTemplateItemIds: [
            ...(plan.detachedTaskTemplateItemIds ?? []),
            task.sourceTemplateItemId,
          ],
        });
      }
    }

    const deletedCompletions = await cascadeTaskCompletions(ctx, args.taskId);
    await ctx.db.delete(args.taskId);

    return { deletedCompletions };
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
      const patch: Partial<Doc<"eventTasks">> = {
        sortOrder: index,
        updatedAt: nowMs,
      };
      // Event-templates linkage (Phase 3): a manual reorder that actually moves
      // a template-sourced task detaches it, so propagation stops rewriting its
      // order. Rows that don't move (and non-template rows) are left synced.
      if (
        task.sourceTemplateItemId &&
        !task.templateDetached &&
        task.sortOrder !== index
      ) {
        patch.templateDetached = true;
      }
      await ctx.db.patch(taskId, patch);
      index += 1;
    }
    return { reordered: index };
  },
});

/**
 * Toggle the current user's completion of a ROLE task. `timeLabel` is meaningful
 * only for "during" tasks (one completion per service time).
 *
 * Team-level tasks (roleId == null) are REJECTED here — they are team-wide and
 * must go through `toggleSharedTeamTask` (which gates on confirmed team
 * membership); this per-user path only checks group membership.
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
    // Team-level tasks (no roles) are TEAM-WIDE and must be completed through
    // `toggleSharedTeamTask`, which gates on confirmed TEAM membership. This
    // per-user path only checks GROUP membership, so accepting a team-level
    // completion here would let a non-teammate (or a stale/direct caller) mark it
    // done and bypass the team gate. The mobile client already routes team-level
    // tasks to the Shared tab and excludes them from "Mine".
    if (isTeamLevel(task)) {
      throw new ConvexError("Team-level tasks are completed on the Shared tab.");
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
 * per-team. Two completion models, one per task kind:
 *   • Role tasks (`roleId != null`): completion is PER-USER
 *     (`eventTaskCompletions`). "Expected completions" is the number of
 *     confirmed assignees of the role, × the number of service times for
 *     "during" tasks; `done` counts valid completions from those assignees.
 *   • Team-level tasks (`roleId == null`): completion is TEAM-WIDE and
 *     single-source on `sharedTaskCompletions` (surfaced on the Shared tab).
 *     Counted as a single slot: `total += 1`, `done += 1` iff a shared
 *     completion row exists. (Pre-migration per-user completions of team-level
 *     tasks were snapshotted into `sharedTaskCompletions` by a one-time
 *     backfill — see `backfillTeamLevelSharedCompletions` — so they are not read
 *     from `eventTaskCompletions` here.)
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
    // Team-wide completion for team-level tasks (single-source: one row per task
    // in `sharedTaskCompletions`).
    const sharedDoneByTask = new Set(sharedRows.map((r) => r.taskId as string));

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

    const teamEntryFor = async (
      teamId: Id<"teams">,
    ): Promise<{ teamId: string; teamName: string; done: number; total: number }> => {
      const teamKey = teamId as string;
      let teamEntry = byTeam.get(teamKey);
      if (!teamEntry) {
        const team = await ctx.db.get(teamId);
        teamEntry = {
          teamId: teamKey,
          teamName: team?.name ?? "Team",
          done: 0,
          total: 0,
        };
        byTeam.set(teamKey, teamEntry);
      }
      return teamEntry;
    };

    for (const task of tasks) {
      const teamIds = taskTeamIds(task);
      let total: number;
      let done: number;
      if (isTeamLevel(task)) {
        // Team-level task: a single TEAM-WIDE slot, completed once for the whole
        // task via `sharedTaskCompletions` (the Shared surface), regardless of
        // how many teammates are confirmed or how many teams it spans. Single-
        // source — done iff a shared completion row exists.
        total = 1;
        done = sharedDoneByTask.has(task._id as string) ? 1 : 0;

        overall.total += total;
        overall.done += done;
        bySegment[task.segment].total += total;
        bySegment[task.segment].done += done;

        // Credit the (single) shared slot to EACH team the task spans. NOTE:
        // this means sum(byTeam) can exceed overall for a team-level task that
        // spans multiple teams — each team is shown the whole shared checkbox.
        for (const teamId of teamIds) {
          const entry = await teamEntryFor(teamId);
          entry.total += total;
          entry.done += done;
        }
      } else {
        // Role task: PER-USER completion via `eventTaskCompletions`.
        const expected = assigneesForTask(assignments, task);
        const expectedUserIds = new Set(
          expected.map((a) => a.userId as string),
        );
        const expectedPeople = expectedUserIds.size;
        total =
          task.segment === "during"
            ? expectedPeople * timesCount
            : expectedPeople;

        // Count only completions from people who are currently expected to do
        // this task (a since-removed assignee, or anyone calling the mutation
        // directly, must not push readiness forward), and — for "during" tasks —
        // only completions tagged with a real service time.
        const completions = await ctx.db
          .query("eventTaskCompletions")
          .withIndex("by_task", (q) => q.eq("taskId", task._id))
          .collect();
        const countValid = (allowed: Set<string>): number =>
          completions.filter((c) => {
            if (!allowed.has(c.userId as string)) return false;
            if (task.segment === "during") {
              // No configured times => a single unlabeled slot (mirrors
              // getMyServingTasks), so accept the null-label completion.
              if (plan.times.length === 0) return c.timeLabel == null;
              return c.timeLabel != null && validTimeLabels.has(c.timeLabel);
            }
            return true;
          }).length;
        done = Math.min(countValid(expectedUserIds), total);

        overall.total += total;
        overall.done += done;
        bySegment[task.segment].total += total;
        bySegment[task.segment].done += done;

        // Per-team split: a role belongs to exactly one team, so partition the
        // expected assignees by team. This keeps sum(byTeam) == overall for
        // role tasks even when the task spans multiple teams/roles.
        for (const teamId of teamIds) {
          const teamUserIds = new Set(
            expected
              .filter((a) => (a.teamId as string) === (teamId as string))
              .map((a) => a.userId as string),
          );
          const teamPeople = teamUserIds.size;
          if (teamPeople === 0) continue;
          const teamTotal =
            task.segment === "during" ? teamPeople * timesCount : teamPeople;
          const teamDone = Math.min(countValid(teamUserIds), teamTotal);
          const entry = await teamEntryFor(teamId);
          entry.total += teamTotal;
          entry.done += teamDone;
        }
      }
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
 *   (a) ROLE-assigned template tasks (`eventTasks.roleId` set) whose role the
 *       user is confirmed for on this plan — completed PER-USER via
 *       `eventTaskCompletions`, and
 *   (b) the user's personal serving tasks (`personalServingTasks`).
 *
 * Team-level tasks (`roleId == null`) are deliberately EXCLUDED here: they are
 * team-wide (single-source on `sharedTaskCompletions`) and are surfaced on the
 * Shared tab only, not in this personal "Mine" list.
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
      // Team-level tasks (no roles) are team-wide, single-source on
      // `sharedTaskCompletions`, and belong to the Shared surface only — they
      // are no longer listed in this personal "Mine" view. A role task appears
      // here when the user is confirmed for ANY of its roles (plus their
      // personal tasks).
      const roleIds = taskRoleIds(task);
      if (roleIds.length === 0) continue;
      if (!roleIds.some((r) => confirmedRoleIds.has(r as string))) continue;

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
//   • Team-level tasks (roleId == null) are TEAM-WIDE, single-source on
//     `sharedTaskCompletions` (one row per task — see below): completing one on
//     the Shared surface marks it done everywhere it's counted.
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
  /** The team(s) this whole-team task spans (>= 1). */
  teamIds: string[];
  teamNames: string[];
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
 * everyone. Completion is single-source on `sharedTaskCompletions` — a task
 * shows done iff a shared row exists (pre-migration per-user completions were
 * snapshotted into `sharedTaskCompletions` by a one-time backfill).
 * Returned as a flat array (each item carries its `segment`), ordered
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

    // Team-level tasks (no roles) that span a team the user is confirmed for.
    // A multi-team task shows ONCE (one shared checkbox) for any teammate on
    // any of its teams.
    const teamTasks = tasks.filter(
      (t) =>
        isTeamLevel(t) &&
        taskTeamIds(t).some((id) => myTeamIds.has(id as string)),
    );
    teamTasks.sort(
      (a, b) =>
        (SEGMENT_RANK[a.segment] ?? 1) - (SEGMENT_RANK[b.segment] ?? 1) ||
        a.sortOrder - b.sortOrder,
    );

    const teamNames = new Map<string, string>();
    const teamNameFor = async (id: Id<"teams">): Promise<string> => {
      const key = id as string;
      if (!teamNames.has(key)) {
        const team = await ctx.db.get(id);
        teamNames.set(key, team?.name ?? "Team");
      }
      return teamNames.get(key)!;
    };
    const userNames = new Map<string, string>();
    const items: SharedTeamTaskItem[] = [];
    for (const task of teamTasks) {
      const teamIds = taskTeamIds(task);
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
        teamIds: teamIds as string[],
        teamNames: await Promise.all(teamIds.map(teamNameFor)),
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
 * Team-level completion reads `sharedTaskCompletions` OR legacy per-user
 * `eventTaskCompletions` (pre-migration state), so un-checking clears BOTH:
 * marking done writes only the shared row, but un-checking also deletes any
 * legacy `eventTaskCompletions` rows for the task.
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
    if (!isTeamLevel(task)) {
      throw new ConvexError(
        "Only team-level tasks can be completed for the whole team",
      );
    }
    const plan = await requirePlan(ctx, args.planId);
    await requireGroupMember(ctx, plan.groupId, userId);

    // Gate: the caller must be a confirmed member of ANY of THIS task's teams.
    const taskTeams = new Set(taskTeamIds(task) as string[]);
    const confirmed = await myConfirmedAssignments(ctx, args.planId, userId);
    const onTeam = confirmed.some((a) => taskTeams.has(a.teamId as string));
    if (!onTeam) {
      throw new ConvexError("You must be serving on this team to update it");
    }

    const existing = await ctx.db
      .query("sharedTaskCompletions")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .unique();

    if (args.completed) {
      // Marking done writes only the team-wide `sharedTaskCompletions` row; any
      // legacy per-user `eventTaskCompletions` rows are harmless because reads OR
      // the two sources together.
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
    } else {
      // Un-checking must clear BOTH sources — the shared row and any legacy
      // per-user `eventTaskCompletions` rows for this (plan, task) — or a
      // pre-migration team-level completion would keep the task showing done.
      if (existing) {
        await ctx.db.delete(existing._id);
      }
      const legacyRows = await ctx.db
        .query("eventTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
        .collect();
      await Promise.all(legacyRows.map((r) => ctx.db.delete(r._id)));
    }

    return { taskId: args.taskId, completed: args.completed };
  },
});

/**
 * One-time backfill: snapshot legitimate pre-migration team-level completions
 * into the single-source `sharedTaskCompletions` store.
 *
 * Historically, a team-level task (`roleId == null`) could be marked done via a
 * per-user `eventTaskCompletions` row. Team-level completion is now single-source
 * on `sharedTaskCompletions`, and readers no longer look at `eventTaskCompletions`
 * for team-level tasks. This migration preserves the existing "done" state by
 * scanning every team-level task and, when it has NO shared row yet but DOES have
 * a per-user completion from a CONFIRMED member of the task's team, inserting a
 * shared row (using that completion's author + timestamp).
 *
 * Idempotent: a task that already has a `sharedTaskCompletions` row is skipped,
 * so re-running is a no-op. The confirmed-member filter mirrors the old
 * readers — a per-user row from a non-teammate (the old per-user toggle only
 * checked group, not team, membership) does NOT seed a completion.
 *
 * Run once per deployment after deploy:
 *   npx convex run functions/scheduling/eventTasks:backfillTeamLevelSharedCompletions
 */
export const backfillTeamLevelSharedCompletions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tasks = await ctx.db.query("eventTasks").collect();
    const teamLevelTasks = tasks.filter((t) => isTeamLevel(t));

    // Cache of confirmed assignees per plan (userId set keyed by teamId), so we
    // load each plan's roleAssignments at most once.
    const confirmedByPlan = new Map<string, Map<string, Set<string>>>();
    const confirmedForPlan = async (planId: Id<"eventPlans">) => {
      const key = planId as string;
      const cached = confirmedByPlan.get(key);
      if (cached) return cached;
      const assignments = await ctx.db
        .query("roleAssignments")
        .withIndex("by_plan", (q) => q.eq("planId", planId))
        .collect();
      const byTeam = new Map<string, Set<string>>();
      for (const a of assignments) {
        if (a.status !== "confirmed") continue;
        const teamKey = a.teamId as string;
        let set = byTeam.get(teamKey);
        if (!set) {
          set = new Set<string>();
          byTeam.set(teamKey, set);
        }
        set.add(a.userId as string);
      }
      confirmedByPlan.set(key, byTeam);
      return byTeam;
    };

    let scanned = 0;
    let inserted = 0;
    let skippedHasShared = 0;
    let skippedNoLegacy = 0;

    for (const task of teamLevelTasks) {
      scanned += 1;

      // Idempotency: a task with a shared completion is already migrated.
      const existingShared = await ctx.db
        .query("sharedTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", task._id))
        .first();
      if (existingShared) {
        skippedHasShared += 1;
        continue;
      }

      const completions = await ctx.db
        .query("eventTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", task._id))
        .collect();
      if (completions.length === 0) {
        skippedNoLegacy += 1;
        continue;
      }

      const confirmedByTeam = await confirmedForPlan(task.planId);
      // Union of confirmed members across ALL of the task's teams.
      const confirmedTeam = new Set<string>();
      for (const teamId of taskTeamIds(task)) {
        for (const uid of confirmedByTeam.get(teamId as string) ?? [])
          confirmedTeam.add(uid);
      }
      // Only per-user rows from a CONFIRMED member of one of the task's teams
      // count. Pick the earliest such completion so the snapshot is deterministic.
      const qualifying = completions
        .filter((c) => confirmedTeam.has(c.userId as string))
        .sort((a, b) => a.completedAt - b.completedAt);
      if (qualifying.length === 0) {
        skippedNoLegacy += 1;
        continue;
      }

      const source = qualifying[0];
      await ctx.db.insert("sharedTaskCompletions", {
        taskId: task._id,
        planId: task.planId,
        communityId: task.communityId,
        completedByUserId: source.userId,
        completedAt: source.completedAt ?? Date.now(),
      });
      inserted += 1;
    }

    return { scanned, inserted, skippedHasShared, skippedNoLegacy };
  },
});

/**
 * One-time backfill: populate the multi-assign `teamIds` / `roleIds` arrays on
 * every `eventTasks` row from the legacy single `teamId` / `roleId` columns.
 *
 * All reads go through `taskTeamIds()` / `taskRoleIds()`, which fall back to the
 * legacy columns, so correctness does not depend on this having run. It exists
 * so the legacy columns can be dropped in a follow-up:
 *   TODO(followup): after this has run in all envs, remove `teamId` / `roleId`
 *   from the `eventTasks` schema and this migration.
 *
 * Idempotent: a task that already has `teamIds` set is skipped, so re-running is
 * a no-op. A legacy `roleId` of null becomes an empty `roleIds` (team-level).
 *
 * Run once per deployment after deploy:
 *   npx convex run functions/scheduling/eventTasks:backfillTaskAssignmentArrays
 */
export const backfillTaskAssignmentArrays = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tasks = await ctx.db.query("eventTasks").collect();
    let scanned = 0;
    let migrated = 0;
    let skippedHasArrays = 0;
    for (const task of tasks) {
      scanned += 1;
      if (task.teamIds !== undefined) {
        skippedHasArrays += 1;
        continue;
      }
      await ctx.db.patch(task._id, {
        teamIds: task.teamId ? [task.teamId] : [],
        roleIds: task.roleId ? [task.roleId] : [],
      });
      migrated += 1;
    }
    return { scanned, migrated, skippedHasArrays };
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
    // A multi-role task appears under each of its roles, so each person in any
    // of those roles sees it in their crew row.
    const tasksByRole = new Map<string, Doc<"eventTasks">[]>();
    for (const t of tasks) {
      for (const roleId of taskRoleIds(t)) {
        const key = roleId as string;
        const list = tasksByRole.get(key) ?? [];
        list.push(t);
        tasksByRole.set(key, list);
      }
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
    /** Role(s) responsible for this task ON THIS team; empty => team-level. */
    roleNames: string[];
    completed: boolean;
    howToType: string;
  }>;
};

/**
 * The "All-teams" surface: a READ-ONLY overview of every team on the plan and
 * its tasks, so a volunteer can see the whole event's shape and progress.
 *
 * `done`/`total` here use the plan-wide READINESS semantics (same as
 * `getPlanTaskReadiness`), one model per task kind:
 *   • Role tasks (`roleId != null`): PER-USER — `total` is the number of
 *     confirmed assignees expected to complete it (× the number of service
 *     times for "during" tasks), `done` counts valid completions from those
 *     assignees, and `completed` is true when fully satisfied (done >= total,
 *     total > 0).
 *   • Team-level tasks (`roleId == null`): TEAM-WIDE — a single slot
 *     (`total = 1`) completed via `sharedTaskCompletions` (the Shared tab).
 *     Single-source: `done`/`completed` reflect whether a shared completion row
 *     exists (pre-migration per-user completions were backfilled into it).
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

    // Role -> teamId, resolved lazily, so we can bucket a task's roles by team
    // and label each team's slice of a multi-role task.
    const roleTeam = new Map<string, string>();
    const roleTeamFor = async (id: Id<"teamRoles">): Promise<string | null> => {
      const key = id as string;
      if (!roleTeam.has(key)) {
        const role = await ctx.db.get(id);
        if (role) roleTeam.set(key, role.teamId as string);
      }
      return roleTeam.get(key) ?? null;
    };
    const roleNameFor = async (id: Id<"teamRoles">): Promise<string> => {
      const key = id as string;
      if (!roleNames.has(key)) {
        const role = await ctx.db.get(id);
        roleNames.set(key, role?.name ?? "Role");
      }
      return roleNames.get(key)!;
    };
    const entryFor = async (teamId: Id<"teams">): Promise<AllTeamsEntry> => {
      const teamKey = teamId as string;
      if (!teamNames.has(teamKey)) {
        const team = await ctx.db.get(teamId);
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
      return entry;
    };

    for (const task of tasks) {
      const teamIds = taskTeamIds(task);
      const roleIds = taskRoleIds(task);

      if (roleIds.length === 0) {
        // Team-level task: a single TEAM-WIDE slot completed via
        // `sharedTaskCompletions` (the Shared surface). It shows under EACH team
        // it spans, each crediting the whole shared checkbox.
        const sharedDone = sharedByTask.has(task._id as string);
        for (const teamId of teamIds) {
          const entry = await entryFor(teamId);
          entry.taskCount += 1;
          entry.total += 1;
          entry.done += sharedDone ? 1 : 0;
          entry.tasks.push({
            taskId: task._id as string,
            title: task.title,
            segment: task.segment,
            roleNames: [],
            completed: sharedDone,
            howToType: task.howToType,
          });
        }
        continue;
      }

      // Role task: PER-USER readiness, partitioned by team (a role belongs to
      // exactly one team). Under each team the task shows only that team's
      // roles + that team's assignees.
      const expected = assigneesForTask(assignments, task);
      const completions = await ctx.db
        .query("eventTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", task._id))
        .collect();
      const countValid = (allowed: Set<string>): number =>
        completions.filter((c) => {
          if (!allowed.has(c.userId as string)) return false;
          if (task.segment === "during") {
            if (plan.times.length === 0) return c.timeLabel == null;
            return c.timeLabel != null && validTimeLabels.has(c.timeLabel);
          }
          return true;
        }).length;

      // Group the task's roles by their owning team.
      const rolesForTeam = new Map<string, Id<"teamRoles">[]>();
      for (const roleId of roleIds) {
        const teamKey = await roleTeamFor(roleId);
        if (!teamKey) continue;
        const list = rolesForTeam.get(teamKey) ?? [];
        list.push(roleId);
        rolesForTeam.set(teamKey, list);
      }

      for (const teamId of teamIds) {
        const teamKey = teamId as string;
        const teamRoleIds = rolesForTeam.get(teamKey) ?? [];
        if (teamRoleIds.length === 0) continue; // no roles for this team
        const teamUserIds = new Set(
          expected
            .filter((a) => (a.teamId as string) === teamKey)
            .map((a) => a.userId as string),
        );
        const teamPeople = teamUserIds.size;
        const total =
          task.segment === "during" ? teamPeople * timesCount : teamPeople;
        const done = Math.min(countValid(teamUserIds), total);
        const completed = total > 0 && done >= total;

        const entry = await entryFor(teamId);
        entry.taskCount += 1;
        entry.total += total;
        entry.done += done;
        entry.tasks.push({
          taskId: task._id as string,
          title: task.title,
          segment: task.segment,
          roleNames: await Promise.all(teamRoleIds.map(roleNameFor)),
          completed,
          howToType: task.howToType,
        });
      }
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
