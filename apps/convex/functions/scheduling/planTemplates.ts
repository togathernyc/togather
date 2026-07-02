/**
 * Scheduling — plan ↔ template linkage + forward propagation (Phase 3).
 *
 * A plan can LINK to a task template and (independently) a run-sheet template.
 * A linked plan still OWNS its own `eventTasks` / `eventItems` rows — they are
 * MATERIALIZED from the template's items, each carrying a `sourceTemplateItemId`
 * back-pointer. Template edits propagate FORWARD to FUTURE linked plans; PAST
 * plans (eventDate < now) are FROZEN and never touched.
 *
 * Row semantics (identical for `eventTasks` and `eventItems`):
 *   • `sourceTemplateItemId` set + `templateDetached` falsy  → SYNCED:
 *     propagation updates/deletes the row to match the template.
 *   • `sourceTemplateItemId` set + `templateDetached` true   → OVERRIDDEN:
 *     the user locally edited it; propagation leaves it alone.
 *   • `sourceTemplateItemId` unset                           → LOCAL: a plain
 *     plan-owned row; propagation ignores it.
 *   • a template item id in the plan's `detached…ItemIds`    → the user removed
 *     it locally; propagation must NOT re-add it.
 *
 * The override marking (detach on local edit, record on local delete) lives in
 * `eventTasks.ts` / `eventItems.ts`; this file owns the plan-level link/switch/
 * save/revert mutations and the propagation reconcilers that template item
 * mutations (`taskTemplates.ts` / `runSheetTemplates.ts`) call after every edit.
 *
 * Auth mirrors the rest of the module: `requireGroupScheduler` /
 * `requirePlanScheduler` (group leader / community admin).
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { requireGroupMember, requirePlanScheduler } from "./permissions";
import { taskTeamIds, taskRoleIds, cascadeTaskCompletions } from "./eventTasks";

/** before < during < after ordering rank. */
const SEGMENT_RANK: Record<string, number> = { before: 0, during: 1, after: 2 };

/** A plan is frozen once its event date has passed. */
function isPastPlan(plan: Doc<"eventPlans">): boolean {
  return plan.eventDate < Date.now();
}

/**
 * Validate a template name — 1–50 chars, at least one letter/number. Mirrors
 * `validateTemplateName` in `taskTemplates.ts` / `runSheetTemplates.ts`.
 */
function validateTemplateName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 50) {
    throw new ConvexError("Template name must be 1-50 characters.");
  }
  if (!/[a-zA-Z0-9]/.test(trimmed)) {
    throw new ConvexError(
      "Template name must contain at least one letter or number.",
    );
  }
  return trimmed;
}

// ============================================================================
// Read-side contract for the linkage UI (Phase 4)
// ============================================================================

/**
 * The plan's template-linkage state for the event editor: which template(s) it
 * is linked to (id + name), whether the plan's list has local edits away from
 * the template (so the UI can offer "revert"), and whether the plan is frozen
 * (past — switching disabled).
 *
 * `hasTaskTemplateEdits` / `hasRunSheetTemplateEdits` are true when any of the
 * plan's rows are overridden (`templateDetached`) OR locally-added
 * (`sourceTemplateItemId` unset) OR the plan has recorded locally-removed
 * template items. Note: on an UNLINKED plan every row is "locally-added", so
 * these flags are only meaningful alongside a non-null template id — the UI
 * gates its revert affordance on the id.
 *
 * Auth: an active member of the plan's group (read gate).
 */
