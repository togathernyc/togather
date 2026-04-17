/**
 * Meeting Query functions
 *
 * Read-only queries for fetching meeting data.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import { now, normalizePagination, getMediaUrl } from "../../lib/utils";
import { paginationArgs, meetingStatusValidator } from "../../lib/validators";
import { getOptionalAuth } from "../../lib/auth";
import { getSeriesNumber } from "../eventSeries";

/**
 * Get meeting by short ID (for public sharing URLs)
 *
 * Returns meeting with group, community, and access information.
 * Used for the /e/[shortId] event pages.
 */
export const getByShortId = query({
  args: { shortId: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const meeting = await ctx.db
      .query("meetings")
      .withIndex("by_shortId", (q) => q.eq("shortId", args.shortId))
      .first();

    if (!meeting) return null;

    const group = await ctx.db.get(meeting.groupId);
    if (!group) return null;

    const community = await ctx.db.get(group.communityId);

    // Get RSVP counts by option (with safety limit to prevent unbounded queries)
    const rsvps = await ctx.db
      .query("meetingRsvps")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
      .take(1000);

    // Count by rsvpOptionId (1=yes, 2=no, 3=maybe based on rsvpOptions)
    const rsvpCounts = {
      yes: rsvps.filter((r) => r.rsvpOptionId === 1).length,
      no: rsvps.filter((r) => r.rsvpOptionId === 2).length,
      maybe: rsvps.filter((r) => r.rsvpOptionId === 3).length,
      total: rsvps.length,
    };

    // Check user access
    const userId = await getOptionalAuth(ctx, args.token);
    let hasAccess = false;
    let userRole: string | null = null;

    // Check visibility-based access
    const visibility = meeting.visibility || "group";
    if (visibility === "public") {
      hasAccess = true;
    } else if (visibility === "community" && userId) {
      // Check if user is in the community
      const communityMembership = await ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", userId).eq("communityId", group.communityId)
        )
        .first();
      hasAccess = !!communityMembership;
    } else if (userId) {
      // Check if user is a member of the group
      const groupMembership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", meeting.groupId).eq("userId", userId)
        )
        .filter((q) =>
          q.and(
            q.eq(q.field("leftAt"), undefined),
            q.or(
              q.eq(q.field("requestStatus"), undefined),
              q.eq(q.field("requestStatus"), "accepted")
            )
          )
        )
        .first();

      if (groupMembership) {
        hasAccess = true;
        userRole = groupMembership.role || "member";
      }
    }

    // Get group type name
    const groupType = await ctx.db.get(group.groupTypeId);

    // Get creator display info (for member-led events we surface
    // "Hosted by [name]" so the attendee can tell it's a member event, not
    // an official community post). Name is rendered in "First L." form
    // everywhere — short, identity-preserving, and privacy-friendly even
    // on public share pages where non-members may land. Safe to load
    // regardless of access: names already appear on guest lists.
    const creator = meeting.createdById
      ? await ctx.db.get(meeting.createdById)
      : null;
    const creatorName = creator
      ? [creator.firstName, creator.lastName?.[0] ? `${creator.lastName[0]}.` : ""]
          .filter(Boolean)
          .join(" ")
          .trim() || null
      : null;

    // Build access prompt for users without access
    let accessPrompt = null;
    if (!hasAccess) {
      accessPrompt = {
        message: userId
          ? "Join this group to RSVP"
          : "Sign in to RSVP to this event",
        action: userId ? "join" : "signin",
      };
    }

    // Return full meeting data if user has access, limited data otherwise
    return {
      id: meeting._id,
      shortId: meeting.shortId,
      title: meeting.title,
      scheduledAt: meeting.scheduledAt
        ? new Date(meeting.scheduledAt).toISOString()
        : null,
      actualEnd: meeting.actualEnd
        ? new Date(meeting.actualEnd).toISOString()
        : null,
      status: meeting.status,
      cancellationReason: meeting.cancellationReason,
      meetingType: meeting.meetingType,
      meetingLink: hasAccess ? meeting.meetingLink : null,
      locationOverride: meeting.locationOverride,
      note: hasAccess ? meeting.note : null,
      coverImage: getMediaUrl(meeting.coverImage),
      visibility: meeting.visibility || "group",
      rsvpEnabled: meeting.rsvpEnabled ?? true,
      rsvpOptions: meeting.rsvpOptions || [],
      rsvpCounts,
      // Group info
      groupId: group._id,
      groupName: group.name,
      groupImage: getMediaUrl(group.preview),
      groupTypeName: groupType?.name || "Group",
      isAnnouncementGroup: group.isAnnouncementGroup === true,
      // Community info
      communityId: community?._id || null,
      communityName: community?.name || null,
      communityLogo: getMediaUrl(community?.logo),
      // Creator info (ADR-022: distinguishes member-led from leader-led)
      createdById: meeting.createdById ?? null,
      creatorName,
      creatorImage: creator ? getMediaUrl(creator.profilePhoto) : null,
      // Access info
      hasAccess,
      accessPrompt,
      userRole,
      rsvpNotifyLeaders: meeting.rsvpNotifyLeaders,
    };
  },
});

