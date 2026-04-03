/**
 * Admin functions for community statistics and analytics
 *
 * Includes:
 * - Total attendance statistics
 * - New signups tracking
 * - Active members analytics
 * - Attendance breakdowns by group type
 * - Export functionality for attendance data
 */

import { v } from "convex/values";
import { query, action, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id, Doc } from "../../_generated/dataModel";
import { now, getMediaUrl } from "../../lib/utils";
import { requireAuth } from "../../lib/auth";
import { requireCommunityAdmin, checkCommunityAdmin } from "./auth";

type SuperAdminRange = "7d" | "30d" | "90d" | "all";
type SuperAdminGranularity = "day" | "month";

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_DAYS: Record<Exclude<SuperAdminRange, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function utcDayStart(timestamp: number): number {
  const d = new Date(timestamp);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function utcMonthStart(timestamp: number): number {
  const d = new Date(timestamp);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function nextBucketStart(timestamp: number, granularity: SuperAdminGranularity): number {
  const d = new Date(timestamp);
  if (granularity === "month") {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return timestamp + DAY_MS;
}

function bucketStartFor(timestamp: number, granularity: SuperAdminGranularity): number {
  return granularity === "month" ? utcMonthStart(timestamp) : utcDayStart(timestamp);
}

function formatBucketLabel(timestamp: number, granularity: SuperAdminGranularity): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    ...(granularity === "month" ? { year: "numeric" as const } : { day: "numeric" as const }),
  });
}

// ============================================================================
// Stats
// ============================================================================

/**
 * Internal Togather dashboard analytics (app-wide).
 *
 * IMPORTANT: This endpoint is restricted to Togather internal users only
 * (developers/owners via isStaff or isSuperuser).
 * It provides a time-series graph plus summary metrics for the selected range.
 */