export const getPlanTemplateState = query({
  args: { token: v.string(), planId: v.id("eventPlans") },
  returns: v.object({
    taskTemplateId: v.union(v.id("eventTaskTemplates"), v.null()),
    taskTemplateName: v.union(v.string(), v.null()),
    hasTaskTemplateEdits: v.boolean(),
    runSheetTemplateId: v.union(v.id("runSheetTemplates"), v.null()),
    runSheetTemplateName: v.union(v.string(), v.null()),
    hasRunSheetTemplateEdits: v.boolean(),
    isPast: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const plan = await ctx.db.get(args.planId);
    if (!plan) throw new ConvexError("Event not found");
    await requireGroupMember(ctx, plan.groupId, userId);

    const taskTemplate = plan.taskTemplateId
      ? await ctx.db.get(plan.taskTemplateId)
      : null;
    const runSheetTemplate = plan.runSheetTemplateId
      ? await ctx.db.get(plan.runSheetTemplateId)
      : null;

    const tasks = await ctx.db
      .query("eventTasks")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .collect();
    const items = await ctx.db
      .query("eventItems")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .collect();

    const hasTaskTemplateEdits =
      (plan.detachedTaskTemplateItemIds ?? []).length > 0 ||
      tasks.some((t) => t.templateDetached || !t.sourceTemplateItemId);
    const hasRunSheetTemplateEdits =
      (plan.detachedRunSheetTemplateItemIds ?? []).length > 0 ||
      items.some((i) => i.templateDetached || !i.sourceTemplateItemId);

    return {
      taskTemplateId: plan.taskTemplateId ?? null,
      taskTemplateName: taskTemplate?.name ?? null,
      hasTaskTemplateEdits,
      runSheetTemplateId: plan.runSheetTemplateId ?? null,
      runSheetTemplateName: runSheetTemplate?.name ?? null,
      hasRunSheetTemplateEdits,
      isPast: isPastPlan(plan),
    };
  },
});

// ============================================================================
// Copy helpers (template item → plan row) — mirror `duplicateEvent`'s per-item
// clone, tagging the new row as SYNCED against the template.
// ============================================================================

async function insertTaskFromTemplateItem(
  ctx: MutationCtx,
  plan: Doc<"eventPlans">,
  item: Doc<"eventTaskTemplateItems">,
  userId: Id<"users">,
  now: number,
): Promise<Id<"eventTasks">> {
  return ctx.db.insert("eventTasks", {
    planId: plan._id,
    communityId: plan.communityId,
    teamIds: item.teamIds,
    roleIds: item.roleIds,
    segment: item.segment,
    title: item.title,
    howToType: item.howToType,
    howToText: item.howToText,
    howToUrl: item.howToUrl,
    howToMediaPath: item.howToMediaPath,
    howToDoc: item.howToDoc,
    sortOrder: item.sortOrder,
    sourceTemplateItemId: item._id,
    templateDetached: false,
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  });
}

/** Field patch that makes a SYNCED task match its template item exactly. */
function taskPatchFromTemplateItem(
  item: Doc<"eventTaskTemplateItems">,
  now: number,
): Partial<Doc<"eventTasks">> {
  return {
    teamIds: item.teamIds,
    roleIds: item.roleIds,
    segment: item.segment,
    title: item.title,
    howToType: item.howToType,
    howToText: item.howToText,
    howToUrl: item.howToUrl,
    howToMediaPath: item.howToMediaPath,
    howToDoc: item.howToDoc,
    sortOrder: item.sortOrder,
    updatedAt: now,
  };
}

async function insertItemFromTemplateItem(
  ctx: MutationCtx,
  plan: Doc<"eventPlans">,
  item: Doc<"runSheetTemplateItems">,
  userId: Id<"users">,
  now: number,
): Promise<Id<"eventItems">> {
  return ctx.db.insert("eventItems", {
    planId: plan._id,
    communityId: plan.communityId,
    segment: item.segment ?? "during",
    sequence: item.sequence,
    type: item.type,
    title: item.title,
    description: item.description,
    durationSec: item.durationSec,
    notes: item.notes,
    assignments: item.assignments,
    songDetails: item.songDetails,
    songId: item.songId,
    sourceTemplateItemId: item._id,
    templateDetached: false,
    createdAt: now,
    createdById: userId,
    updatedAt: now,
  });
}

/** Field patch that makes a SYNCED run-sheet item match its template item. */
function itemPatchFromTemplateItem(
  item: Doc<"runSheetTemplateItems">,
  now: number,
): Partial<Doc<"eventItems">> {
  return {
    segment: item.segment ?? "during",
    sequence: item.sequence,
    type: item.type,
    title: item.title,
    description: item.description,
    durationSec: item.durationSec,
    notes: item.notes,
    assignments: item.assignments,
    songDetails: item.songDetails,
    songId: item.songId,
    updatedAt: now,
  };
}

// ============================================================================
// Forward propagation — called at the end of every template ITEM mutation.
// Reconciles each FUTURE linked plan's template-sourced rows to the current
// template items. PAST plans are never touched.
// ============================================================================

/**
 * Propagate a task template's current items to every FUTURE plan linked to it:
 * SYNCED rows are patched to match, missing items are inserted (unless the user
 * removed them locally), OVERRIDDEN rows are left alone, and SYNCED rows whose
 * template item was deleted are removed (with their completions cascaded).
 */
export async function propagateTaskTemplate(
  ctx: MutationCtx,
  templateId: Id<"eventTaskTemplates">,
  actorId?: Id<"users">,
): Promise<void> {
  const template = await ctx.db.get(templateId);
  if (!template) return;
  const now = Date.now();

  const plans = await ctx.db
    .query("eventPlans")
    .withIndex("by_task_template", (q) => q.eq("taskTemplateId", templateId))
    .collect();
  const futurePlans = plans.filter((p) => p.eventDate >= now);
  if (futurePlans.length === 0) return;

  const items = await ctx.db
    .query("eventTaskTemplateItems")
    .withIndex("by_template", (q) => q.eq("templateId", templateId))
    .collect();
  const itemIds = new Set(items.map((i) => i._id as string));

  for (const plan of futurePlans) {
    const tasks = await ctx.db
      .query("eventTasks")
      .withIndex("by_plan", (q) => q.eq("planId", plan._id))
      .collect();
    const detached = new Set(
      (plan.detachedTaskTemplateItemIds ?? []).map((id) => id as string),
    );
    const bySource = new Map<string, Doc<"eventTasks">>();
    for (const t of tasks) {
      if (t.sourceTemplateItemId) bySource.set(t.sourceTemplateItemId as string, t);
    }

    // Upsert: patch synced rows, insert missing items (unless detached),
    // skip overridden rows.
    for (const item of items) {
      const existing = bySource.get(item._id as string);
      if (existing) {
        if (existing.templateDetached) continue; // overridden — leave it
        const wasTeamLevel = taskRoleIds(existing).length === 0;
        const nowTeamLevel = item.roleIds.length === 0;
        await ctx.db.patch(existing._id, taskPatchFromTemplateItem(item, now));
        // If the task flipped between role and team-level, its old completion
        // model is stale — clear it (mirrors updateTask's cleanup).
        if (wasTeamLevel !== nowTeamLevel) {
          await cascadeTaskCompletions(ctx, existing._id);
        }
      } else {
        if (detached.has(item._id as string)) continue; // removed locally
        await insertTaskFromTemplateItem(
          ctx,
          plan,
          item,
          actorId ?? plan.createdById,
          now,
        );
      }
    }

    // Delete synced rows whose template item no longer exists.
    for (const t of tasks) {
      if (!t.sourceTemplateItemId || t.templateDetached) continue;
      if (itemIds.has(t.sourceTemplateItemId as string)) continue;
      await cascadeTaskCompletions(ctx, t._id);
      await ctx.db.delete(t._id);
    }
  }
}

/**
 * Run-sheet sibling of `propagateTaskTemplate`. `eventItems` have no completion
 * records, so removed rows are simply deleted.
 */
export async function propagateRunSheetTemplate(
  ctx: MutationCtx,
  templateId: Id<"runSheetTemplates">,
  actorId?: Id<"users">,
): Promise<void> {
  const template = await ctx.db.get(templateId);
  if (!template) return;
  const now = Date.now();

  const plans = await ctx.db
    .query("eventPlans")
    .withIndex("by_run_sheet_template", (q) =>
      q.eq("runSheetTemplateId", templateId),
    )
    .collect();
  const futurePlans = plans.filter((p) => p.eventDate >= now);
  if (futurePlans.length === 0) return;

  const items = await ctx.db
    .query("runSheetTemplateItems")
    .withIndex("by_template", (q) => q.eq("templateId", templateId))
    .collect();
  const itemIds = new Set(items.map((i) => i._id as string));

  for (const plan of futurePlans) {
    const rows = await ctx.db
      .query("eventItems")
      .withIndex("by_plan", (q) => q.eq("planId", plan._id))
      .collect();
    const detached = new Set(
      (plan.detachedRunSheetTemplateItemIds ?? []).map((id) => id as string),
    );
    const bySource = new Map<string, Doc<"eventItems">>();
    for (const r of rows) {
      if (r.sourceTemplateItemId) bySource.set(r.sourceTemplateItemId as string, r);
    }

    for (const item of items) {
      const existing = bySource.get(item._id as string);
      if (existing) {
        if (existing.templateDetached) continue;
        await ctx.db.patch(existing._id, itemPatchFromTemplateItem(item, now));
      } else {
        if (detached.has(item._id as string)) continue;
        await insertItemFromTemplateItem(
          ctx,
          plan,
          item,
          actorId ?? plan.createdById,
          now,
        );
      }
    }

    for (const r of rows) {
      if (!r.sourceTemplateItemId || r.templateDetached) continue;
      if (itemIds.has(r.sourceTemplateItemId as string)) continue;
      await ctx.db.delete(r._id);
    }
  }
}

// ============================================================================
// Plan → template LINK / SWITCH / UNLINK
// ============================================================================

const carryoverValidator = v.union(v.literal("discard"), v.literal("copy"));

/**
 * Link (or switch, or unlink) a plan's TASK template.
 *
 * - `templateId` null → UNLINK: strip the template tags from every
 *   template-sourced task (they become plain local rows) and clear the pointer.
 * - `templateId` set → LINK/SWITCH: remove the plan's currently-SYNCED template
 *   rows, then INSTANTIATE the new template's items as fresh synced rows.
 *   `carryover` controls the user's edited/added rows: "discard" drops
 *   overridden + local rows; "copy" keeps them as plain local rows alongside
 *   the new template rows. Roster / completions are never touched.
 *
 * Auth: `requireGroupScheduler` (via `requirePlanScheduler`). Only UPCOMING
 * plans may (re)link — a past plan is frozen.
 */
export const setPlanTaskTemplate = mutation({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
    templateId: v.union(v.id("eventTaskTemplates"), v.null()),
    carryover: v.optional(carryoverValidator),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const { plan } = await requirePlanScheduler(ctx, args.planId, userId);
    if (isPastPlan(plan)) {
      throw new ConvexError("Past events are frozen and cannot be re-linked.");
    }
    const now = Date.now();
    const tasks = await ctx.db
      .query("eventTasks")
      .withIndex("by_plan", (q) => q.eq("planId", plan._id))
      .collect();

    if (args.templateId === null) {
      // UNLINK — leave rows as plain plan-owned (strip the source tags).
      await Promise.all(
        tasks
          .filter((t) => t.sourceTemplateItemId)
          .map((t) =>
            ctx.db.patch(t._id, {
              sourceTemplateItemId: undefined,
              templateDetached: undefined,
              updatedAt: now,
            }),
          ),
      );
      await ctx.db.patch(plan._id, {
        taskTemplateId: undefined,
        detachedTaskTemplateItemIds: undefined,
        updatedAt: now,
      });
      return { planId: plan._id, templateId: null };
    }

    // LINK / SWITCH.
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new ConvexError("Task template not found");
    if (template.groupId !== plan.groupId) {
      throw new ConvexError("Template belongs to a different group");
    }
    const carryover = args.carryover ?? "discard";

    for (const t of tasks) {
      if (t.sourceTemplateItemId && !t.templateDetached) {
        // Currently-synced against the old template → remove (re-instantiated).
        await cascadeTaskCompletions(ctx, t._id);
        await ctx.db.delete(t._id);
      } else if (t.sourceTemplateItemId) {
        // Overridden (edited) row.
        if (carryover === "copy") {
          await ctx.db.patch(t._id, {
            sourceTemplateItemId: undefined,
            templateDetached: undefined,
            updatedAt: now,
          });
        } else {
          await cascadeTaskCompletions(ctx, t._id);
          await ctx.db.delete(t._id);
        }
      } else if (carryover === "discard") {
        // Local (user-added) row.
        await cascadeTaskCompletions(ctx, t._id);
        await ctx.db.delete(t._id);
      }
    }

    const items = await ctx.db
      .query("eventTaskTemplateItems")
      .withIndex("by_template", (q) => q.eq("templateId", template._id))
      .collect();
    for (const item of items) {
      await insertTaskFromTemplateItem(ctx, plan, item, userId, now);
    }
    await ctx.db.patch(plan._id, {
      taskTemplateId: template._id,
      detachedTaskTemplateItemIds: [],
      updatedAt: now,
    });
    return { planId: plan._id, templateId: template._id };
  },
});

