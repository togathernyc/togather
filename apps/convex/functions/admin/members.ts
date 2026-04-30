/**
 * Admin functions for community member management
 *
 * Includes:
 * - Listing and searching community members
 * - Member role management
 * - Primary admin transfer
 * - User group history
 */

import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import { now, normalizePhone, getMediaUrl } from "../../lib/utils";
import { requireAuth } from "../../lib/auth";
import { searchCommunityMembersPaginated } from "../../lib/memberSearch";
import { getUsersWithNotificationsDisabled } from "../../lib/notifications/enabledStatus";
import { syncAnnouncementGroupMembership } from "../sync/memberships";
import {
  requireCommunityAdmin,
  requirePrimaryAdmin,
  COMMUNITY_ROLES,
  ADMIN_ROLE_THRESHOLD,
} from "./auth";

// ============================================================================
// Community Members
// ============================================================================

/**
 * List community members with pagination and filters
 *
 * Optimized to reduce reads by:
 * 1. Fetching groups once upfront
 * 2. Paginating memberships at the database level
 * 3. Only processing members needed for current page
 */
export const listCommunityMembers = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    search: v.optional(v.string()),
    groupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    // Use the shared paginated search helper
    const result = await searchCommunityMembersPaginated(ctx, {
      communityId: args.communityId,
      search: args.search,
      groupId: args.groupId,
      page: args.page,
      pageSize: Math.min(args.pageSize ?? 20, 50),
    });

    return result;
  },
});

/**
 * Search community members by name, email, or phone
 * Uses Convex search index for efficient full-text search across all users
 * Results are ordered by: 1) community login activity, 2) app login activity
 */
export const searchCommunityMembers = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    search: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const limit = Math.min(args.limit ?? 50, 100);

    if (!args.search.trim()) {
      return { members: [], total: 0 };
    }

    // Use Convex search index to find users matching the search term
    // This searches across all users efficiently without the 2000 limit
    const searchResults = await ctx.db
      .query("users")
      .withSearchIndex("search_users", (q) => q.search("searchText", args.search))
      .take(500); // Get more results to filter by community membership

    // Also handle phone number search with normalization
    // Full-text search doesn't handle formatted phone numbers well,
    // so we do a separate phone lookup if the search contains digits
    const normalizedPhone = normalizePhone(args.search).replace(/\D/g, "");
    let phoneSearchResults: typeof searchResults = [];
    if (normalizedPhone.length >= 4) {
      // Get community members and check for phone matches
      const communityMemberships = await ctx.db
        .query("userCommunities")
        .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
        .filter((q) => q.neq(q.field("status"), 3)) // Not blocked
        .take(2000);

      const phoneMatchPromises = communityMemberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        if (user?.phone?.includes(normalizedPhone)) {
          return user;
        }
        return null;
      });
      const phoneMatches = await Promise.all(phoneMatchPromises);
      phoneSearchResults = phoneMatches.filter((u): u is NonNullable<typeof u> => u !== null);
    }

    // Merge results, deduplicating by user ID
    const seenUserIds = new Set<string>();
    const allResults = [...searchResults, ...phoneSearchResults].filter((user) => {
      if (seenUserIds.has(user._id)) return false;
      seenUserIds.add(user._id);
      return true;
    });

    if (allResults.length === 0) {
      return { members: [], total: 0 };
    }

    // Check which of these users are members of this community
    const membershipPromises = allResults.map((user) =>
      ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", user._id).eq("communityId", args.communityId)
        )
        .first()
    );
    const memberships = await Promise.all(membershipPromises);

    // Build results for users who are community members
    const matches: Array<{
      id: typeof allResults[0]["_id"];
      firstName: string;
      lastName: string;
      email: string;
      phone: string | null;
      profilePhoto: string | null;
      isAdmin: boolean;
      role: number;
      notificationsDisabled: boolean;
      communityLastLogin: number;
      appLastLogin: number;
    }> = [];

    // Batched notif-disabled lookup so each row can show the slashed-bell.
    const candidateUserIds = allResults
      .map((u, i) => ({ user: u, membership: memberships[i] }))
      .filter(({ membership }) => membership && membership.status !== 3)
      .map(({ user }) => user._id);
    const notifsDisabled = await getUsersWithNotificationsDisabled(
      ctx,
      candidateUserIds,
    );

    for (let i = 0; i < allResults.length; i++) {
      const user = allResults[i];
      const membership = memberships[i];

      // Skip if not a member or blocked
      if (!membership || membership.status === 3) continue;

      matches.push({
        id: user._id,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
        phone: user.phone || null,
        profilePhoto: getMediaUrl(user.profilePhoto) ?? null,
        isAdmin: (membership.roles ?? 0) >= ADMIN_ROLE_THRESHOLD,
        role: membership.roles ?? COMMUNITY_ROLES.MEMBER,
        notificationsDisabled: notifsDisabled.has(user._id),
        communityLastLogin: membership.lastLogin ?? 0,
        appLastLogin: user.lastLogin ?? 0,
      });
    }

    // Sort by: 1) community login activity (desc), 2) app login activity (desc)
    matches.sort((a, b) => {
      // First compare by community login
      if (a.communityLastLogin !== b.communityLastLogin) {
        return b.communityLastLogin - a.communityLastLogin;
      }
      // Then by app login
      return b.appLastLogin - a.appLastLogin;
    });

    // Take only the requested limit and remove sort fields from response
    const limitedMatches = matches.slice(0, limit).map(({ communityLastLogin, appLastLogin, ...rest }) => rest);

    return {
      members: limitedMatches,
      total: limitedMatches.length,
    };
  },
});


