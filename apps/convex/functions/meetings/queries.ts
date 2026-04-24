/**
 * Meeting Query functions
 *
 * Read-only queries for fetching meeting data.
 */

import { v } from "convex/values";
import type { QueryCtx } from "../../_generated/server";
import { query } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { now, normalizePagination, getMediaUrl } from "../../lib/utils";
import { paginationArgs, meetingStatusValidator } from "../../lib/validators";
import { getOptionalAuth } from "../../lib/auth";
import { getSeriesNumber } from "../eventSeries";
import { isActiveLeader, isLeaderRole } from "../../lib/helpers";
import { getHostUserIds, isMeetingHost } from "../../lib/meetingPermissions";

/**
 * "Hosted by [name]" (ADR-022) only applies to *member-led* events — i.e.
 * an event a non-leader member created in a group they don't lead. CWE
 * events are admin-created and share a single parent across groups, so
 * surfacing the admin's name on every group's copy reads as noise. Leader-
 * led events are already implicitly attributed via the group itself.
 */
async function shouldSurfaceCreator(
  ctx: QueryCtx,
  meeting: Doc<"meetings">
): Promise<boolean> {
  if (meeting.communityWideEventId) return false;
  if (!meeting.createdById) return false;
  const membership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q: any) =>
      q.eq("groupId", meeting.groupId).eq("userId", meeting.createdById)
    )
    .first();
  return !isActiveLeader(membership);
}

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

    // Look up the viewer's group membership up front so we always know their
    // role, independent of how access is granted. Without this, leaders who
    // view public/community events (where hasAccess is granted by visibility
    // alone) would never populate userRole, and `viewerIsLeader` below would
    // incorrectly flip to false — causing group leaders to lose hidden-count
    // visibility on their own group's public events.
    const groupMembership = userId
      ? await ctx.db
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
          .first()
      : null;
    if (groupMembership) {
      userRole = groupMembership.role || "member";
    }

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
    } else if (groupMembership) {
      hasAccess = true;
    }

    // Get group type name
    const groupType = await ctx.db.get(group.groupTypeId);

    // If this is a CWE child and has no cover of its own, inherit the
    // parent's cover so "edit just the cover on the parent" propagates
    // visually without touching the child row.
    let effectiveCoverImage: string | null | undefined = meeting.coverImage;
    if (!effectiveCoverImage && meeting.communityWideEventId) {
      const parent = await ctx.db.get(meeting.communityWideEventId);
      effectiveCoverImage = (parent as any)?.coverImage ?? null;
    }

    // Creator display only surfaces for member-led events (see
    // `shouldSurfaceCreator`). Leader-led and CWE events intentionally omit
    // the "Hosted by" attribution so the group/community reads as the host.
    // Name is rendered "First L." — short, identity-preserving, and safe to
    // load on public share pages where non-members may land.
    const surfaceCreator = await shouldSurfaceCreator(ctx, meeting);
    const creator = surfaceCreator && meeting.createdById
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

    // Viewer is treated as a leader (and thus can see the hidden RSVP count)
    // when they lead the hosting group OR host the event. `isMeetingHost`
    // falls back to the creator when no hosts are set.
    const viewerIsLeader =
      isLeaderRole(userRole) ||
      (!!userId && isMeetingHost(meeting, userId));

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
      coverImage: getMediaUrl(effectiveCoverImage ?? undefined),
      visibility: meeting.visibility || "group",
      rsvpEnabled: meeting.rsvpEnabled ?? true,
      rsvpOptions: meeting.rsvpOptions || [],
      rsvpCounts,
      // When true, attendees can RSVP but the count is hidden from non-leaders.
      hideRsvpCount: meeting.hideRsvpCount === true,
      // True when the viewer should see the hidden count (leader of the
      // hosting group or the event creator).
      viewerIsLeader,
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
    // Only surface creator on member-led events — CWE + leader-led events
    // are attributed to the group/community instead.
    const surfaceCreator = await shouldSurfaceCreator(ctx, meeting);
    const creator = surfaceCreator && meeting.createdById
      ? await ctx.db.get(meeting.createdById)
      : null;

    // Denormalize hosts for the detail view's "Hosted by" display. Uses
    // getHostUserIds so legacy meetings (undefined) resolve to an empty
    // list — UI should fall back to the creator or group attribution when
    // this is empty.
    const hostIds = getHostUserIds(meeting);
    const hostDocs = await Promise.all(hostIds.map((id) => ctx.db.get(id)));
    const hosts = hostDocs
      .filter((u): u is NonNullable<typeof u> => u != null)
      .map((u) => ({
        id: u._id,
        firstName: u.firstName ?? null,
        lastName: u.lastName ?? null,
        profilePhoto: getMediaUrl(u.profilePhoto),
      }));

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

    // Get parent event title + cover if it's a community-wide event. Parent
    // holds the shared cover so "edit just the parent cover" propagates to
    // every child without marking them overridden.
    let parentEventTitle: string | undefined;
    let parentCoverImage: string | undefined;
    if (meeting.communityWideEventId) {
      const parentEvent = await ctx.db.get(meeting.communityWideEventId);
      parentEventTitle = parentEvent?.title;
      parentCoverImage = (parentEvent as any)?.coverImage;
    }
    const effectiveCoverImage = meeting.coverImage || parentCoverImage;

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
      coverImage: getMediaUrl(effectiveCoverImage),
      group: group
        ? {
            ...group,
            preview: getMediaUrl(group.preview),
          }
        : null,
      creator,
      hosts,
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