/**
 * Get meeting with details (group info, RSVP count, etc.)
 */
export const getWithDetails = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return null;

    const group = await ctx.db.get(meeting.groupId);
    const creator = meeting.createdById
      ? await ctx.db.get(meeting.createdById)
      : null;

    // Get RSVP counts by option
    const rsvps = await ctx.db
      .query("meetingRsvps")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .collect();

    // Count by rsvpOptionId (1=yes, 2=no, 3=maybe based on rsvpOptions)
    const rsvpCounts = {
      yes: rsvps.filter((r) => r.rsvpOptionId === 1).length,
      no: rsvps.filter((r) => r.rsvpOptionId === 2).length,
      maybe: rsvps.filter((r) => r.rsvpOptionId === 3).length,
      total: rsvps.length,
    };

    // Get parent event title if it's a community-wide event
    let parentEventTitle: string | undefined;
    if (meeting.communityWideEventId) {
      const parentEvent = await ctx.db.get(meeting.communityWideEventId);
      parentEventTitle = parentEvent?.title;
    }

    // Get series info if meeting is part of a series
    let seriesInfo: {
      seriesId: string;
      seriesName: string;
      seriesNumber: number;
      seriesTotalCount: number;
    } | null = null;
    if (meeting.seriesId) {
      const series = await ctx.db.get(meeting.seriesId);
      if (series) {
        const { seriesNumber, seriesTotalCount } = await getSeriesNumber(ctx, {
          _id: meeting._id,
          seriesId: meeting.seriesId,
          scheduledAt: meeting.scheduledAt,
        });
        seriesInfo = {
          seriesId: series._id,
          seriesName: series.name,
          seriesNumber,
          seriesTotalCount,
        };
      }
    }

    return {
      ...meeting,
      coverImage: getMediaUrl(meeting.coverImage),
      group: group
        ? {
            ...group,
            preview: getMediaUrl(group.preview),
          }
        : null,
      creator,
      rsvpCounts,
      // Community-wide event fields
      communityWideEventId: meeting.communityWideEventId,
      isOverridden: meeting.isOverridden ?? false,
      parentEventTitle,
      // Series info
      seriesInfo,
    };
  },
});

/**
 * Check if a meeting is a community-wide event
 *
 * Returns information about the meeting's community-wide status,
 * including whether it's been overridden by a leader.
 */
export const isCommunityWideEvent = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) {
      return {
        isCommunityWide: false,
        isOverridden: false,
        parentEventTitle: undefined,
      };
    }

    const isCommunityWide = !!meeting.communityWideEventId;
    const isOverridden = meeting.isOverridden ?? false;

    // Get parent event title if it's a community-wide event
    let parentEventTitle: string | undefined;
    if (meeting.communityWideEventId) {
      const parentEvent = await ctx.db.get(meeting.communityWideEventId);
      parentEventTitle = parentEvent?.title;
    }

    return {
      isCommunityWide,
      isOverridden,
      parentEventTitle,
    };
  },
});

/**
 * List meetings for a group
 */