/**
 * Get community member details by ID
 */
export const getCommunityMemberById = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    targetUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const user = await ctx.db.get(args.targetUserId);
    if (!user) {
      throw new Error("User not found");
    }

    // Get community membership
    const communityMembership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", args.targetUserId).eq("communityId", args.communityId)
      )
      .first();

    if (!communityMembership) {
      // User was removed from community - return null instead of throwing
      return null;
    }

    // Get active group memberships
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    const groupIds = new Set(groups.map((g) => g._id));

    const allMemberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.targetUserId))
      .collect();

    const activeGroups = allMemberships.filter(
      (m) =>
        !m.leftAt &&
        groupIds.has(m.groupId) &&
        (m.requestStatus === undefined || m.requestStatus === null || m.requestStatus === "accepted")
    );

    // Get recent attendance
    const allAttendances = await ctx.db
      .query("meetingAttendances")
      .withIndex("by_user", (q) => q.eq("userId", args.targetUserId))
      .collect();

    // Filter to community meetings and get recent 20
    const communityAttendances: {
      _id: typeof allAttendances[0]["_id"];
      meetingId: typeof allAttendances[0]["meetingId"];
      status: number;
      recordedAt: number;
      meeting: any;
    }[] = [];

    for (const attendance of allAttendances) {
      const meeting = await ctx.db.get(attendance.meetingId);
      if (meeting && groupIds.has(meeting.groupId)) {
        const group = groups.find((g) => g._id === meeting.groupId);
        communityAttendances.push({
          ...attendance,
          meeting: {
            ...meeting,
            group: {
              id: group?._id,
              name: group?.name,
            },
          },
        });
      }
    }

    // Sort by recordedAt and take 20
    communityAttendances.sort((a, b) => b.recordedAt - a.recordedAt);
    const recentAttendance = communityAttendances.slice(0, 20);

    // Calculate attendance stats
    const totalAttendance = communityAttendances.length;
    const attendedCount = communityAttendances.filter((a) => a.status === 1).length;
    const attendanceRate = totalAttendance > 0 ? (attendedCount / totalAttendance) * 100 : 0;

    const notifsDisabled = await getUsersWithNotificationsDisabled(ctx, [
      user._id,
    ]);

    return {
      id: user._id,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      email: user.email || "",
      phone: user.phone || null,
      phoneVerified: user.phoneVerified || false,
      profilePhoto: getMediaUrl(user.profilePhoto),
      notificationsDisabled: notifsDisabled.has(user._id),
      dateOfBirth: user.dateOfBirth || null,
      lastLogin: communityMembership.lastLogin || null,
      communityMembership: {
        roles: communityMembership.roles || 0,
        isAdmin: (communityMembership.roles ?? 0) >= ADMIN_ROLE_THRESHOLD,
        isPrimaryAdmin: communityMembership.roles === COMMUNITY_ROLES.PRIMARY_ADMIN,
        status: communityMembership.status || 0,
        joinedAt: communityMembership.createdAt || null,
        anniversary: communityMembership.communityAnniversary || null,
      },
      activeGroups: await Promise.all(
        activeGroups.map(async (m) => {
          const group = groups.find((g) => g._id === m.groupId);
          const groupType = group?.groupTypeId ? await ctx.db.get(group.groupTypeId) : null;
          return {
            groupId: m.groupId,
            groupName: group?.name || "",
            groupTypeId: groupType?._id || null,
            groupTypeName: groupType?.name || "",
            groupTypeSlug: groupType?.slug || "",
            role: m.role,
            joinedAt: m.joinedAt,
            notificationsEnabled: m.notificationsEnabled,
          };
        })
      ),
      recentAttendance: recentAttendance.map((a) => ({
        id: a._id,
        meetingId: a.meeting._id,
        meetingTitle: a.meeting.title,
        meetingScheduledAt: a.meeting.scheduledAt,
        meetingStatus: a.meeting.status,
        groupId: a.meeting.group.id,
        groupName: a.meeting.group.name,
        status: a.status,
        recordedAt: a.recordedAt,
      })),
      attendance: {
        total: totalAttendance,
        attended: attendedCount,
        rate: Math.round(attendanceRate * 100) / 100,
      },
    };
  },
});

