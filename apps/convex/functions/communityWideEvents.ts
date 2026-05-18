/**
 * Community-Wide Events functions
 *
 * Functions for managing community-wide events that spawn meetings across all groups of a type.
 * Created by community admins to coordinate events across multiple groups simultaneously.
 *
 * Key concepts:
 * - CommunityWideEvent: Parent event record created by admin
 * - Child Meetings: Individual meeting records created for each group
 * - Cascade Updates: Changes to parent propagate to non-overridden children
 * - Override: Group leaders can customize their meeting, breaking the cascade link
 */

import { v } from "convex/values";
import { query, mutation, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { Doc, Id } from "../_generated/dataModel";
import { now, generateShortId } from "../lib/utils";
import { requireAuth } from "../lib/auth";
import { requireCommunityAdmin } from "../lib/permissions";
import {
  DEFAULT_REMINDER_OFFSET_MS,
  DEFAULT_ATTENDANCE_CONFIRMATION_OFFSET_MS,
  DEFAULT_MEETING_DURATION_MS,
  DEFAULT_RSVP_OPTIONS,
} from "../lib/meetingConfig";
import { buildMeetingSearchText } from "../lib/meetingSearchText";
import { findSeriesByGroupAndName } from "./eventSeries";

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a community-wide event
 *
 * Creates a parent event record and spawns individual meetings for all active
 * (non-archived) groups of the specified group type.
 *
 * @returns Object with communityWideEventId and count of meetings created
 */
export const create = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    groupTypeId: v.id("groupTypes"),
    title: v.string(),
    scheduledAt: v.number(),
    meetingType: v.number(), // 1=In-Person, 2=Online
    meetingLink: v.optional(v.string()),
    note: v.optional(v.string()),
    coverImage: v.optional(v.string()),
    seriesName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const timestamp = now();

    // Verify the group type belongs to this community
    const groupType = await ctx.db.get(args.groupTypeId);
    if (!groupType || groupType.communityId !== args.communityId) {
      throw new Error("Group type not found in this community");
    }

    // Query all active (non-archived) groups of the specified type FIRST
    // to ensure we don't create orphan events with no child meetings.
    //
    // SAFETY NOTE: This entire mutation runs as a single Convex transaction.
    // The groups query and meeting inserts happen atomically - no external state
    // can change between the query and the loop below. Groups cannot become
    // archived during this mutation's execution.
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community_type_archived", (q) =>
        q
          .eq("communityId", args.communityId)
          .eq("groupTypeId", args.groupTypeId)
          .eq("isArchived", false)
      )
      .collect();

    if (groups.length === 0) {
      throw new Error("No active groups of this type exist. Create groups before scheduling community-wide events.");
    }

    // Create the community-wide event record
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
      updatedAt: timestamp,
    });

    // Calculate reminder and attendance confirmation times
    const reminderAt = args.scheduledAt - DEFAULT_REMINDER_OFFSET_MS;
    const meetingEndTime = args.scheduledAt + DEFAULT_MEETING_DURATION_MS;
    const attendanceConfirmationAt = meetingEndTime + DEFAULT_ATTENDANCE_CONFIRMATION_OFFSET_MS;

    // Create a meeting for each group
    let meetingsCreated = 0;
    for (const group of groups) {
      const shortId = generateShortId();

      // If seriesName provided, find or create a series for this group
      let seriesId: Id<"eventSeries"> | undefined = undefined;
      if (args.seriesName) {
        const existingSeries = await findSeriesByGroupAndName(ctx, group._id, args.seriesName);
        if (existingSeries && existingSeries.status === "active") {
          seriesId = existingSeries._id;
        } else {
          seriesId = await ctx.db.insert("eventSeries", {
            groupId: group._id,
            createdById: userId,
            name: args.seriesName,
            status: "active",
            createdAt: timestamp,
          });
        }
      }

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
        createdById: userId,
        createdAt: timestamp,
        visibility: "community",
        rsvpEnabled: true,
        rsvpOptions: DEFAULT_RSVP_OPTIONS,
        communityId: args.communityId,
        searchText: buildMeetingSearchText({
          title: args.title,
          groupName: group.name,
        }),
        // Community-wide event link
        communityWideEventId,
        isOverridden: false,
        seriesId,
        // Scheduled job fields
        reminderAt,
        reminderSent: false,
        attendanceConfirmationAt,
        attendanceConfirmationSent: false,
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

      meetingsCreated++;
    }

    return {
      communityWideEventId,
      meetingsCreated,
    };
  },
});

