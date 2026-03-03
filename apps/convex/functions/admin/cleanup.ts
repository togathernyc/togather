/**
 * Admin functions for community cleanup and inactive user management
 *
 * CAUTION: These functions permanently delete data. Always export first!
 *
 * Includes:
 * - Internal queries for finding communities and users
 * - Dry run functions for previewing cleanup
 * - Preview and delete inactive user data
 * - Export community attendance to CSV
 */

import { v } from "convex/values";
import { query, mutation, action, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id, Doc } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { requirePrimaryAdmin, checkPrimaryAdmin } from "./auth";

/**
 * Attendance status codes (for CSV export readability)
 */
const ATTENDANCE_STATUS_LABELS: Record<number, string> = {
  1: "Present",
  2: "Absent",
  3: "Excused",
};

// ============================================================================
// Internal Queries for CLI/Scripts
// ============================================================================

/**
 * Internal query to find communities by name or slug (for admin scripts)
 * This is used to identify the correct community ID before running cleanup.
 */
export const findCommunitiesInternal = internalQuery({
  args: {
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const allCommunities = await ctx.db.query("communities").collect();

    let results = allCommunities;
    if (args.search) {
      const searchLower = args.search.toLowerCase();
      results = allCommunities.filter(
        (c) =>
          c.name?.toLowerCase().includes(searchLower) ||
          c.slug?.toLowerCase().includes(searchLower)
      );
    }

    return results.map((c) => ({
      id: c._id,
      name: c.name,
      slug: c.slug,
    }));
  },
});

/**
 * Get community membership count for planning pagination
 */
export const getCommunityMembershipCountInternal = internalQuery({
  args: {
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.neq(q.field("status"), 3))
      .collect();
    return memberships.length;
  },
});

/**
 * Get a batch of user IDs from community memberships
 */
export const getMembershipBatchInternal = internalQuery({
  args: {
    communityId: v.id("communities"),
    skip: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.neq(q.field("status"), 3))
      .collect();

    // Manual pagination since Convex doesn't have skip/offset
    const batch = memberships.slice(args.skip, args.skip + args.limit);
    return batch.map((m) => ({
      membershipId: m._id,
      odId: m.userId,
      lastLogin: m.lastLogin ?? null,
    }));
  },
});

/**
 * Build a mapping from legacy user IDs to Convex user IDs
 * This is used to join Supabase data with Convex users
 */
export const buildLegacyIdMappingInternal = internalQuery({
  args: {
    legacyIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const mapping: Record<string, string> = {};

    // Batch fetch all users at once using Promise.all
    const userQueries = args.legacyIds.map(legacyId =>
      ctx.db
        .query("users")
        .withIndex("by_legacyId", (q: any) => q.eq("legacyId", legacyId))
        .first()
    );
    const users = await Promise.all(userQueries);

    // Build mapping from results
    for (let i = 0; i < args.legacyIds.length; i++) {
      const user = users[i];
      if (user) {
        mapping[args.legacyIds[i]] = user._id;
      }
    }

    return mapping;
  },
});

/**
 * Get recent meeting IDs for a community (meetings after cutoff date)
 */
export const getRecentMeetingIdsInternal = internalQuery({
  args: {
    communityId: v.id("communities"),
    cutoffDate: v.number(),
  },
  handler: async (ctx, args) => {
    // Get all groups in the community
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q: any) => q.eq("communityId", args.communityId))
      .collect();

    const meetingIds: Id<"meetings">[] = [];

    // Get meetings after cutoff date for each group
    for (const group of groups) {
      const meetings = await ctx.db
        .query("meetings")
        .withIndex("by_group_scheduledAt", (q: any) =>
          q.eq("groupId", group._id).gte("scheduledAt", args.cutoffDate)
        )
        .collect();
      meetingIds.push(...meetings.map((m) => m._id));
    }

    return meetingIds;
  },
});

/**
 * Check which users have attendance in recent meetings
 */
export const checkUserAttendanceActivityInternal = internalQuery({
  args: {
    userIds: v.array(v.id("users")),
    meetingIds: v.array(v.id("meetings")),
  },
  handler: async (ctx, args) => {
    const usersWithAttendance = new Set<string>();

    // For each user, check if they have attendance in any recent meeting
    for (const odId of args.userIds) {
      const attendances = await ctx.db
        .query("meetingAttendances")
        .withIndex("by_user", (q: any) => q.eq("userId", odId))
        .collect();

      // Check if any attendance is for a recent meeting
      const hasRecentAttendance = attendances.some((a) =>
        args.meetingIds.some((mid) => mid === a.meetingId)
      );

      if (hasRecentAttendance) {
        usersWithAttendance.add(odId);
      }
    }

    return Array.from(usersWithAttendance);
  },
});

