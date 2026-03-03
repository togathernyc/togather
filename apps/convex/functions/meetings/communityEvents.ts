/**
 * Community-Wide Event functions
 *
 * Functions for creating and managing community-wide events
 * that spawn individual meetings for all groups of a given type.
 */

import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { now, generateShortId } from "../../lib/utils";
import { requireAuth } from "../../lib/auth";
import { COMMUNITY_ADMIN_THRESHOLD } from "../../lib/permissions";
import {
  DEFAULT_REMINDER_OFFSET_MS,
  DEFAULT_ATTENDANCE_CONFIRMATION_OFFSET_MS,
  DEFAULT_MEETING_DURATION_MS,
  DEFAULT_RSVP_OPTIONS,
} from "../../lib/meetingConfig";

/**
 * Create a community-wide event that spawns individual meetings for all active groups of a given type.
 *
 * Only community admins can call this function.
 * Creates a parent event in communityWideEvents and individual meetings for each matching group.
 */
export const createCommunityWideEvent = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    groupTypeId: v.id("groupTypes"),
    title: v.string(),
    scheduledAt: v.number(),
    meetingType: v.number(), // 1=In-Person, 2=Online
    meetingLink: v.optional(v.string()),
    note: v.optional(v.string()),
    visibility: v.optional(v.string()),
    coverImage: v.optional(v.string()),
    rsvpEnabled: v.optional(v.boolean()),
    rsvpOptions: v.optional(
      v.array(
        v.object({
          id: v.number(),
          label: v.string(),
          enabled: v.boolean(),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const timestamp = now();

    // Verify user is a community admin (roles >= 3 = Admin level)
    const userCommunity = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", args.communityId)
      )
      .first();

    if (!userCommunity || (userCommunity.roles ?? 0) < COMMUNITY_ADMIN_THRESHOLD || userCommunity.status !== 1) {
      throw new Error("Only active community admins can create community-wide events");
    }

    // Verify group type exists and belongs to this community
    const groupType = await ctx.db.get(args.groupTypeId);
    if (!groupType || groupType.communityId !== args.communityId) {
      throw new Error("Invalid group type");
    }

    // Get all active (non-archived) groups of this type.
    //
    // SAFETY NOTE: This entire mutation runs as a single Convex transaction.
    // The groups query and meeting inserts happen atomically - no external state
    // can change between the query and the loop below. Groups cannot become
    // archived during this mutation's execution.
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) =>
        q.and(
          q.eq(q.field("groupTypeId"), args.groupTypeId),
          q.eq(q.field("isArchived"), false)
        )
      )
      .collect();

    if (groups.length === 0) {
      throw new Error(`No active groups found for type "${groupType.name}"`);
    }

    // Create the parent community-wide event
    const communityWideEventId = await ctx.db.insert("communityWideEvents", {
      communityId: args.communityId,
      groupTypeId: args.groupTypeId,
      createdById: userId,
      title: args.title,
      scheduledAt: args.scheduledAt,
      meetingType: args.meetingType,
      meetingLink: args.meetingLink,
      note: args.note,
      status: "scheduled",
      createdAt: timestamp,
    });

    // Calculate reminder and attendance confirmation times
    const reminderAt = args.scheduledAt - DEFAULT_REMINDER_OFFSET_MS;
    const meetingEndTime = args.scheduledAt + DEFAULT_MEETING_DURATION_MS;
    const attendanceConfirmationAt =
      meetingEndTime + DEFAULT_ATTENDANCE_CONFIRMATION_OFFSET_MS;

    // Use provided rsvpOptions or default when rsvpEnabled is true
    const effectiveRsvpEnabled = args.rsvpEnabled ?? true;
    const effectiveRsvpOptions = args.rsvpOptions ?? (effectiveRsvpEnabled ? DEFAULT_RSVP_OPTIONS : undefined);

    // Create individual meetings for each group
    const meetingIds: Id<"meetings">[] = [];
    for (const group of groups) {
      const shortId = generateShortId();

      const meetingId = await ctx.db.insert("meetings", {
        groupId: group._id,
        title: args.title,
        shortId,
        scheduledAt: args.scheduledAt,
        meetingType: args.meetingType,
        meetingLink: args.meetingLink,
        note: args.note,
        coverImage: args.coverImage,
        status: "scheduled",
        visibility: args.visibility || "community",
        createdById: userId,
        createdAt: timestamp,
        rsvpEnabled: effectiveRsvpEnabled,
        rsvpOptions: effectiveRsvpOptions,
        // Link to parent event
        communityWideEventId,
        isOverridden: false,
        // Scheduled job fields
        reminderAt,
        reminderSent: false,
        attendanceConfirmationAt,
        attendanceConfirmationSent: false,
      });

      meetingIds.push(meetingId);

      // Schedule reminder (only if in the future) and store job ID
      let reminderJobId = undefined;
      if (reminderAt > timestamp) {
        reminderJobId = await ctx.scheduler.runAt(
          reminderAt,
          internal.functions.scheduledJobs.sendMeetingReminder,
          { meetingId }
        );
      }

      // Schedule attendance confirmation and store job ID
      let attendanceConfirmationJobId = undefined;
      if (attendanceConfirmationAt > timestamp) {
        attendanceConfirmationJobId = await ctx.scheduler.runAt(
          attendanceConfirmationAt,
          internal.functions.scheduledJobs.sendAttendanceConfirmation,
          { meetingId }
        );
      }

      // Store the job IDs in the meeting record for future cancellation
      if (reminderJobId || attendanceConfirmationJobId) {
        await ctx.db.patch(meetingId, {
          reminderJobId,
          attendanceConfirmationJobId,
        });
      }
    }

    return {
      communityWideEventId,
      meetingIds,
      groupCount: groups.length,
      groupTypeName: groupType.name,
    };
  },
});

/**
 * Count active groups for a given group type in a community.
 * Used by the frontend to show how many groups will receive the community-wide event.
 */
export const countGroupsByType = query({
  args: {
    token: v.optional(v.string()),
    communityId: v.id("communities"),
    groupTypeId: v.id("groupTypes"),
  },
  handler: async (ctx, args) => {
    // Get all active (non-archived) groups of this type
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) =>
        q.and(
          q.eq(q.field("groupTypeId"), args.groupTypeId),
          q.eq(q.field("isArchived"), false)
        )
      )
      .collect();

    return groups.length;
  },
});
