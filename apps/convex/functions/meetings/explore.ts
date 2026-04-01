/**
 * Meeting Explore functions
 *
 * Functions for the community events explore page and user's RSVP events.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import { Id, Doc } from "../../_generated/dataModel";
import { now, getMediaUrl } from "../../lib/utils";
import { getOptionalAuth } from "../../lib/auth";

/**
 * List all events in a community that the user has access to.
 * Visibility filtering is applied based on user's group memberships.
 *
 * User can see events if:
 * 1. visibility = 'public' (anyone can see)
 * 2. visibility = 'community' (user is community member)
 * 3. visibility = 'group' AND user is a member of that group
 */
export const communityEvents = query({
  args: {
    token: v.optional(v.string()),
    communityId: v.id("communities"),
    datePreset: v.optional(
      v.union(
        v.literal("today"),
        v.literal("this_week"),
        v.literal("this_month"),
        v.literal("custom")
      )
    ),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    hostingGroupIds: v.optional(v.array(v.id("groups"))),
    limit: v.optional(v.number()),
    includePast: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuth(ctx, args.token);
    const currentTime = now();
    const limit = args.limit ?? 50;

    // Get user's group memberships for visibility filtering
    const userGroupIds: Set<string> = new Set();
    // Get user's community memberships for visibility filtering
    const userCommunityIds: Set<string> = new Set();
    if (userId) {
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

      for (const m of memberships) {
        userGroupIds.add(m.groupId);
      }

      // Get user's community memberships
      const communityMemberships = await ctx.db
        .query("userCommunities")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .filter((q) => q.eq(q.field("status"), 1)) // Active status
        .collect();

      for (const cm of communityMemberships) {
        userCommunityIds.add(cm.communityId);
      }
    }

    // Get all non-archived groups in this community
    const communityGroups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    const communityGroupIds = new Set(communityGroups.map((g) => g._id));

    // Build date range filter
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfDayMs = startOfDay.getTime();

    let dateStart = args.includePast ? undefined : startOfDayMs;
    let dateEnd: number | undefined = undefined;

    switch (args.datePreset) {
      case "today": {
        const endOfDay = new Date(startOfDay);
        endOfDay.setDate(endOfDay.getDate() + 1);
        dateStart = startOfDayMs;
        dateEnd = endOfDay.getTime();
        break;
      }
      case "this_week": {
        const endOfWeek = new Date(startOfDay);
        const daysUntilSunday = 7 - startOfDay.getDay();
        endOfWeek.setDate(endOfWeek.getDate() + daysUntilSunday);
        dateStart = startOfDayMs;
        dateEnd = endOfWeek.getTime();
        break;
      }
      case "this_month": {
        const endOfMonth = new Date(
          startOfDay.getFullYear(),
          startOfDay.getMonth() + 1,
          1
        );
        dateStart = startOfDayMs;
        dateEnd = endOfMonth.getTime();
        break;
      }
      case "custom": {
        if (args.startDate) {
          dateStart = new Date(args.startDate).getTime();
        }
        if (args.endDate) {
          dateEnd = new Date(args.endDate).getTime();
        }
        break;
      }
    }

    // Get meetings from all community groups with a limit per group
    // We'll filter by visibility and date after fetching
    const meetingsPerGroup = limit * 2; // Fetch extra to account for filtering
    const allMeetings = await Promise.all(
      communityGroups.map(async (group) => {
        const meetings = await ctx.db
          .query("meetings")
          .withIndex("by_group_scheduledAt", (q) => q.eq("groupId", group._id))
          .order("desc") // Fetch newest meetings first to ensure recent events are included
          .filter((q) => q.neq(q.field("status"), "cancelled"))
          .take(meetingsPerGroup);

        return meetings.map((m) => ({ ...m, group }));
      })
    );

    // Flatten and filter
    let meetings = allMeetings.flat();

    // Filter by date range
    if (dateStart !== undefined) {
      meetings = meetings.filter((m) => m.scheduledAt >= dateStart!);
    }
    if (dateEnd !== undefined) {
      meetings = meetings.filter((m) => m.scheduledAt < dateEnd!);
    }

    // Filter by hosting groups if specified
    if (args.hostingGroupIds && args.hostingGroupIds.length > 0) {
      const hostingSet = new Set(args.hostingGroupIds);
      meetings = meetings.filter((m) => hostingSet.has(m.groupId));
    }

    // Filter by visibility
    meetings = meetings.filter((m) => {
      const visibility = m.visibility || "group";
      if (visibility === "public") return true;
      if (visibility === "community") {
        // User must be authenticated AND a member of this community
        return userId !== null && userCommunityIds.has(args.communityId);
      }
      if (visibility === "group") {
        return userGroupIds.has(m.groupId);
      }
      return false;
    });

    // Sort by scheduledAt ascending
    meetings.sort((a, b) => a.scheduledAt - b.scheduledAt);

    // Limit results
    meetings = meetings.slice(0, limit);

    // Batch fetch all group types (they repeat across meetings)
    const groupTypeIds = [...new Set(meetings.map((m) => m.group.groupTypeId))];
    const groupTypes = await Promise.all(
      groupTypeIds.map((id) => ctx.db.get(id))
    );
    const groupTypesMap = new Map(
      groupTypes.filter(Boolean).map((gt) => [gt!._id, gt!])
    );

    // Batch fetch all "Going" RSVPs for all meetings
    const meetingIds = meetings.map((m) => m._id);
    const allGoingRsvps = await Promise.all(
      meetingIds.map((meetingId) =>
        ctx.db
          .query("meetingRsvps")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
          .filter((q) => q.eq(q.field("rsvpOptionId"), 1))
          .take(100) // Safety limit
      )
    );

    // Build a map of meeting ID -> going RSVPs
    const rsvpsByMeeting = new Map(
      meetingIds.map((id, index) => [id, allGoingRsvps[index]])
    );

    // Collect all unique user IDs from top 5 RSVPs per meeting
    const userIdsToFetch = new Set<Id<"users">>();
    for (const rsvps of allGoingRsvps) {
      for (const rsvp of rsvps.slice(0, 5)) {
        userIdsToFetch.add(rsvp.userId);
      }
    }

    // Batch fetch all users
    const userIdArray = [...userIdsToFetch];
    const users = await Promise.all(
      userIdArray.map((id) => ctx.db.get(id))
    );
    const usersMap = new Map<Id<"users">, Doc<"users">>(
      users.filter((u): u is Doc<"users"> => u !== null).map((u) => [u._id, u])
    );

    // Build results using pre-fetched data
    const results = meetings.map((meeting) => {
      const goingRsvps = rsvpsByMeeting.get(meeting._id) || [];
      const groupType = groupTypesMap.get(meeting.group.groupTypeId);

      // Get top 5 going guests with user info from pre-fetched data
      const topGoingGuests = goingRsvps
        .slice(0, 5)
        .map((rsvp) => {
          const user = usersMap.get(rsvp.userId);
          return user
            ? {
                id: user._id,
                firstName: user.firstName || "",
                profileImage: getMediaUrl(user.profilePhoto),
              }
            : null;
        })
        .filter(Boolean) as Array<{
          id: string;
          firstName: string;
          profileImage: string | null;
        }>;

      return {
        id: meeting._id,
        shortId: meeting.shortId || null,
        title: meeting.title || null,
        scheduledAt: new Date(meeting.scheduledAt).toISOString(),
        status: meeting.status,
        visibility: (meeting.visibility || "group") as
          | "group"
          | "community"
          | "public",
        coverImage: getMediaUrl(meeting.coverImage),
        locationOverride: meeting.locationOverride || null,
        meetingType: meeting.meetingType,
        rsvpEnabled: meeting.rsvpEnabled ?? true,
        // Community-wide event indicator
        communityWideEventId: meeting.communityWideEventId || null,
        group: {
          id: meeting.group._id,
          name: meeting.group.name,
          image: getMediaUrl(meeting.group.preview),
          groupTypeName: groupType?.name || "Group",
          addressLine1: meeting.group.addressLine1 || null,
          addressLine2: meeting.group.addressLine2 || null,
          city: meeting.group.city || null,
          state: meeting.group.state || null,
          zipCode: meeting.group.zipCode || null,
        },
        rsvpSummary: {
          totalGoing: goingRsvps.length,
          topGoingGuests,
        },
      };
    });

    return {
      events: results,
      nextCursor: null, // Simplified pagination for now
    };
  },
});

