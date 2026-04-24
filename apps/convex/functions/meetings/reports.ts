/**
 * Meeting Reports — moderation mutations for member-created events.
 *
 * ADR-022: any community member can report an event. Reports route to the
 * event's group leaders (not community admins). The full leader-review UI
 * lives in a follow-up; this module provides the mutations + a stub listing
 * query so the review UI has something to hang off.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { requireAuth } from "../../lib/auth";
import { isActiveLeader } from "../../lib/helpers";
import { isMeetingHost } from "../../lib/meetingPermissions";
import { isCommunityAdmin } from "../../lib/permissions";
import { now } from "../../lib/utils";

const VALID_REASONS = new Set(["spam", "inappropriate", "other"]);

/**
 * Submit a report against a meeting. Open to any active member of the same
 * community. Re-reporting the same meeting updates the existing row instead of
 * producing duplicates.
 */
export const createReport = mutation({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
    reason: v.string(),
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const reportedById = await requireAuth(ctx, args.token);

    if (!VALID_REASONS.has(args.reason)) {
      throw new Error(
        `Invalid report reason. Expected one of: ${[...VALID_REASONS].join(", ")}`
      );
    }

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) {
      throw new Error("Event not found");
    }

    // Hosts can't report their own event. The client shows the flag icon
    // uniformly (we don't want to special-case the UI for hosts), but we
    // reject here so self-reports don't pollute the moderation queue or the
    // `event_reported` analytics signal. Uses the host list with creator
    // fallback — if no hosts are set, the creator still can't self-report.
    if (isMeetingHost(meeting, reportedById)) {
      throw new Error("You can't report an event you host");
    }

    // Caller must be an active member of the event's community (we gate on
    // community membership so community-wide events remain reportable by any
    // member, not just members of the hosting group).
    if (!meeting.communityId) {
      throw new Error("Event is not scoped to a community");
    }
    const communityMembership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", reportedById).eq("communityId", meeting.communityId!)
      )
      .first();
    if (!communityMembership || communityMembership.status !== 1) {
      throw new Error("You must be a member of this community to report events");
    }

    const existing = await ctx.db
      .query("meetingReports")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .filter((q) => q.eq(q.field("reportedById"), reportedById))
      .first();

    if (existing) {
      // Re-reporting an already-resolved event should put it back in the
      // leader queue. Without this, a dismissed or actioned row stays
      // non-pending and `listReportsForGroup` (which filters to pending)
      // silently drops the new signal.
      await ctx.db.patch(existing._id, {
        reason: args.reason,
        details: args.details,
        status: "pending",
        reviewedById: undefined,
        reviewedAt: undefined,
        actionTaken: undefined,
      });
      return existing._id;
    }

    return await ctx.db.insert("meetingReports", {
      meetingId: args.meetingId,
      reportedById,
      reason: args.reason,
      details: args.details,
      status: "pending",
      createdAt: now(),
    });
  },
});

/**
 * List pending reports for meetings in a given group. Group leaders and
 * community admins only. Stub for the follow-up review UI — returns raw rows
 * with minimal enrichment.
 */
export const listReportsForGroup = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new Error("Group not found");
    }

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .first();

    const isAdmin = group.communityId
      ? await isCommunityAdmin(ctx, group.communityId, userId)
      : false;
    if (!isActiveLeader(membership) && !isAdmin) {
      throw new Error("Only group leaders or community admins can view reports");
    }

    const groupMeetings = await ctx.db
      .query("meetings")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const groupMeetingIds = new Set(groupMeetings.map((m) => m._id));

    const pendingReports = await ctx.db
      .query("meetingReports")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    return pendingReports.filter((r) => groupMeetingIds.has(r.meetingId));
  },
});

/**
 * Resolve a report. Group leaders of the reported meeting's group (or
 * community admins) can dismiss or action. Stub for the follow-up UI.
 */
export const resolveReport = mutation({
  args: {
    token: v.string(),
    reportId: v.id("meetingReports"),
    action: v.union(v.literal("dismissed"), v.literal("actioned")),
    actionTaken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const report = await ctx.db.get(args.reportId);
    if (!report) {
      throw new Error("Report not found");
    }

    const meeting = await ctx.db.get(report.meetingId);
    if (!meeting) {
      throw new Error("Reported event not found");
    }

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", meeting.groupId).eq("userId", userId)
      )
      .first();
    const isAdmin = meeting.communityId
      ? await isCommunityAdmin(ctx, meeting.communityId, userId)
      : false;
    if (!isActiveLeader(membership) && !isAdmin) {
      throw new Error("Only group leaders or community admins can resolve reports");
    }

    await ctx.db.patch(args.reportId, {
      status: args.action === "actioned" ? "actioned" : "dismissed",
      reviewedById: userId,
      reviewedAt: now(),
      actionTaken: args.actionTaken,
    });
  },
});
