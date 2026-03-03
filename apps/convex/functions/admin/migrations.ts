/**
 * Admin migration functions
 *
 * Functions for data migration and synchronization (e.g., Supabase to Convex sync)
 */

import { v } from "convex/values";
import { mutation } from "../../_generated/server";
import { now } from "../../lib/utils";
import { requireAuth } from "../../lib/auth";

// ============================================================================
// Migration Functions (for Supabase to Convex sync)
// ============================================================================

/**
 * Upsert a group type from legacy Supabase data
 * Returns the Convex ID (creates new or updates existing)
 */
export const upsertGroupTypeFromLegacy = mutation({
  args: {
    token: v.string(),
    legacyId: v.string(),
    communityId: v.id("communities"),
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    isActive: v.boolean(),
    displayOrder: v.number(),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Verify authentication (admin-only migration function)
    await requireAuth(ctx, args.token);

    // Check if group type already exists by legacyId
    const existing = await ctx.db
      .query("groupTypes")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.legacyId))
      .first();

    const timestamp = now();
    const data = {
      legacyId: args.legacyId,
      communityId: args.communityId,
      name: args.name,
      slug: args.slug,
      description: args.description,
      icon: args.icon || "people",
      isActive: args.isActive,
      displayOrder: args.displayOrder,
      createdAt: args.createdAt ?? timestamp,
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
      return existing._id;
    }

    return await ctx.db.insert("groupTypes", data);
  },
});