/**
 * Check activity status for a batch of users
 * Now includes attendance as an activity criterion
 *
 * supabaseLoginData is keyed by LEGACY user ID (from Supabase)
 * We look up each user's legacyId to check for Supabase login data
 */
export const checkUserActivityBatchInternal = internalQuery({
  args: {
    userIds: v.array(v.id("users")),
    membershipData: v.array(
      v.object({
        odId: v.id("users"),
        lastLogin: v.union(v.number(), v.null()),
      })
    ),
    cutoffDate: v.number(),
    usersWithRecentAttendance: v.array(v.string()), // User IDs with recent attendance
    // Supabase login data keyed by legacy user ID
    supabaseLoginByLegacyId: v.optional(v.any()), // Map<string, {lastLogin, communityLastLogin}>
  },
  handler: async (ctx, args) => {
    const results: Array<{
      odId: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
      communityLastLogin: string | null;
      globalLastLogin: string | null;
      supabaseLastLogin: string | null;
      isActive: boolean;
      activeReason: string;
    }> = [];

    const membershipMap = new Map(args.membershipData.map((m) => [m.odId, m.lastLogin]));
    const attendanceSet = new Set(args.usersWithRecentAttendance);

    // Supabase login data is now keyed by legacy ID
    const supabaseLoginByLegacyId = args.supabaseLoginByLegacyId as Record<string, { lastLogin: number | null; communityLastLogin: number | null }> | undefined;

    for (const odId of args.userIds) {
      const user = await ctx.db.get(odId);
      if (!user) continue;

      const communityLastLogin = membershipMap.get(odId) ?? null;
      const globalLastLogin = user.lastLogin ?? null;
      const hasRecentAttendance = attendanceSet.has(odId);

      // Check Supabase login data using user's legacyId
      let supabaseLastLogin: number | null = null;
      if (supabaseLoginByLegacyId && user.legacyId) {
        const supabaseData = supabaseLoginByLegacyId[user.legacyId];
        if (supabaseData) {
          supabaseLastLogin = supabaseData.lastLogin ?? supabaseData.communityLastLogin ?? null;
        }
      }

      // Activity checks
      const activeByCommunityLogin = communityLastLogin !== null && communityLastLogin >= args.cutoffDate;
      const activeByGlobalLogin = globalLastLogin !== null && globalLastLogin >= args.cutoffDate;
      const activeBySupabaseLogin = supabaseLastLogin !== null && supabaseLastLogin >= args.cutoffDate;
      const activeByAttendance = hasRecentAttendance;

      const isActive = activeByCommunityLogin || activeByGlobalLogin || activeBySupabaseLogin || activeByAttendance;

      let activeReason = "";
      if (isActive) {
        const reasons: string[] = [];
        if (activeByCommunityLogin) reasons.push("Convex community login");
        if (activeByGlobalLogin) reasons.push("Convex app login");
        if (activeBySupabaseLogin) reasons.push("Supabase login");
        if (activeByAttendance) reasons.push("Recent attendance");
        activeReason = reasons.join(" + ");
      }

      results.push({
        odId,
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
        email: user.email ?? null,
        phone: user.phone ?? null,
        communityLastLogin: communityLastLogin ? new Date(communityLastLogin).toISOString() : null,
        globalLastLogin: globalLastLogin ? new Date(globalLastLogin).toISOString() : null,
        supabaseLastLogin: supabaseLastLogin ? new Date(supabaseLastLogin).toISOString() : null,
        isActive,
        activeReason,
      });
    }

    return results;
  },
});

// ============================================================================
// Dry Run Functions
// ============================================================================

/**
 * Dry run action: Process large communities in batches
 * This handles communities with many members without hitting read limits.
 *
 * Activity criteria:
 * 1. Logged into this community in Convex (userCommunities.lastLogin)
 * 2. Logged into the app in Convex (users.lastLogin)
 * 3. Has attendance recorded in a meeting within the period
 * 4. (Optional) Logged in via Supabase if supabaseLoginData is provided
 */