/**
 * Update a community-wide event
 *
 * Updates the parent event and propagates changes to all child meetings
 * that have NOT been overridden by group leaders.
 *
 * @returns Count of meetings updated
 */
export const update = mutation({
  args: {
    token: v.string(),
    communityWideEventId: v.id("communityWideEvents"),
    title: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    meetingType: v.optional(v.number()),
    meetingLink: v.optional(v.string()),
    note: v.optional(v.string()),
    // Parent-only. Children inherit via read-path fallback — they never
    // store `coverImage` at creation anymore. Leaders can still set a
    // per-group override via `meetings.update`, and those overrides take
    // precedence in the child detail views.
    coverImage: v.optional(v.string()),
    // Community-wide fields that still make sense cross-group. These DO
    // cascade to every non-overridden child so edits from the CreateEvent
    // form on a CWE child don't silently drop when the user picks a
    // cross-group scope. Per-group fields (`locationOverride`) are
    // intentionally NOT cascaded.
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
    scope: v.optional(v.union(v.literal("this_date_all_groups"), v.literal("all_in_series"))),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get the community-wide event
    const communityWideEvent = await ctx.db.get(args.communityWideEventId);
    if (!communityWideEvent) {
      throw new Error("Community-wide event not found");
    }

    // Verify admin access
    await requireCommunityAdmin(ctx, communityWideEvent.communityId, userId);

    // Check event is not already cancelled
    if (communityWideEvent.status === "cancelled") {
      throw new Error("Cannot update a cancelled event");
    }

    const timestamp = now();

    // An "all_in_series" edit is forward-looking: this occurrence and future
    // ones. If the edited occurrence is itself in the past, it is treated like
    // any other past occurrence and skipped entirely — only future occurrences
    // change. (A default-scope edit still applies to the chosen occurrence
    // even when it's past.) This is keyed off the parent's own scheduledAt,
    // which stays authoritative even when child meeting dates are corrupt.
    const includeAnchor =
      args.scope !== "all_in_series" ||
      communityWideEvent.scheduledAt >= timestamp;

    // Build update object for the parent event
    const parentUpdates: Record<string, unknown> = { updatedAt: timestamp };
    if (args.title !== undefined) parentUpdates.title = args.title;
    if (args.scheduledAt !== undefined) parentUpdates.scheduledAt = args.scheduledAt;
    if (args.meetingType !== undefined) parentUpdates.meetingType = args.meetingType;
    if (args.meetingLink !== undefined) parentUpdates.meetingLink = args.meetingLink;
    if (args.note !== undefined) parentUpdates.note = args.note;
    if (args.coverImage !== undefined) {
      // `""` is the client's explicit-remove sentinel. Convex patches drop
      // fields set to `undefined`, so translate it here to fully unset the
      // shared cover instead of persisting an empty string.
      parentUpdates.coverImage = args.coverImage === "" ? undefined : args.coverImage;
    }

    // Update the parent event (skipped when this is a past all_in_series anchor).
    if (includeAnchor) {
      await ctx.db.patch(args.communityWideEventId, parentUpdates);
    }

    // ----------------------------------------------------------------
    // Determine which meetings receive the edit.
    //
    // A scheduledAt change ONLY ever applies to this occurrence's direct
    // children. Each occurrence in a series has its own date, so cascading
    // one absolute timestamp across the series would collapse every other
    // occurrence onto the same day.
    //
    // Non-date fields (title, note, RSVP config, …) cascade under
    // "all_in_series" — but only to this occurrence and *future* ones. Past
    // occurrences have already happened; editing them would rewrite history.
    // ----------------------------------------------------------------
    // All direct children of this occurrence. Overridden ones are kept here
    // only for series discovery — a `seriesId` lives on every child, and the
    // edited occurrence could have all of its children overridden, in which
    // case filtering first would lose the series link entirely.
    const allDirectChildren = await ctx.db
      .query("meetings")
      .withIndex("by_communityWideEvent", (q) =>
        q.eq("communityWideEventId", args.communityWideEventId)
      )
      .collect();

    // Children that receive the edit: non-overridden and not cancelled.
    // Overridden meetings are intentional per-group customizations; cancelled
    // meetings must not be patched or have reminder jobs rescheduled.
    const directChildren = allDirectChildren.filter(
      (m) => m.isOverridden !== true && m.status !== "cancelled"
    );

    // Meetings that receive non-date field edits.
    let cascadeMeetings: typeof directChildren = directChildren;
    // Future, non-cancelled parent occurrences in the series — the targets of
    // the parent-record cascade below.
    let futureSeriesParents: Doc<"communityWideEvents">[] = [];
    if (args.scope === "all_in_series") {
      const seriesIds = new Set(
        allDirectChildren
          .map((m) => m.seriesId)
          .filter((id): id is Id<"eventSeries"> => !!id)
      );
      if (seriesIds.size > 0) {
        // Gather every meeting across the series, deduplicated.
        const seriesMeetings: (typeof directChildren)[number][] = [];
        const seenMeeting = new Set<string>();
        const seriesParentIds = new Set<Id<"communityWideEvents">>();
        for (const sid of seriesIds) {
          const ms = await ctx.db
            .query("meetings")
            .withIndex("by_series", (q) => q.eq("seriesId", sid))
            .collect();
          for (const m of ms) {
            if (seenMeeting.has(m._id)) continue;
            seenMeeting.add(m._id);
            seriesMeetings.push(m);
            if (m.communityWideEventId) seriesParentIds.add(m.communityWideEventId);
          }
        }

        // Fetch the parent communityWideEvents. The occurrence date comes from
        // the parent, which stays authoritative even when a child meeting's
        // own `scheduledAt` is corrupt (the exact state this PR repairs) — so
        // "skip past occurrences" must key off the parent, not the child.
        const parentById = new Map<Id<"communityWideEvents">, Doc<"communityWideEvents">>();
        for (const pid of seriesParentIds) {
          const parent = await ctx.db.get(pid);
          if (parent) parentById.set(pid, parent);
        }

        // cascadeMeetings = the edited occurrence's children (unless it's a
        // past anchor), plus children of future, non-cancelled occurrences
        // (judged by the parent's date).
        const byId = new Map<Id<"meetings">, (typeof directChildren)[number]>();
        if (includeAnchor) {
          for (const m of directChildren) byId.set(m._id, m);
        }
        for (const m of seriesMeetings) {
          if (m.isOverridden === true || m.status === "cancelled") continue;
          if (!m.communityWideEventId) continue;
          const parent = parentById.get(m.communityWideEventId);
          if (!parent || parent.status === "cancelled") continue;
          if (parent.scheduledAt < timestamp) continue;
          byId.set(m._id, m);
        }
        cascadeMeetings = [...byId.values()];

        futureSeriesParents = [...parentById.values()].filter(
          (p) =>
            p._id !== args.communityWideEventId &&
            p.status !== "cancelled" &&
            p.scheduledAt >= timestamp
        );
      }
    }

    // Non-date field updates — cascade to the scoped set.
    const cascadeUpdates: Record<string, unknown> = {};
    if (args.title !== undefined) cascadeUpdates.title = args.title;
    if (args.meetingType !== undefined) cascadeUpdates.meetingType = args.meetingType;
    if (args.meetingLink !== undefined) cascadeUpdates.meetingLink = args.meetingLink;
    if (args.note !== undefined) cascadeUpdates.note = args.note;
    // coverImage is intentionally NOT cascaded — it's parent-only so that
    // admin-level cover edits don't clobber per-group leader overrides. The
    // read paths already fall back from child → parent when the child has no
    // cover of its own.
    if (args.rsvpEnabled !== undefined) cascadeUpdates.rsvpEnabled = args.rsvpEnabled;
    if (args.rsvpOptions !== undefined) cascadeUpdates.rsvpOptions = args.rsvpOptions;
    if (args.hideRsvpCount !== undefined) cascadeUpdates.hideRsvpCount = args.hideRsvpCount;
    if (args.visibility !== undefined) cascadeUpdates.visibility = args.visibility;

    // Date update — applies ONLY to this occurrence's direct children.
    const dateChanged = args.scheduledAt !== undefined;
    const dateUpdates: Record<string, unknown> = {};
    if (dateChanged) {
      const scheduledAt = args.scheduledAt as number;
      dateUpdates.scheduledAt = scheduledAt;
      dateUpdates.reminderAt = scheduledAt - DEFAULT_REMINDER_OFFSET_MS;
      dateUpdates.attendanceConfirmationAt =
        scheduledAt + DEFAULT_MEETING_DURATION_MS + DEFAULT_ATTENDANCE_CONFIRMATION_OFFSET_MS;
      // Reset sent flags
      dateUpdates.reminderSent = false;
      dateUpdates.attendanceConfirmationSent = false;
    }

    // Merge per-meeting patches so each meeting is written at most once.
    // A date change applies only to the edited occurrence's children — and
    // not at all when it's a past all_in_series anchor.
    const directIds = new Set(
      includeAnchor ? directChildren.map((m) => m._id) : []
    );
    const patches = new Map<
      Id<"meetings">,
      { meeting: (typeof directChildren)[number]; patch: Record<string, unknown> }
    >();
    for (const m of cascadeMeetings) {
      patches.set(m._id, { meeting: m, patch: { ...cascadeUpdates } });
    }
    if (dateChanged && includeAnchor) {
      for (const m of directChildren) {
        const entry = patches.get(m._id) ?? { meeting: m, patch: {} };
        Object.assign(entry.patch, dateUpdates);
        patches.set(m._id, entry);
      }
    }

    // Apply patches and reschedule jobs for any occurrence whose time changed.
    let meetingsUpdated = 0;
    for (const { meeting, patch } of patches.values()) {
      const timeChangedForThis = dateChanged && directIds.has(meeting._id);

      // Cancel old scheduled jobs before scheduling new ones if time changed.
      if (timeChangedForThis) {
        if (meeting.reminderJobId) {
          try { await ctx.scheduler.cancel(meeting.reminderJobId); } catch { /* already run */ }
        }
        if (meeting.attendanceConfirmationJobId) {
          try { await ctx.scheduler.cancel(meeting.attendanceConfirmationJobId); } catch { /* already run */ }
        }
      }

      if (args.title !== undefined) {
        const group = await ctx.db.get(meeting.groupId);
        patch.searchText = buildMeetingSearchText({
          title: args.title,
          locationOverride: meeting.locationOverride,
          groupName: group?.name,
        });
      }

      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(meeting._id, patch);
      }

      // Reschedule jobs if this occurrence's time changed.
      if (timeChangedForThis) {
        const scheduledAt = args.scheduledAt as number;
        const newReminderAt = scheduledAt - DEFAULT_REMINDER_OFFSET_MS;
        const newAttendanceConfirmationAt =
          scheduledAt + DEFAULT_MEETING_DURATION_MS + DEFAULT_ATTENDANCE_CONFIRMATION_OFFSET_MS;

        let newReminderJobId = undefined;
        let newAttendanceConfirmationJobId = undefined;

        if (newReminderAt > timestamp) {
          newReminderJobId = await ctx.scheduler.runAt(
            newReminderAt,
            internal.functions.scheduledJobs.sendMeetingReminder,
            { meetingId: meeting._id }
          );
        }
        if (newAttendanceConfirmationAt > timestamp) {
          newAttendanceConfirmationJobId = await ctx.scheduler.runAt(
            newAttendanceConfirmationAt,
            internal.functions.scheduledJobs.sendAttendanceConfirmation,
            { meetingId: meeting._id }
          );
        }

        await ctx.db.patch(meeting._id, {
          reminderJobId: newReminderJobId,
          attendanceConfirmationJobId: newAttendanceConfirmationJobId,
        });
      }

      meetingsUpdated++;
    }

    // Cascade non-date fields to the other future occurrences' parent
    // communityWideEvents. The Events feed and admin list render from the
    // parent record (e.g. `parent.title`), so without this they'd show stale
    // titles/notes even though the child meetings were updated.
    if (args.scope === "all_in_series") {
      const parentCascadeUpdates: Record<string, unknown> = { updatedAt: timestamp };
      if (args.title !== undefined) parentCascadeUpdates.title = args.title;
      if (args.meetingType !== undefined) parentCascadeUpdates.meetingType = args.meetingType;
      if (args.meetingLink !== undefined) parentCascadeUpdates.meetingLink = args.meetingLink;
      if (args.note !== undefined) parentCascadeUpdates.note = args.note;
      if (args.coverImage !== undefined) {
        parentCascadeUpdates.coverImage = args.coverImage === "" ? undefined : args.coverImage;
      }

      // Only cascade if there's an actual field change beyond `updatedAt`.
      if (Object.keys(parentCascadeUpdates).length > 1) {
        // futureSeriesParents is already filtered to future, non-cancelled
        // occurrences other than the edited one.
        for (const parent of futureSeriesParents) {
          await ctx.db.patch(parent._id, parentCascadeUpdates);
        }
      }
    }

    return { meetingsUpdated };
  },
});

