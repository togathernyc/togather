/**
 * Meeting functions - Index
 *
 * Configuration, re-exports, and core CRUD mutations.
 */

import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { now, generateShortId, getDisplayName, getMediaUrl } from "../../lib/utils";
import { requireAuth } from "../../lib/auth";
import { isActiveLeader, isActiveMembership } from "../../lib/helpers";
import {
  canCreateInGroup,
  canEditMeeting,
  canEditSeriesWide,
  countFutureEventsCreatedBy,
  NON_LEADER_FUTURE_EVENT_CAP,
} from "../../lib/meetingPermissions";
import { DOMAIN_CONFIG } from "@togather/shared/config";
import {
  DEFAULT_REMINDER_OFFSET_MS,
  DEFAULT_ATTENDANCE_CONFIRMATION_OFFSET_MS,
  DEFAULT_MEETING_DURATION_MS,
  DEFAULT_RSVP_OPTIONS,
} from "../../lib/meetingConfig";
import { buildMeetingSearchText } from "../../lib/meetingSearchText";
import { findSeriesByGroupAndName } from "../eventSeries";

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
    locationMode: v.optional(
      v.union(v.literal("address"), v.literal("online"), v.literal("tbd"))
    ),
    note: v.optional(v.string()),
    coverImage: v.optional(v.string()),
    posterId: v.optional(v.id("posters")),
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
    hideRsvpCount: v.optional(v.boolean()),
    visibility: v.optional(v.string()),
    seriesId: v.optional(v.id("eventSeries")),
    // Hosts own the event. When omitted on create we default to
    // [createdById] so the filer is seated as host; pass `[]` to explicitly
    // delegate to group leaders (the "no host" state) at create time.
    hostUserIds: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, args) => {
    const createdById = await requireAuth(ctx, args.token);

    // Any active member can create; leaders get extra privileges below. See ADR-022.
    const { allowed, isLeader } = await canCreateInGroup(
      ctx,
      createdById,
      args.groupId
    );
    if (!allowed) {
      throw new Error("You must be a member of this group to create events");
    }

    // Validate hosts are active members of the target group. Deduplicate
    // so a client sending [userA, userA] doesn't double-seat.
    const rawHostUserIds = args.hostUserIds ?? [createdById];
    const hostUserIds: typeof rawHostUserIds = [];
    const seenHosts = new Set<string>();
    for (const hostId of rawHostUserIds) {
      const key = String(hostId);
      if (seenHosts.has(key)) continue;
      seenHosts.add(key);
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", args.groupId).eq("userId", hostId)
        )
        .first();
      if (!isActiveMembership(membership)) {
        throw new Error("Hosts must be active members of the group");
      }
      hostUserIds.push(hostId);
    }

    // Series creation remains leader-only.
    if (args.seriesId && !isLeader) {
      throw new Error("Only group leaders can add events to a series");
    }

    // 1-future-event cap for non-leaders (ADR-022). Convex mutations are
    // serialized per-document; a concurrent second create reads the just-inserted
    // row and this check rejects it. Scoped to the target group's community —
    // events in a different community don't count against this one.
    if (!isLeader) {
      // Look ahead to the target group so we know the community scope.
      const targetGroup = await ctx.db.get(args.groupId);
      if (!targetGroup?.communityId) {
        throw new Error("Group is not linked to a community");
      }
      const futureCount = await countFutureEventsCreatedBy(
        ctx,
        createdById,
        now(),
        targetGroup.communityId
      );
      if (futureCount >= NON_LEADER_FUTURE_EVENT_CAP) {
        throw new Error(
          "You already have an upcoming event. Cancel or finish it before creating another."
        );
      }
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
      locationMode: args.locationMode,
      note: args.note,
      coverImage: args.coverImage,
      posterId: args.posterId,
      status: "scheduled",
      createdById,
      hostUserIds,
      createdAt: timestamp,
      rsvpEnabled: effectiveRsvpEnabled,
      rsvpOptions: effectiveRsvpOptions,
      hideRsvpCount: args.hideRsvpCount,
      visibility: args.visibility,
      seriesId: args.seriesId,
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

    // Notify group leaders when a non-leader creates an event, EXCEPT in the
    // announcement group (community-wide events), where this would spam admins.
    if (!isLeader && !group.isAnnouncementGroup) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.notifications.senders.notifyEventCreatedByMember,
        { meetingId }
      );
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
    locationMode: v.optional(
      v.union(v.literal("address"), v.literal("online"), v.literal("tbd"))
    ),
    note: v.optional(v.string()),
    coverImage: v.optional(v.string()),
    // `undefined` → leave posterId unchanged. `null` → explicitly clear the
    // linked curated poster (e.g. user switched from a library pick to a
    // custom upload). We translate null → `ctx.db.patch(..., { posterId:
    // undefined })` below, which Convex interprets as "delete this field."
    posterId: v.optional(v.union(v.id("posters"), v.null())),
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
    hideRsvpCount: v.optional(v.boolean()),
    visibility: v.optional(v.string()),
    scope: v.optional(v.union(v.literal("this_only"), v.literal("all_in_series"))),
    // Pass an array (including `[]` to delegate to group leaders) to change
    // hosts; omit to leave unchanged.
    hostUserIds: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const { meetingId, token: _token, scope: _scope, ...updates } = args;
    const timestamp = now();

    // Get the current meeting to detect changes
    const meeting = await ctx.db.get(meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }

    // Per ADR-022: host, group leaders, and community admins can update.
    if (!(await canEditMeeting(ctx, userId, meeting))) {
      throw new Error("You do not have permission to update this event");
    }

    // Validate host changes before applying. Hosts must be active members of
    // the hosting group. Empty array is allowed — it delegates the event
    // back to the group's leaders. Deduplicate defensively.
    let hostsChanged = false;
    if (updates.hostUserIds !== undefined) {
      const seen = new Set<string>();
      const validated: typeof updates.hostUserIds = [];
      for (const hostId of updates.hostUserIds) {
        const key = String(hostId);
        if (seen.has(key)) continue;
        seen.add(key);
        const membership = await ctx.db
          .query("groupMembers")
          .withIndex("by_group_user", (q) =>
            q.eq("groupId", meeting.groupId).eq("userId", hostId)
          )
          .first();
        if (!isActiveMembership(membership)) {
          throw new Error("Hosts must be active members of the group");
        }
        validated.push(hostId);
      }
      updates.hostUserIds = validated;

      const prev = meeting.hostUserIds ?? [];
      hostsChanged =
        prev.length !== validated.length ||
        prev.some((id, i) => id !== validated[i]);
    }

    // Series-wide scope can cascade writes to siblings the caller may not own
    // or lead (shared series spanning multiple groups). Tighten: require the
    // caller to be a leader of the anchor group or a community admin. A plain
    // creator can only touch their own single meeting.
    if (args.scope === "all_in_series" && meeting.seriesId) {
      if (!(await canEditSeriesWide(ctx, userId, meeting))) {
        throw new Error(
          "Only group leaders or community admins can edit all events in a series"
        );
      }
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

    // Clients send `posterId: null` to explicitly clear the curated-poster
    // reference (e.g. switching to a custom upload). Convex patches drop
    // fields when the value is `undefined`, so translate null → undefined to
    // remove `posterId` from the document.
    if (cleanedUpdates.posterId === null) {
      cleanedUpdates.posterId = undefined;
    }
    // `coverImage: ""` is the client's explicit-remove sentinel. Translate
    // to undefined so the patch unsets the field (instead of storing an
    // empty string that every read path would have to treat as falsy).
    if (cleanedUpdates.coverImage === "") {
      cleanedUpdates.coverImage = undefined;
    }

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

      // Schedule new reminder if in the future. Don't gate on the old
      // reminderSent value — line 401 just reset it for forward reschedules,
      // so an already-fired meeting moved to a new future time still needs
      // a fresh job. The attendance block below already follows this shape.
      if (newReminderAt > timestamp) {
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

    // Reconcile chat channel admin seating when hosts change. Safe to call
    // even if no channel exists — the internal mutation no-ops in that case.
    if (hostsChanged) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.messaging.eventChat.reconcileEventChannelAdmins,
        { meetingId }
      );
    }

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

    // If scope is "all_in_series", apply non-temporal updates to all meetings in the series
    if (args.scope === "all_in_series" && meeting.seriesId) {
      const seriesMeetings = await ctx.db
        .query("meetings")
        .withIndex("by_series", (q) => q.eq("seriesId", meeting.seriesId!))
        .collect();

      // Non-temporal fields that cascade to series siblings
      const seriesUpdates: Record<string, unknown> = {};
      if (updates.title !== undefined) seriesUpdates.title = updates.title;
      if (updates.meetingType !== undefined) seriesUpdates.meetingType = updates.meetingType;
      if (updates.meetingLink !== undefined) seriesUpdates.meetingLink = updates.meetingLink;
      if (updates.note !== undefined) seriesUpdates.note = updates.note;
      if (updates.coverImage !== undefined) seriesUpdates.coverImage = updates.coverImage;
      // null → delete the field on every sibling (same semantics as the
      // single-meeting path above).
      if (updates.posterId !== undefined) {
        seriesUpdates.posterId =
          updates.posterId === null ? undefined : updates.posterId;
      }
      if (updates.rsvpEnabled !== undefined) seriesUpdates.rsvpEnabled = updates.rsvpEnabled;
      if (updates.rsvpOptions !== undefined) seriesUpdates.rsvpOptions = updates.rsvpOptions;
      if (updates.hideRsvpCount !== undefined) seriesUpdates.hideRsvpCount = updates.hideRsvpCount;
      if (updates.visibility !== undefined) seriesUpdates.visibility = updates.visibility;
      if (updates.locationOverride !== undefined) seriesUpdates.locationOverride = updates.locationOverride;
      // Hosts cascade like any other non-temporal field. Without this, a
      // "change hosts on all events in series" edit would only touch the
      // anchor and leave siblings with stale hosts/chat admins/notification
      // recipients — violating the selected scope.
      if (updates.hostUserIds !== undefined) seriesUpdates.hostUserIds = updates.hostUserIds;

      if (Object.keys(seriesUpdates).length > 0) {
        for (const sibling of seriesMeetings) {
          // Skip the meeting we already updated, cancelled meetings, and overridden meetings
          if (sibling._id === meetingId) continue;
          if (sibling.status === "cancelled") continue;
          if (sibling.isOverridden) continue;

          // Rebuild searchText if title or location changed
          if (updates.title !== undefined || updates.locationOverride !== undefined) {
            const siblingGroup = await ctx.db.get(sibling.groupId);
            seriesUpdates.searchText = buildMeetingSearchText({
              title: (updates.title ?? sibling.title) as string | undefined,
              locationOverride: (updates.locationOverride ?? sibling.locationOverride) as string | undefined,
              groupName: siblingGroup?.name,
            });
          }

          // Compare the sibling's pre-patch hosts to the incoming value
          // so we only reconcile when *this sibling* actually changed.
          // The anchor-based `hostsChanged` isn't enough: a sibling could
          // have diverged from a prior per-meeting edit and still need
          // reconciliation even when the anchor's hosts look the same on
          // this save.
          let siblingHostsChanged = false;
          if (updates.hostUserIds !== undefined) {
            const prev = sibling.hostUserIds ?? [];
            const next = updates.hostUserIds;
            siblingHostsChanged =
              prev.length !== next.length ||
              prev.some((id, i) => id !== next[i]);
          }

          await ctx.db.patch(sibling._id, seriesUpdates);

          // Reconcile sibling's chat-channel admin seating after host
          // change so old hosts get demoted/removed and new hosts seated
          // — same logic the single-meeting path runs above.
          if (siblingHostsChanged) {
            await ctx.scheduler.runAfter(
              0,
              internal.functions.messaging.eventChat.reconcileEventChannelAdmins,
              { meetingId: sibling._id }
            );
          }
        }
      }
    }

    return await ctx.db.get(meetingId);
  },
});