/**
 * Run-sheet sibling of `setPlanTaskTemplate`. Same link/switch/unlink + carryover
 * semantics over `eventItems` / `runSheetTemplates`.
 */
export const setPlanRunSheetTemplate = mutation({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
    templateId: v.union(v.id("runSheetTemplates"), v.null()),
    carryover: v.optional(carryoverValidator),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const { plan } = await requirePlanScheduler(ctx, args.planId, userId);
    if (isPastPlan(plan)) {
      throw new ConvexError("Past events are frozen and cannot be re-linked.");
    }
    const now = Date.now();
    const rows = await ctx.db
      .query("eventItems")
      .withIndex("by_plan", (q) => q.eq("planId", plan._id))
      .collect();

    if (args.templateId === null) {
      await Promise.all(
        rows
          .filter((r) => r.sourceTemplateItemId)
          .map((r) =>
            ctx.db.patch(r._id, {
              sourceTemplateItemId: undefined,
              templateDetached: undefined,
              updatedAt: now,
            }),
          ),
      );
      await ctx.db.patch(plan._id, {
        runSheetTemplateId: undefined,
        detachedRunSheetTemplateItemIds: undefined,
        updatedAt: now,
      });
      return { planId: plan._id, templateId: null };
    }

    const template = await ctx.db.get(args.templateId);
    if (!template) throw new ConvexError("Run sheet template not found");
    if (template.groupId !== plan.groupId) {
      throw new ConvexError("Template belongs to a different group");
    }
    const carryover = args.carryover ?? "discard";

    for (const r of rows) {
      if (r.sourceTemplateItemId && !r.templateDetached) {
        await ctx.db.delete(r._id);
      } else if (r.sourceTemplateItemId) {
        if (carryover === "copy") {
          await ctx.db.patch(r._id, {
            sourceTemplateItemId: undefined,
            templateDetached: undefined,
            updatedAt: now,
          });
        } else {
          await ctx.db.delete(r._id);
        }
      } else if (carryover === "discard") {
        await ctx.db.delete(r._id);
      }
    }

    const items = await ctx.db
      .query("runSheetTemplateItems")
      .withIndex("by_template", (q) => q.eq("templateId", template._id))
      .collect();
    for (const item of items) {
      await insertItemFromTemplateItem(ctx, plan, item, userId, now);
    }
    await ctx.db.patch(plan._id, {
      runSheetTemplateId: template._id,
      detachedRunSheetTemplateItemIds: [],
      updatedAt: now,
    });
    return { planId: plan._id, templateId: template._id };
  },
});