export const getInternalDashboard = query({
  args: {
    token: v.string(),
    range: v.optional(v.union(v.literal("7d"), v.literal("30d"), v.literal("90d"), v.literal("all"))),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const user = await ctx.db.get(userId);
    const isInternalUser = user?.isStaff === true || user?.isSuperuser === true;
    if (!isInternalUser) {
      throw new Error("Togather internal access required");
    }

    const selectedRange: SuperAdminRange = args.range ?? "30d";
    const endDate = now();
    const allUsers = await ctx.db.query("users").collect();
    const earliestUserCreatedAt = allUsers
      .map((u) => u.createdAt ?? Number.MAX_SAFE_INTEGER)
      .reduce((min, current) => Math.min(min, current), Number.MAX_SAFE_INTEGER);

    const rangeStart =
      selectedRange === "all"
        ? utcMonthStart(
            earliestUserCreatedAt === Number.MAX_SAFE_INTEGER ? endDate : earliestUserCreatedAt
          )
        : utcDayStart(endDate - (RANGE_DAYS[selectedRange] - 1) * DAY_MS);
    const granularity: SuperAdminGranularity = selectedRange === "all" ? "month" : "day";

    // Build fixed buckets so graph keeps a stable shape while data loads/recomputes.
    const buckets: Array<{
      bucketStart: number;
      label: string;
      messagesSent: number;
      newMembers: number;
      activeSenders: Set<string>;
    }> = [];
    const bucketLookup = new Map<number, (typeof buckets)[number]>();
    for (
      let cursor = bucketStartFor(rangeStart, granularity);
      cursor <= endDate;
      cursor = nextBucketStart(cursor, granularity)
    ) {
      const bucket = {
        bucketStart: cursor,
        label: formatBucketLabel(cursor, granularity),
        messagesSent: 0,
        newMembers: 0,
        activeSenders: new Set<string>(),
      };
      buckets.push(bucket);
      bucketLookup.set(cursor, bucket);
    }

    const communities = await ctx.db.query("communities").collect();
    const groups = await ctx.db.query("groups").collect();

    const activeGroupsCount = groups.filter((g) => !g.isArchived).length;
    const channels = await ctx.db.query("chatChannels").collect();

    const activeChannelCount = channels.filter((c) => !c.isArchived).length;
    const rangeMessagesByChannel = new Map<Id<"chatChannels">, number>();
    const uniqueActiveSenders = new Set<string>();
    let messagesSent = 0;

    const rangeMessages =
      selectedRange === "all"
        ? await ctx.db.query("chatMessages").withIndex("by_createdAt").collect()
        : await ctx.db
            .query("chatMessages")
            .withIndex("by_createdAt", (q) => q.gte("createdAt", rangeStart).lte("createdAt", endDate))
            .collect();

    for (const message of rangeMessages) {
      if (message.isDeleted || message.createdAt < rangeStart || message.createdAt > endDate) {
        continue;
      }

      messagesSent += 1;
      if (message.senderId) {
        uniqueActiveSenders.add(message.senderId);
      }

      const bucketKey = bucketStartFor(message.createdAt, granularity);
      const bucket = bucketLookup.get(bucketKey);
      if (bucket) {
        bucket.messagesSent += 1;
        if (message.senderId) {
          bucket.activeSenders.add(message.senderId);
        }
      }

      rangeMessagesByChannel.set(
        message.channelId,
        (rangeMessagesByChannel.get(message.channelId) ?? 0) + 1
      );
    }

    const inRangeUsers = allUsers.filter(
      (member) =>
        member.isActive !== false &&
        !!member.createdAt &&
        member.createdAt >= rangeStart &&
        member.createdAt <= endDate
    );

    for (const member of inRangeUsers) {
      if (!member.createdAt) continue;
      const bucketKey = bucketStartFor(member.createdAt, granularity);
      const bucket = bucketLookup.get(bucketKey);
      if (bucket) {
        bucket.newMembers += 1;
      }
    }

    const activeUsers = allUsers.filter((member) => member.isActive !== false);

    const thirtyDaysAgo = endDate - 30 * DAY_MS;
    const activeMembers30d = activeUsers.filter(
      (member) => !!member.lastLogin && member.lastLogin >= thirtyDaysAgo
    );

    let meetingsHeld = 0;
    let attendanceCheckIns = 0;

    const rangeMeetings =
      selectedRange === "all"
        ? await ctx.db.query("meetings").withIndex("by_scheduledAt").collect()
        : await ctx.db
            .query("meetings")
            .withIndex("by_scheduledAt", (q) =>
              q.gte("scheduledAt", rangeStart).lte("scheduledAt", endDate)
            )
            .collect();

    meetingsHeld = rangeMeetings.length;

    for (const meeting of rangeMeetings) {
      const attendance = await ctx.db
        .query("meetingAttendances")
        .withIndex("by_meeting_status", (q) => q.eq("meetingId", meeting._id).eq("status", 1))
        .collect();
      attendanceCheckIns += attendance.length;
    }

    const topChannels = channels
      .map((channel) => ({
        channelId: channel._id,
        channelName: channel.name,
        messagesSent: rangeMessagesByChannel.get(channel._id) ?? 0,
      }))
      .filter((channel) => channel.messagesSent > 0)
      .sort((a, b) => b.messagesSent - a.messagesSent)
      .slice(0, 5);

    const trend = buckets.map((bucket) => ({
      bucketStart: bucket.bucketStart,
      label: bucket.label,
      messagesSent: bucket.messagesSent,
      newMembers: bucket.newMembers,
      dailyActiveUsers: bucket.activeSenders.size,
    }));

    const activeDaysWithMessages = trend.filter((point) => point.messagesSent > 0).length;

    return {
      range: {
        key: selectedRange,
        granularity,
        startDate: rangeStart,
        endDate,
      },
      overview: {
        messagesSent,
        uniqueActiveSenders: uniqueActiveSenders.size,
        newMembers: inRangeUsers.length,
        meetingsHeld,
        attendanceCheckIns,
        avgMessagesPerActiveDay:
          activeDaysWithMessages > 0 ? Math.round(messagesSent / activeDaysWithMessages) : 0,
      },
      totals: {
        totalMembers: activeUsers.length,
        activeMembers30d: activeMembers30d.length,
        activeGroups: activeGroupsCount,
        activeChannels: activeChannelCount,
        totalCommunities: communities.length,
      },
      trend,
      topChannels,
    };
  },
});