/**
 * Cancel a meeting (or all meetings in a series)
 */
export const cancel = mutation({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
    cancellationReason: v.optional(v.string()),
    scope: v.optional(v.union(v.literal("this_only"), v.literal("all_in_series"))),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get the meeting to find the group
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }

    // Per ADR-022: creator, group leaders, and community admins can cancel.
    if (!(await canEditMeeting(ctx, userId, meeting))) {
      throw new Error("You do not have permission to cancel this event");
    }

    // Series-wide cancel can destroy meetings the caller doesn't own or lead.
    // Tighten to leader-of-anchor-group or community admin.
    if (args.scope === "all_in_series" && meeting.seriesId) {
      if (!(await canEditSeriesWide(ctx, userId, meeting))) {
        throw new Error(
          "Only group leaders or community admins can cancel all events in a series"
        );
      }
    }

    if (args.scope === "all_in_series" && meeting.seriesId) {
      // Cancel all meetings in the series
      const seriesMeetings = await ctx.db
        .query("meetings")
        .withIndex("by_series", (q) => q.eq("seriesId", meeting.seriesId!))
        .collect();

      let meetingsCancelled = 0;
      for (const m of seriesMeetings) {
        if (m.status === "cancelled") continue;

        // Cancel scheduled jobs
        if (m.reminderJobId) {
          try { await ctx.scheduler.cancel(m.reminderJobId); } catch { /* already run */ }
        }
        if (m.attendanceConfirmationJobId) {
          try { await ctx.scheduler.cancel(m.attendanceConfirmationJobId); } catch { /* already run */ }
        }

        await ctx.db.patch(m._id, {
          status: "cancelled",
          cancellationReason: args.cancellationReason,
        });
        meetingsCancelled++;
      }

      // Also cancel the series record
      await ctx.db.patch(meeting.seriesId, { status: "cancelled" });

      return { meetingsCancelled };
    }

    // Default: cancel just this meeting
    await ctx.db.patch(args.meetingId, {
      status: "cancelled",
      cancellationReason: args.cancellationReason,
    });

    return true;
  },
});

