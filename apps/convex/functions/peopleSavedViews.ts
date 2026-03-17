/**
 * People Saved Views CRUD operations
 *
 * Manages saved view configurations for the People tab.
 * Each view stores sort, filter, and column settings that can be
 * personal (visible only to creator) or shared (visible to all community members).
 *
 * Key concepts:
 * - Personal views: only visible to the creator
 * - Shared views: visible to all members of the community
 * - Default views: seeded on first access, cannot be deleted
 * - Max 20 views per user per community
 * - View names max 30 characters
 */

import { v, ConvexError } from "convex/values";
import { query, mutation, internalMutation } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { isCommunityAdmin } from "../lib/permissions";

// ============================================================================
// Constants
// ============================================================================

const MAX_VIEWS_PER_USER = 20;
const MAX_VIEW_NAME_LENGTH = 30;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Verify user is an active member of the community.
 * Returns the userCommunities record.
 * Throws if user is not a member.
 */
async function requireCommunityMember(
  ctx: { db: any },
  userId: any,
  communityId: any,
) {
  const membership = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q: any) =>
      q.eq("userId", userId).eq("communityId", communityId),
    )
    .first();

  if (!membership || membership.status !== 1) {
    throw new ConvexError("Not a member of this community");
  }

  return membership;
}

// ============================================================================
// Queries
// ============================================================================

/**
 * List all saved views accessible to the current user in a community.
 *
 * Returns:
 * - All personal views created by the user
 * - All shared views in the community
 *
 * Results are deduplicated by _id (a shared view created by the user
 * would appear in both queries).
 */