/**
 * Get total attendance statistics for a date range
 *
 * Optimized to query attendance per meeting instead of full table scan
 */
export const getTotalAttendance = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    startDate: v.number(), // Unix timestamp
    endDate: v.number(), // Unix timestamp
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    // Get all groups in community
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    const groupIds = new Set(groups.map((g) => g._id));

    // Get meetings in date range for these groups
    // Query per group to use index efficiently
    const communityMeetings: Array<{
      _id: Id<"meetings">;
      groupId: Id<"groups">;
      scheduledAt: number;
      title?: string;
      status?: string;
    }> = [];
    for (const group of groups) {
      const groupMeetings = await ctx.db
        .query("meetings")
        .withIndex("by_group_scheduledAt", (q) =>
          q
            .eq("groupId", group._id)
            .gte("scheduledAt", args.startDate)
            .lte("scheduledAt", args.endDate)
        )
        .collect();
      communityMeetings.push(...groupMeetings);
    }

    // Count attendance per meeting using index (not full table scan!)
    let totalAttended = 0;
    for (const meeting of communityMeetings) {
      if (!meeting) continue;
      const attendances = await ctx.db
        .query("meetingAttendances")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
        .filter((q) => q.eq(q.field("status"), 1))
        .collect();
      totalAttended += attendances.length;
    }

    return {
      totalAttendance: totalAttended,
      startDate: args.startDate,
      endDate: args.endDate,
      meetingsCount: communityMeetings.length,
    };
  },
});

/**
 * Get new signups statistics for a date range
 */
export const getNewSignups = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    startDate: v.number(),
    endDate: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    // Count new userCommunity records created in this date range
    const memberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    const newSignups = memberships.filter(
      (m) =>
        m.createdAt &&
        m.createdAt >= args.startDate &&
        m.createdAt <= args.endDate &&
        m.status !== 3 // Not blocked
    ).length;

    return {
      newSignups,
      startDate: args.startDate,
      endDate: args.endDate,
    };
  },
});

/**
 * Get active members count (logged in within past month)
 *
 * Uses a sampled approach for large communities to stay within read limits
 */
export const getActiveMembers = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const oneMonthAgo = now() - 30 * 24 * 60 * 60 * 1000;
    const currentTime = now();

    // Count total members
    const allMemberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("status"), 1))
      .collect();

    const totalMembers = allMemberships.length;

    // Count active members using the lastLogin field on userCommunities
    // Uses the by_community_lastLogin index for efficiency
    const activeMemberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_community_lastLogin", (q) =>
        q.eq("communityId", args.communityId).gte("lastLogin", oneMonthAgo)
      )
      .filter((q) => q.eq(q.field("status"), 1))
      .collect();

    return {
      activeCount: activeMemberships.length,
      totalMembers,
      periodStart: oneMonthAgo,
      periodEnd: currentTime,
    };
  },
});

/**
 * Get new members count for current month
 * Uses by_community_createdAt index for efficient filtering
 */
export const getNewMembersThisMonth = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const currentDate = new Date();
    const startOfMonth = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      1
    ).getTime();

    const monthName = new Date(startOfMonth).toLocaleString("default", {
      month: "long",
      year: "numeric",
    });

    // Use index to efficiently get only members who joined this month
    const newMemberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_community_createdAt", (q) =>
        q.eq("communityId", args.communityId).gte("createdAt", startOfMonth)
      )
      .filter((q) => q.neq(q.field("status"), 3)) // Not blocked
      .collect();

    return {
      newMembersCount: newMemberships.length,
      monthStart: startOfMonth,
      monthName,
    };
  },
});

// ============================================================================
// Attendance Stats (Extended)
// ============================================================================

/**
 * Get attendance breakdown by group type for a date range
 *
 * Returns attendance statistics per group within a group type
 */
