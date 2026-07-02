/**
 * Scheduling — Task templates (Phase 1 of event templates)
 *
 * An `eventTaskTemplates` row is a reusable, per-GROUP checklist a leader saves
 * for a location and can later apply to a plan's `eventTasks`. Its items
 * (`eventTaskTemplateItems`) mirror `eventTasks` minus the `planId`, using ONLY the
 * multi-assign array role model: `teamIds` (>= 1) + `roleIds` (empty => a
 * team-level task). There is no completion state — a template is never "done";
 * it seeds a plan's tasks (plan linkage / propagation land in later phases).
 *
 * Auth mirrors `eventTasks`: viewing requires an active group member
 * (`requireGroupMember`); editing requires `requireGroupScheduler` (group
 * leader / community admin). Like the rest of the backend, every function takes
 * a JWT `token` and resolves the user via `requireAuth`.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { requireGroupMember, requireGroupScheduler } from "./permissions";

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

/** before < during < after ordering rank for a template item/segment. */
const SEGMENT_RANK: Record<string, number> = { before: 0, during: 1, after: 2 };

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

/**
 * Validate a template name — same rule as `createCrossTeamChannel` /
 * `createCustomChannel`: 1–50 characters, at least one letter or number.
 * Returns the trimmed name.
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

/**
 * Load a template or throw. Shared by item functions that key off a
 * `templateId`.
 */
async function requireTaskTemplate(
  ctx: QueryCtx | MutationCtx,
  templateId: Id<"eventTaskTemplates">,
): Promise<Doc<"eventTaskTemplates">> {
  const template = await ctx.db.get(templateId);
  if (!template) {
    throw new ConvexError("Task template not found");
  }
  return template;
}

/**
 * Resolve a template and assert the caller may edit its group's schedule.
 * Returns the template (its `groupId` is the edit gate).
 */
async function requireTaskTemplateScheduler(
  ctx: MutationCtx,
  templateId: Id<"eventTaskTemplates">,
  userId: Id<"users">,
): Promise<Doc<"eventTaskTemplates">> {
  const template = await requireTaskTemplate(ctx, templateId);
  await requireGroupScheduler(ctx, template.groupId, userId);
  return template;
}

/**
 * Validate a template item's `teamIds` / `roleIds` against the template's
 * group: every team must belong to the group, and every role must belong to one
 * of the item's teams. Mirrors the checks in `eventTasks.createTask`. Returns
 * the deduped arrays.
 */
async function validateItemTeamsRoles(
  ctx: MutationCtx,
  template: Doc<"eventTaskTemplates">,
  rawTeamIds: Id<"teams">[],
  rawRoleIds: Id<"teamRoles">[],
): Promise<{ teamIds: Id<"teams">[]; roleIds: Id<"teamRoles">[] }> {
  const teamIds = dedupeIds(rawTeamIds);
  if (teamIds.length === 0) {
    throw new ConvexError("A task must belong to at least one team");
  }
  const teamIdSet = new Set(teamIds as string[]);
  for (const teamId of teamIds) {
    const team = await ctx.db.get(teamId);
    if (!team || team.groupId !== template.groupId) {
      throw new ConvexError("Team does not belong to this template's group");
    }
  }
  const roleIds = dedupeIds(rawRoleIds);
  for (const roleId of roleIds) {
    const role = await ctx.db.get(roleId);
    if (!role || !teamIdSet.has(role.teamId as string)) {
      throw new ConvexError("Role does not belong to one of the task's teams");
    }
  }
  return { teamIds, roleIds };
}

/**
 * Next append `sortOrder` within a (template, segment) bucket. Mirrors
 * `nextTaskSortOrder` for `eventTasks`.
 */
async function nextItemSortOrder(
  ctx: MutationCtx,
  templateId: Id<"eventTaskTemplates">,
  segment: "before" | "during" | "after",
): Promise<number> {
  const inSegment = await ctx.db
    .query("eventTaskTemplateItems")
    .withIndex("by_template_segment", (q) =>
      q.eq("templateId", templateId).eq("segment", segment),
    )
    .collect();
  if (inSegment.length === 0) return 0;
  return Math.max(...inSegment.map((i) => i.sortOrder)) + 1;
}

// ============================================================================
// Templates
// ============================================================================

/**
 * Create an empty task template for a group.
 *
 * Auth: group leader / community admin for the group.
 */
export const createTaskTemplate = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    name: v.string(),
  },
  returns: v.object({ templateId: v.id("eventTaskTemplates") }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const group = await requireGroupScheduler(ctx, args.groupId, userId);

    const name = validateTemplateName(args.name);
    const nowMs = Date.now();
    const templateId = await ctx.db.insert("eventTaskTemplates", {
      groupId: args.groupId,
      communityId: group.communityId,
      name,
      createdById: userId,
      createdAt: nowMs,
      updatedAt: nowMs,
    });
    return { templateId };
  },
});