export const dryRunActiveUsersAction = action({
  args: {
    communityId: v.id("communities"),
    monthsInactive: v.optional(v.number()),
    includeInactiveList: v.optional(v.boolean()), // Set to true to get inactive list (may fail for large communities)
    // Supabase login data keyed by legacy user ID: { "12345": { lastLogin: 123456789, communityLastLogin: 123456789 } }
    supabaseLoginByLegacyId: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<{
    cutoffDate: string;
    monthsInactive: number;
    totalMembers: number;
    activeCount: number;
    inactiveCount: number;
    recentMeetingsCount: number;
    activeUsers: Array<{
      odId: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
      communityLastLogin: string | null;
      globalLastLogin: string | null;
      supabaseLastLogin: string | null;
      activeReason: string;
    }>;
    inactiveUsers: Array<{
      odId: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
      communityLastLogin: string | null;
      globalLastLogin: string | null;
    }>;
  }> => {
    const monthsInactive = args.monthsInactive ?? 6;
    const cutoffDate = Date.now() - (monthsInactive * 30 * 24 * 60 * 60 * 1000);

    // Get total count
    const totalCount: number = await ctx.runQuery(internal.functions.admin.cleanup.getCommunityMembershipCountInternal, {
      communityId: args.communityId,
    });

    // Get recent meeting IDs (meetings after cutoff date)
    const recentMeetingIds: Id<"meetings">[] = await ctx.runQuery(
      internal.functions.admin.cleanup.getRecentMeetingIdsInternal,
      {
        communityId: args.communityId,
        cutoffDate,
      }
    );

    const batchSize = 200;
    const activeUsers: Array<{
      odId: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
      communityLastLogin: string | null;
      globalLastLogin: string | null;
      supabaseLastLogin: string | null;
      activeReason: string;
    }> = [];

    const inactiveUsers: Array<{
      odId: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
      communityLastLogin: string | null;
      globalLastLogin: string | null;
    }> = [];

    // Process in batches
    for (let skip = 0; skip < totalCount; skip += batchSize) {
      const batch = await ctx.runQuery(internal.functions.admin.cleanup.getMembershipBatchInternal, {
        communityId: args.communityId,
        skip,
        limit: batchSize,
      });

      if (batch.length === 0) break;

      const userIds = batch.map((m: { odId: Id<"users"> }) => m.odId);
      const membershipData = batch.map((m: { odId: Id<"users">; lastLogin: number | null }) => ({
        odId: m.odId,
        lastLogin: m.lastLogin,
      }));

      // Check attendance activity for this batch
      const usersWithRecentAttendance: string[] = await ctx.runQuery(
        internal.functions.admin.cleanup.checkUserAttendanceActivityInternal,
        {
          userIds,
          meetingIds: recentMeetingIds,
        }
      );

      const results = await ctx.runQuery(internal.functions.admin.cleanup.checkUserActivityBatchInternal, {
        userIds,
        membershipData,
        cutoffDate,
        usersWithRecentAttendance,
        supabaseLoginByLegacyId: args.supabaseLoginByLegacyId,
      });

      for (const r of results) {
        if (r.isActive) {
          activeUsers.push({
            odId: r.odId,
            firstName: r.firstName,
            lastName: r.lastName,
            email: r.email,
            phone: r.phone,
            communityLastLogin: r.communityLastLogin,
            globalLastLogin: r.globalLastLogin,
            supabaseLastLogin: r.supabaseLastLogin,
            activeReason: r.activeReason,
          });
        } else {
          inactiveUsers.push({
            odId: r.odId,
            firstName: r.firstName,
            lastName: r.lastName,
            email: r.email,
            phone: r.phone,
            communityLastLogin: r.communityLastLogin,
            globalLastLogin: r.globalLastLogin,
          });
        }
      }
    }

    // Sort by last name
    activeUsers.sort((a, b) => (a.lastName || "").localeCompare(b.lastName || ""));
    if (args.includeInactiveList) {
      inactiveUsers.sort((a, b) => (a.lastName || "").localeCompare(b.lastName || ""));
    }

    return {
      cutoffDate: new Date(cutoffDate).toISOString(),
      monthsInactive,
      totalMembers: totalCount,
      activeCount: activeUsers.length,
      inactiveCount: inactiveUsers.length,
      recentMeetingsCount: recentMeetingIds.length,
      activeUsers,
      // Only include inactive list if explicitly requested (saves return size)
      inactiveUsers: args.includeInactiveList ? inactiveUsers : [],
    };
  },
});

/**
 * Internal dry run: List users who would STAY (active in last 6 months)
 * This version doesn't require auth - for CLI use only.
 *
 * A user is considered "active" if they have:
 * 1. Logged into this specific community in the last 6 months (userCommunities.lastLogin)
 * 2. OR logged into the app at all in the last 6 months (users.lastLogin)
 */
export const dryRunActiveUsersInternal = internalQuery({
  args: {
    communityId: v.id("communities"),
    monthsInactive: v.optional(v.number()), // Default 6 months
  },
  handler: async (ctx, args) => {
    const monthsInactive = args.monthsInactive ?? 6;
    const cutoffDate = Date.now() - (monthsInactive * 30 * 24 * 60 * 60 * 1000);

    // Get all groups in the community for attendance checking
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    // Get recent meetings (after cutoff date) for attendance checking
    const recentMeetingIds = new Set<Id<"meetings">>();
    for (const group of groups) {
      const meetings = await ctx.db
        .query("meetings")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .collect();
      for (const m of meetings) {
        if (m.scheduledAt && m.scheduledAt >= cutoffDate) {
          recentMeetingIds.add(m._id);
        }
      }
    }

    // Get all community memberships
    const allMemberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.neq(q.field("status"), 3)) // Not blocked
      .collect();

    const activeUsers: Array<{
      userId: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
      communityLastLogin: string | null;
      globalLastLogin: string | null;
      activeReason: string;
    }> = [];

    const inactiveUsers: Array<{
      userId: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
      communityLastLogin: string | null;
      globalLastLogin: string | null;
    }> = [];

    for (const membership of allMemberships) {
      const user = await ctx.db.get(membership.userId);
      if (!user) continue;

      const communityLastLogin = membership.lastLogin ?? null;
      const globalLastLogin = user.lastLogin ?? null;

      // Check if user is active (login OR attendance)
      const activeByCommunityLogin = communityLastLogin !== null && communityLastLogin >= cutoffDate;
      const activeByGlobalLogin = globalLastLogin !== null && globalLastLogin >= cutoffDate;

      // Also check for recent attendance (to match deletion criteria)
      const userAttendances = await ctx.db
        .query("meetingAttendances")
        .withIndex("by_user", (q) => q.eq("userId", membership.userId))
        .collect();
      const activeByAttendance = userAttendances.some((a) => recentMeetingIds.has(a.meetingId));

      const isActive = activeByCommunityLogin || activeByGlobalLogin || activeByAttendance;

      const userInfo = {
        userId: membership.userId,
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
        email: user.email ?? null,
        phone: user.phone ?? null,
        communityLastLogin: communityLastLogin ? new Date(communityLastLogin).toISOString() : null,
        globalLastLogin: globalLastLogin ? new Date(globalLastLogin).toISOString() : null,
      };

      if (isActive) {
        let activeReason = "";
        if (activeByCommunityLogin && activeByGlobalLogin) {
          activeReason = "Both community and app login";
        } else if (activeByCommunityLogin) {
          activeReason = "Community login";
        } else if (activeByGlobalLogin) {
          activeReason = "App login (different community)";
        } else if (activeByAttendance) {
          activeReason = "Meeting attendance";
        }
        activeUsers.push({ ...userInfo, activeReason });
      } else {
        inactiveUsers.push(userInfo);
      }
    }

    // Sort by last name
    activeUsers.sort((a, b) => (a.lastName || "").localeCompare(b.lastName || ""));
    inactiveUsers.sort((a, b) => (a.lastName || "").localeCompare(b.lastName || ""));

    return {
      cutoffDate: new Date(cutoffDate).toISOString(),
      monthsInactive,
      totalMembers: allMemberships.length,
      activeCount: activeUsers.length,
      inactiveCount: inactiveUsers.length,
      activeUsers,
      inactiveUsers,
      recentMeetingsCount: recentMeetingIds.size,
    };
  },
});