// ============================================================================
// Save a plan's current list AS a template
// ============================================================================

const taskSaveModeValidator = v.union(
  v.object({ kind: v.literal("new"), name: v.string() }),
  v.object({
    kind: v.literal("existing"),
    templateId: v.id("eventTaskTemplates"),
    strategy: v.union(v.literal("replace"), v.literal("merge")),
  }),
);

/**
 * Save a plan's CURRENT task list as a template.
 *
 * - `{kind:"new", name}` → create a new task template in the plan's group,
 *   copy every current task into it, and LINK the plan to it (its rows become
 *   synced against the new template).
 * - `{kind:"existing", templateId, strategy}` → "replace" clears the template
 *   and repopulates it from the plan (then relinks the source plan clean);
 *   "merge" appends the plan's tasks to the template. Both propagate forward to
 *   the template's other future plans.
 *
 * Auth: `requireGroupScheduler`; the template must be in the plan's group.
 */
export const saveTaskTemplateFromPlan = mutation({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
    mode: taskSaveModeValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const { plan } = await requirePlanScheduler(ctx, args.planId, userId);
    const now = Date.now();

    const tasks = await ctx.db
      .query("eventTasks")
      .withIndex("by_plan", (q) => q.eq("planId", plan._id))
      .collect();
    tasks.sort(
      (a, b) =>
        (SEGMENT_RANK[a.segment] ?? 1) - (SEGMENT_RANK[b.segment] ?? 1) ||
        a.sortOrder - b.sortOrder,
    );

    const insertItem = (
      templateId: Id<"eventTaskTemplates">,
      task: Doc<"eventTasks">,
      sortOrder: number,
    ) =>
      ctx.db.insert("eventTaskTemplateItems", {
        templateId,
        communityId: plan.communityId,
        teamIds: taskTeamIds(task),
        roleIds: taskRoleIds(task),
        segment: task.segment,
        title: task.title,
        howToType: task.howToType,
        howToText: task.howToText,
        howToUrl: task.howToUrl,
        howToMediaPath: task.howToMediaPath,
        howToDoc: task.howToDoc,
        sortOrder,
        createdById: userId,
        createdAt: now,
        updatedAt: now,
      });

    if (args.mode.kind === "new") {
      const name = validateTemplateName(args.mode.name);
      const templateId = await ctx.db.insert("eventTaskTemplates", {
        groupId: plan.groupId,
        communityId: plan.communityId,
        name,
        createdById: userId,
        createdAt: now,
        updatedAt: now,
      });
      // Copy every task, then link the plan clean against the new template.
      for (const task of tasks) {
        const itemId = await insertItem(templateId, task, task.sortOrder);
        await ctx.db.patch(task._id, {
          sourceTemplateItemId: itemId,
          templateDetached: false,
          updatedAt: now,
        });
      }
      await ctx.db.patch(plan._id, {
        taskTemplateId: templateId,
        detachedTaskTemplateItemIds: [],
        updatedAt: now,
      });
      return { templateId };
    }

    // existing.
    const templateId = args.mode.templateId;
    const template = await ctx.db.get(templateId);
    if (!template) throw new ConvexError("Task template not found");
    if (template.groupId !== plan.groupId) {
      throw new ConvexError("Template belongs to a different group");
    }

    if (args.mode.strategy === "replace") {
      const existingItems = await ctx.db
        .query("eventTaskTemplateItems")
        .withIndex("by_template", (q) => q.eq("templateId", templateId))
        .collect();
      await Promise.all(existingItems.map((i) => ctx.db.delete(i._id)));
      for (const task of tasks) {
        const itemId = await insertItem(templateId, task, task.sortOrder);
        await ctx.db.patch(task._id, {
          sourceTemplateItemId: itemId,
          templateDetached: false,
          updatedAt: now,
        });
      }
      await ctx.db.patch(plan._id, {
        taskTemplateId: templateId,
        detachedTaskTemplateItemIds: [],
        updatedAt: now,
      });
      await ctx.db.patch(templateId, { updatedAt: now });
      // The source plan is now fully synced (no-op for it); this updates the
      // template's OTHER future plans.
      await propagateTaskTemplate(ctx, templateId, userId);
      return { templateId };
    }

    // merge — append the plan's tasks as new items.
    const existingItems = await ctx.db
      .query("eventTaskTemplateItems")
      .withIndex("by_template", (q) => q.eq("templateId", templateId))
      .collect();
    const maxBySegment: Record<string, number> = {
      before: -1,
      during: -1,
      after: -1,
    };
    for (const it of existingItems) {
      maxBySegment[it.segment] = Math.max(maxBySegment[it.segment], it.sortOrder);
    }
    const newItemIds: Id<"eventTaskTemplateItems">[] = [];
    for (const task of tasks) {
      const sortOrder = ++maxBySegment[task.segment];
      newItemIds.push(await insertItem(templateId, task, sortOrder));
    }
    await ctx.db.patch(templateId, { updatedAt: now });
    // If the SOURCE plan is itself linked to this template, mark the appended
    // copies as locally-removed for it so propagation doesn't add them back as
    // duplicate rows (they came from this plan). Merge does not relink.
    if (plan.taskTemplateId === templateId) {
      await ctx.db.patch(plan._id, {
        detachedTaskTemplateItemIds: [
          ...(plan.detachedTaskTemplateItemIds ?? []),
          ...newItemIds,
        ],
      });
    }
    await propagateTaskTemplate(ctx, templateId, userId);
    return { templateId };
  },
});

