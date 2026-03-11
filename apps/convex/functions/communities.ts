/**
 * Community functions
 *
 * Functions for managing communities and community memberships.
 */

import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { now, normalizePagination } from "../lib/utils";
import { paginationArgs } from "../lib/validators";
import { requireAuth } from "../lib/auth";
import { parseDate } from "../lib/validation";
import { COMMUNITY_ADMIN_THRESHOLD, PRIMARY_ADMIN_ROLE } from "../lib/permissions";
import { syncUserChannelMembershipsLogic, syncAnnouncementGroupMembership } from "./sync/memberships";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get or create the "announcements" group type for a community.
 * Used when auto-creating announcement groups.
 */
async function getOrCreateAnnouncementGroupType(
  ctx: any,
  communityId: Id<"communities">
): Promise<Id<"groupTypes">> {
  const timestamp = now();

  // Look for existing "announcements" group type
  const existingType = await ctx.db
    .query("groupTypes")
    .withIndex("by_community_slug", (q: any) =>
      q.eq("communityId", communityId).eq("slug", "announcements")
    )
    .first();

  if (existingType) {
    return existingType._id;
  }

  // Create the announcements group type
  console.log("[getOrCreateAnnouncementGroupType] Creating announcements group type", {
    communityId,
  });

  return await ctx.db.insert("groupTypes", {
    communityId,
    name: "Announcements",
    slug: "announcements",
    description: "Community announcements",
    isActive: true,
    displayOrder: 0,
    createdAt: timestamp,
  });
}

/**
 * Add a user to the announcement group for a community.
 *
 * - If user is a community admin/leader (roles >= 3), they become a group leader
 * - Otherwise, they become a group member
 * - If already a member, updates role if needed (e.g., promoted to admin)
 * - If no announcement group exists, one is created automatically (defensive creation)
 */
async function addUserToAnnouncementGroup(
  ctx: any,
  communityId: Id<"communities">,
  userId: Id<"users">,
  communityRoles: number
): Promise<void> {
  const timestamp = now();

  // Find the announcement group for this community
  let announcementGroup = await ctx.db
    .query("groups")
    .withIndex("by_community", (q: any) => q.eq("communityId", communityId))
    .filter((q: any) => q.eq(q.field("isAnnouncementGroup"), true))
    .first();

  // Defensive creation: auto-create announcement group if missing
  if (!announcementGroup) {
    console.log("[addUserToAnnouncementGroup] No announcement group found, creating one", {
      communityId,
    });

    // Get or create the announcements group type
    const groupTypeId = await getOrCreateAnnouncementGroupType(ctx, communityId);

    // Get community name for the announcement group name
    const community = await ctx.db.get(communityId);
    const communityName = community?.name || "Community";

    // Create the announcement group
    const announcementGroupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: `${communityName} Announcements`,
      description: "Official community announcements",
      isAnnouncementGroup: true,
      isPublic: true,
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    console.log("[addUserToAnnouncementGroup] Created announcement group", {
      communityId,
      announcementGroupId,
    });

    // Fetch the newly created group
    announcementGroup = await ctx.db.get(announcementGroupId);
  }

  // Determine role in announcement group based on community role
  // Community admins (roles >= 3) become leaders, others become members
  const groupRole = communityRoles >= COMMUNITY_ADMIN_THRESHOLD ? "leader" : "member";

  // Check if user is already a member of the announcement group
  const existingMembership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q: any) =>
      q.eq("groupId", announcementGroup._id).eq("userId", userId)
    )
    .first();

  if (existingMembership) {
    // Already a member - check if we need to update their role
    if (existingMembership.leftAt) {
      // Was a member but left - rejoin
      await ctx.db.patch(existingMembership._id, {
        leftAt: undefined,
        role: groupRole,
        joinedAt: timestamp,
      });
      console.log("[addUserToAnnouncementGroup] Rejoined user to announcement group", {
        userId,
        groupId: announcementGroup._id,
        role: groupRole,
      });
      // Sync channel memberships for rejoining user (transactional)
      await syncUserChannelMembershipsLogic(ctx, userId, announcementGroup._id);
    } else if (groupRole === "leader" && existingMembership.role === "member") {
      // Upgrade to leader if they became a community admin
      await ctx.db.patch(existingMembership._id, {
        role: "leader",
      });
      console.log("[addUserToAnnouncementGroup] Upgraded user to leader in announcement group", {
        userId,
        groupId: announcementGroup._id,
      });
      // Sync channel memberships for role upgrade (transactional - gives leaders channel access)
      await syncUserChannelMembershipsLogic(ctx, userId, announcementGroup._id);
    }
    return;
  }

  // Create new membership in announcement group
  await ctx.db.insert("groupMembers", {
    groupId: announcementGroup._id,
    userId,
    role: groupRole,
    joinedAt: timestamp,
    notificationsEnabled: true,
  });

  console.log("[addUserToAnnouncementGroup] Added user to announcement group", {
    userId,
    groupId: announcementGroup._id,
    role: groupRole,
  });

  // Sync channel memberships (transactional - ensures user gets added to channels)
  await syncUserChannelMembershipsLogic(ctx, userId, announcementGroup._id);
}