/**
 * Dry run: List users who would STAY (active in last 6 months)
 *
 * A user is considered "active" if they have:
 * 1. Logged into this specific community in the last 6 months (userCommunities.lastLogin)
 * 2. OR logged into the app at all in the last 6 months (users.lastLogin)
 * 3. OR attended a meeting in the last 6 months
 *
 * This is a PRIMARY ADMIN only function for safety.
 */
export const dryRunActiveUsers = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    monthsInactive: v.optional(v.number()), // Default 6 months
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requirePrimaryAdmin(ctx, args.communityId, userId);

    const monthsInactive = args.monthsInactive ?? 6;
    const cutoffDate = Date.now() - (monthsInactive * 30 * 24 * 60 * 60 * 1000);

    // Get all groups in the community for attendance checking
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    // Get recent meetings (after cutoff date) for attendance checking
    const recentMeetingIds = new Set<Id<"meetings">>();
    for (const group of groups) {
      const meetings = await ctx.db
        .query("meetings")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .collect();
      for (const m of meetings) {
        if (m.scheduledAt && m.scheduledAt >= cutoffDate) {
          recentMeetingIds.add(m._id);
        }
      }
    }

    // Get all community memberships
    const allMemberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.neq(q.field("status"), 3)) // Not blocked
      .collect();

    const activeUsers: Array<{
      userId: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
      communityLastLogin: string | null;
      globalLastLogin: string | null;
      activeReason: string;
    }> = [];

    const inactiveUsers: Array<{
      userId: string;
      firstName: string;
      lastName: string;
      email: string | null;
      phone: string | null;
      communityLastLogin: string | null;
      globalLastLogin: string | null;
    }> = [];

    for (const membership of allMemberships) {
      const user = await ctx.db.get(membership.userId);
      if (!user) continue;

      const communityLastLogin = membership.lastLogin ?? null;
      const globalLastLogin = user.lastLogin ?? null;

      // Check if user is active (login OR attendance)
      const activeByCommunityLogin = communityLastLogin !== null && communityLastLogin >= cutoffDate;
      const activeByGlobalLogin = globalLastLogin !== null && globalLastLogin >= cutoffDate;

      // Also check for recent attendance (to match deletion criteria)
      const userAttendances = await ctx.db
        .query("meetingAttendances")
        .withIndex("by_user", (q) => q.eq("userId", membership.userId))
        .collect();
      const activeByAttendance = userAttendances.some((a) => recentMeetingIds.has(a.meetingId));

      const isActive = activeByCommunityLogin || activeByGlobalLogin || activeByAttendance;

      const userInfo = {
        userId: membership.userId,
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
        email: user.email ?? null,
        phone: user.phone ?? null,
        communityLastLogin: communityLastLogin ? new Date(communityLastLogin).toISOString() : null,
        globalLastLogin: globalLastLogin ? new Date(globalLastLogin).toISOString() : null,
      };

      if (isActive) {
        let activeReason = "";
        if (activeByCommunityLogin && activeByGlobalLogin) {
          activeReason = "Both community and app login";
        } else if (activeByCommunityLogin) {
          activeReason = "Community login";
        } else if (activeByGlobalLogin) {
          activeReason = "App login (different community)";
        } else if (activeByAttendance) {
          activeReason = "Meeting attendance";
        }
        activeUsers.push({ ...userInfo, activeReason });
      } else {
        inactiveUsers.push(userInfo);
      }
    }

    // Sort by last name
    activeUsers.sort((a, b) => (a.lastName || "").localeCompare(b.lastName || ""));
    inactiveUsers.sort((a, b) => (a.lastName || "").localeCompare(b.lastName || ""));

    return {
      cutoffDate: new Date(cutoffDate).toISOString(),
      monthsInactive,
      totalMembers: allMemberships.length,
      activeCount: activeUsers.length,
      inactiveCount: inactiveUsers.length,
      activeUsers,
      inactiveUsers,
      recentMeetingsCount: recentMeetingIds.size,
    };
  },
});

