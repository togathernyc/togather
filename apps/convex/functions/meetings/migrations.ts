/**
 * Meeting Migration functions
 *
 * Functions for syncing legacy Supabase data to Convex.
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";

/**
 * Upsert meeting attendance from legacy Supabase data
 */
export const upsertAttendanceFromLegacy = internalMutation({
  args: {
    legacyId: v.string(),
    meetingId: v.id("meetings"),
    userId: v.id("users"),
    status: v.number(),
    recordedAt: v.number(),
    recordedById: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    // Check if attendance already exists by legacyId
    const existing = await ctx.db
      .query("meetingAttendances")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.legacyId))
      .first();

    const data = {
      legacyId: args.legacyId,
      meetingId: args.meetingId,
      userId: args.userId,
      status: args.status,
      recordedAt: args.recordedAt,
      recordedById: args.recordedById,
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
      return existing._id;
    }

    return await ctx.db.insert("meetingAttendances", data);
  },
});