export const getAttendanceByGroupType = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    groupTypeId: v.id("groupTypes"), // Convex group type ID
    startDate: v.string(), // ISO date string
    endDate: v.string(), // ISO date string
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const startDate = new Date(args.startDate).getTime();
    const endDate = new Date(args.endDate).getTime();

    // Get group type by Convex ID
    const groupType = await ctx.db.get(args.groupTypeId);

    if (!groupType || groupType.communityId !== args.communityId) {
      return {
        totalAttended: 0,
        totalRecords: 0,
        totalMeetings: 0,
        overallRate: 0,
        startDate: args.startDate,
        endDate: args.endDate,
        groupBreakdown: [],
      };
    }

    // Get all non-archived groups of this type
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_groupType", (q) => q.eq("groupTypeId", groupType._id))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    // Filter to community groups
    const communityGroups = groups.filter((g) => g.communityId === args.communityId);

    // Query meetings per group using by_group_scheduledAt index
    // This is much more efficient than scanning all meetings globally
    const meetings: Doc<"meetings">[] = [];
    for (const group of communityGroups) {
      const groupMeetings = await ctx.db
        .query("meetings")
        .withIndex("by_group_scheduledAt", (q) =>
          q.eq("groupId", group._id).gte("scheduledAt", startDate).lte("scheduledAt", endDate)
        )
        .collect();
      meetings.push(...groupMeetings);
    }

    // Query attendance per meeting using index (not full table scan!)
    type AttendanceRecord = { meetingId: Id<"meetings">; status: number | null };
    const attendancesByMeeting = new Map<Id<"meetings">, AttendanceRecord[]>();
    for (const meeting of meetings) {
      const meetingAttendances = await ctx.db
        .query("meetingAttendances")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
        .collect();
      attendancesByMeeting.set(meeting._id, meetingAttendances);
    }

    // Flatten for counting
    const attendances = Array.from(attendancesByMeeting.values()).flat();

    // Calculate per-group stats
    const groupStats = new Map<
      Id<"groups">,
      { name: string; attended: number; total: number; meetingCount: number }
    >();

    for (const group of communityGroups) {
      groupStats.set(group._id, {
        name: group.name,
        attended: 0,
        total: 0,
        meetingCount: 0,
      });
    }

    // Count meetings per group
    for (const meeting of meetings) {
      const stats = groupStats.get(meeting.groupId);
      if (stats) {
        stats.meetingCount++;
      }
    }

    // Count attendance
    for (const attendance of attendances) {
      const meeting = meetings.find((m) => m._id === attendance.meetingId);
      if (meeting) {
        const stats = groupStats.get(meeting.groupId);
        if (stats) {
          stats.total++;
          if (attendance.status === 1) {
            stats.attended++;
          }
        }
      }
    }

    // Calculate totals
    let totalAttended = 0;
    let totalRecords = 0;
    let totalMeetings = 0;

    const groupBreakdown = Array.from(groupStats.entries()).map(([groupId, data]) => {
      totalAttended += data.attended;
      totalRecords += data.total;
      totalMeetings += data.meetingCount;

      return {
        groupId: groupId,
        groupName: data.name,
        attended: data.attended,
        total: data.total,
        meetingCount: data.meetingCount,
        rate: data.total > 0 ? Math.round((data.attended / data.total) * 100) : 0,
      };
    });

    // Sort by attendance count descending
    groupBreakdown.sort((a, b) => b.attended - a.attended);

    return {
      totalAttended,
      totalRecords,
      totalMeetings,
      overallRate: totalRecords > 0 ? Math.round((totalAttended / totalRecords) * 100) : 0,
      startDate: args.startDate,
      endDate: args.endDate,
      groupBreakdown,
    };
  },
});

/**
 * Get active members list with pagination
 *
 * Returns members who logged in within past month
 * Optimized to batch fetch users rather than N+1 queries
 */