/**
 * Get community by ID
 */
export const getById = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.communityId);
  },
});

/**
 * Get community by slug
 */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("communities")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
  },
});

/**
 * List public communities
 */
export const listPublic = query({
  args: paginationArgs,
  handler: async (ctx, args) => {
    const { limit } = normalizePagination(args);

    const communities = await ctx.db
      .query("communities")
      .withIndex("by_public", (q) => q.eq("isPublic", true))
      .take(limit + 1);

    const hasMore = communities.length > limit;
    const items = hasMore ? communities.slice(0, limit) : communities;

    return {
      items,
      hasMore,
    };
  },
});

/**
 * Get communities for a user
 */
export const listForUser = query({
  args: {
    token: v.string(),
    ...paginationArgs,
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const { limit } = normalizePagination(args);

    // Only get active memberships (status=1)
    // Status values: 1=Active, 2=Inactive (left), 3=Blocked
    const memberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), 1))
      .take(limit);

    const communities = await Promise.all(
      memberships.map(async (membership) => {
        const community = await ctx.db.get(membership.communityId);
        return community
          ? {
              ...community,
              roles: membership.roles,
              memberStatus: membership.status,
            }
          : null;
      })
    );

    return communities.filter(Boolean);
  },
});

/**
 * Public user fields for member lists (safe to return to community members)
 */
type PublicMemberFields = {
  _id: Id<"users">;
  firstName: string | undefined;
  lastName: string | undefined;
  profilePhoto: string | undefined;
  roles: number | undefined;
  memberStatus: number | undefined;
  createdAt: number | undefined;
};

/**
 * Get community members
 *
 * Security:
 * - Requires authentication
 * - Verifies caller is a member of the community
 * - Returns only public user fields (not phone, email, DOB)
 * - Filters out deactivated users
 */
export const getMembers = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    roles: v.optional(v.number()),
    status: v.optional(v.number()),
    ...paginationArgs,
  },
  handler: async (ctx, args) => {
    // Require authentication
    const userId = await requireAuth(ctx, args.token);

    // Verify caller is a member of this community
    const callerMembership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", args.communityId)
      )
      .first();

    if (!callerMembership || callerMembership.status === 3) {
      // Not a member or blocked - return empty array
      return [];
    }

    const { limit } = normalizePagination(args);

    const membersQuery = ctx.db
      .query("userCommunities")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId));

    const memberships = await membersQuery.take(limit);

    // Filter by roles/status if specified
    const filtered = memberships.filter((m) => {
      if (args.roles !== undefined && m.roles !== args.roles) return false;
      if (args.status !== undefined && m.status !== args.status) return false;
      return true;
    });

    // Fetch user details - return only public fields and filter deactivated users
    const members = await Promise.all(
      filtered.map(async (membership): Promise<PublicMemberFields | null> => {
        const user = await ctx.db.get(membership.userId);

        // Filter out null users and deactivated users
        if (!user || user.isActive === false) {
          return null;
        }

        // Return only public fields
        return {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          profilePhoto: user.profilePhoto,
          roles: membership.roles,
          memberStatus: membership.status,
          createdAt: membership.createdAt,
        };
      })
    );

    return members.filter(Boolean);
  },
});

/**
 * Check if user is a member of a community
 */
export const getMembership = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    return await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", args.communityId)
      )
      .first();
  },
});

/**
 * Create a new community
 */