/**
 * Toggle RSVP leader notifications for a meeting.
 * Strictly leader/admin-only per ADR-022. This flag controls whether the
 * group's leaders get notified — creators shouldn't be able to silence
 * their own group's leaders by creating an event there. Creators receive
 * RSVP notifications unconditionally via `notifyRsvpReceived`, so they
 * don't need a toggle here.
 */
export const toggleRsvpLeaderNotifications = mutation({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", meeting.groupId).eq("userId", userId)
      )
      .first();
    if (!isActiveLeader(membership)) {
      throw new Error("Only group leaders can change notification settings");
    }

    await ctx.db.patch(args.meetingId, {
      rsvpNotifyLeaders: args.enabled,
    });

    return { success: true };
  },
});

/**
 * Create multiple meetings as a series for a single group.
 */
export const createSeriesEvents = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    seriesName: v.string(),
    dates: v.array(v.number()), // Array of scheduledAt timestamps
    title: v.optional(v.string()),
    meetingType: v.number(),
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
    hideRsvpCount: v.optional(v.boolean()),
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

    if (args.dates.length < 1) {
      throw new Error("Series must have at least 1 date");
    }

    const timestamp = now();

    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new Error("Group not found");
    }

    // Find or create the series for this group
    let series = await findSeriesByGroupAndName(ctx, args.groupId, args.seriesName);
    let seriesId;
    if (series && series.status === "active") {
      seriesId = series._id;
    } else {
      seriesId = await ctx.db.insert("eventSeries", {
        groupId: args.groupId,
        createdById,
        name: args.seriesName,
        status: "active",
        createdAt: timestamp,
      });
    }

    const effectiveRsvpEnabled = args.rsvpEnabled ?? true;
    const effectiveRsvpOptions = args.rsvpOptions ?? (effectiveRsvpEnabled ? DEFAULT_RSVP_OPTIONS : undefined);

    const meetingIds: string[] = [];

    for (const scheduledAt of args.dates) {
      const shortId = generateShortId();
      const reminderAt = scheduledAt - DEFAULT_REMINDER_OFFSET_MS;
      const meetingEndTime = scheduledAt + DEFAULT_MEETING_DURATION_MS;
      const attendanceConfirmationAt = meetingEndTime + DEFAULT_ATTENDANCE_CONFIRMATION_OFFSET_MS;

      const meetingId = await ctx.db.insert("meetings", {
        groupId: args.groupId,
        title: args.title,
        shortId,
        scheduledAt,
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
        hideRsvpCount: args.hideRsvpCount,
        visibility: args.visibility,
        seriesId,
        reminderAt,
        reminderSent: false,
        attendanceConfirmationAt,
        attendanceConfirmationSent: false,
        communityId: group.communityId,
        searchText: buildMeetingSearchText({
          title: args.title,
          locationOverride: args.locationOverride,
          groupName: group.name,
        }),
      });

      // Schedule reminder
      let reminderJobId = undefined;
      if (reminderAt > timestamp) {
        reminderJobId = await ctx.scheduler.runAt(
          reminderAt,
          internal.functions.scheduledJobs.sendMeetingReminder,
          { meetingId }
        );
      }

      // Schedule attendance confirmation
      let attendanceConfirmationJobId = undefined;
      if (attendanceConfirmationAt > timestamp) {
        attendanceConfirmationJobId = await ctx.scheduler.runAt(
          attendanceConfirmationAt,
          internal.functions.scheduledJobs.sendAttendanceConfirmation,
          { meetingId }
        );
      }

      if (reminderJobId || attendanceConfirmationJobId) {
        await ctx.db.patch(meetingId, {
          reminderJobId,
          attendanceConfirmationJobId,
        });
      }

      meetingIds.push(meetingId);
    }

    return { seriesId, meetingIds };
  },
});