export const getActiveMembersList = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const page = args.page ?? 1;
    const pageSize = Math.min(args.pageSize ?? 50, 100);
    const skip = (page - 1) * pageSize;
    const oneMonthAgo = now() - 30 * 24 * 60 * 60 * 1000;

    // Query memberships with lastLogin filter using index
    // This is efficient: only fetches members who logged into THIS community recently
    const membershipsQuery = ctx.db
      .query("userCommunities")
      .withIndex("by_community_lastLogin", (q) =>
        q.eq("communityId", args.communityId).gte("lastLogin", oneMonthAgo)
      )
      .filter((q) => q.eq(q.field("status"), 1));

    // For search, we need to fetch more and filter; otherwise just paginate directly
    const fetchLimit = args.search ? 500 : skip + pageSize + 1; // +1 to check if there's more
    const memberships = await membershipsQuery.take(fetchLimit);

    // Batch fetch users for these memberships
    const userIds = memberships.map((m) => m.userId);
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const userMap = new Map(
      users.filter((u): u is NonNullable<typeof u> => u !== null).map((u) => [u._id, u])
    );

    // Build results with optional search filter
    const activeMembers: Array<{
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      profilePhoto: string | null;
      lastLogin: string | null;
    }> = [];

    for (const membership of memberships) {
      const user = userMap.get(membership.userId);
      if (!user) continue;

      // Apply search filter if provided
      if (args.search && args.search.trim()) {
        const searchLower = args.search.toLowerCase();
        const fullName = `${user.firstName || ""} ${user.lastName || ""}`.toLowerCase();
        const matchesSearch =
          fullName.includes(searchLower) ||
          (user.email?.toLowerCase().includes(searchLower) ?? false);

        if (!matchesSearch) continue;
      }

      activeMembers.push({
        id: user._id,
        firstName: user.firstName || null,
        lastName: user.lastName || null,
        email: user.email || null,
        profilePhoto: getMediaUrl(user.profilePhoto) ?? null,
        lastLogin: membership.lastLogin ? new Date(membership.lastLogin).toISOString() : null,
      });
    }

    // Results are already sorted by lastLogin desc from index
    const total = activeMembers.length;
    const paginatedMembers = activeMembers.slice(skip, skip + pageSize);
    const hasMore = activeMembers.length > skip + pageSize;

    return {
      members: paginatedMembers,
      total: args.search ? total : (hasMore ? total : memberships.length),
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  },
});

/**
 * Get new members list with pagination
 *
 * Returns members who joined this month
 * Uses by_community_createdAt index for efficient filtering
 */
export const getNewMembersList = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const page = args.page ?? 1;
    const pageSize = Math.min(args.pageSize ?? 50, 100);
    const skip = (page - 1) * pageSize;

    const currentDate = new Date();
    const startOfMonth = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      1
    ).getTime();
    const monthName = new Date(startOfMonth).toLocaleString("default", {
      month: "long",
      year: "numeric",
    });

    // Use index to efficiently get only members who joined this month
    const newMemberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_community_createdAt", (q) =>
        q.eq("communityId", args.communityId).gte("createdAt", startOfMonth)
      )
      .filter((q) => q.neq(q.field("status"), 3)) // Not blocked
      .collect();

    // Batch fetch all users upfront (avoid N+1 queries)
    const userIds = newMemberships.map((m) => m.userId);
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const userMap = new Map(
      users.filter((u): u is NonNullable<typeof u> => u !== null).map((u) => [u._id, u])
    );

    // Get user details
    const newMembers: Array<{
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      profilePhoto: string | null;
      joinedAt: string | null;
    }> = [];

    for (const membership of newMemberships) {
      const user = userMap.get(membership.userId);
      if (!user) continue;

      // Apply search filter
      if (args.search && args.search.trim()) {
        const searchLower = args.search.toLowerCase();
        const fullName = `${user.firstName || ""} ${user.lastName || ""}`.toLowerCase();
        const matchesSearch =
          fullName.includes(searchLower) ||
          (user.email?.toLowerCase().includes(searchLower) ?? false);

        if (!matchesSearch) continue;
      }

      newMembers.push({
        id: user._id,
        firstName: user.firstName || null,
        lastName: user.lastName || null,
        email: user.email || null,
        profilePhoto: getMediaUrl(user.profilePhoto) ?? null,
        joinedAt: membership.createdAt ? new Date(membership.createdAt).toISOString() : null,
      });
    }

    // Sort by joined date descending
    newMembers.sort((a, b) => {
      const aDate = a.joinedAt ? new Date(a.joinedAt).getTime() : 0;
      const bDate = b.joinedAt ? new Date(b.joinedAt).getTime() : 0;
      return bDate - aDate;
    });

    const total = newMembers.length;
    const paginatedMembers = newMembers.slice(skip, skip + pageSize);

    return {
      members: paginatedMembers,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      monthName,
    };
  },
});