/**
 * Get all events the user has RSVPed to (regardless of community)
 * This is useful for users without a community context to see their upcoming events
 */
export const myRsvpEvents = query({
  args: {
    token: v.optional(v.string()),
    limit: v.optional(v.number()),
    includePast: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuth(ctx, args.token);
    if (!userId) return { events: [] };

    const limit = args.limit ?? 20;
    const currentTime = now();

    // Get user's positive RSVPs (Going or Maybe, option IDs 1 and 2)
    const rsvps = await ctx.db
      .query("meetingRsvps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) =>
        q.or(
          q.eq(q.field("rsvpOptionId"), 1),
          q.eq(q.field("rsvpOptionId"), 2)
        )
      )
      .collect();

    // Batch fetch all meetings first
    const meetingIds = rsvps.map((r) => r.meetingId);
    const meetings = await Promise.all(
      meetingIds.map((id) => ctx.db.get(id))
    );
    const meetingsMap = new Map(
      meetings.filter(Boolean).map((m) => [m!._id, m!])
    );

    // Create rsvp-meeting pairs and filter by date/status
    const validRsvpMeetingPairs = rsvps
      .map((rsvp) => {
        const meeting = meetingsMap.get(rsvp.meetingId);
        if (!meeting) return null;

        // Filter by date if not including past
        if (!args.includePast && meeting.scheduledAt < currentTime) {
          return null;
        }

        // Filter by status
        if (
          meeting.status !== "scheduled" &&
          meeting.status !== "confirmed"
        ) {
          return null;
        }

        return { rsvp, meeting };
      })
      .filter(Boolean) as Array<{ rsvp: typeof rsvps[0]; meeting: NonNullable<typeof meetings[0]> }>;

    // Extract unique group IDs and batch fetch groups
    const groupIds = [...new Set(validRsvpMeetingPairs.map((p) => p.meeting.groupId))];
    const groups = await Promise.all(groupIds.map((id) => ctx.db.get(id)));
    const groupsMap = new Map(
      groups.filter(Boolean).map((g) => [g!._id, g!])
    );

    // Extract unique community IDs and group type IDs
    const communityIds = [...new Set(groups.filter(Boolean).map((g) => g!.communityId))];
    const groupTypeIds = [...new Set(groups.filter(Boolean).map((g) => g!.groupTypeId))];

    // Batch fetch communities and group types in parallel
    const [communities, groupTypes] = await Promise.all([
      Promise.all(communityIds.map((id) => ctx.db.get(id))),
      Promise.all(groupTypeIds.map((id) => ctx.db.get(id))),
    ]);

    const communitiesMap = new Map(
      communities.filter(Boolean).map((c) => [c!._id, c!])
    );
    const groupTypesMap = new Map(
      groupTypes.filter(Boolean).map((gt) => [gt!._id, gt!])
    );

    // Build the full meeting data using Maps
    const meetingsWithRsvp = validRsvpMeetingPairs.map(({ rsvp, meeting }) => {
      const group = groupsMap.get(meeting.groupId);
      if (!group) return null;

      const groupType = groupTypesMap.get(group.groupTypeId);
      const community = communitiesMap.get(group.communityId);

      // Get RSVP option label from meeting's rsvpOptions
      const rsvpOptions = (meeting.rsvpOptions as Array<{
        id: number;
        label: string;
        enabled: boolean;
      }>) || [];
      const selectedOption = rsvpOptions.find(
        (opt) => opt.id === rsvp.rsvpOptionId
      );

      return {
        meeting,
        group,
        groupType,
        community,
        rsvp,
        selectedOption,
      };
    });

    // Filter nulls and sort by scheduledAt
    const validMeetings = meetingsWithRsvp
      .filter(Boolean)
      .sort((a, b) => a!.meeting.scheduledAt - b!.meeting.scheduledAt)
      .slice(0, limit);

    const events = validMeetings.map((item) => ({
      id: item!.meeting._id,
      shortId: item!.meeting.shortId || null,
      title: item!.meeting.title || null,
      scheduledAt: new Date(item!.meeting.scheduledAt).toISOString(),
      status: item!.meeting.status,
      visibility: (item!.meeting.visibility || "group") as
        | "group"
        | "community"
        | "public",
      coverImage: getMediaUrl(item!.meeting.coverImage),
      locationOverride: item!.meeting.locationOverride || null,
      meetingType: item!.meeting.meetingType,
      rsvpEnabled: item!.meeting.rsvpEnabled ?? true,
      rsvpStatus: {
        optionId: item!.rsvp.rsvpOptionId,
        optionLabel: item!.selectedOption?.label || null,
      },
      group: {
        id: item!.group._id,
        name: item!.group.name,
        image: getMediaUrl(item!.group.preview),
        groupTypeName: item!.groupType?.name || "Group",
        addressLine1: item!.group.addressLine1 || null,
        addressLine2: item!.group.addressLine2 || null,
        city: item!.group.city || null,
        state: item!.group.state || null,
        zipCode: item!.group.zipCode || null,
      },
      community: {
        id: item!.community?._id || "",
        name: item!.community?.name || "",
      },
    }));

    return { events };
  },
});

