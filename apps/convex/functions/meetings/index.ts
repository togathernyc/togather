/**
 * Meeting functions - Index
 *
 * Configuration, re-exports, and core CRUD mutations.
 */

import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { now, generateShortId } from "../../lib/utils";
import { requireAuth } from "../../lib/auth";
import { isActiveLeader } from "../../lib/helpers";
import {
  DEFAULT_REMINDER_OFFSET_MS,
  DEFAULT_ATTENDANCE_CONFIRMATION_OFFSET_MS,
  DEFAULT_MEETING_DURATION_MS,
  DEFAULT_RSVP_OPTIONS,
} from "../../lib/meetingConfig";
import { buildMeetingSearchText } from "../../lib/meetingSearchText";

// Re-export meeting config for consumers that import from this module
export {
  DEFAULT_REMINDER_OFFSET_MS,
  DEFAULT_ATTENDANCE_CONFIRMATION_OFFSET_MS,
  DEFAULT_MEETING_DURATION_MS,
  DEFAULT_RSVP_OPTIONS,
} from "../../lib/meetingConfig";

// ============================================================================
// Re-exports
// ============================================================================

export {
  // Query functions
  getByShortId,
  getWithDetails,
  isCommunityWideEvent,
  listByGroup,
  listUpcomingForUser,
} from "./queries";

// NOTE: RSVP functions are in the root-level meetingRsvps.ts file, not here.
// Use api.functions.meetingRsvps.* for RSVP operations.

export {
  // Attendance functions
  listAttendance,
  markAttendance,
  addGuest,
  listGuests,
  removeGuest, // FIX for Issue #303
  updateGuest, // FIX for Issue #303
  validateAttendanceToken,
  selfReportAttendance,
  confirmAttendanceWithToken,
  getMyAttendance,
} from "./attendance";

export {
  // Community-wide event functions
  createCommunityWideEvent,
  countGroupsByType,
} from "./communityEvents";

export {
  // Explore page functions
  communityEvents,
  myRsvpEvents,
} from "./explore";

export {
  // Migration functions
  upsertAttendanceFromLegacy,
} from "./migrations";

// ============================================================================
// Basic Meeting CRUD
// ============================================================================

/**
 * Get meeting by ID
 */
export const getById = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.meetingId);
  },
});

/**
 * Create a new meeting
 */
export const create = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    title: v.optional(v.string()),
    scheduledAt: v.number(),
    actualEnd: v.optional(v.number()),
    meetingType: v.number(), // 1=In-Person, 2=Online
    meetingLink: v.optional(v.string()),
    locationOverride: v.optional(v.string()),
    note: v.optional(v.string()),
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
    visibility: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const createdById = await requireAuth(ctx, args.token);

    // Verify user is a leader of this group
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", createdById)
      )
      .first();

    if (!isActiveLeader(membership)) {
      throw new Error("Only group leaders can create events");
    }

    const timestamp = now();

    // Look up group for communityId and name (used for search)
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new Error("Group not found");
    }

    // Generate a short ID for URLs (e.g., "abc123xyz")
    const shortId = generateShortId();

    // Calculate reminder time (1 hour before)
    const reminderAt = args.scheduledAt - DEFAULT_REMINDER_OFFSET_MS;

    // Calculate attendance confirmation time (30 min after end)
    const meetingEndTime = args.actualEnd || args.scheduledAt + DEFAULT_MEETING_DURATION_MS;
    const attendanceConfirmationAt =
      meetingEndTime + DEFAULT_ATTENDANCE_CONFIRMATION_OFFSET_MS;

    // Use provided rsvpOptions or default when rsvpEnabled is true
    const effectiveRsvpEnabled = args.rsvpEnabled ?? true;
    const effectiveRsvpOptions = args.rsvpOptions ?? (effectiveRsvpEnabled ? DEFAULT_RSVP_OPTIONS : undefined);

    const meetingId = await ctx.db.insert("meetings", {
      groupId: args.groupId,
      title: args.title,
      shortId,
      scheduledAt: args.scheduledAt,
      actualEnd: args.actualEnd,
      meetingType: args.meetingType,
      meetingLink: args.meetingLink,
      locationOverride: args.locationOverride,
      note: args.note,
      coverImage: args.coverImage,
      status: "scheduled",
      createdById,
      createdAt: timestamp,
      rsvpEnabled: effectiveRsvpEnabled,
      rsvpOptions: effectiveRsvpOptions,
      visibility: args.visibility,
      // Scheduled job fields
      reminderAt,
      reminderSent: false,
      attendanceConfirmationAt,
      attendanceConfirmationSent: false,
      // Denormalized search fields
      communityId: group.communityId,
      searchText: buildMeetingSearchText({
        title: args.title,
        locationOverride: args.locationOverride,
        groupName: group.name,
      }),
    });

    // Schedule reminder (only if reminderAt is in the future) and store job ID
    let reminderJobId = undefined;
    if (reminderAt > timestamp) {
      reminderJobId = await ctx.scheduler.runAt(
        reminderAt,
        internal.functions.scheduledJobs.sendMeetingReminder,
        { meetingId }
      );
    }

    // Schedule attendance confirmation (always in the future for new meetings) and store job ID
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

    return meetingId;
  },
});

