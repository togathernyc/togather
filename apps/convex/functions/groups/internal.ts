/**
 * Internal group queries
 *
 * These are internal queries that can only be called by other Convex functions,
 * not directly from clients.
 */

import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";

/**
 * Internal query to get group by ID.
 * Used by chat actions.
 */
export const getByIdInternal = internalQuery({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.groupId);
  },
});

/**
 * Internal query to check if a user is a member of a group.
 */
export const getMembershipInternal = internalQuery({
  args: {
    groupId: v.id("groups"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", args.userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();
  },
});

/**
 * Internal query to get group by legacy ID.
 * Used by chat actions for parsing Stream channel IDs.
 */
export const getByLegacyId = internalQuery({
  args: { legacyId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("groups")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.legacyId))
      .first();
  },
});