/**
 * Rename a task template.
 *
 * Auth: group leader / community admin for the template's group.
 */
export const renameTaskTemplate = mutation({
  args: {
    token: v.string(),
    templateId: v.id("eventTaskTemplates"),
    name: v.string(),
  },
  returns: v.object({ templateId: v.id("eventTaskTemplates") }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireTaskTemplateScheduler(ctx, args.templateId, userId);

    const name = validateTemplateName(args.name);
    await ctx.db.patch(args.templateId, { name, updatedAt: Date.now() });
    return { templateId: args.templateId };
  },
});

/**
 * Delete a task template and cascade all of its items.
 *
 * Auth: group leader / community admin for the template's group.
 */
export const deleteTaskTemplate = mutation({
  args: {
    token: v.string(),
    templateId: v.id("eventTaskTemplates"),
  },
  returns: v.object({ deletedItems: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireTaskTemplateScheduler(ctx, args.templateId, userId);

    const items = await ctx.db
      .query("eventTaskTemplateItems")
      .withIndex("by_template", (q) => q.eq("templateId", args.templateId))
      .collect();
    await Promise.all(items.map((i) => ctx.db.delete(i._id)));
    await ctx.db.delete(args.templateId);
    return { deletedItems: items.length };
  },
});

/**
 * List a group's task templates, each with its `itemCount`.
 *
 * Auth: an active member of the group (community read gate).
 */
export const listTaskTemplates = query({
  args: { token: v.string(), groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireGroupMember(ctx, args.groupId, userId);

    const templates = await ctx.db
      .query("eventTaskTemplates")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    templates.sort((a, b) => a.createdAt - b.createdAt);

    return Promise.all(
      templates.map(async (template) => {
        const items = await ctx.db
          .query("eventTaskTemplateItems")
          .withIndex("by_template", (q) => q.eq("templateId", template._id))
          .collect();
        return {
          _id: template._id,
          groupId: template.groupId,
          name: template.name,
          itemCount: items.length,
          createdAt: template.createdAt,
          updatedAt: template.updatedAt,
        };
      }),
    );
  },
});

/**
 * List a template's items, ordered by (segment, then sortOrder), each enriched
 * with its `teamNames` / `roleNames` — mirrors `listPlanTasks`.
 *
 * Auth: an active member of the template's group.
 */
export const listTaskTemplateItems = query({
  args: { token: v.string(), templateId: v.id("eventTaskTemplates") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const template = await requireTaskTemplate(ctx, args.templateId);
    await requireGroupMember(ctx, template.groupId, userId);

    const items = await ctx.db
      .query("eventTaskTemplateItems")
      .withIndex("by_template", (q) => q.eq("templateId", args.templateId))
      .collect();
    items.sort(
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
      items.map(async (item) => ({
        _id: item._id,
        templateId: item.templateId,
        teamIds: item.teamIds as string[],
        roleIds: item.roleIds as string[],
        teamNames: await Promise.all(item.teamIds.map(teamNameFor)),
        roleNames: await Promise.all(item.roleIds.map(roleNameFor)),
        segment: item.segment,
        title: item.title,
        howToType: item.howToType,
        howToText: item.howToText,
        howToUrl: item.howToUrl,
        howToMediaPath: item.howToMediaPath,
        howToDoc: item.howToDoc,
        sortOrder: item.sortOrder,
      })),
    );
  },
});

// ============================================================================
// Template items
// ============================================================================

/**
 * Add an item to a task template. `roleIds` empty (or omitted) => a team-level
 * task. Mirrors `eventTasks.createTask`.
 *
 * Auth: group leader / community admin for the template's group.
 */
export const addTaskTemplateItem = mutation({
  args: {
    token: v.string(),
    templateId: v.id("eventTaskTemplates"),
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
  returns: v.object({ itemId: v.id("eventTaskTemplateItems") }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const template = await requireTaskTemplateScheduler(
      ctx,
      args.templateId,
      userId,
    );

    const { teamIds, roleIds } = await validateItemTeamsRoles(
      ctx,
      template,
      args.teamIds,
      args.roleIds ?? [],
    );

    const title = args.title.trim();
    if (!title) {
      throw new ConvexError("Task title cannot be empty");
    }

    const nowMs = Date.now();
    const sortOrder = await nextItemSortOrder(ctx, args.templateId, args.segment);
    const itemId = await ctx.db.insert("eventTaskTemplateItems", {
      templateId: args.templateId,
      communityId: template.communityId,
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
    return { itemId };
  },
});

/**
 * Update a template item's editable fields. Only provided fields change; an
 * empty `roleIds` converts the item to team-level. Mirrors `eventTasks.updateTask`
 * (minus the completion cleanup — templates have no completions).
 *
 * Auth: group leader / community admin for the template's group.
 */
export const updateTaskTemplateItem = mutation({
  args: {
    token: v.string(),
    itemId: v.id("eventTaskTemplateItems"),
    title: v.optional(v.string()),
    teamIds: v.optional(v.array(v.id("teams"))),
    roleIds: v.optional(v.array(v.id("teamRoles"))),
    segment: v.optional(segmentValidator),
    howToType: v.optional(howToTypeValidator),
    howToText: v.optional(v.string()),
    howToUrl: v.optional(v.string()),
    howToMediaPath: v.optional(v.string()),
    howToDoc: v.optional(v.string()),
  },
  returns: v.object({ itemId: v.id("eventTaskTemplateItems") }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const item = await ctx.db.get(args.itemId);
    if (!item) {
      throw new ConvexError("Task template item not found");
    }
    const template = await requireTaskTemplateScheduler(
      ctx,
      item.templateId,
      userId,
    );

    const patch: Partial<Doc<"eventTaskTemplateItems">> = { updatedAt: Date.now() };
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) {
        throw new ConvexError("Task title cannot be empty");
      }
      patch.title = title;
    }

    // Resolve the effective team/role sets after this update so roles can be
    // validated against teams and dropped when their team leaves.
    const nextTeamIds =
      args.teamIds !== undefined ? dedupeIds(args.teamIds) : item.teamIds;
    if (nextTeamIds.length === 0) {
      throw new ConvexError("A task must belong to at least one team");
    }
    const teamIdSet = new Set(nextTeamIds as string[]);
    if (args.teamIds !== undefined) {
      for (const teamId of nextTeamIds) {
        const team = await ctx.db.get(teamId);
        if (!team || team.groupId !== template.groupId) {
          throw new ConvexError("Team does not belong to this template's group");
        }
      }
      patch.teamIds = nextTeamIds;
    }

    if (args.roleIds !== undefined) {
      const nextRoleIds = dedupeIds(args.roleIds);
      for (const roleId of nextRoleIds) {
        const role = await ctx.db.get(roleId);
        if (!role || !teamIdSet.has(role.teamId as string)) {
          throw new ConvexError("Role does not belong to one of the task's teams");
        }
      }
      patch.roleIds = nextRoleIds;
    } else if (args.teamIds !== undefined) {
      // Teams changed but roles weren't explicitly set: drop any role that no
      // longer belongs to one of the item's teams.
      const kept: Id<"teamRoles">[] = [];
      for (const roleId of item.roleIds) {
        const role = await ctx.db.get(roleId);
        if (role && teamIdSet.has(role.teamId as string)) kept.push(roleId);
      }
      if (kept.length !== item.roleIds.length) {
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

    await ctx.db.patch(args.itemId, patch);
    return { itemId: args.itemId };
  },
});

/**
 * Delete a single template item.
 *
 * Auth: group leader / community admin for the template's group.
 */
export const deleteTaskTemplateItem = mutation({
  args: { token: v.string(), itemId: v.id("eventTaskTemplateItems") },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const item = await ctx.db.get(args.itemId);
    if (!item) {
      throw new ConvexError("Task template item not found");
    }
    await requireTaskTemplateScheduler(ctx, item.templateId, userId);
    await ctx.db.delete(args.itemId);
    return { deleted: true };
  },
});

/**
 * Reorder a template's items by index over `orderedIds`. Ids that don't belong
 * to the template are ignored so a stale client list can't rewrite foreign rows.
 * Mirrors `eventTasks.reorderTasks`.
 *
 * Auth: group leader / community admin for the template's group.
 */
export const reorderTaskTemplateItems = mutation({
  args: {
    token: v.string(),
    templateId: v.id("eventTaskTemplates"),
    orderedIds: v.array(v.id("eventTaskTemplateItems")),
  },
  returns: v.object({ reordered: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireTaskTemplateScheduler(ctx, args.templateId, userId);

    const nowMs = Date.now();
    let index = 0;
    for (const itemId of args.orderedIds) {
      const item = await ctx.db.get(itemId);
      if (!item || item.templateId !== args.templateId) continue;
      await ctx.db.patch(itemId, { sortOrder: index, updatedAt: nowMs });
      index += 1;
    }
    return { reordered: index };
  },
});
