/**
 * Scheduling — run sheet items (ADR-026)
 *
 * `eventItems` are the native, editable order-of-items for an event plan — the
 * PCO-independent replacement for the read-only PCO run sheet. One run sheet is
 * a set of `eventItems` keyed by `planId` and ordered by `sequence`; the same
 * run sheet is shared across all of the plan's `times`. Clock times are NOT
 * stored — the client cascades `durationSec` from the selected service time
 * (see `features/scheduling/utils/runSheetTiming.ts`).
 *
 * Permissions reuse the event-plan guards: viewing requires an active group
 * member (`requireGroupMember`); editing requires `requirePlanScheduler`
 * (group leader / community admin / team channel admin-moderator).
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { requireGroupMember, requirePlanScheduler } from "./permissions";

/** Run sheet item types — mirrors PCO vocabulary. */
const ITEM_TYPES = new Set(["song", "header", "media", "item"]);

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
 * Resolve a run sheet item, assert the caller may edit its plan, and return
 * both. Item mutations are keyed by `itemId`, so we resolve the owning plan
 * from the item and delegate to `requirePlanScheduler`.
 *
 * @throws ConvexError if the item/plan is missing or the user lacks permission.
 */
async function requireItemScheduler(
  ctx: MutationCtx,
  itemId: Id<"eventItems">,
  userId: Id<"users">,
): Promise<{ item: Doc<"eventItems">; plan: Doc<"eventPlans"> }> {
  const item = await ctx.db.get(itemId);
  if (!item) {
    throw new ConvexError("Run sheet item not found");
  }
  const { plan } = await requirePlanScheduler(ctx, item.planId, userId);
  return { item, plan };
}

/**
 * Validate that every `assignments` entry references a role belonging to a team
 * in the plan's group. Mirrors the cross-group checks in `events.ts` so an item
 * cannot link to a foreign group's role.
 *
 * @throws ConvexError on any invalid reference.
 */
async function validateItemAssignments(
  ctx: MutationCtx,
  plan: Doc<"eventPlans">,
  assignments: Array<{ roleId: Id<"teamRoles"> }>,
): Promise<void> {
  for (const link of assignments) {
    const role = await ctx.db.get(link.roleId);
    if (!role) {
      throw new ConvexError("Linked role not found");
    }
    const team = await ctx.db.get(role.teamId);
    if (!team || team.groupId !== plan.groupId) {
      throw new ConvexError("Linked role does not belong to this event's group");
    }
  }
}

/** Validate a run sheet item type, throwing on an unknown value. */
function assertItemType(type: string): void {
  if (!ITEM_TYPES.has(type)) {
    throw new ConvexError(`Unknown run sheet item type: ${type}`);
  }
}

/**
 * List a plan's run sheet items in sequence order, joined with the display
 * info the editor needs: role name/color and assignee display name for each
 * linked assignment.
 *
 * Auth: an active member of the plan's group, or a community admin (same view
 * gate as `getEvent`).
 */
export const listItems = query({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const plan = await ctx.db.get(args.planId);
    if (!plan) return null;
    await requireGroupMember(ctx, plan.groupId, userId);

    const items = await ctx.db
      .query("eventItems")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .collect();
    items.sort((a, b) => a.sequence - b.sequence);

    return Promise.all(items.map((item) => hydrateItem(ctx, item)));
  },
});

/**
 * Join an item's linked assignments with role + user display info. Kept small
 * and shared so the shape stays consistent across mutations that echo an item.
 */
async function hydrateItem(ctx: QueryCtx, item: Doc<"eventItems">) {
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

  return {
    _id: item._id,
    planId: item.planId,
    sequence: item.sequence,
    type: item.type,
    title: item.title,
    description: item.description ?? null,
    durationSec: item.durationSec,
    notes: item.notes ?? [],
    songDetails: item.songDetails ?? null,
    assignments,
  };
}

/**
 * Append a new item to the end of a plan's run sheet.
 *
 * Auth: scheduler for the plan's group.
 */