const runSheetSaveModeValidator = v.union(
  v.object({ kind: v.literal("new"), name: v.string() }),
  v.object({
    kind: v.literal("existing"),
    templateId: v.id("runSheetTemplates"),
    strategy: v.union(v.literal("replace"), v.literal("merge")),
  }),
);

/** Run-sheet sibling of `saveTaskTemplateFromPlan`. */
export const saveRunSheetTemplateFromPlan = mutation({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
    mode: runSheetSaveModeValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const { plan } = await requirePlanScheduler(ctx, args.planId, userId);
    const now = Date.now();

    const rows = await ctx.db
      .query("eventItems")
      .withIndex("by_plan", (q) => q.eq("planId", plan._id))
      .collect();
    const seg = (r: Doc<"eventItems">) => r.segment ?? "during";
    rows.sort(
      (a, b) =>
        (SEGMENT_RANK[seg(a)] ?? 1) - (SEGMENT_RANK[seg(b)] ?? 1) ||
        a.sequence - b.sequence,
    );

    const insertItem = (
      templateId: Id<"runSheetTemplates">,
      row: Doc<"eventItems">,
      sequence: number,
    ) =>
      ctx.db.insert("runSheetTemplateItems", {
        templateId,
        communityId: plan.communityId,
        segment: seg(row),
        sequence,
        type: row.type,
        title: row.title,
        description: row.description,
        durationSec: row.durationSec,
        notes: row.notes,
        assignments: row.assignments,
        songDetails: row.songDetails,
        songId: row.songId,
        createdById: userId,
        createdAt: now,
        updatedAt: now,
      });

    if (args.mode.kind === "new") {
      const name = validateTemplateName(args.mode.name);
      const templateId = await ctx.db.insert("runSheetTemplates", {
        groupId: plan.groupId,
        communityId: plan.communityId,
        name,
        createdById: userId,
        createdAt: now,
        updatedAt: now,
      });
      for (const row of rows) {
        const itemId = await insertItem(templateId, row, row.sequence);
        await ctx.db.patch(row._id, {
          sourceTemplateItemId: itemId,
          templateDetached: false,
          updatedAt: now,
        });
      }
      await ctx.db.patch(plan._id, {
        runSheetTemplateId: templateId,
        detachedRunSheetTemplateItemIds: [],
        updatedAt: now,
      });
      return { templateId };
    }

    const templateId = args.mode.templateId;
    const template = await ctx.db.get(templateId);
    if (!template) throw new ConvexError("Run sheet template not found");
    if (template.groupId !== plan.groupId) {
      throw new ConvexError("Template belongs to a different group");
    }

    if (args.mode.strategy === "replace") {
      const existingItems = await ctx.db
        .query("runSheetTemplateItems")
        .withIndex("by_template", (q) => q.eq("templateId", templateId))
        .collect();
      await Promise.all(existingItems.map((i) => ctx.db.delete(i._id)));
      for (const row of rows) {
        const itemId = await insertItem(templateId, row, row.sequence);
        await ctx.db.patch(row._id, {
          sourceTemplateItemId: itemId,
          templateDetached: false,
          updatedAt: now,
        });
      }
      await ctx.db.patch(plan._id, {
        runSheetTemplateId: templateId,
        detachedRunSheetTemplateItemIds: [],
        updatedAt: now,
      });
      await ctx.db.patch(templateId, { updatedAt: now });
      await propagateRunSheetTemplate(ctx, templateId, userId);
      return { templateId };
    }

    // merge.
    const existingItems = await ctx.db
      .query("runSheetTemplateItems")
      .withIndex("by_template", (q) => q.eq("templateId", templateId))
      .collect();
    const maxBySegment: Record<string, number> = {
      before: -1,
      during: -1,
      after: -1,
    };
    for (const it of existingItems) {
      const s = it.segment ?? "during";
      maxBySegment[s] = Math.max(maxBySegment[s], it.sequence);
    }
    const newItemIds: Id<"runSheetTemplateItems">[] = [];
    for (const row of rows) {
      const sequence = ++maxBySegment[seg(row)];
      newItemIds.push(await insertItem(templateId, row, sequence));
    }
    await ctx.db.patch(templateId, { updatedAt: now });
    if (plan.runSheetTemplateId === templateId) {
      await ctx.db.patch(plan._id, {
        detachedRunSheetTemplateItemIds: [
          ...(plan.detachedRunSheetTemplateItemIds ?? []),
          ...newItemIds,
        ],
      });
    }
    await propagateRunSheetTemplate(ctx, templateId, userId);
    return { templateId };
  },
});

