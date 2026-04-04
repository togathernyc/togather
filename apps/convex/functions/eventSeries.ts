/**
 * Event Series functions
 *
 * CRUD operations for event series. A series is group-scoped and links multiple
 * meetings together (e.g., "Weekly Dinner Party"). For community-wide series,
 * each group gets its own eventSeries record; the series name serves as the
 * implicit cross-group link.
 */

import { v } from "convex/values";
import { query, mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { now } from "../lib/utils";
import { requireAuth } from "../lib/auth";
import { isActiveLeader } from "../lib/helpers";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compute the 1-based position of a meeting within its series.
 * Excludes cancelled meetings from the count.
 */
export async function getSeriesNumber(
  ctx: QueryCtx,
  meeting: { _id: Id<"meetings">; seriesId: Id<"eventSeries">; scheduledAt: number }
): Promise<{ seriesNumber: number; seriesTotalCount: number }> {
  const seriesMeetings = await ctx.db
    .query("meetings")
    .withIndex("by_series", (q) => q.eq("seriesId", meeting.seriesId))
    .collect();

  const activeMeetings = seriesMeetings.filter((m) => m.status !== "cancelled");

  // Sort by scheduledAt, then by _id for tiebreaking
  activeMeetings.sort((a, b) =>
    a.scheduledAt !== b.scheduledAt
      ? a.scheduledAt - b.scheduledAt
      : a._id.localeCompare(b._id)
  );

  const index = activeMeetings.findIndex((m) => m._id === meeting._id);
  return {
    seriesNumber: index === -1 ? 0 : index + 1,
    seriesTotalCount: activeMeetings.length,
  };
}

/**
 * Find an existing series by group and name, or return null.
 */
export async function findSeriesByGroupAndName(
  ctx: QueryCtx,
  groupId: Id<"groups">,
  name: string
) {
  return await ctx.db
    .query("eventSeries")
    .withIndex("by_group_name", (q) => q.eq("groupId", groupId).eq("name", name))
    .first();
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new event series for a group.
 */
export const create = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Verify user is a leader of this group
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .first();

    if (!isActiveLeader(membership)) {
      throw new Error("Only group leaders can create event series");
    }

    const seriesId = await ctx.db.insert("eventSeries", {
      groupId: args.groupId,
      createdById: userId,
      name: args.name,
      status: "active",
      createdAt: now(),
    });

    return seriesId;
  },
});

/**
 * Add an existing meeting to a series.
 * Validates that the meeting and series belong to the same group.
 */
export const addMeetingToSeries = mutation({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
    seriesId: v.id("eventSeries"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) throw new Error("Meeting not found");

    const series = await ctx.db.get(args.seriesId);
    if (!series) throw new Error("Series not found");

    if (meeting.groupId !== series.groupId) {
      throw new Error("Meeting and series must belong to the same group");
    }

    // Verify user is a leader of the group
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", meeting.groupId).eq("userId", userId)
      )
      .first();

    if (!isActiveLeader(membership)) {
      throw new Error("Only group leaders can manage event series");
    }

    await ctx.db.patch(args.meetingId, { seriesId: args.seriesId });
    return true;
  },
});

/**
 * Remove a meeting from its series.
 * If the series has no remaining meetings, marks it as cancelled.
 */
export const removeMeetingFromSeries = mutation({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) throw new Error("Meeting not found");
    if (!meeting.seriesId) throw new Error("Meeting is not part of a series");

    // Verify user is a leader of the group
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", meeting.groupId).eq("userId", userId)
      )
      .first();

    if (!isActiveLeader(membership)) {
      throw new Error("Only group leaders can manage event series");
    }

    const seriesId = meeting.seriesId;
    await ctx.db.patch(args.meetingId, { seriesId: undefined });

    // Check if the series now has zero active meetings
    const remaining = await ctx.db
      .query("meetings")
      .withIndex("by_series", (q) => q.eq("seriesId", seriesId))
      .collect();

    const activeRemaining = remaining.filter((m) => m.status !== "cancelled");
    if (activeRemaining.length === 0) {
      await ctx.db.patch(seriesId, { status: "cancelled" });
    }

    return true;
  },
});

/**
 * Create a new series and add multiple existing meetings to it.
 * All meetings must belong to the same group.
 */
export const createSeriesFromMeetings = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    name: v.string(),
    meetingIds: v.array(v.id("meetings")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    if (args.meetingIds.length < 1) {
      throw new Error("At least 1 meeting is required");
    }

    // Verify user is a leader of the group
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .first();

    if (!isActiveLeader(membership)) {
      throw new Error("Only group leaders can create event series");
    }

    // Validate all meetings belong to this group
    const meetings = await Promise.all(args.meetingIds.map((id) => ctx.db.get(id)));
    for (const m of meetings) {
      if (!m) throw new Error("Meeting not found");
      if (m.groupId !== args.groupId) {
        throw new Error("All meetings must belong to the same group");
      }
    }

    // Find or create the series
    let series = await findSeriesByGroupAndName(ctx, args.groupId, args.name);
    let seriesId;
    if (series && series.status === "active") {
      seriesId = series._id;
    } else {
      seriesId = await ctx.db.insert("eventSeries", {
        groupId: args.groupId,
        createdById: userId,
        name: args.name,
        status: "active",
        createdAt: now(),
      });
    }

    // Link all meetings to the series
    for (const meetingId of args.meetingIds) {
      await ctx.db.patch(meetingId, { seriesId });
    }

    return { seriesId, meetingsLinked: args.meetingIds.length };
  },
});