/**
 * Cancel a community-wide event
 *
 * Sets the parent event status to 'cancelled' and cancels ALL child meetings,
 * including those that have been overridden.
 *
 * @returns Count of meetings cancelled
 */
export const cancel = mutation({
  args: {
    token: v.string(),
    communityWideEventId: v.id("communityWideEvents"),
    cancellationReason: v.optional(v.string()),
    scope: v.optional(v.union(v.literal("this_date_all_groups"), v.literal("all_in_series"))),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get the community-wide event
    const communityWideEvent = await ctx.db.get(args.communityWideEventId);
    if (!communityWideEvent) {
      throw new Error("Community-wide event not found");
    }

    // Verify admin access
    await requireCommunityAdmin(ctx, communityWideEvent.communityId, userId);

    // Check event is not already cancelled
    if (communityWideEvent.status === "cancelled") {
      throw new Error("Event is already cancelled");
    }

    const timestamp = now();

    // Update the parent event status
    await ctx.db.patch(args.communityWideEventId, {
      status: "cancelled",
      updatedAt: timestamp,
    });

    if (args.scope === "all_in_series") {
      // Cancel all meetings across all series linked to this communityWideEvent
      const directChildren = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", args.communityWideEventId)
        )
        .collect();

      const seriesIds = new Set(
        directChildren.map((m) => m.seriesId).filter((id): id is Id<"eventSeries"> => !!id)
      );

      let meetingsCancelled = 0;

      // Cancel all meetings in each series
      for (const sid of seriesIds) {
        const seriesMeetings = await ctx.db
          .query("meetings")
          .withIndex("by_series", (q) => q.eq("seriesId", sid))
          .collect();

        for (const meeting of seriesMeetings) {
          if (meeting.status === "cancelled") continue;

          // Cancel scheduled jobs
          if (meeting.reminderJobId) {
            try { await ctx.scheduler.cancel(meeting.reminderJobId); } catch { /* already run */ }
          }
          if (meeting.attendanceConfirmationJobId) {
            try { await ctx.scheduler.cancel(meeting.attendanceConfirmationJobId); } catch { /* already run */ }
          }

          await ctx.db.patch(meeting._id, {
            status: "cancelled",
            cancellationReason: args.cancellationReason,
          });
          meetingsCancelled++;
        }

        // Cancel the series record itself
        await ctx.db.patch(sid, { status: "cancelled" });
      }

      // Also cancel any direct children that weren't in a series
      for (const meeting of directChildren) {
        if (meeting.status === "cancelled" || meeting.seriesId) continue;
        await ctx.db.patch(meeting._id, {
          status: "cancelled",
          cancellationReason: args.cancellationReason,
        });
        meetingsCancelled++;
      }

      // Also cancel all communityWideEvents that share series with this one
      // (other dates in the series)
      const allCommunityWideEventIds = new Set<string>();
      for (const sid of seriesIds) {
        const seriesMeetings = await ctx.db
          .query("meetings")
          .withIndex("by_series", (q) => q.eq("seriesId", sid))
          .collect();
        for (const m of seriesMeetings) {
          if (m.communityWideEventId) {
            allCommunityWideEventIds.add(m.communityWideEventId);
          }
        }
      }
      for (const cweId of allCommunityWideEventIds) {
        if (cweId === args.communityWideEventId) continue; // Already cancelled above
        const cwe = await ctx.db.get(cweId as Id<"communityWideEvents">);
        if (cwe && cwe.status !== "cancelled") {
          await ctx.db.patch(cweId as Id<"communityWideEvents">, {
            status: "cancelled",
            updatedAt: timestamp,
          });
        }
      }

      return { meetingsCancelled };
    }

    // Default: this_date_all_groups — cancel only this date's meetings
    const childMeetings = await ctx.db
      .query("meetings")
      .withIndex("by_communityWideEvent", (q) =>
        q.eq("communityWideEventId", args.communityWideEventId)
      )
      .collect();

    let meetingsCancelled = 0;
    for (const meeting of childMeetings) {
      if (meeting.status === "cancelled") continue;

      // Cancel scheduled jobs
      if (meeting.reminderJobId) {
        try { await ctx.scheduler.cancel(meeting.reminderJobId); } catch { /* already run */ }
      }
      if (meeting.attendanceConfirmationJobId) {
        try { await ctx.scheduler.cancel(meeting.attendanceConfirmationJobId); } catch { /* already run */ }
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

/**
 * Create a community-wide event series (multiple dates across all groups of a type).
 *
 * For each date: creates a communityWideEvent record.
 * For each group: finds or creates an eventSeries record.
 * For each group x date: creates a meeting linked to both.
 */
export const createSeries = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    groupTypeId: v.id("groupTypes"),
    seriesName: v.string(),
    dates: v.array(v.number()), // Array of scheduledAt timestamps
    title: v.string(),
    meetingType: v.number(),
    meetingLink: v.optional(v.string()),
    note: v.optional(v.string()),
    coverImage: v.optional(v.string()),
    hideRsvpCount: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    if (args.dates.length < 1) {
      throw new Error("Series must have at least 1 date");
    }

    const timestamp = now();

    // Verify the group type belongs to this community
    const groupType = await ctx.db.get(args.groupTypeId);
    if (!groupType || groupType.communityId !== args.communityId) {
      throw new Error("Group type not found in this community");
    }

    // Query all active groups of this type
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community_type_archived", (q) =>
        q
          .eq("communityId", args.communityId)
          .eq("groupTypeId", args.groupTypeId)
          .eq("isArchived", false)
      )
      .collect();

    if (groups.length === 0) {
      throw new Error("No active groups of this type exist.");
    }

    // Find or create an eventSeries for each group
    const groupSeriesMap = new Map<string, Id<"eventSeries">>();
    for (const group of groups) {
      const existingSeries = await findSeriesByGroupAndName(ctx, group._id, args.seriesName);
      if (existingSeries && existingSeries.status === "active") {
        groupSeriesMap.set(group._id, existingSeries._id);
      } else {
        const seriesId = await ctx.db.insert("eventSeries", {
          groupId: group._id,
          createdById: userId,
          name: args.seriesName,
          status: "active",
          createdAt: timestamp,
        });
        groupSeriesMap.set(group._id, seriesId);
      }
    }

    // Create a communityWideEvent for each date, then meetings for each group
    const communityWideEventIds: Id<"communityWideEvents">[] = [];
    let totalMeetingsCreated = 0;

    for (const scheduledAt of args.dates) {
      const communityWideEventId = await ctx.db.insert("communityWideEvents", {
        communityId: args.communityId,
        groupTypeId: args.groupTypeId,
        createdById: userId,
        title: args.title,
        scheduledAt,
        meetingType: args.meetingType,
        meetingLink: args.meetingLink,
        note: args.note,
        coverImage: args.coverImage,
        status: "scheduled",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      communityWideEventIds.push(communityWideEventId);

      const reminderAt = scheduledAt - DEFAULT_REMINDER_OFFSET_MS;
      const meetingEndTime = scheduledAt + DEFAULT_MEETING_DURATION_MS;
      const attendanceConfirmationAt = meetingEndTime + DEFAULT_ATTENDANCE_CONFIRMATION_OFFSET_MS;

      for (const group of groups) {
        const shortId = generateShortId();
        const seriesId = groupSeriesMap.get(group._id)!;

        const meetingId = await ctx.db.insert("meetings", {
          groupId: group._id,
          title: args.title,
          shortId,
          scheduledAt,
          meetingType: args.meetingType,
          meetingLink: args.meetingLink,
          note: args.note,
          // coverImage lives on the parent CWE only — children fall back.
          status: "scheduled",
          createdById: userId,
          createdAt: timestamp,
          visibility: "community",
          rsvpEnabled: true,
          rsvpOptions: DEFAULT_RSVP_OPTIONS,
          hideRsvpCount: args.hideRsvpCount,
          communityId: args.communityId,
          searchText: buildMeetingSearchText({
            title: args.title,
            groupName: group.name,
          }),
          communityWideEventId,
          isOverridden: false,
          seriesId,
          reminderAt,
          reminderSent: false,
          attendanceConfirmationAt,
          attendanceConfirmationSent: false,
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

        totalMeetingsCreated++;
      }
    }

    return {
      communityWideEventIds,
      totalMeetingsCreated,
    };
  },
});

// ============================================================================
// Data repair (one-off migration)
// ============================================================================

/**
 * Restore child meeting dates that were collapsed by the old
 * `update(scope: "all_in_series")` bug.
 *
 * That bug overwrote `scheduledAt` on every meeting sharing a series with a
 * single absolute timestamp, dragging the children of past community-wide
 * events forward onto one future date — so the Events feed rendered one card
 * per historical occurrence all stacked on the same day.
 *
 * For every non-overridden child meeting whose `scheduledAt` diverges from its
 * parent communityWideEvent, this resets the meeting to the parent's date and
 * re-syncs the reminder / attendance-confirmation jobs. Per-group overrides are
 * left untouched. Safe to run repeatedly — already-correct children are skipped.
 *
 * Run with:
 *   npx convex run functions/communityWideEvents:repairCollapsedChildDates '{"dryRun":true}'
 */
export const repairCollapsedChildDates = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun === true;
    const timestamp = now();

    const communityWideEvents = await ctx.db.query("communityWideEvents").collect();

    let meetingsRepaired = 0;
    let jobsCancelled = 0;
    let jobsRescheduled = 0;
    const perEvent: Array<{
      communityWideEventId: Id<"communityWideEvents">;
      title: string;
      repaired: number;
    }> = [];

    for (const cwe of communityWideEvents) {
      const children = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", cwe._id)
        )
        .collect();

      let repairedForEvent = 0;
      for (const meeting of children) {
        // Leave per-group overrides untouched — leaders set those on purpose.
        if (meeting.isOverridden === true) continue;
        // Never repair or reschedule cancelled meetings — consistent with the
        // update/cancel paths, which deliberately skip cancelled rows.
        if (meeting.status === "cancelled") continue;
        if (meeting.scheduledAt === cwe.scheduledAt) continue;

        repairedForEvent++;
        meetingsRepaired++;
        if (dryRun) continue;

        // Cancel stale jobs scheduled for the wrong (collapsed) date.
        if (meeting.reminderJobId) {
          try {
            await ctx.scheduler.cancel(meeting.reminderJobId);
            jobsCancelled++;
          } catch { /* already run */ }
        }
        if (meeting.attendanceConfirmationJobId) {
          try {
            await ctx.scheduler.cancel(meeting.attendanceConfirmationJobId);
            jobsCancelled++;
          } catch { /* already run */ }
        }

        const reminderAt = cwe.scheduledAt - DEFAULT_REMINDER_OFFSET_MS;
        const attendanceConfirmationAt =
          cwe.scheduledAt + DEFAULT_MEETING_DURATION_MS + DEFAULT_ATTENDANCE_CONFIRMATION_OFFSET_MS;

        await ctx.db.patch(meeting._id, {
          scheduledAt: cwe.scheduledAt,
          reminderAt,
          attendanceConfirmationAt,
          // A window already in the past is treated as handled so no sweep
          // re-fires it; a future window is left pending for its new job.
          reminderSent: reminderAt <= timestamp,
          attendanceConfirmationSent: attendanceConfirmationAt <= timestamp,
        });

        // Reschedule jobs only when the restored time is still in the future.
        let reminderJobId = undefined;
        let attendanceConfirmationJobId = undefined;
        if (reminderAt > timestamp) {
          reminderJobId = await ctx.scheduler.runAt(
            reminderAt,
            internal.functions.scheduledJobs.sendMeetingReminder,
            { meetingId: meeting._id }
          );
          jobsRescheduled++;
        }
        if (attendanceConfirmationAt > timestamp) {
          attendanceConfirmationJobId = await ctx.scheduler.runAt(
            attendanceConfirmationAt,
            internal.functions.scheduledJobs.sendAttendanceConfirmation,
            { meetingId: meeting._id }
          );
          jobsRescheduled++;
        }
        await ctx.db.patch(meeting._id, {
          reminderJobId,
          attendanceConfirmationJobId,
        });
      }

      if (repairedForEvent > 0) {
        perEvent.push({
          communityWideEventId: cwe._id,
          title: cwe.title,
          repaired: repairedForEvent,
        });
      }
    }

    return { dryRun, meetingsRepaired, jobsCancelled, jobsRescheduled, perEvent };
  },
});