// ============================================================================
// Revert a plan's edits back to the linked template
// ============================================================================

/**
 * Revert a plan's TASK list to its linked template: drop every current task
 * (overridden + local included, cascading completions), clear the detached set,
 * and re-instantiate the template's items as fresh synced rows. No-op if the
 * plan isn't linked (or the template no longer exists).
 *
 * Auth: `requireGroupScheduler`.
 */
export const revertPlanTaskTemplateEdits = mutation({
  args: { token: v.string(), planId: v.id("eventPlans") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const { plan } = await requirePlanScheduler(ctx, args.planId, userId);
    if (!plan.taskTemplateId) return { reverted: false };
    const template = await ctx.db.get(plan.taskTemplateId);
    if (!template) return { reverted: false };
    const now = Date.now();

    const tasks = await ctx.db
      .query("eventTasks")
      .withIndex("by_plan", (q) => q.eq("planId", plan._id))
      .collect();
    for (const t of tasks) {
      await cascadeTaskCompletions(ctx, t._id);
      await ctx.db.delete(t._id);
    }
    await ctx.db.patch(plan._id, {
      detachedTaskTemplateItemIds: [],
      updatedAt: now,
    });
    const items = await ctx.db
      .query("eventTaskTemplateItems")
      .withIndex("by_template", (q) => q.eq("templateId", template._id))
      .collect();
    for (const item of items) {
      await insertTaskFromTemplateItem(ctx, plan, item, userId, now);
    }
    return { reverted: true };
  },
});

/** Run-sheet sibling of `revertPlanTaskTemplateEdits`. */
export const revertPlanRunSheetTemplateEdits = mutation({
  args: { token: v.string(), planId: v.id("eventPlans") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const { plan } = await requirePlanScheduler(ctx, args.planId, userId);
    if (!plan.runSheetTemplateId) return { reverted: false };
    const template = await ctx.db.get(plan.runSheetTemplateId);
    if (!template) return { reverted: false };
    const now = Date.now();

    const rows = await ctx.db
      .query("eventItems")
      .withIndex("by_plan", (q) => q.eq("planId", plan._id))
      .collect();
    for (const r of rows) {
      await ctx.db.delete(r._id);
    }
    await ctx.db.patch(plan._id, {
      detachedRunSheetTemplateItemIds: [],
      updatedAt: now,
    });
    const items = await ctx.db
      .query("runSheetTemplateItems")
      .withIndex("by_template", (q) => q.eq("templateId", template._id))
      .collect();
    for (const item of items) {
      await insertItemFromTemplateItem(ctx, plan, item, userId, now);
    }
    return { reverted: true };
  },
});