export const listByGroup = query({
  args: {
    groupId: v.id("groups"),
    status: v.optional(meetingStatusValidator),
    startAfter: v.optional(v.number()),
    startBefore: v.optional(v.number()),
    includeCompleted: v.optional(v.boolean()),
    includeCancelled: v.optional(v.boolean()),
    ...paginationArgs,
  },
  handler: async (ctx, args) => {
    const { limit } = normalizePagination(args);

    // Order descending to get most recent meetings first
    // This ensures we get recent meetings even if there are many old ones
    const meetingsQuery = ctx.db
      .query("meetings")
      .withIndex("by_group_scheduledAt", (q) => q.eq("groupId", args.groupId))
      .order("desc");

    // Filter by time range and status
    const meetings = await meetingsQuery.take(limit * 3); // Fetch extra for filtering

    const filtered = meetings
      .filter((m) => {
        if (args.status && m.status !== args.status) return false;
        if (args.startAfter && m.scheduledAt < args.startAfter) return false;
        if (args.startBefore && m.scheduledAt > args.startBefore) return false;
        // Filter by status flags
        if (!args.includeCompleted && m.status === "completed") return false;
        if (!args.includeCancelled && m.status === "cancelled") return false;
        return true;
      })
      .slice(0, limit);

    // Batch fetch all attendance and guest records for the filtered meetings
    const meetingIds = filtered.map((m) => m._id);

    // Fetch all attendance records for these meetings in parallel
    const [allAttendanceRecords, allGuests] = await Promise.all([
      Promise.all(
        meetingIds.map((meetingId) =>
          ctx.db
            .query("meetingAttendances")
            .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
            .collect()
        )
      ),
      Promise.all(
        meetingIds.map((meetingId) =>
          ctx.db
            .query("meetingGuests")
            .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
            .collect()
        )
      ),
    ]);

    // Build maps for O(1) lookup
    const attendanceByMeeting = new Map<string, number>();
    const guestsByMeeting = new Map<string, number>();

    meetingIds.forEach((meetingId, index) => {
      // Status 1 = attended
      const attendedCount = allAttendanceRecords[index].filter(
        (r) => r.status === 1
      ).length;
      attendanceByMeeting.set(meetingId, attendedCount);
      guestsByMeeting.set(meetingId, allGuests[index].length);
    });

    // Map meetings with counts and series info from pre-fetched data
    const withCounts = await Promise.all(
      filtered.map(async (meeting) => {
        let seriesName: string | null = null;
        if (meeting.seriesId) {
          const series = await ctx.db.get(meeting.seriesId);
          seriesName = series?.name ?? null;
        }
        return {
          ...meeting,
          attendanceCount: attendanceByMeeting.get(meeting._id) ?? 0,
          guestCount: guestsByMeeting.get(meeting._id) ?? 0,
          seriesName,
        };
      })
    );

    return withCounts;
  },
});

/**
 * List upcoming meetings for a user (across all their groups)
 */
export const listUpcomingForUser = query({
  args: {
    token: v.optional(v.string()),
    ...paginationArgs,
  },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuth(ctx, args.token);
    if (!userId) return [];

    const { limit } = normalizePagination(args);
    const currentTime = now();

    // Get user's groups
    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) =>
        q.and(
          q.eq(q.field("leftAt"), undefined),
          q.or(
            q.eq(q.field("requestStatus"), undefined),
            q.eq(q.field("requestStatus"), "accepted")
          )
        )
      )
      .collect();

    // Batch fetch all groups upfront
    const groupIds = memberships.map((m) => m.groupId);
    const groups = await Promise.all(groupIds.map((id) => ctx.db.get(id)));
    const groupsMap = new Map(
      groups.filter(Boolean).map((g) => [g!._id, g!])
    );

    // Get meetings for each group (groups already fetched)
    const allMeetings = await Promise.all(
      memberships.map(async (membership) => {
        const meetings = await ctx.db
          .query("meetings")
          .withIndex("by_group_scheduledAt", (q) => q.eq("groupId", membership.groupId))
          .filter((q) =>
            q.and(
              q.gte(q.field("scheduledAt"), currentTime),
              q.eq(q.field("status"), "scheduled")
            )
          )
          .take(limit);

        // Add group info from pre-fetched map
        const group = groupsMap.get(membership.groupId);
        return meetings.map((m) => ({ ...m, group }));
      })
    );

    // Flatten and sort by scheduledAt
    const meetings = allMeetings
      .flat()
      .sort((a, b) => a.scheduledAt - b.scheduledAt)
      .slice(0, limit);

    return meetings;
  },
});