// ============================================================================
// Queries
// ============================================================================

/**
 * List all community-wide events for a community
 *
 * Returns events sorted by scheduledAt descending with group type info
 * and child meeting counts.
 */
export const list = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    // Get all community-wide events for this community
    const events = await ctx.db
      .query("communityWideEvents")
      .withIndex("by_scheduledAt", (q) => q.eq("communityId", args.communityId))
      .order("desc")
      .collect();

    // Batch fetch all group types
    const groupTypeIds = [...new Set(events.map((e) => e.groupTypeId))];
    const groupTypes = await Promise.all(groupTypeIds.map((id) => ctx.db.get(id)));
    const groupTypeMap = new Map(
      groupTypes
        .filter((gt): gt is NonNullable<typeof gt> => gt !== null)
        .map((gt) => [gt._id, gt])
    );

    // Get child meeting counts for each event
    const results = await Promise.all(
      events.map(async (event) => {
        const groupType = groupTypeMap.get(event.groupTypeId);

        // Query child meetings
        const childMeetings = await ctx.db
          .query("meetings")
          .withIndex("by_communityWideEvent", (q) =>
            q.eq("communityWideEventId", event._id)
          )
          .collect();

        const totalMeetings = childMeetings.length;
        const overriddenMeetings = childMeetings.filter((m) => m.isOverridden === true).length;

        // Pick the first non-overridden child meeting for edit navigation
        const firstChild = childMeetings.find((m) => !m.isOverridden) || childMeetings[0];

        return {
          id: event._id,
          communityId: event.communityId,
          groupTypeId: event.groupTypeId,
          groupTypeName: groupType?.name || "Unknown",
          createdById: event.createdById,
          title: event.title,
          scheduledAt: event.scheduledAt,
          meetingType: event.meetingType,
          meetingLink: event.meetingLink || null,
          note: event.note || null,
          status: event.status,
          createdAt: event.createdAt,
          updatedAt: event.updatedAt || null,
          // Stats
          totalMeetings,
          overriddenMeetings,
          // For edit navigation — first non-overridden child meeting
          firstChildMeetingId: firstChild?._id || null,
          firstChildGroupId: firstChild?.groupId || null,
        };
      })
    );

    return results;
  },
});

