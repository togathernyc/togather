/**
 * Helper functions for Supabase to Convex sync
 * These queries return legacyId -> _id mappings for rebuilding state
 * Uses pagination to handle large tables
 *
 * NOTE: These are internal queries used by migration scripts.
 * They don't require authentication since they're called server-side
 * via internalQuery from migration scripts or actions.
 */

import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

const PAGE_SIZE = 5000; // Stay under 8192 limit

// Get community ID mappings (paginated)
export const getCommunityMappings = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("communities")
      .paginate({ numItems: PAGE_SIZE, cursor: args.cursor ?? null });

    return {
      items: result.page
        .filter((c) => c.legacyId)
        .map((c) => ({ legacyId: c.legacyId!, convexId: c._id })),
      cursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

// Get user ID mappings (paginated)
export const getUserMappings = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("users")
      .paginate({ numItems: PAGE_SIZE, cursor: args.cursor ?? null });

    return {
      items: result.page
        .filter((u) => u.legacyId)
        .map((u) => ({ legacyId: u.legacyId!, convexId: u._id })),
      cursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

// Get group type ID mappings (paginated)
export const getGroupTypeMappings = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("groupTypes")
      .paginate({ numItems: PAGE_SIZE, cursor: args.cursor ?? null });

    return {
      items: result.page
        .filter((gt) => gt.legacyId)
        .map((gt) => ({ legacyId: gt.legacyId!, convexId: gt._id })),
      cursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

// Get group ID mappings (paginated)
export const getGroupMappings = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("groups")
      .paginate({ numItems: PAGE_SIZE, cursor: args.cursor ?? null });

    return {
      items: result.page
        .filter((g) => g.legacyId)
        .map((g) => ({ legacyId: g.legacyId!, convexId: g._id })),
      cursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

// Get group member ID mappings (paginated)
export const getGroupMemberMappings = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("groupMembers")
      .paginate({ numItems: PAGE_SIZE, cursor: args.cursor ?? null });

    return {
      items: result.page
        .filter((m) => m.legacyId)
        .map((m) => ({ legacyId: m.legacyId!, convexId: m._id })),
      cursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

// Get meeting ID mappings (paginated)
export const getMeetingMappings = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("meetings")
      .paginate({ numItems: PAGE_SIZE, cursor: args.cursor ?? null });

    return {
      items: result.page
        .filter((m) => m.legacyId)
        .map((m) => ({ legacyId: m.legacyId!, convexId: m._id })),
      cursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});