/**
 * Get detailed attendance for a specific group
 *
 * Returns member-level attendance breakdown
 * For single day: list view with present/absent status
 * For date range: grid view with meetings as columns
 */
export const getGroupAttendanceDetails = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    groupId: v.id("groups"), // Convex group ID
    startDate: v.string(), // ISO date string
    endDate: v.string(), // ISO date string
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const startDate = new Date(args.startDate).getTime();
    const endDate = new Date(args.endDate).getTime();

    // Get group by Convex ID
    const group = await ctx.db.get(args.groupId);

    if (!group || group.communityId !== args.communityId) {
      throw new Error("Group not found");
    }

    // Check if this is a single day
    const startDateStr = new Date(args.startDate).toDateString();
    const endDateStr = new Date(args.endDate).toDateString();
    const isSingleDay = startDateStr === endDateStr;

    // Get meetings in date range
    const allMeetings = await ctx.db
      .query("meetings")
      .withIndex("by_group_scheduledAt", (q) => q.eq("groupId", group._id))
      .filter((q) =>
        q.and(
          q.gte(q.field("scheduledAt"), startDate),
          q.lte(q.field("scheduledAt"), endDate)
        )
      )
      .collect();

    // Sort by scheduledAt ascending
    allMeetings.sort((a, b) => a.scheduledAt - b.scheduledAt);

    // Get all active group members
    const allMembers = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", group._id))
      .collect();

    const activeMembers = allMembers.filter(
      (m) => !m.leftAt && (!m.requestStatus || m.requestStatus === "accepted")
    );

    // Get meeting attendance for all meetings
    const meetingAttendances = new Map<Id<"meetings">, Map<Id<"users">, number | null>>();
    for (const meeting of allMeetings) {
      const attendances = await ctx.db
        .query("meetingAttendances")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
        .collect();

      const attendanceMap = new Map<Id<"users">, number | null>();
      for (const a of attendances) {
        attendanceMap.set(a.userId, a.status);
      }
      meetingAttendances.set(meeting._id, attendanceMap);
    }

    // Get user details for members
    const memberDetails = await Promise.all(
      activeMembers.map(async (member) => {
        const user = await ctx.db.get(member.userId);
        return {
          userId: member.userId,
          firstName: user?.firstName || "",
          lastName: user?.lastName || "",
          profilePhoto: getMediaUrl(user?.profilePhoto),
        };
      })
    );

    if (isSingleDay) {
      // Single day mode
      const meeting = allMeetings[0];

      const memberAttendance = memberDetails.map((member) => {
        const attendanceMap = meeting ? meetingAttendances.get(meeting._id) : undefined;
        const status = attendanceMap?.get(member.userId) ?? null;

        return {
          userId: member.userId,
          firstName: member.firstName,
          lastName: member.lastName,
          profilePhoto: member.profilePhoto,
          status,
          statusLabel:
            status === 1 ? "Present" : status === 0 ? "Absent" : "Not recorded",
        };
      });

      // Sort: present first, then absent, then not recorded
      memberAttendance.sort((a, b) => {
        if (a.status === 1 && b.status !== 1) return -1;
        if (a.status !== 1 && b.status === 1) return 1;
        if (a.status === 0 && b.status === null) return -1;
        if (a.status === null && b.status === 0) return 1;
        return 0;
      });

      return {
        groupId: args.groupId,
        groupName: group.name,
        isSingleDay: true as const,
        date: args.startDate,
        meetingId: meeting?._id || null,
        meetingTitle: meeting?.title || null,
        memberAttendance,
        presentCount: memberAttendance.filter((m) => m.status === 1).length,
        absentCount: memberAttendance.filter((m) => m.status === 0).length,
        notRecordedCount: memberAttendance.filter((m) => m.status === null).length,
      };
    } else {
      // Date range mode
      const meetingColumns = allMeetings.map((m) => ({
        meetingId: m._id,
        title: m.title || null,
        date: new Date(m.scheduledAt).toISOString(),
        dateLabel: new Date(m.scheduledAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
      }));

      const memberRows = memberDetails.map((member) => {
        const attendanceByMeeting: Record<string, number | null> = {};
        let presentCount = 0;
        let absentCount = 0;

        for (const meeting of allMeetings) {
          const attendanceMap = meetingAttendances.get(meeting._id);
          const status = attendanceMap?.get(member.userId) ?? null;
          attendanceByMeeting[meeting._id] = status;
          if (status === 1) presentCount++;
          if (status === 0) absentCount++;
        }

        return {
          userId: member.userId,
          firstName: member.firstName,
          lastName: member.lastName,
          profilePhoto: member.profilePhoto,
          attendanceByMeeting,
          presentCount,
          absentCount,
          attendanceRate:
            allMeetings.length > 0
              ? Math.round((presentCount / allMeetings.length) * 100)
              : 0,
        };
      });

      // Sort by attendance rate descending
      memberRows.sort((a, b) => b.attendanceRate - a.attendanceRate);

      return {
        groupId: args.groupId,
        groupName: group.name,
        isSingleDay: false as const,
        startDate: args.startDate,
        endDate: args.endDate,
        meetingColumns,
        memberRows,
        totalMeetings: allMeetings.length,
      };
    }
  },
});