// ============================================================================
// Preview and Delete Functions
// ============================================================================

/**
 * Count records that would be deleted for inactive users
 *
 * This is a preview of what would be deleted. Run this before actual deletion.
 */
export const previewInactiveUserDeletion = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    monthsInactive: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requirePrimaryAdmin(ctx, args.communityId, userId);

    const monthsInactive = args.monthsInactive ?? 6;
    const cutoffDate = Date.now() - (monthsInactive * 30 * 24 * 60 * 60 * 1000);

    // Get all groups in this community first (needed for attendance check)
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    const groupIds = new Set(groups.map(g => g._id));

    // Get recent meetings (after cutoff date) for attendance checking
    const recentMeetingIds = new Set<Id<"meetings">>();
    for (const group of groups) {
      const meetings = await ctx.db
        .query("meetings")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .collect();
      for (const m of meetings) {
        if (m.scheduledAt && m.scheduledAt >= cutoffDate) {
          recentMeetingIds.add(m._id);
        }
      }
    }

    // Get inactive users (checking login AND attendance to match dry-run criteria)
    const allMemberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.neq(q.field("status"), 3))
      .collect();

    const inactiveUserIds: Id<"users">[] = [];
    for (const membership of allMemberships) {
      const user = await ctx.db.get(membership.userId);
      if (!user) continue;

      const communityLastLogin = membership.lastLogin ?? null;
      const globalLastLogin = user.lastLogin ?? null;

      const activeByCommunityLogin = communityLastLogin !== null && communityLastLogin >= cutoffDate;
      const activeByGlobalLogin = globalLastLogin !== null && globalLastLogin >= cutoffDate;

      // Also check for recent attendance (matching dry-run criteria)
      const userAttendances = await ctx.db
        .query("meetingAttendances")
        .withIndex("by_user", (q) => q.eq("userId", membership.userId))
        .collect();
      const activeByAttendance = userAttendances.some((a) => recentMeetingIds.has(a.meetingId));

      if (!activeByCommunityLogin && !activeByGlobalLogin && !activeByAttendance) {
        inactiveUserIds.push(membership.userId);
      }
    }

    // Count group memberships to delete
    let groupMembershipsCount = 0;
    for (const inactiveUserId of inactiveUserIds) {
      const memberships = await ctx.db
        .query("groupMembers")
        .withIndex("by_user", (q) => q.eq("userId", inactiveUserId))
        .collect();
      groupMembershipsCount += memberships.filter(m => groupIds.has(m.groupId)).length;
    }

    // Get all meetings in community groups
    const allMeetings: Doc<"meetings">[] = [];
    for (const group of groups) {
      const meetings = await ctx.db
        .query("meetings")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .collect();
      allMeetings.push(...meetings);
    }
    const meetingIds = new Set(allMeetings.map(m => m._id));

    // Count attendance records to delete
    let attendanceCount = 0;
    for (const inactiveUserId of inactiveUserIds) {
      const attendances = await ctx.db
        .query("meetingAttendances")
        .withIndex("by_user", (q) => q.eq("userId", inactiveUserId))
        .collect();
      attendanceCount += attendances.filter(a => meetingIds.has(a.meetingId)).length;
    }

    // Count RSVPs to delete
    let rsvpCount = 0;
    for (const inactiveUserId of inactiveUserIds) {
      const rsvps = await ctx.db
        .query("meetingRsvps")
        .withIndex("by_user", (q) => q.eq("userId", inactiveUserId))
        .collect();
      rsvpCount += rsvps.filter(r => meetingIds.has(r.meetingId)).length;
    }

    return {
      inactiveUserCount: inactiveUserIds.length,
      groupMembershipsToDelete: groupMembershipsCount,
      attendanceRecordsToDelete: attendanceCount,
      rsvpsToDelete: rsvpCount,
      communityMembershipsToDelete: inactiveUserIds.length,
      totalRecordsToDelete: groupMembershipsCount + attendanceCount + rsvpCount + inactiveUserIds.length,
    };
  },
});

