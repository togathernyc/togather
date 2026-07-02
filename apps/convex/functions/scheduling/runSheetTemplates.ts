/**
 * Scheduling — Run-sheet templates (Phase 1 of event templates)
 *
 * A `runSheetTemplates` row is a reusable, per-GROUP order-of-items a leader
 * saves for a location and can later apply to a plan's `eventItems`. Its items
 * (`runSheetTemplateItems`) mirror `eventItems` minus the `planId` (keyed by
 * `templateId`), with the same segment + `sequence` ordering, notes, role
 * `assignments`, and library `songId` join. Clock times are never stored
 * (durations cascade client-side), matching `eventItems`. Plan linkage /
 * propagation land in later phases.
 *
 * Auth mirrors `eventItems`: viewing requires an active group member
 * (`requireGroupMember`); editing requires `requireGroupScheduler` (group
 * leader / community admin).
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { requireGroupMember, requireGroupScheduler } from "./permissions";
import { getHydratedSongForJoin } from "./songs";
import { propagateRunSheetTemplate } from "./planTemplates";

/** Run sheet item types — mirrors PCO vocabulary. */
const ITEM_TYPES = new Set(["song", "header", "media", "item"]);

/** When an item happens relative to the event's service times. */
const SEGMENTS = ["before", "during", "after"] as const;
type Segment = (typeof SEGMENTS)[number];
const SEGMENT_SET = new Set<string>(SEGMENTS);

/** An item's segment, defaulting legacy/absent rows to "during". */
function itemSegment(item: Doc<"runSheetTemplateItems">): Segment {
  const s = item.segment;
  return s && SEGMENT_SET.has(s) ? (s as Segment) : "during";
}

/** Validate a run sheet segment, throwing on an unknown value. */
function assertSegment(segment: string): void {
  if (!SEGMENT_SET.has(segment)) {
    throw new ConvexError(`Unknown run sheet segment: ${segment}`);
  }
}

/** Validate a run sheet item type, throwing on an unknown value. */
function assertItemType(type: string): void {
  if (!ITEM_TYPES.has(type)) {
    throw new ConvexError(`Unknown run sheet item type: ${type}`);
  }
}

/** Highest `sequence` among a template's items in `segment`, or -1 if none. */
function lastSequenceInSegment(
  items: Doc<"runSheetTemplateItems">[],
  segment: Segment,
): number {
  return items.reduce(
    (max, i) => (itemSegment(i) === segment ? Math.max(max, i.sequence) : max),
    -1,
  );
}

const noteValidator = v.object({
  category: v.string(),
  content: v.string(),
});

const itemAssignmentValidator = v.object({
  roleId: v.id("teamRoles"),
});

const songDetailsValidator = v.object({
  key: v.optional(v.string()),
  bpm: v.optional(v.number()),
  author: v.optional(v.string()),
});

/**
 * Validate a template name — same rule as `createCrossTeamChannel`: 1–50
 * characters, at least one letter or number. Returns the trimmed name.
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

/** Load a run-sheet template or throw. */
async function requireRunSheetTemplate(
  ctx: QueryCtx | MutationCtx,
  templateId: Id<"runSheetTemplates">,
): Promise<Doc<"runSheetTemplates">> {
  const template = await ctx.db.get(templateId);
  if (!template) {
    throw new ConvexError("Run sheet template not found");
  }
  return template;
}

/**
 * Resolve a template and assert the caller may edit its group's schedule.
 */
async function requireRunSheetTemplateScheduler(
  ctx: MutationCtx,
  templateId: Id<"runSheetTemplates">,
  userId: Id<"users">,
): Promise<Doc<"runSheetTemplates">> {
  const template = await requireRunSheetTemplate(ctx, templateId);
  await requireGroupScheduler(ctx, template.groupId, userId);
  return template;
}