/**
 * Update a meeting
 */
export const update = mutation({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
    title: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    actualEnd: v.optional(v.number()),
    meetingType: v.optional(v.number()),
    meetingLink: v.optional(v.string()),
    locationOverride: v.optional(v.string()),
    note: v.optional(v.string()),
    coverImage: v.optional(v.string()),
    status: v.optional(v.union(v.literal("scheduled"), v.literal("confirmed"), v.literal("completed"), v.literal("cancelled"))),
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
    visibility: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const { meetingId, token: _token, ...updates } = args;
    const timestamp = now();

    // Get the current meeting to detect changes
    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }

    // Verify user is a leader of this group
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", meeting.groupId).eq("userId", userId)
      )
      .first();

    if (!isActiveLeader(membership)) {
      throw new Error("Only group leaders can update meetings");
    }

    // Track what changed for notification
    const changes: string[] = [];

    if (updates.title !== undefined && updates.title !== meeting.title) {
      changes.push("title");
    }
    if (
      updates.scheduledAt !== undefined &&
      updates.scheduledAt !== meeting.scheduledAt
    ) {
      changes.push("time");
    }
    if (
      updates.locationOverride !== undefined &&
      updates.locationOverride !== meeting.locationOverride
    ) {
      changes.push("location");
    }
    if (
      updates.meetingLink !== undefined &&
      updates.meetingLink !== meeting.meetingLink
    ) {
      changes.push("meeting link");
    }

    // Build update object
    const cleanedUpdates: Record<string, unknown> = Object.fromEntries(
      Object.entries(updates).filter(([, val]) => val !== undefined)
    );

    // If this meeting is linked to a community-wide event and hasn't been overridden yet,
    // mark it as overridden so future cascade updates from the parent event skip it
    if (meeting.communityWideEventId && !meeting.isOverridden) {
      cleanedUpdates.isOverridden = true;
    }

    // Recalculate reminder/confirmation times if scheduledAt changed
    if (updates.scheduledAt !== undefined) {
      const newReminderAt = updates.scheduledAt - DEFAULT_REMINDER_OFFSET_MS;
      const meetingEndTime =
        updates.actualEnd ||
        meeting.actualEnd ||
        updates.scheduledAt + DEFAULT_MEETING_DURATION_MS;
      const newAttendanceConfirmationAt =
        meetingEndTime + DEFAULT_ATTENDANCE_CONFIRMATION_OFFSET_MS;

      cleanedUpdates.reminderAt = newReminderAt;
      cleanedUpdates.attendanceConfirmationAt = newAttendanceConfirmationAt;

      // Reset sent flags if we're rescheduling to the future
      if (!meeting.reminderSent || newReminderAt > timestamp) {
        cleanedUpdates.reminderSent = false;
      }
      if (
        !meeting.attendanceConfirmationSent ||
        newAttendanceConfirmationAt > timestamp
      ) {
        cleanedUpdates.attendanceConfirmationSent = false;
      }

      // Cancel old scheduled jobs before scheduling new ones
      if (meeting.reminderJobId) {
        try {
          await ctx.scheduler.cancel(meeting.reminderJobId);
        } catch {
          // Job may have already run or been cancelled - ignore
        }
      }
      if (meeting.attendanceConfirmationJobId) {
        try {
          await ctx.scheduler.cancel(meeting.attendanceConfirmationJobId);
        } catch {
          // Job may have already run or been cancelled - ignore
        }
      }

      let newReminderJobId = undefined;
      let newAttendanceConfirmationJobId = undefined;

      // Schedule new reminder if in the future and not yet sent
      if (newReminderAt > timestamp && !meeting.reminderSent) {
        newReminderJobId = await ctx.scheduler.runAt(
          newReminderAt,
          internal.functions.scheduledJobs.sendMeetingReminder,
          { meetingId }
        );
      }

      // Schedule new attendance confirmation if in the future
      if (newAttendanceConfirmationAt > timestamp) {
        newAttendanceConfirmationJobId = await ctx.scheduler.runAt(
          newAttendanceConfirmationAt,
          internal.functions.scheduledJobs.sendAttendanceConfirmation,
          { meetingId }
        );
      }

      // Store new job IDs (will be patched along with other updates)
      cleanedUpdates.reminderJobId = newReminderJobId;
      cleanedUpdates.attendanceConfirmationJobId = newAttendanceConfirmationJobId;
    }

    // Rebuild searchText if title or location changed
    if (updates.title !== undefined || updates.locationOverride !== undefined) {
      const group = await ctx.db.get(meeting.groupId);
      cleanedUpdates.searchText = buildMeetingSearchText({
        title: updates.title ?? meeting.title,
        locationOverride: updates.locationOverride ?? meeting.locationOverride,
        groupName: group?.name,
      });
    }

    // Apply updates
    await ctx.db.patch(meetingId, cleanedUpdates);

    // Trigger followup score recomputation when meeting completion status changes
    if (
      (cleanedUpdates.status === "completed" && meeting.status !== "completed") ||
      (cleanedUpdates.status !== undefined && cleanedUpdates.status !== "completed" && meeting.status === "completed")
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.followupScoreComputation.computeGroupScores,
        { groupId: meeting.groupId }
      );

      // Also refresh community-level scores
      const meetingGroup = await ctx.db.get(meeting.groupId);
      if (meetingGroup?.communityId) {
        await ctx.scheduler.runAfter(
          0,
          internal.functions.communityScoreComputation.computeCommunityScores,
          { communityId: meetingGroup.communityId }
        );
      }
    }

    // Send event update notification if significant changes were made
    if (changes.length > 0 && meeting.status === "scheduled") {
      await ctx.scheduler.runAfter(
        0, // Run immediately
        internal.functions.scheduledJobs.sendEventUpdateNotification,
        {
          meetingId,
          changes,
          newTime: updates.scheduledAt
            ? new Date(updates.scheduledAt).toISOString()
            : undefined,
          newLocation: updates.locationOverride,
        }
      );
    }

    return await ctx.db.get(meetingId);
  },
});

/**
 * Cancel a meeting
 */
export const cancel = mutation({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
    cancellationReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get the meeting to find the group
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }

    // Verify user is a leader of this group
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", meeting.groupId).eq("userId", userId)
      )
      .first();

    if (!isActiveLeader(membership)) {
      throw new Error("Only group leaders can cancel meetings");
    }

    await ctx.db.patch(args.meetingId, {
      status: "cancelled",
      cancellationReason: args.cancellationReason,
    });

    return true;
  },
});