// ============================================================================
// Action-based export for large date ranges
// ============================================================================

/**
 * Internal query to get attendance for a single group
 * Used by the export action to process groups in separate transactions
 */
export const getGroupAttendanceForExport = internalQuery({
  args: {
    groupId: v.id("groups"),
    groupName: v.string(),
    startDate: v.number(),
    endDate: v.number(),
  },
  handler: async (ctx, args) => {
    // Query meetings for this specific group in date range
    const meetings = await ctx.db
      .query("meetings")
      .withIndex("by_group_scheduledAt", (q) =>
        q.eq("groupId", args.groupId).gte("scheduledAt", args.startDate).lte("scheduledAt", args.endDate)
      )
      .collect();

    // Query attendance for each meeting
    let attended = 0;
    let total = 0;

    for (const meeting of meetings) {
      const attendances = await ctx.db
        .query("meetingAttendances")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
        .collect();

      for (const a of attendances) {
        total++;
        if (a.status === 1) {
          attended++;
        }
      }
    }

    return {
      groupId: args.groupId,
      groupName: args.groupName,
      meetingCount: meetings.length,
      attended,
      total,
      rate: total > 0 ? Math.round((attended / total) * 100) : 0,
    };
  },
});

// Type for group attendance result
type GroupAttendanceResult = {
  groupId: Id<"groups">;
  groupName: string;
  meetingCount: number;
  attended: number;
  total: number;
  rate: number;
};

// Type for export setup data
type ExportSetupData = {
  authorized: boolean;
  groups: Array<{ id: string; name: string }>;
};

/**
 * Export attendance data for large date ranges
 *
 * Uses action to process groups in separate transactions, bypassing the 32K read limit.
 * Each group's data is fetched in its own query transaction.
 */