/**
 * Get a single community-wide event with details
 *
 * Returns the event with group type info and full list of child meetings
 * with group names.
 */
export const get = query({
  args: {
    token: v.string(),
    communityWideEventId: v.id("communityWideEvents"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get the community-wide event
    const event = await ctx.db.get(args.communityWideEventId);
    if (!event) {
      return null;
    }

    // Verify admin access
    await requireCommunityAdmin(ctx, event.communityId, userId);

    // Get group type
    const groupType = await ctx.db.get(event.groupTypeId);

    // Get all child meetings
    const childMeetings = await ctx.db
      .query("meetings")
      .withIndex("by_communityWideEvent", (q) =>
        q.eq("communityWideEventId", args.communityWideEventId)
      )
      .collect();

    // Batch fetch all groups
    const groupIds = [...new Set(childMeetings.map((m) => m.groupId))];
    const groups = await Promise.all(groupIds.map((id) => ctx.db.get(id)));
    const groupMap = new Map(
      groups
        .filter((g): g is NonNullable<typeof g> => g !== null)
        .map((g) => [g._id, g])
    );

    // Build child meeting details
    const meetings = childMeetings.map((meeting) => {
      const group = groupMap.get(meeting.groupId);
      return {
        id: meeting._id,
        groupId: meeting.groupId,
        groupName: group?.name || "Unknown Group",
        title: meeting.title || null,
        scheduledAt: meeting.scheduledAt,
        status: meeting.status,
        isOverridden: meeting.isOverridden || false,
        shortId: meeting.shortId || null,
      };
    });

    // Sort meetings by group name
    meetings.sort((a, b) => a.groupName.localeCompare(b.groupName));

    return {
      id: event._id,
      communityId: event.communityId,
      groupTypeId: event.groupTypeId,
      groupTypeName: groupType?.name || "Unknown",
      createdById: event.createdById,
      title: event.title,
      scheduledAt: event.scheduledAt,
      meetingType: event.meetingType,
      meetingLink: event.meetingLink || null,
      note: event.note || null,
      coverImage: event.coverImage ?? null,
      status: event.status,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt || null,
      // Child meetings
      meetings,
      // Stats
      totalMeetings: meetings.length,
      overriddenMeetings: meetings.filter((m) => m.isOverridden).length,
    };
  },
});