export const create = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    slug: v.string(),
    isPublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const timestamp = now();

    // Create the community
    const communityId = await ctx.db.insert("communities", {
      name: args.name,
      slug: args.slug.toLowerCase(),
      isPublic: args.isPublic ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Add creator as primary admin (role = 4)
    await ctx.db.insert("userCommunities", {
      communityId,
      userId,
      roles: 4, // PRIMARY_ADMIN
      status: 1, // Active
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return communityId;
  },
});

/**
 * Join a community
 */
export const join = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    console.log("[communities.join] Join mutation called", {
      communityId: args.communityId,
    });

    const userId = await requireAuth(ctx, args.token);
    const timestamp = now();

    console.log("[communities.join] Authenticated user", {
      userId,
      communityId: args.communityId,
    });

    // Check if already a member
    const existing = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", args.communityId)
      )
      .first();

    console.log("[communities.join] Existing membership check", {
      found: !!existing,
      status: existing?.status,
      roles: existing?.roles,
    });

    if (existing) {
      // Reactivate if inactive (status !== 1)
      if (existing.status !== 1) {
        console.log("[communities.join] Reactivating member, scheduling Planning Center sync", {
          userId,
          communityId: args.communityId,
          previousStatus: existing.status,
        });

        await ctx.db.patch(existing._id, {
          status: 1, // Active
          updatedAt: timestamp,
        });

        // Schedule Planning Center sync for reactivated member
        await ctx.scheduler.runAfter(0, api.functions.integrations.syncUserToPlanningCenter, {
          communityId: args.communityId,
          userId,
        });

        // Re-add user to announcement group
        await addUserToAnnouncementGroup(ctx, args.communityId, userId, existing.roles ?? 1);
      } else {
        console.log("[communities.join] User already active member, skipping sync", {
          userId,
          communityId: args.communityId,
          status: existing.status,
        });
      }
      return existing._id;
    }

    console.log("[communities.join] Creating new membership, scheduling Planning Center sync", {
      userId,
      communityId: args.communityId,
    });

    // Create new membership
    const membershipId = await ctx.db.insert("userCommunities", {
      communityId: args.communityId,
      userId,
      roles: 1, // MEMBER
      status: 1, // Active
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Schedule Planning Center sync for new member
    await ctx.scheduler.runAfter(0, api.functions.integrations.syncUserToPlanningCenter, {
      communityId: args.communityId,
      userId,
    });

    // Add user to announcement group
    await addUserToAnnouncementGroup(ctx, args.communityId, userId, 1); // roles=1 is MEMBER

    return membershipId;
  },
});

/**
 * Helper: Remove a user from a community
 *
 * This performs a comprehensive cleanup:
 * 1. Deletes the community membership record
 * 2. Deletes user from all groups in this community
 * 3. Deletes all RSVPs for meetings in this community
 * 4. Soft-deletes chatChannelMembers (sets leftAt) via syncUserChannelMembershipsLogic
 * 5. Clears user's activeCommunityId if it matches this community
 *
 * Intentionally preserved for audit purposes:
 * - `meetingAttendances.recordedById` - Historical record of who recorded attendance
 * - `meetingGuests.recordedById` - Historical record of who added the guest
 * - `meetingAttendances.userId` - Attendance records are preserved even after user leaves
 *
 * Used by both the `leave` mutation (user leaves) and `removeMember` mutation (admin removes).
 */