/**
 * Delete all data for inactive users in a community
 *
 * DANGER: This permanently deletes data. Ensure you have exported attendance first!
 *
 * Deletes:
 * - Group memberships (groupMembers)
 * - Meeting attendance records (meetingAttendances)
 * - RSVPs (meetingRsvps)
 * - Community membership (userCommunities)
 *
 * Does NOT delete the user account itself (they may belong to other communities)
 */
export const deleteInactiveUserData = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    monthsInactive: v.optional(v.number()),
    confirmDelete: v.boolean(), // Must be true to proceed
  },
  handler: async (ctx, args) => {
    if (!args.confirmDelete) {
      throw new Error("Must set confirmDelete: true to proceed with deletion");
    }

    const userId = await requireAuth(ctx, args.token);
    await requirePrimaryAdmin(ctx, args.communityId, userId);

    const monthsInactive = args.monthsInactive ?? 6;
    const cutoffDate = Date.now() - (monthsInactive * 30 * 24 * 60 * 60 * 1000);

    // Get all groups in this community first (needed for attendance check)
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    const groupIds = new Set(groups.map(g => g._id));

    // Get recent meetings (after cutoff date) for attendance checking
    const recentMeetingIds = new Set<Id<"meetings">>();
    for (const group of groups) {
      const meetings = await ctx.db
        .query("meetings")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .collect();
      for (const m of meetings) {
        if (m.scheduledAt && m.scheduledAt >= cutoffDate) {
          recentMeetingIds.add(m._id);
        }
      }
    }

    // Get inactive users (checking login AND attendance to match dry-run criteria)
    const allMemberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.neq(q.field("status"), 3))
      .collect();

    const inactiveUserIds: Id<"users">[] = [];
    for (const membership of allMemberships) {
      const user = await ctx.db.get(membership.userId);
      if (!user) continue;

      const communityLastLogin = membership.lastLogin ?? null;
      const globalLastLogin = user.lastLogin ?? null;

      const activeByCommunityLogin = communityLastLogin !== null && communityLastLogin >= cutoffDate;
      const activeByGlobalLogin = globalLastLogin !== null && globalLastLogin >= cutoffDate;

      // Also check for recent attendance (matching dry-run criteria)
      const userAttendances = await ctx.db
        .query("meetingAttendances")
        .withIndex("by_user", (q) => q.eq("userId", membership.userId))
        .collect();
      const activeByAttendance = userAttendances.some((a) => recentMeetingIds.has(a.meetingId));

      if (!activeByCommunityLogin && !activeByGlobalLogin && !activeByAttendance) {
        inactiveUserIds.push(membership.userId);
      }
    }

    // Get all meetings in community groups (for deletion scope - includes all meetings, not just recent)
    const allMeetings: Doc<"meetings">[] = [];
    for (const group of groups) {
      const meetings = await ctx.db
        .query("meetings")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .collect();
      allMeetings.push(...meetings);
    }
    const meetingIds = new Set(allMeetings.map(m => m._id));

    let deletedGroupMemberships = 0;
    let deletedAttendances = 0;
    let deletedRsvps = 0;
    let deletedCommunityMemberships = 0;

    // Delete data for each inactive user
    for (const inactiveUserId of inactiveUserIds) {
      // Delete group memberships
      const groupMemberships = await ctx.db
        .query("groupMembers")
        .withIndex("by_user", (q) => q.eq("userId", inactiveUserId))
        .collect();
      for (const gm of groupMemberships) {
        if (groupIds.has(gm.groupId)) {
          await ctx.db.delete(gm._id);
          deletedGroupMemberships++;
        }
      }

      // Delete attendance records
      const attendances = await ctx.db
        .query("meetingAttendances")
        .withIndex("by_user", (q) => q.eq("userId", inactiveUserId))
        .collect();
      for (const a of attendances) {
        if (meetingIds.has(a.meetingId)) {
          await ctx.db.delete(a._id);
          deletedAttendances++;
        }
      }

      // Delete RSVPs
      const rsvps = await ctx.db
        .query("meetingRsvps")
        .withIndex("by_user", (q) => q.eq("userId", inactiveUserId))
        .collect();
      for (const r of rsvps) {
        if (meetingIds.has(r.meetingId)) {
          await ctx.db.delete(r._id);
          deletedRsvps++;
        }
      }

      // Delete community membership
      const communityMembership = await ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", inactiveUserId).eq("communityId", args.communityId)
        )
        .first();
      if (communityMembership) {
        await ctx.db.delete(communityMembership._id);
        deletedCommunityMemberships++;
      }
    }

    return {
      success: true,
      deletedAt: new Date().toISOString(),
      deletedGroupMemberships,
      deletedAttendances,
      deletedRsvps,
      deletedCommunityMemberships,
      totalDeleted: deletedGroupMemberships + deletedAttendances + deletedRsvps + deletedCommunityMemberships,
      usersAffected: inactiveUserIds.length,
    };
  },
});