/**
 * Update a community member's admin role
 */
export const updateMemberRole = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    targetUserId: v.id("users"),
    role: v.number(),
  },
  handler: async (ctx, args) => {
    const adminUserId = await requireAuth(ctx, args.token);

    // Get target user's current role
    const targetMembership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", args.targetUserId).eq("communityId", args.communityId)
      )
      .first();

    if (!targetMembership || targetMembership.status !== 1) {
      throw new Error("User not found in community");
    }

    const currentRole = targetMembership.roles ?? COMMUNITY_ROLES.MEMBER;
    const newRole = args.role;

    // Check if this involves admin-level changes
    const isPromotingToAdmin = newRole >= ADMIN_ROLE_THRESHOLD && currentRole < ADMIN_ROLE_THRESHOLD;
    const isDemotingFromAdmin = newRole < ADMIN_ROLE_THRESHOLD && currentRole >= ADMIN_ROLE_THRESHOLD;
    const involvesAdminChange = isPromotingToAdmin || isDemotingFromAdmin;

    // Primary Admin cannot be modified through this endpoint
    if (currentRole === COMMUNITY_ROLES.PRIMARY_ADMIN) {
      throw new Error("Cannot modify Primary Admin role. Use transfer instead.");
    }

    // Only Primary Admin can promote/demote admins
    if (involvesAdminChange) {
      await requirePrimaryAdmin(ctx, args.communityId, adminUserId);
    } else {
      await requireCommunityAdmin(ctx, args.communityId, adminUserId);
    }

    // Prevent Primary Admin from demoting themselves
    if (adminUserId === args.targetUserId && isDemotingFromAdmin) {
      const callerMembership = await ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", adminUserId).eq("communityId", args.communityId)
        )
        .first();

      if (callerMembership?.roles === COMMUNITY_ROLES.PRIMARY_ADMIN) {
        throw new Error("Primary Admin cannot demote themselves. Transfer Primary Admin role first.");
      }
    }

    await ctx.db.patch(targetMembership._id, {
      roles: newRole,
      updatedAt: now(),
    });

    // Sync announcement group membership if admin status changed (transactional)
    if (isPromotingToAdmin || isDemotingFromAdmin) {
      await syncAnnouncementGroupMembership(ctx, args.targetUserId, args.communityId);
    }

    return { success: true };
  },
});