export const exportAttendanceByGroupType = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    groupTypeId: v.id("groupTypes"),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args): Promise<{
    totalAttended: number;
    totalRecords: number;
    totalMeetings: number;
    overallRate: number;
    startDate: string;
    endDate: string;
    groupBreakdown: GroupAttendanceResult[];
  }> => {
    // Verify auth and get groups (lightweight query)
    const setupData: ExportSetupData = await ctx.runQuery(internal.functions.admin.stats.getExportSetupData, {
      token: args.token,
      communityId: args.communityId,
      groupTypeId: args.groupTypeId,
    });

    if (!setupData.authorized) {
      throw new Error("Unauthorized");
    }

    const startDate = new Date(args.startDate).getTime();
    const endDate = new Date(args.endDate).getTime();

    // Process each group in a separate transaction
    const groupResults: GroupAttendanceResult[] = await Promise.all(
      setupData.groups.map((group: { id: string; name: string }) =>
        ctx.runQuery(internal.functions.admin.stats.getGroupAttendanceForExport, {
          groupId: group.id as Id<"groups">,
          groupName: group.name,
          startDate,
          endDate,
        })
      )
    );

    // Aggregate results
    let totalAttended = 0;
    let totalRecords = 0;
    let totalMeetings = 0;

    const groupBreakdown = groupResults.map((result: GroupAttendanceResult) => {
      totalAttended += result.attended;
      totalRecords += result.total;
      totalMeetings += result.meetingCount;
      return result;
    });

    // Sort by attendance count descending
    groupBreakdown.sort((a: GroupAttendanceResult, b: GroupAttendanceResult) => b.attended - a.attended);

    return {
      totalAttended,
      totalRecords,
      totalMeetings,
      overallRate: totalRecords > 0 ? Math.round((totalAttended / totalRecords) * 100) : 0,
      startDate: args.startDate,
      endDate: args.endDate,
      groupBreakdown,
    };
  },
});

/**
 * Internal query to get setup data for export action
 */
export const getExportSetupData = internalQuery({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    groupTypeId: v.id("groupTypes"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const isAdmin = await checkCommunityAdmin(ctx, args.communityId, userId);

    if (!isAdmin) {
      return { authorized: false, groups: [] };
    }

    const groupType = await ctx.db.get(args.groupTypeId);
    if (!groupType || groupType.communityId !== args.communityId) {
      return { authorized: true, groups: [] };
    }

    const groups = await ctx.db
      .query("groups")
      .withIndex("by_groupType", (q) => q.eq("groupTypeId", groupType._id))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    const communityGroups = groups
      .filter((g) => g.communityId === args.communityId)
      .map((g) => ({ id: g._id, name: g.name }));

    return { authorized: true, groups: communityGroups };
  },
});

// ============================================================================
// Lightweight Daily Summary
// ============================================================================

/**
 * Lightweight daily summary for the admin dashboard.
 *
 * Only scans today's chatMessages (via by_createdAt index) and resolves
 * channel/group names for the top 10 channels. Does NOT touch users,
 * communities, meetings, or attendance tables.
 */
export const getDailySummary = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const user = await ctx.db.get(userId);
    if (!user?.isStaff && !user?.isSuperuser) {
      throw new Error("Togather internal access required");
    }

    const nowMs = now();
    const todayStart = utcDayStart(nowMs);
    const todayEnd = todayStart + DAY_MS;

    // Scan only today's messages using the by_createdAt index
    const todayMessages = await ctx.db
      .query("chatMessages")
      .withIndex("by_createdAt", (q) =>
        q.gte("createdAt", todayStart).lt("createdAt", todayEnd)
      )
      .collect();

    let totalMessages = 0;
    const uniqueSenders = new Set<string>();
    const channelCounts = new Map<string, number>();

    for (const msg of todayMessages) {
      if (msg.isDeleted) continue;
      totalMessages += 1;
      if (msg.senderId) {
        uniqueSenders.add(msg.senderId);
      }
      channelCounts.set(
        msg.channelId,
        (channelCounts.get(msg.channelId) ?? 0) + 1
      );
    }

    // Sort channels by message count descending and take top 10
    const sortedChannels = Array.from(channelCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    // Resolve channel and group names for top channels
    const topChannels = await Promise.all(
      sortedChannels.map(async ([channelId, messageCount]) => {
        const channel = await ctx.db.get(channelId as Id<"chatChannels">);
        let groupName = "";
        if (channel?.groupId) {
          const group = await ctx.db.get(channel.groupId);
          groupName = group?.name ?? "";
        }
        return {
          channelId,
          channelName: channel?.name ?? "",
          groupName,
          messageCount,
        };
      })
    );

    // Format date as YYYY-MM-DD in UTC
    const d = new Date(todayStart);
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

    return {
      date,
      messages: {
        total: totalMessages,
        uniqueSenders: uniqueSenders.size,
      },
      topChannels,
    };
  },
});