// ============================================================================
// Export Functions
// ============================================================================

/**
 * Export ALL attendance records for a community in CSV format
 *
 * This must be run BEFORE any deletion to preserve historical data.
 * Returns data in a format suitable for CSV export.
 *
 * Uses action to handle large data sets by processing in batches.
 */
export const exportCommunityAttendanceCSV = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args): Promise<{
    csvHeaders: string;
    csvRows: string[];
    totalRecords: number;
  }> => {
    // Get all attendance data via internal query
    const data = await ctx.runQuery(internal.functions.admin.cleanup.getCommunityAttendanceForExport, {
      token: args.token,
      communityId: args.communityId,
    });

    if (!data.authorized) {
      throw new Error("Unauthorized - Primary Admin required");
    }

    const csvHeaders = "User ID,First Name,Last Name,Email,Phone,Group Name,Meeting Title,Meeting Date,Attendance Status,Recorded At,Recorded By";

    // Escape fields for CSV (handles quotes and special characters)
    const escape = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;

    const csvRows = data.records.map((r: {
      odId: string;
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      groupName: string;
      meetingTitle: string;
      meetingDate: string;
      attendanceStatus: string;
      recordedAt: string;
      recordedBy: string;
    }) => [
      escape(r.odId),
      escape(r.firstName),
      escape(r.lastName),
      escape(r.email),
      escape(r.phone),
      escape(r.groupName),
      escape(r.meetingTitle),
      escape(r.meetingDate),
      escape(r.attendanceStatus),
      escape(r.recordedAt),
      escape(r.recordedBy)
    ].join(','));

    return {
      csvHeaders,
      csvRows,
      totalRecords: data.records.length,
    };
  },
});

/**
 * Internal query to get all attendance data for a community
 */
export const getCommunityAttendanceForExport = internalQuery({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const isPrimaryAdmin = await checkPrimaryAdmin(ctx, args.communityId, userId);

    if (!isPrimaryAdmin) {
      return { authorized: false, records: [] };
    }

    // Get all groups in this community
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    const groupMap = new Map(groups.map(g => [g._id, g.name]));
    const groupIds = groups.map(g => g._id);

    // Get all meetings for these groups
    const allMeetings: Doc<"meetings">[] = [];
    for (const groupId of groupIds) {
      const meetings = await ctx.db
        .query("meetings")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect();
      allMeetings.push(...meetings);
    }

    const meetingMap = new Map(allMeetings.map(m => [m._id, m]));
    const meetingIds = allMeetings.map(m => m._id);

    // Get all attendance records for these meetings
    const records: Array<{
      odId: string;
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      groupName: string;
      meetingTitle: string;
      meetingDate: string;
      attendanceStatus: string;
      recordedAt: string;
      recordedBy: string;
    }> = [];

    for (const meetingId of meetingIds) {
      const attendances = await ctx.db
        .query("meetingAttendances")
        .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
        .collect();

      for (const attendance of attendances) {
        const user = await ctx.db.get(attendance.userId);
        const meeting = meetingMap.get(meetingId);
        const groupName = meeting ? groupMap.get(meeting.groupId) ?? "Unknown" : "Unknown";

        let recordedByName = "";
        if (attendance.recordedById) {
          const recordedByUser = await ctx.db.get(attendance.recordedById);
          if (recordedByUser) {
            recordedByName = `${recordedByUser.firstName ?? ""} ${recordedByUser.lastName ?? ""}`.trim();
          }
        }

        records.push({
          odId: attendance.userId,
          firstName: user?.firstName ?? "",
          lastName: user?.lastName ?? "",
          email: user?.email ?? "",
          phone: user?.phone ?? "",
          groupName,
          meetingTitle: meeting?.title ?? "Meeting",
          meetingDate: meeting ? new Date(meeting.scheduledAt).toISOString() : "",
          attendanceStatus: ATTENDANCE_STATUS_LABELS[attendance.status] ?? `Status ${attendance.status}`,
          recordedAt: new Date(attendance.recordedAt).toISOString(),
          recordedBy: recordedByName,
        });
      }
    }

    // Sort by date, then user name
    records.sort((a, b) => {
      const dateCompare = a.meetingDate.localeCompare(b.meetingDate);
      if (dateCompare !== 0) return dateCompare;
      return (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName);
    });

    return { authorized: true, records };
  },
});