export const createItem = mutation({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
    type: v.string(),
    title: v.string(),
    durationSec: v.optional(v.number()),
    description: v.optional(v.string()),
    notes: v.optional(v.array(noteValidator)),
    assignments: v.optional(v.array(itemAssignmentValidator)),
    songDetails: v.optional(songDetailsValidator),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const { plan } = await requirePlanScheduler(ctx, args.planId, userId);

    assertItemType(args.type);
    const title = args.title.trim();
    if (!title) {
      throw new ConvexError("Run sheet item title cannot be empty");
    }
    if (args.assignments && args.assignments.length > 0) {
      await validateItemAssignments(ctx, plan, args.assignments);
    }

    // Append after the current last item.
    const existing = await ctx.db
      .query("eventItems")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .collect();
    const nextSequence =
      existing.reduce((max, i) => Math.max(max, i.sequence), -1) + 1;

    const nowMs = Date.now();
    const itemId = await ctx.db.insert("eventItems", {
      planId: args.planId,
      communityId: plan.communityId,
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

    return { itemId };
  },
});

/**
 * Update an item's editable fields. Only provided fields change; pass an empty
 * array to clear `notes` / `assignments`.
 *
 * Auth: scheduler for the item's plan.
 */
export const updateItem = mutation({
  args: {
    token: v.string(),
    itemId: v.id("eventItems"),
    type: v.optional(v.string()),
    title: v.optional(v.string()),
    durationSec: v.optional(v.number()),
    description: v.optional(v.string()),
    notes: v.optional(v.array(noteValidator)),
    assignments: v.optional(v.array(itemAssignmentValidator)),
    songDetails: v.optional(songDetailsValidator),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const { plan } = await requireItemScheduler(ctx, args.itemId, userId);

    const patch: Partial<Doc<"eventItems">> = { updatedAt: Date.now() };
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
        await validateItemAssignments(ctx, plan, args.assignments);
      }
      patch.assignments = args.assignments;
    }
    if (args.songDetails !== undefined) patch.songDetails = args.songDetails;

    await ctx.db.patch(args.itemId, patch);
    return { itemId: args.itemId };
  },
});

/**
 * Delete a single run sheet item. Remaining items keep their `sequence` values
 * (gaps are harmless — ordering is relative); call `reorderItems` to compact.
 *
 * Auth: scheduler for the item's plan.
 */
export const deleteItem = mutation({
  args: {
    token: v.string(),
    itemId: v.id("eventItems"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireItemScheduler(ctx, args.itemId, userId);
    await ctx.db.delete(args.itemId);
    return { deleted: true };
  },
});

/**
 * Duplicate a run sheet item, placing the copy immediately after the source and
 * resequencing the plan so the order stays contiguous. The copy keeps the
 * source's role `assignments` (unlike duplicating a whole plan) — duplicating a
 * single item within the same plan means the same roster still applies.
 *
 * Auth: scheduler for the item's plan.
 */
export const duplicateItem = mutation({
  args: {
    token: v.string(),
    itemId: v.id("eventItems"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const { item, plan } = await requireItemScheduler(ctx, args.itemId, userId);

    const nowMs = Date.now();
    const newItemId = await ctx.db.insert("eventItems", {
      planId: item.planId,
      communityId: plan.communityId,
      sequence: item.sequence, // provisional; resequenced below
      type: item.type,
      title: item.title,
      description: item.description,
      durationSec: item.durationSec,
      notes: item.notes,
      assignments: item.assignments,
      songDetails: item.songDetails,
      createdAt: nowMs,
      createdById: userId,
      updatedAt: nowMs,
    });

    // Rebuild contiguous sequences with the copy directly after the source.
    const all = await ctx.db
      .query("eventItems")
      .withIndex("by_plan", (q) => q.eq("planId", item.planId))
      .collect();
    const existingOrder = all
      .filter((i) => i._id !== newItemId)
      .sort((a, b) => a.sequence - b.sequence)
      .map((i) => i._id);
    const sourceIndex = existingOrder.findIndex((id) => id === item._id);
    existingOrder.splice(sourceIndex + 1, 0, newItemId);

    await Promise.all(
      existingOrder.map((id, index) =>
        ctx.db.patch(id, { sequence: index, updatedAt: nowMs }),
      ),
    );

    return { itemId: newItemId };
  },
});

/**
 * Reorder a plan's run sheet by rewriting each item's `sequence` to its index
 * in `orderedIds`. Every id must belong to the plan, and the set must be
 * complete — this rejects a stale client list rather than silently dropping or
 * stranding items.
 *
 * Auth: scheduler for the plan's group.
 */
export const reorderItems = mutation({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
    orderedIds: v.array(v.id("eventItems")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requirePlanScheduler(ctx, args.planId, userId);

    const existing = await ctx.db
      .query("eventItems")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .collect();

    const existingIds = new Set(existing.map((i) => i._id as string));
    const seen = new Set<string>();
    for (const id of args.orderedIds) {
      if (!existingIds.has(id as string)) {
        throw new ConvexError("Reorder list references an item not on this plan");
      }
      if (seen.has(id as string)) {
        throw new ConvexError("Reorder list contains a duplicate item");
      }
      seen.add(id as string);
    }
    if (args.orderedIds.length !== existing.length) {
      throw new ConvexError(
        "Reorder list is stale — it does not match the plan's current items",
      );
    }

    const nowMs = Date.now();
    await Promise.all(
      args.orderedIds.map((id, index) =>
        ctx.db.patch(id, { sequence: index, updatedAt: nowMs }),
      ),
    );

    return { reordered: args.orderedIds.length };
  },
});