/**
 * Search events by text within a community.
 *
 * Uses the searchIndex on meetings for full-text search across
 * title, location, and group name. Returns upcoming non-cancelled events
 * by default, with optional date range filtering.
 */
export const searchEvents = query({
  args: {
    token: v.optional(v.string()),
    communityId: v.id("communities"),
    searchTerm: v.string(),
    startAfter: v.optional(v.number()), // Unix timestamp ms
    startBefore: v.optional(v.number()), // Unix timestamp ms
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxResults = args.limit ?? 20;

    if (!args.searchTerm.trim()) {
      return { events: [] };
    }

    // Resolve user for visibility filtering
    const userId = await getOptionalAuth(ctx, args.token);

    // Get user's group memberships for visibility filtering
    let userGroupIds: Set<string> = new Set();
    let isCommunityMember = false;

    if (userId) {
      const communityMembership = await ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", userId).eq("communityId", args.communityId)
        )
        .filter((q) => q.eq(q.field("status"), 1))
        .first();
      isCommunityMember = !!communityMembership;

      if (isCommunityMember) {
        const groupMemberships = await ctx.db
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
        userGroupIds = new Set(groupMemberships.map((m) => m.groupId));
      }
    }

    // Full-text search using searchIndex
    const searchResults = await ctx.db
      .query("meetings")
      .withSearchIndex("search_meetings", (q) =>
        q
          .search("searchText", args.searchTerm.trim())
          .eq("communityId", args.communityId)
      )
      .take(maxResults * 2); // Over-fetch to account for visibility filtering

    const searchGroupIds = [...new Set(searchResults.map((m) => m.groupId))];
    const searchGroups = await Promise.all(
      searchGroupIds.map((id) => ctx.db.get(id))
    );
    const nonArchivedGroupIds = new Set(
      searchGroups.filter((g) => g && !g.isArchived).map((g) => g!._id)
    );

    // Filter by date range and visibility
    const currentTime = now();
    const filtered = searchResults.filter((meeting) => {
      if (!nonArchivedGroupIds.has(meeting.groupId)) return false;
      if (meeting.status === "cancelled") return false;

      // Date range filtering
      const afterCutoff = args.startAfter ?? currentTime;
      if (meeting.scheduledAt < afterCutoff) return false;
      if (args.startBefore && meeting.scheduledAt > args.startBefore) return false;

      // Visibility filtering
      const visibility = meeting.visibility ?? "group";
      if (visibility === "public") return true;
      if (visibility === "community") return isCommunityMember;
      // Default "group" visibility: must be member
      return userGroupIds.has(meeting.groupId);
    });

    // Take only the requested number
    const events = filtered.slice(0, maxResults);

    // Batch fetch groups
    const groupIds = [...new Set(events.map((e) => e.groupId))];
    const groups = await Promise.all(groupIds.map((id) => ctx.db.get(id)));
    const groupMap = new Map(
      groups.filter(Boolean).map((g) => [g!._id, g!])
    );

    // Return enriched results
    return {
      events: events.map((meeting) => {
        const group = groupMap.get(meeting.groupId);
        return {
          _id: meeting._id,
          title: meeting.title || "Untitled Event",
          scheduledAt: meeting.scheduledAt,
          actualEnd: meeting.actualEnd,
          meetingType: meeting.meetingType,
          locationOverride: meeting.locationOverride,
          shortId: meeting.shortId,
          visibility: meeting.visibility,
          coverImage: meeting.coverImage
            ? getMediaUrl(meeting.coverImage)
            : null,
          group: group
            ? {
                _id: group._id,
                name: group.name,
                city: group.city || null,
                state: group.state || null,
              }
            : null,
        };
      }),
    };
  },
});