// ============================================================================
// Internal Queries for Batched Processing
// ============================================================================

/**
 * Get list of groups in a community (for batched processing)
 */
export const getCommunityGroupsInternal = internalQuery({
  args: {
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q: any) => q.eq("communityId", args.communityId))
      .collect();

    return groups.map(g => ({ id: g._id, name: g.name }));
  },
});

/**
 * Get attendance records for a single group (batched)
 */
export const getGroupAttendanceRecordsInternal = internalQuery({
  args: {
    groupId: v.id("groups"),
    groupName: v.string(),
  },
  handler: async (ctx, args) => {
    const records: Array<{
      odId: string;
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      groupName: string;
      meetingTitle: string;
      meetingDate: string;
      attendanceStatus: string;
      recordedAt: string;
      recordedBy: string;
    }> = [];

    // Get all meetings for this group
    const meetings = await ctx.db
      .query("meetings")
      .withIndex("by_group", (q: any) => q.eq("groupId", args.groupId))
      .collect();

    for (const meeting of meetings) {
      const attendances = await ctx.db
        .query("meetingAttendances")
        .withIndex("by_meeting", (q: any) => q.eq("meetingId", meeting._id))
        .collect();

      for (const attendance of attendances) {
        const user = await ctx.db.get(attendance.userId);

        let recordedByName = "";
        if (attendance.recordedById) {
          const recordedByUser = await ctx.db.get(attendance.recordedById);
          if (recordedByUser) {
            recordedByName = `${recordedByUser.firstName ?? ""} ${recordedByUser.lastName ?? ""}`.trim();
          }
        }

        records.push({
          odId: attendance.userId,
          firstName: user?.firstName ?? "",
          lastName: user?.lastName ?? "",
          email: user?.email ?? "",
          phone: user?.phone ?? "",
          groupName: args.groupName,
          meetingTitle: meeting.title ?? "Meeting",
          meetingDate: new Date(meeting.scheduledAt).toISOString(),
          attendanceStatus: ATTENDANCE_STATUS_LABELS[attendance.status] ?? `Status ${attendance.status}`,
          recordedAt: new Date(attendance.recordedAt).toISOString(),
          recordedBy: recordedByName,
        });
      }
    }

    return records;
  },
});

/**
 * Get list of meetings for a group (lightweight - just IDs and metadata)
 * Use this for paginated processing of large groups
 */
export const getGroupMeetingsInternal = internalQuery({
  args: {
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const meetings = await ctx.db
      .query("meetings")
      .withIndex("by_group", (q: any) => q.eq("groupId", args.groupId))
      .collect();

    return meetings.map(m => ({
      id: m._id,
      title: m.title ?? "Meeting",
      scheduledAt: m.scheduledAt,
    }));
  },
});

/**
 * Get attendance records for a SINGLE meeting
 * Use this for paginated processing - call once per meeting
 */
export const getMeetingAttendanceInternal = internalQuery({
  args: {
    meetingId: v.id("meetings"),
    groupName: v.string(),
    meetingTitle: v.string(),
    meetingDate: v.number(),
  },
  handler: async (ctx, args) => {
    const records: Array<{
      odId: string;
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      groupName: string;
      meetingTitle: string;
      meetingDate: string;
      attendanceStatus: string;
      recordedAt: string;
      recordedBy: string;
    }> = [];

    const attendances = await ctx.db
      .query("meetingAttendances")
      .withIndex("by_meeting", (q: any) => q.eq("meetingId", args.meetingId))
      .collect();

    for (const attendance of attendances) {
      const user = await ctx.db.get(attendance.userId);

      let recordedByName = "";
      if (attendance.recordedById) {
        const recordedByUser = await ctx.db.get(attendance.recordedById);
        if (recordedByUser) {
          recordedByName = `${recordedByUser.firstName ?? ""} ${recordedByUser.lastName ?? ""}`.trim();
        }
      }

      records.push({
        odId: attendance.userId,
        firstName: user?.firstName ?? "",
        lastName: user?.lastName ?? "",
        email: user?.email ?? "",
        phone: user?.phone ?? "",
        groupName: args.groupName,
        meetingTitle: args.meetingTitle,
        meetingDate: new Date(args.meetingDate).toISOString(),
        attendanceStatus: ATTENDANCE_STATUS_LABELS[attendance.status] ?? `Status ${attendance.status}`,
        recordedAt: new Date(attendance.recordedAt).toISOString(),
        recordedBy: recordedByName,
      });
    }

    return records;
  },
});