/**
 * Transfer Primary Admin role to another community member
 */
export const transferPrimaryAdmin = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    targetUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const currentAdminUserId = await requireAuth(ctx, args.token);

    // Require current user to be Primary Admin
    await requirePrimaryAdmin(ctx, args.communityId, currentAdminUserId);

    // Cannot transfer to yourself
    if (currentAdminUserId === args.targetUserId) {
      throw new Error("Cannot transfer Primary Admin to yourself");
    }

    // Verify target is a community member
    const targetMembership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", args.targetUserId).eq("communityId", args.communityId)
      )
      .first();

    if (!targetMembership || targetMembership.status !== 1) {
      throw new Error("Target user is not a community member");
    }

    // Get current admin's membership
    const currentAdminMembership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", currentAdminUserId).eq("communityId", args.communityId)
      )
      .first();

    if (!currentAdminMembership) {
      throw new Error("Current admin membership not found");
    }

    const timestamp = now();
    const targetWasAdmin = (targetMembership.roles ?? 0) >= ADMIN_ROLE_THRESHOLD;

    // Demote current Primary Admin to regular Admin
    await ctx.db.patch(currentAdminMembership._id, {
      roles: COMMUNITY_ROLES.ADMIN,
      updatedAt: timestamp,
    });

    // Promote target to Primary Admin
    await ctx.db.patch(targetMembership._id, {
      roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
      updatedAt: timestamp,
    });

    // Sync announcement group if target was not previously an admin (transactional)
    // (they need to become a leader in the announcement group)
    if (!targetWasAdmin) {
      await syncAnnouncementGroupMembership(ctx, args.targetUserId, args.communityId);
    }

    return { success: true };
  },
});

// ============================================================================
// User Group History
// ============================================================================

/**
 * Get user's complete group membership history
 */
export const getUserGroupHistory = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    targetUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    // Get all groups in community (including archived)
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    const groupIds = new Set(groups.map((g) => g._id));

    // Get all memberships for user
    const allMemberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.targetUserId))
      .collect();

    // Filter to community groups
    const memberships = allMemberships.filter((m) => groupIds.has(m.groupId));

    // Sort by requestedAt desc, joinedAt desc
    memberships.sort((a, b) => {
      const aTime = a.requestedAt || a.joinedAt || 0;
      const bTime = b.requestedAt || b.joinedAt || 0;
      return bTime - aTime;
    });

    return Promise.all(
      memberships.map(async (m) => {
        const group = groups.find((g) => g._id === m.groupId);
        const groupType = group?.groupTypeId ? await ctx.db.get(group.groupTypeId) : null;
        const reviewer = m.requestReviewedById ? await ctx.db.get(m.requestReviewedById) : null;

        return {
          id: m._id,
          groupId: m.groupId,
          groupName: group?.name || "",
          groupTypeId: groupType?._id || null,
          groupTypeName: groupType?.name || "",
          groupTypeSlug: groupType?.slug || "",
          role: m.role,
          joinedAt: m.joinedAt,
          leftAt: m.leftAt || null,
          requestStatus: m.requestStatus || null,
          requestedAt: m.requestedAt || null,
          requestReviewedAt: m.requestReviewedAt || null,
          requestReviewedBy: reviewer
            ? {
                id: reviewer._id,
                firstName: reviewer.firstName || "",
                lastName: reviewer.lastName || "",
              }
            : null,
          isArchived: group?.isArchived || false,
          groupArchivedAt: group?.archivedAt || null,
          notificationsEnabled: m.notificationsEnabled,
        };
      })
    );
  },
});