async function removeUserFromCommunity(
  ctx: any,
  userId: Id<"users">,
  communityId: Id<"communities">,
  membershipId: Id<"userCommunities">,
  logPrefix: string = "[communities.removeUserFromCommunity]"
): Promise<void> {
  console.log(`${logPrefix} Starting community removal cleanup`, {
    userId,
    communityId,
  });

  // 1. Delete the community membership record
  await ctx.db.delete(membershipId);

  // 2. Find all groups in this community
  const groupsInCommunity = await ctx.db
    .query("groups")
    .withIndex("by_community", (q: any) => q.eq("communityId", communityId))
    .collect();

  const groupIds = groupsInCommunity.map((g: any) => g._id);
  console.log(`${logPrefix} Found groups in community`, {
    groupCount: groupIds.length,
  });

  // 3. Delete user from all groups in this community
  const userGroupMemberships = await ctx.db
    .query("groupMembers")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .collect();

  const groupMembershipsToRemove = userGroupMemberships.filter((gm: any) =>
    groupIds.includes(gm.groupId)
  );

  console.log(`${logPrefix} Deleting group memberships`, {
    count: groupMembershipsToRemove.length,
  });

  let followupsDeleted = 0;
  let followupScoresDeleted = 0;
  for (const gm of groupMembershipsToRemove) {
    // Clean up follow-up artifacts tied to this membership to prevent zombie rows
    // in the denormalized follow-up table after community removal.
    const followups = await ctx.db
      .query("memberFollowups")
      .withIndex("by_groupMember", (q: any) => q.eq("groupMemberId", gm._id))
      .collect();
    for (const followup of followups) {
      await ctx.db.delete(followup._id);
      followupsDeleted++;
    }

    const scoreDoc = await ctx.db
      .query("memberFollowupScores")
      .withIndex("by_groupMember", (q: any) => q.eq("groupMemberId", gm._id))
      .first();
    if (scoreDoc) {
      await ctx.db.delete(scoreDoc._id);
      followupScoresDeleted++;
    }

    await ctx.db.delete(gm._id);
  }

  console.log(`${logPrefix} Removed follow-up artifacts`, {
    followupsDeleted,
    followupScoresDeleted,
  });

  // 4. Find all meetings in these groups and delete RSVPs
  let rsvpsCancelled = 0;
  for (const groupId of groupIds) {
    const meetings = await ctx.db
      .query("meetings")
      .withIndex("by_group", (q: any) => q.eq("groupId", groupId))
      .collect();

    for (const meeting of meetings) {
      const rsvp = await ctx.db
        .query("meetingRsvps")
        .withIndex("by_meeting_user", (q: any) =>
          q.eq("meetingId", meeting._id).eq("userId", userId)
        )
        .first();

      if (rsvp) {
        await ctx.db.delete(rsvp._id);
        rsvpsCancelled++;
      }
    }
  }

  console.log(`${logPrefix} Cancelled RSVPs`, {
    count: rsvpsCancelled,
  });

  // 5. Sync Convex-native channel memberships for each group (transactional)
  // This soft-deletes chatChannelMembers by setting leftAt (preserves displayName/profilePhoto for historical messages)
  // The sync logic checks groupMembers, finds user is no longer a member, and sets leftAt on their channel memberships
  for (const groupId of groupIds) {
    await syncUserChannelMembershipsLogic(ctx, userId, groupId);
  }

  console.log(`${logPrefix} Cleanup complete, soft-deleted channel memberships for ${groupIds.length} groups`);

  // 6. Clear user's activeCommunityId if it matches this community
  const user = await ctx.db.get(userId);
  if (user && user.activeCommunityId === communityId) {
    await ctx.db.patch(userId, {
      activeCommunityId: undefined,
      updatedAt: now(),
    });
    console.log(`${logPrefix} Cleared user's activeCommunityId`, { userId, communityId });
  }
}

/**
 * Leave a community
 *
 * Allows the current user to leave a community. Primary admins cannot leave.
 */
export const leave = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const membership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", args.communityId)
      )
      .first();

    if (!membership) {
      throw new Error("Not a member of this community");
    }

    // Primary Admin cannot leave - must transfer primary admin first
    if ((membership.roles ?? 0) === PRIMARY_ADMIN_ROLE) {
      throw new Error("Primary Admin cannot leave community. Transfer primary admin role first.");
    }

    await removeUserFromCommunity(ctx, userId, args.communityId, membership._id, "[communities.leave]");

    return true;
  },
});

/**
 * Remove a member from the community (admin only)
 *
 * Allows a community admin to remove another member. Cannot remove the primary admin.
 */
export const removeMember = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    targetUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const adminUserId = await requireAuth(ctx, args.token);

    // Verify the caller is a community admin
    const adminMembership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", adminUserId).eq("communityId", args.communityId)
      )
      .first();

    if (!adminMembership || (adminMembership.roles ?? 0) < COMMUNITY_ADMIN_THRESHOLD || adminMembership.status !== 1) {
      throw new Error("Only active community admins can remove members");
    }

    // Get the target user's membership
    const targetMembership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", args.targetUserId).eq("communityId", args.communityId)
      )
      .first();

    if (!targetMembership) {
      throw new Error("User is not a member of this community");
    }

    // Cannot remove the primary admin
    if ((targetMembership.roles ?? 0) === PRIMARY_ADMIN_ROLE) {
      throw new Error("Cannot remove the primary admin from the community");
    }

    // Regular admins cannot remove other admins - only primary admin can
    const adminRole = adminMembership.roles ?? 0;
    const targetRole = targetMembership.roles ?? 0;
    if (adminRole < PRIMARY_ADMIN_ROLE && targetRole >= COMMUNITY_ADMIN_THRESHOLD) {
      throw new Error("Only the primary admin can remove other admins");
    }

    // Cannot remove yourself (use leave instead)
    if (args.targetUserId === adminUserId) {
      throw new Error("Cannot remove yourself. Use leave community instead.");
    }

    await removeUserFromCommunity(
      ctx,
      args.targetUserId,
      args.communityId,
      targetMembership._id,
      "[communities.removeMember]"
    );

    return true;
  },
});