/**
 * Resolve a run sheet template item, assert the caller may edit its template,
 * and return both. Mirrors `eventItems.requireItemScheduler`.
 */
async function requireItemScheduler(
  ctx: MutationCtx,
  itemId: Id<"runSheetTemplateItems">,
  userId: Id<"users">,
): Promise<{
  item: Doc<"runSheetTemplateItems">;
  template: Doc<"runSheetTemplates">;
}> {
  const item = await ctx.db.get(itemId);
  if (!item) {
    throw new ConvexError("Run sheet template item not found");
  }
  const template = await requireRunSheetTemplateScheduler(
    ctx,
    item.templateId,
    userId,
  );
  return { item, template };
}

/**
 * Validate that every `assignments` entry references a role belonging to a team
 * in the template's group. Mirrors `eventItems.validateItemAssignments`.
 */
async function validateItemAssignments(
  ctx: MutationCtx,
  template: Doc<"runSheetTemplates">,
  assignments: Array<{ roleId: Id<"teamRoles"> }>,
): Promise<void> {
  for (const link of assignments) {
    const role = await ctx.db.get(link.roleId);
    if (!role) {
      throw new ConvexError("Linked role not found");
    }
    const team = await ctx.db.get(role.teamId);
    if (!team || team.groupId !== template.groupId) {
      throw new ConvexError(
        "Linked role does not belong to this template's group",
      );
    }
  }
}

/**
 * Join a template item's linked assignments with role display info + library
 * song. Mirrors `eventItems.hydrateItem`.
 */
async function hydrateItem(ctx: QueryCtx, item: Doc<"runSheetTemplateItems">) {
  const assignments = await Promise.all(
    (item.assignments ?? []).map(async (link) => {
      const role = await ctx.db.get(link.roleId);
      return {
        roleId: link.roleId,
        roleName: role?.name ?? "Role",
        roleColor: role?.color ?? null,
      };
    }),
  );

  const song = await getHydratedSongForJoin(ctx, item.songId);

  return {
    _id: item._id,
    templateId: item.templateId,
    segment: itemSegment(item),
    sequence: item.sequence,
    type: item.type,
    title: item.title,
    description: item.description ?? null,
    durationSec: item.durationSec,
    notes: item.notes ?? [],
    songDetails: item.songDetails ?? null,
    songId: item.songId ?? null,
    song,
    assignments,
  };
}

// ============================================================================
// Templates
// ============================================================================

/**
 * Create an empty run-sheet template for a group.
 *
 * Auth: group leader / community admin for the group.
 */