/**
 * Cancel an entire series and all its meetings.
 */
export const cancelSeries = mutation({
  args: {
    token: v.string(),
    seriesId: v.id("eventSeries"),
    cancellationReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const series = await ctx.db.get(args.seriesId);
    if (!series) {
      throw new Error("Series not found");
    }

    // Verify user is a leader of the series' group
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", series.groupId).eq("userId", userId)
      )
      .first();

    if (!isActiveLeader(membership)) {
      throw new Error("Only group leaders can cancel event series");
    }

    // Cancel the series record
    await ctx.db.patch(args.seriesId, { status: "cancelled" });

    // Cancel all meetings in the series (including overridden ones)
    const meetings = await ctx.db
      .query("meetings")
      .withIndex("by_series", (q) => q.eq("seriesId", args.seriesId))
      .collect();

    let meetingsCancelled = 0;
    for (const meeting of meetings) {
      if (meeting.status === "cancelled") continue;

      // Cancel scheduled jobs
      if (meeting.reminderJobId) {
        try {
          await ctx.scheduler.cancel(meeting.reminderJobId);
        } catch {
          // Job may have already run
        }
      }
      if (meeting.attendanceConfirmationJobId) {
        try {
          await ctx.scheduler.cancel(meeting.attendanceConfirmationJobId);
        } catch {
          // Job may have already run
        }
      }

      await ctx.db.patch(meeting._id, {
        status: "cancelled",
        cancellationReason: args.cancellationReason,
      });
      meetingsCancelled++;
    }

    return { meetingsCancelled };
  },
});

// ============================================================================
// Queries
// ============================================================================

/**
 * Get a series with all its meetings and computed series numbers.
 */
export const get = query({
  args: {
    token: v.string(),
    seriesId: v.id("eventSeries"),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.token);

    const series = await ctx.db.get(args.seriesId);
    if (!series) return null;

    const meetings = await ctx.db
      .query("meetings")
      .withIndex("by_series", (q) => q.eq("seriesId", args.seriesId))
      .collect();

    // Sort by scheduledAt for display
    const activeMeetings = meetings.filter((m) => m.status !== "cancelled");
    activeMeetings.sort((a, b) => a.scheduledAt - b.scheduledAt);

    const meetingsWithNumbers = activeMeetings.map((m, index) => ({
      ...m,
      seriesNumber: index + 1,
      seriesTotalCount: activeMeetings.length,
    }));

    return {
      ...series,
      meetings: meetingsWithNumbers,
    };
  },
});

/**
 * List active series for a group.
 */
export const listByGroup = query({
  args: {
    token: v.optional(v.string()),
    groupId: v.id("groups"),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {

    let seriesQuery;
    if (args.status) {
      seriesQuery = ctx.db
        .query("eventSeries")
        .withIndex("by_group_status", (q) =>
          q.eq("groupId", args.groupId).eq("status", args.status!)
        );
    } else {
      seriesQuery = ctx.db
        .query("eventSeries")
        .withIndex("by_group", (q) => q.eq("groupId", args.groupId));
    }

    const seriesList = await seriesQuery.collect();

    // Include meeting count for each series
    const results = await Promise.all(
      seriesList.map(async (s) => {
        const meetings = await ctx.db
          .query("meetings")
          .withIndex("by_series", (q) => q.eq("seriesId", s._id))
          .collect();

        const activeCount = meetings.filter((m) => m.status !== "cancelled").length;
        return {
          ...s,
          meetingCount: activeCount,
        };
      })
    );

    return results;
  },
});

/**
 * List distinct series names across all groups of a given type in a community.
 * Used for the "existing series" dropdown in community-wide event creation.
 */
export const listSeriesNamesByGroupType = query({
  args: {
    token: v.optional(v.string()),
    communityId: v.id("communities"),
    groupTypeId: v.id("groupTypes"),
  },
  handler: async (ctx, args) => {

    // Get all active groups of this type
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community_type_archived", (q) =>
        q
          .eq("communityId", args.communityId)
          .eq("groupTypeId", args.groupTypeId)
          .eq("isArchived", false)
      )
      .collect();

    // Collect all active series across these groups
    const seriesNames = new Set<string>();
    for (const group of groups) {
      const seriesList = await ctx.db
        .query("eventSeries")
        .withIndex("by_group_status", (q) =>
          q.eq("groupId", group._id).eq("status", "active")
        )
        .collect();

      for (const s of seriesList) {
        seriesNames.add(s.name);
      }
    }

    return Array.from(seriesNames).sort();
  },
});