/**
 * Update member role
 */
export const updateMemberRole = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    targetUserId: v.id("users"),
    roles: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Verify the requesting user is a community admin
    const adminMembership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", args.communityId)
      )
      .first();

    if (
      !adminMembership ||
      (adminMembership.roles ?? 0) < COMMUNITY_ADMIN_THRESHOLD ||
      adminMembership.status !== 1
    ) {
      throw new Error("Community admin role required");
    }

    const membership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", args.targetUserId).eq("communityId", args.communityId)
      )
      .first();

    if (!membership) {
      throw new Error("Not a member of this community");
    }

    const currentTargetRole = membership.roles ?? 0;
    const callerRole = adminMembership.roles ?? 0;

    // Security check 1: Cannot modify Primary Admin role - use transfer instead
    if (currentTargetRole === PRIMARY_ADMIN_ROLE) {
      throw new Error("Cannot modify Primary Admin role. Use transfer instead.");
    }

    // Security check 2: Prevent self-promotion to Primary Admin (even for admins)
    if (userId === args.targetUserId && args.roles === PRIMARY_ADMIN_ROLE) {
      throw new Error("Cannot promote yourself to primary admin");
    }

    // Security check 3: Only Primary Admin can promote someone to Primary Admin
    if (args.roles === PRIMARY_ADMIN_ROLE && callerRole !== PRIMARY_ADMIN_ROLE) {
      throw new Error("Only primary admin can promote to primary admin");
    }

    // Security check 4: Only Primary Admin can promote/demote admin-level users
    // This includes: promoting to ADMIN, demoting from ADMIN, or modifying any ADMIN
    const involvesAdminChange =
      args.roles >= COMMUNITY_ADMIN_THRESHOLD || // Promoting to admin or higher
      currentTargetRole >= COMMUNITY_ADMIN_THRESHOLD; // Target is currently admin or higher

    if (involvesAdminChange && callerRole !== PRIMARY_ADMIN_ROLE) {
      throw new Error("Only primary admin can promote or demote admin-level roles");
    }

    // Check if admin status is changing
    const wasAdmin = currentTargetRole >= COMMUNITY_ADMIN_THRESHOLD;
    const willBeAdmin = args.roles >= COMMUNITY_ADMIN_THRESHOLD;

    await ctx.db.patch(membership._id, {
      roles: args.roles,
      updatedAt: now(),
    });

    // Sync announcement group membership if admin status changed (transactional)
    if (wasAdmin !== willBeAdmin) {
      await syncAnnouncementGroupMembership(ctx, args.targetUserId, args.communityId);
    }

    return true;
  },
});

// ============================================================================
// Internal Queries (for actions to call)
// ============================================================================

/**
 * Internal query to get community by ID.
 * Used by chat actions.
 */
export const getByIdInternal = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.communityId);
  },
});

// ============================================================================
// Migration Functions (for Supabase to Convex sync)
// ============================================================================

/**
 * Upsert a user-community membership from legacy data
 */
export const upsertMemberFromLegacy = internalMutation({
  args: {
    legacyId: v.string(),
    communityId: v.id("communities"),
    userId: v.id("users"),
    roles: v.optional(v.number()),
    status: v.optional(v.number()),
    communityAnniversary: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Check if membership already exists by legacyId
    const existing = await ctx.db
      .query("userCommunities")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.legacyId))
      .first();

    const timestamp = now();
    const data = {
      legacyId: args.legacyId,
      communityId: args.communityId,
      userId: args.userId,
      roles: args.roles ?? 1,
      status: args.status ?? 1,
      communityAnniversary: args.communityAnniversary
        ? parseDate(args.communityAnniversary, "communityAnniversary")
        : undefined,
      createdAt: args.createdAt ?? timestamp,
      updatedAt: args.updatedAt ?? timestamp,
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
      return existing._id;
    }

    return await ctx.db.insert("userCommunities", data);
  },
});