export const createRunSheetTemplate = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    name: v.string(),
  },
  returns: v.object({ templateId: v.id("runSheetTemplates") }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const group = await requireGroupScheduler(ctx, args.groupId, userId);

    const name = validateTemplateName(args.name);
    const nowMs = Date.now();
    const templateId = await ctx.db.insert("runSheetTemplates", {
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
 * Rename a run-sheet template.
 *
 * Auth: group leader / community admin for the template's group.
 */
export const renameRunSheetTemplate = mutation({
  args: {
    token: v.string(),
    templateId: v.id("runSheetTemplates"),
    name: v.string(),
  },
  returns: v.object({ templateId: v.id("runSheetTemplates") }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireRunSheetTemplateScheduler(ctx, args.templateId, userId);

    const name = validateTemplateName(args.name);
    await ctx.db.patch(args.templateId, { name, updatedAt: Date.now() });
    return { templateId: args.templateId };
  },
});

/**
 * Delete a run-sheet template and cascade all of its items.
 *
 * Auth: group leader / community admin for the template's group.
 */
export const deleteRunSheetTemplate = mutation({
  args: {
    token: v.string(),
    templateId: v.id("runSheetTemplates"),
  },
  returns: v.object({ deletedItems: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireRunSheetTemplateScheduler(ctx, args.templateId, userId);

    const items = await ctx.db
      .query("runSheetTemplateItems")
      .withIndex("by_template", (q) => q.eq("templateId", args.templateId))
      .collect();
    await Promise.all(items.map((i) => ctx.db.delete(i._id)));
    await ctx.db.delete(args.templateId);
    return { deletedItems: items.length };
  },
});

/**
 * List a group's run-sheet templates, each with its `itemCount`.
 *
 * Auth: an active member of the group (community read gate).
 */
export const listRunSheetTemplates = query({
  args: { token: v.string(), groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireGroupMember(ctx, args.groupId, userId);

    const templates = await ctx.db
      .query("runSheetTemplates")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    templates.sort((a, b) => a.createdAt - b.createdAt);

    return Promise.all(
      templates.map(async (template) => {
        const items = await ctx.db
          .query("runSheetTemplateItems")
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
 * List a template's items in (segment, sequence) order, hydrated with role +
 * song display info. Mirrors `eventItems.listItems`.
 *
 * Auth: an active member of the template's group.
 */
export const listRunSheetTemplateItems = query({
  args: { token: v.string(), templateId: v.id("runSheetTemplates") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const template = await requireRunSheetTemplate(ctx, args.templateId);
    await requireGroupMember(ctx, template.groupId, userId);

    const items = await ctx.db
      .query("runSheetTemplateItems")
      .withIndex("by_template", (q) => q.eq("templateId", args.templateId))
      .collect();
    const segRank = (i: Doc<"runSheetTemplateItems">) =>
      SEGMENTS.indexOf(itemSegment(i));
    items.sort((a, b) => segRank(a) - segRank(b) || a.sequence - b.sequence);

    return Promise.all(items.map((item) => hydrateItem(ctx, item)));
  },
});

// ============================================================================
// Template items
// ============================================================================

/**
 * Append a new item to the end of a template's given segment. Mirrors
 * `eventItems.createItem`.
 *
 * Auth: group leader / community admin for the template's group.
 */
export const addRunSheetTemplateItem = mutation({
  args: {
    token: v.string(),
    templateId: v.id("runSheetTemplates"),
    type: v.string(),
    title: v.string(),
    segment: v.optional(v.string()),
    durationSec: v.optional(v.number()),
    description: v.optional(v.string()),
    notes: v.optional(v.array(noteValidator)),
    assignments: v.optional(v.array(itemAssignmentValidator)),
    songDetails: v.optional(songDetailsValidator),
  },
  returns: v.object({ itemId: v.id("runSheetTemplateItems") }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const template = await requireRunSheetTemplateScheduler(
      ctx,
      args.templateId,
      userId,
    );

    assertItemType(args.type);
    const segment: Segment = (args.segment as Segment) ?? "during";
    assertSegment(segment);
    const title = args.title.trim();
    if (!title) {
      throw new ConvexError("Run sheet item title cannot be empty");
    }
    if (args.assignments && args.assignments.length > 0) {
      await validateItemAssignments(ctx, template, args.assignments);
    }

    const existing = await ctx.db
      .query("runSheetTemplateItems")
      .withIndex("by_template", (q) => q.eq("templateId", args.templateId))
      .collect();
    const nextSequence = lastSequenceInSegment(existing, segment) + 1;

    const nowMs = Date.now();
    const itemId = await ctx.db.insert("runSheetTemplateItems", {
      templateId: args.templateId,
      communityId: template.communityId,
      segment,
      sequence: nextSequence,
      type: args.type,
      title,
      description: args.description?.trim() || undefined,
      durationSec: Math.max(0, Math.round(args.durationSec ?? 0)),
      notes: args.notes,
      assignments: args.assignments,
      songDetails: args.songDetails,
      createdAt: nowMs,
      createdById: userId,
      updatedAt: nowMs,
    });
    // Propagate the new item forward to future linked plans (Phase 3).
    await propagateRunSheetTemplate(ctx, args.templateId, userId);
    return { itemId };
  },
});

/**
 * Update a template item's editable fields. Only provided fields change; pass an
 * empty array to clear `notes` / `assignments`. Mirrors `eventItems.updateItem`.
 *
 * Auth: group leader / community admin for the template's group.
 */
export const updateRunSheetTemplateItem = mutation({
  args: {
    token: v.string(),
    itemId: v.id("runSheetTemplateItems"),
    type: v.optional(v.string()),
    title: v.optional(v.string()),
    segment: v.optional(v.string()),
    durationSec: v.optional(v.number()),
    description: v.optional(v.string()),
    notes: v.optional(v.array(noteValidator)),
    assignments: v.optional(v.array(itemAssignmentValidator)),
    songDetails: v.optional(songDetailsValidator),
    /** Link a library song, `null` clears, omitted leaves unchanged. */
    songId: v.optional(v.union(v.id("songs"), v.null())),
  },
  returns: v.object({ itemId: v.id("runSheetTemplateItems") }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const { item, template } = await requireItemScheduler(
      ctx,
      args.itemId,
      userId,
    );

    const patch: Partial<Doc<"runSheetTemplateItems">> = {
      updatedAt: Date.now(),
    };
    if (args.segment !== undefined) {
      assertSegment(args.segment);
      // Moving to another phase appends the item to the end of it.
      if (args.segment !== itemSegment(item)) {
        const siblings = await ctx.db
          .query("runSheetTemplateItems")
          .withIndex("by_template", (q) => q.eq("templateId", item.templateId))
          .collect();
        patch.segment = args.segment;
        patch.sequence =
          lastSequenceInSegment(siblings, args.segment as Segment) + 1;
      }
    }
    if (args.type !== undefined) {
      assertItemType(args.type);
      patch.type = args.type;
    }
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) {
        throw new ConvexError("Run sheet item title cannot be empty");
      }
      patch.title = title;
    }
    if (args.durationSec !== undefined) {
      patch.durationSec = Math.max(0, Math.round(args.durationSec));
    }
    if (args.description !== undefined) {
      patch.description = args.description.trim() || undefined;
    }
    if (args.notes !== undefined) patch.notes = args.notes;
    if (args.assignments !== undefined) {
      if (args.assignments.length > 0) {
        await validateItemAssignments(ctx, template, args.assignments);
      }
      patch.assignments = args.assignments;
    }
    if (args.songDetails !== undefined) patch.songDetails = args.songDetails;
    if (args.songId !== undefined) {
      if (args.songId === null) {
        patch.songId = undefined;
      } else {
        const song = await ctx.db.get(args.songId);
        if (!song || song.communityId !== template.communityId) {
          throw new ConvexError("Linked song does not belong to this community");
        }
        patch.songId = args.songId;
      }
    }

    await ctx.db.patch(args.itemId, patch);
    // Propagate the edit forward to future linked plans (Phase 3).
    await propagateRunSheetTemplate(ctx, item.templateId, userId);
    return { itemId: args.itemId };
  },
});

/**
 * Delete a single template item. Remaining items keep their `sequence` values
 * (gaps are harmless); call `reorderRunSheetTemplateItems` to compact. Mirrors
 * `eventItems.deleteItem`.
 *
 * Auth: group leader / community admin for the template's group.
 */
export const deleteRunSheetTemplateItem = mutation({
  args: { token: v.string(), itemId: v.id("runSheetTemplateItems") },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const { item } = await requireItemScheduler(ctx, args.itemId, userId);
    const templateId = item.templateId;
    await ctx.db.delete(args.itemId);
    // Propagate the deletion forward to future linked plans (Phase 3).
    await propagateRunSheetTemplate(ctx, templateId, userId);
    return { deleted: true };
  },
});

/**
 * Duplicate a template item, placing the copy immediately after the source and
 * resequencing that segment. Mirrors `eventItems.duplicateItem`.
 *
 * Auth: group leader / community admin for the template's group.
 */
export const duplicateRunSheetTemplateItem = mutation({
  args: { token: v.string(), itemId: v.id("runSheetTemplateItems") },
  returns: v.object({ itemId: v.id("runSheetTemplateItems") }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const { item, template } = await requireItemScheduler(
      ctx,
      args.itemId,
      userId,
    );

    const segment = itemSegment(item);
    const nowMs = Date.now();
    const newItemId = await ctx.db.insert("runSheetTemplateItems", {
      templateId: item.templateId,
      communityId: template.communityId,
      segment,
      sequence: item.sequence, // provisional; resequenced below
      type: item.type,
      title: item.title,
      description: item.description,
      durationSec: item.durationSec,
      notes: item.notes,
      assignments: item.assignments,
      songDetails: item.songDetails,
      songId: item.songId,
      createdAt: nowMs,
      createdById: userId,
      updatedAt: nowMs,
    });

    const all = await ctx.db
      .query("runSheetTemplateItems")
      .withIndex("by_template", (q) => q.eq("templateId", item.templateId))
      .collect();
    const segmentOrder = all
      .filter((i) => i._id !== newItemId && itemSegment(i) === segment)
      .sort((a, b) => a.sequence - b.sequence)
      .map((i) => i._id);
    const sourceIndex = segmentOrder.findIndex((id) => id === item._id);
    segmentOrder.splice(sourceIndex + 1, 0, newItemId);

    await Promise.all(
      segmentOrder.map((id, index) =>
        ctx.db.patch(id, { sequence: index, updatedAt: nowMs }),
      ),
    );

    // Propagate the new item + resequence forward to future linked plans.
    await propagateRunSheetTemplate(ctx, item.templateId, userId);
    return { itemId: newItemId };
  },
});

/**
 * Reorder a template's whole run sheet, carrying each item's (possibly changed)
 * `segment`. Every id must belong to the template and the set must be complete.
 * Mirrors `eventItems.reorderItems` (without the legacy `orderedIds` shape —
 * this is a new surface with no deployed older clients).
 *
 * Auth: group leader / community admin for the template's group.
 */
export const reorderRunSheetTemplateItems = mutation({
  args: {
    token: v.string(),
    templateId: v.id("runSheetTemplates"),
    orderedItems: v.array(
      v.object({ id: v.id("runSheetTemplateItems"), segment: v.string() }),
    ),
  },
  returns: v.object({ reordered: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireRunSheetTemplateScheduler(ctx, args.templateId, userId);

    const existing = await ctx.db
      .query("runSheetTemplateItems")
      .withIndex("by_template", (q) => q.eq("templateId", args.templateId))
      .collect();

    const existingIds = new Set(existing.map((i) => i._id as string));
    const seen = new Set<string>();
    for (const entry of args.orderedItems) {
      assertSegment(entry.segment);
      if (!existingIds.has(entry.id as string)) {
        throw new ConvexError(
          "Reorder list references an item not on this template",
        );
      }
      if (seen.has(entry.id as string)) {
        throw new ConvexError("Reorder list contains a duplicate item");
      }
      seen.add(entry.id as string);
    }
    if (args.orderedItems.length !== existing.length) {
      throw new ConvexError(
        "Reorder list is stale — it does not match the template's current items",
      );
    }

    const counters: Record<Segment, number> = { before: 0, during: 0, after: 0 };
    const nowMs = Date.now();
    await Promise.all(
      args.orderedItems.map((entry) => {
        const segment = entry.segment as Segment;
        const sequence = counters[segment]++;
        return ctx.db.patch(entry.id, { segment, sequence, updatedAt: nowMs });
      }),
    );

    // Propagate the new ordering forward to future linked plans (Phase 3).
    await propagateRunSheetTemplate(ctx, args.templateId, userId);
    return { reordered: args.orderedItems.length };
  },
});