export const list = query({
  args: {
    communityId: v.id("communities"),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.token) {
      return [];
    }
    const userId = await requireAuth(ctx, args.token);

    // Verify user is a community member
    await requireCommunityMember(ctx, userId, args.communityId);

    // Fetch personal views for this user in this community
    const personalViews = await ctx.db
      .query("peopleSavedViews")
      .withIndex("by_user_community", (q: any) =>
        q.eq("createdById", userId).eq("communityId", args.communityId),
      )
      .collect();

    // Fetch all shared views in this community
    const sharedViews = await ctx.db
      .query("peopleSavedViews")
      .withIndex("by_community", (q: any) =>
        q.eq("communityId", args.communityId),
      )
      .filter((q: any) => q.eq(q.field("visibility"), "shared"))
      .collect();

    // Deduplicate by _id (user's own shared views appear in both queries)
    const seen = new Set<string>();
    const combined = [];

    for (const view of personalViews) {
      seen.add(view._id);
      combined.push(view);
    }

    for (const view of sharedViews) {
      if (!seen.has(view._id)) {
        seen.add(view._id);
        combined.push(view);
      }
    }

    return combined;
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new saved view for the People tab.
 *
 * Validates:
 * - Name length <= 30 characters
 * - User has not exceeded 20 views in this community
 * - User is a community member
 *
 * @returns The ID of the newly created view document
 */
export const create = mutation({
  args: {
    communityId: v.id("communities"),
    token: v.string(),
    name: v.string(),
    visibility: v.union(v.literal("personal"), v.literal("shared")),
    sortBy: v.optional(v.string()),
    sortDirection: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    columnOrder: v.optional(v.array(v.string())),
    hiddenColumns: v.optional(v.array(v.string())),
    filters: v.optional(
      v.object({
        groupId: v.optional(v.id("groups")),
        statusFilter: v.optional(v.string()),
        assigneeFilter: v.optional(v.string()),
        scoreField: v.optional(v.string()),
        scoreMin: v.optional(v.number()),
        scoreMax: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Verify community membership
    await requireCommunityMember(ctx, userId, args.communityId);

    // Only admins can create shared views
    if (args.visibility === "shared") {
      const isAdmin = await isCommunityAdmin(ctx, args.communityId, userId);
      if (!isAdmin) {
        throw new ConvexError("Only admins can create shared views");
      }
    }

    // Validate name length
    if (args.name.trim().length === 0) {
      throw new ConvexError("View name cannot be empty");
    }
    if (args.name.length > MAX_VIEW_NAME_LENGTH) {
      throw new ConvexError(
        `View name must be ${MAX_VIEW_NAME_LENGTH} characters or fewer`,
      );
    }

    // Check view count limit for this user in this community
    const existingViews = await ctx.db
      .query("peopleSavedViews")
      .withIndex("by_user_community", (q: any) =>
        q.eq("createdById", userId).eq("communityId", args.communityId),
      )
      .collect();

    if (existingViews.length >= MAX_VIEWS_PER_USER) {
      throw new ConvexError(
        `Cannot create more than ${MAX_VIEWS_PER_USER} views per community`,
      );
    }

    const now = Date.now();

    const viewId = await ctx.db.insert("peopleSavedViews", {
      communityId: args.communityId,
      createdById: userId,
      name: args.name,
      visibility: args.visibility,
      sortBy: args.sortBy,
      sortDirection: args.sortDirection,
      columnOrder: args.columnOrder,
      hiddenColumns: args.hiddenColumns,
      filters: args.filters,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });

    return viewId;
  },
});

/**
 * Update an existing saved view.
 *
 * Authorization rules:
 * - The view creator can always update their own view
 * - Community admins can update shared views created by others
 *
 * Only provided fields are patched; omitted fields remain unchanged.
 */
export const update = mutation({
  args: {
    viewId: v.id("peopleSavedViews"),
    token: v.string(),
    name: v.optional(v.string()),
    visibility: v.optional(
      v.union(v.literal("personal"), v.literal("shared")),
    ),
    sortBy: v.optional(v.string()),
    sortDirection: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    columnOrder: v.optional(v.array(v.string())),
    hiddenColumns: v.optional(v.array(v.string())),
    filters: v.optional(
      v.object({
        groupId: v.optional(v.id("groups")),
        statusFilter: v.optional(v.string()),
        assigneeFilter: v.optional(v.string()),
        scoreField: v.optional(v.string()),
        scoreMin: v.optional(v.number()),
        scoreMax: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const view = await ctx.db.get(args.viewId);
    if (!view) {
      throw new ConvexError("View not found");
    }

    // Authorization: creator can always update; community admin can update shared views
    const isCreator = view.createdById === userId;
    if (!isCreator) {
      if (view.visibility !== "shared") {
        throw new ConvexError("Not authorized to update this view");
      }
      const isAdmin = await isCommunityAdmin(ctx, view.communityId, userId);
      if (!isAdmin) {
        throw new ConvexError("Not authorized to update this view");
      }
    }

    // Validate name if provided
    if (args.name !== undefined) {
      if (args.name.trim().length === 0) {
        throw new ConvexError("View name cannot be empty");
      }
      if (args.name.length > MAX_VIEW_NAME_LENGTH) {
        throw new ConvexError(
          `View name must be ${MAX_VIEW_NAME_LENGTH} characters or fewer`,
        );
      }
    }

    // Build patch object with only provided fields
    const patch: Record<string, any> = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) patch.name = args.name;
    if (args.visibility !== undefined) patch.visibility = args.visibility;
    if (args.sortBy !== undefined) patch.sortBy = args.sortBy;
    if (args.sortDirection !== undefined)
      patch.sortDirection = args.sortDirection;
    if (args.columnOrder !== undefined) patch.columnOrder = args.columnOrder;
    if (args.hiddenColumns !== undefined)
      patch.hiddenColumns = args.hiddenColumns;
    if (args.filters !== undefined) patch.filters = args.filters;

    await ctx.db.patch(args.viewId, patch);

    return { success: true };
  },
});

/**
 * Delete a saved view.
 *
 * Named "remove" instead of "delete" since "delete" is a reserved keyword.
 *
 * Authorization rules:
 * - The view creator can delete their own view
 * - Community admins can delete any view in the community
 *
 * Constraints:
 * - Default views (isDefault === true) cannot be deleted
 */
export const remove = mutation({
  args: {
    viewId: v.id("peopleSavedViews"),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const view = await ctx.db.get(args.viewId);
    if (!view) {
      throw new ConvexError("View not found");
    }

    // Cannot delete default views
    if (view.isDefault === true) {
      throw new ConvexError("Cannot delete a default view");
    }

    // Authorization: creator can delete; community admin can delete any view
    const isCreator = view.createdById === userId;
    if (!isCreator) {
      const isAdmin = await isCommunityAdmin(ctx, view.communityId, userId);
      if (!isAdmin) {
        throw new ConvexError("Not authorized to delete this view");
      }
    }

    await ctx.db.delete(args.viewId);

    return { success: true };
  },
});

// ============================================================================
// Internal Mutations
// ============================================================================

/**
 * Seed default saved views for a community.
 *
 * Called internally when a community first accesses the People tab.
 * Creates three built-in views if none exist yet:
 * - "All Members" — alphabetical by last name
 * - "Needs Attention" — sorted by attention score (ascending)
 * - "Recently Added" — newest members first
 *
 * All default views are shared and marked as isDefault: true
 * so they cannot be deleted by users.
 */
export const seedDefaultViews = internalMutation({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Check if any views already exist for this community
    const existing = await ctx.db
      .query("peopleSavedViews")
      .withIndex("by_community", (q: any) =>
        q.eq("communityId", args.communityId),
      )
      .first();

    if (existing) {
      return;
    }

    const now = Date.now();
    const baseFields = {
      communityId: args.communityId,
      createdById: args.userId,
      visibility: "shared" as const,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    };

    // "All Members" — sorted alphabetically by last name
    await ctx.db.insert("peopleSavedViews", {
      ...baseFields,
      name: "All Members",
      sortBy: "lastName",
      sortDirection: "asc",
    });

    // "Needs Attention" — sorted by score3 ascending (lowest scores first)
    await ctx.db.insert("peopleSavedViews", {
      ...baseFields,
      name: "Needs Attention",
      sortBy: "score3",
      sortDirection: "asc",
    });

    // "Recently Added" — sorted by addedAt descending (newest first)
    await ctx.db.insert("peopleSavedViews", {
      ...baseFields,
      name: "Recently Added",
      sortBy: "addedAt",
      sortDirection: "desc",
    });
  },
});