// ============================================================================
// Post Event to Chat
// ============================================================================

/**
 * Post an event link to the group's main chat channel.
 * Called from the "Send to Chat" modal after creating an event.
 */
export const postToChat = mutation({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) {
      throw new Error("Event not found");
    }

    // Verify user is a leader of this group
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", meeting.groupId).eq("userId", userId)
      )
      .first();

    if (!isActiveLeader(membership)) {
      throw new Error("Only group leaders can share events to chat");
    }

    // Find the group's main channel
    const mainChannel = await ctx.db
      .query("chatChannels")
      .withIndex("by_group_type", (q) =>
        q.eq("groupId", meeting.groupId).eq("channelType", "main")
      )
      .first();

    if (!mainChannel) {
      throw new Error("Group chat channel not found");
    }

    // Check user is a member of the channel
    const channelMembership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", mainChannel._id).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!channelMembership) {
      throw new Error("Not a member of the group chat");
    }

    // Build message content with event link
    const eventUrl = meeting.shortId
      ? DOMAIN_CONFIG.eventShareUrl(meeting.shortId)
      : "";
    const content = eventUrl
      ? `${args.message}\n\n${eventUrl}`
      : args.message;

    // Get sender info
    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const senderName = getDisplayName(user.firstName, user.lastName);
    const senderProfilePhoto = getMediaUrl(user.profilePhoto);
    const timestamp = now();

    // Insert the chat message
    const messageId = await ctx.db.insert("chatMessages", {
      channelId: mainChannel._id,
      senderId: userId,
      content,
      contentType: "text",
      createdAt: timestamp,
      isDeleted: false,
      senderName,
      senderProfilePhoto,
      lastActivityAt: timestamp,
    });

    // Update channel with last message info
    const preview = content.slice(0, 100);
    await ctx.db.patch(mainChannel._id, {
      lastMessageAt: timestamp,
      lastMessagePreview: preview,
      lastMessageSenderId: userId,
      lastMessageSenderName: senderName,
      updatedAt: timestamp,
    });

    // Trigger notification logic
    await ctx.scheduler.runAfter(0, internal.functions.messaging.events.onMessageSent, {
      messageId,
      channelId: mainChannel._id,
      senderId: userId,
    });

    return messageId;
  },
});
