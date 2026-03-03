/**
 * Group queries
 *
 * Read operations for groups (list, get, search, etc.)
 */

import { v } from "convex/values";
import { query, internalQuery } from "../../_generated/server";
import { Id } from "../../_generated/dataModel";
import { normalizePagination, getMediaUrl } from "../../lib/utils";
import { paginationArgs } from "../../lib/validators";
import { requireAuth, getOptionalAuth } from "../../lib/auth";
import { isCommunityAdmin } from "../../lib/permissions";

/**
 * Get group by ID
 * Optionally includes user's role and request status when token is provided
 *
 * SECURITY: Sensitive fields (address, externalChatLink) are only returned
 * for group members or community admins to prevent data leakage.
 */
export const getById = query({
  args: {
    groupId: v.id("groups"),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    if (!group) return null;

    // Get user ID and check membership/admin status early
    const userId = await getOptionalAuth(ctx, args.token);

    // Check if user is a community admin
    const isCommAdmin = userId
      ? await isCommunityAdmin(ctx, group.communityId, userId)
      : false;

    // Archived groups are hidden from non-admins and anonymous users.
    // Community admins can still access archived groups for management.
    if (group.isArchived) {
      if (!userId) return null;
      if (!isCommAdmin) return null;
    }

    // Get user-specific data if authenticated
    let userRole: string | undefined;
    let userRequestStatus: string | undefined;
    let isActiveMember = false;

    if (userId) {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", args.groupId).eq("userId", userId)
        )
        .first();

      if (membership) {
        // Handle different membership states:
        // 1. Pending request: return pending status for UI
        // 2. Active member: leftAt is NOT set, approved or no request needed
        // 3. User has left: leftAt is set, not pending - don't return role or status
        if (membership.requestStatus === "pending") {
          // Pending request - show "Request Submitted" UI but don't grant access
          userRequestStatus = "pending";
        } else if (!membership.leftAt) {
          // User hasn't left - check if they're an active member
          if (
            !membership.requestStatus ||
            membership.requestStatus === "accepted"
          ) {
            // Active member (public group or approved private group)
            userRole = membership.role;
            isActiveMember = true;
          }
          // Return request status for active/declined users
          userRequestStatus = membership.requestStatus;
        }
        // If leftAt is set and not pending, user has left - don't set role or status
      }
    }

    // Get group type name
    const groupType = group.groupTypeId
      ? await ctx.db.get(group.groupTypeId)
      : null;

    // SECURITY: Only include sensitive fields for members or community admins
    const canSeeSensitiveData = isActiveMember || isCommAdmin;

    // Build base response without sensitive fields
    const baseResponse = {
      _id: group._id,
      _creationTime: group._creationTime,
      communityId: group.communityId,
      groupTypeId: group.groupTypeId,
      legacyId: group.legacyId,
      shortId: group.shortId, // For shareable links
      name: group.name,
      description: group.description,
      preview: getMediaUrl(group.preview),
      isPublic: group.isPublic,
      isArchived: group.isArchived,
      archivedAt: group.archivedAt,
      isOnBreak: group.isOnBreak,
      breakUntil: group.breakUntil,
      isAnnouncementGroup: group.isAnnouncementGroup,
      defaultDay: group.defaultDay,
      defaultStartTime: group.defaultStartTime,
      defaultEndTime: group.defaultEndTime,
      defaultMeetingType: group.defaultMeetingType,
      defaultMeetingLink: group.defaultMeetingLink,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      userRole,
      userRequestStatus,
      groupTypeName: groupType?.name,
      groupTypeSlug: groupType?.slug,
    };

    // Add sensitive fields only for authorized users
    if (canSeeSensitiveData) {
      return {
        ...baseResponse,
        addressLine1: group.addressLine1,
        addressLine2: group.addressLine2,
        city: group.city,
        state: group.state,
        zipCode: group.zipCode,
        externalChatLink: group.externalChatLink,
        leaderToolbarTools: group.leaderToolbarTools,
        showToolbarToMembers: group.showToolbarToMembers,
        toolVisibility: group.toolVisibility,
        toolDisplayNames: group.toolDisplayNames,
        runSheetConfig: group.runSheetConfig,
        followupScoreConfig: group.followupScoreConfig,
      };
    }

    return baseResponse;
  },
});

/**
 * Get group by shortId (for sharing/deep linking)
 * Returns group info needed for previews and join flow
 */
export const getByShortId = query({
  args: { shortId: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const group = await ctx.db
      .query("groups")
      .withIndex("by_shortId", (q) => q.eq("shortId", args.shortId))
      .first();

    if (!group) return null;

    // Get community info
    const community = await ctx.db.get(group.communityId);

    // Check user access
    const userId = await getOptionalAuth(ctx, args.token);
    let hasAccess = false;
    let userRole: string | null = null;
    let userRequestStatus: string | null = null;

    // Check if user is a community admin
    const isCommAdmin = userId
      ? await isCommunityAdmin(ctx, group.communityId, userId)
      : false;

    // Archived groups are hidden from non-admins
    if (group.isArchived && !isCommAdmin) {
      return null;
    }

    // Public groups are accessible to everyone
    if (group.isPublic) {
      hasAccess = true;
    }

    // Check if user is in the community or group
    if (userId) {
      // Check community membership
      const communityMembership = await ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", userId).eq("communityId", group.communityId)
        )
        .first();

      if (communityMembership && communityMembership.status === 1) {
        hasAccess = true;
      }

      // Check group membership
      const groupMembership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", group._id).eq("userId", userId)
        )
        .first();

      if (groupMembership) {
        if (groupMembership.requestStatus === "pending") {
          userRequestStatus = "pending";
        } else if (!groupMembership.leftAt) {
          if (!groupMembership.requestStatus || groupMembership.requestStatus === "accepted") {
            hasAccess = true;
            userRole = groupMembership.role || "member";
          }
          userRequestStatus = groupMembership.requestStatus ?? null;
        }
      }
    }

    // Get group type
    const groupType = group.groupTypeId
      ? await ctx.db.get(group.groupTypeId)
      : null;

    // Get active members (used for both count and preview)
    const activeMembers = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", group._id))
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

    const memberCount = activeMembers.length;

    // Sort leaders first, take top 5
    const sortedMembers = activeMembers.sort((a, b) => {
      const aLeader = a.role === "leader" || a.role === "admin" ? 1 : 0;
      const bLeader = b.role === "leader" || b.role === "admin" ? 1 : 0;
      return bLeader - aLeader;
    });

    const memberPreview = [];
    for (const gm of sortedMembers.slice(0, 5)) {
      const user = await ctx.db.get(gm.userId);
      if (user) {
        memberPreview.push({
          id: String(user._id),
          first_name: user.firstName || "",
          last_name: user.lastName || "",
          profile_photo: getMediaUrl(user.profilePhoto),
          isLeader: gm.role === "leader" || gm.role === "admin",
        });
      }
    }

    // Build access prompt for users without access
    let accessPrompt = null;
    if (!hasAccess) {
      if (!userId) {
        accessPrompt = {
          message: "Sign in to join this group",
          action: "signin",
        };
      } else if (!group.isPublic) {
        accessPrompt = {
          message: "This is a private group. Request to join.",
          action: "request",
        };
      } else {
        accessPrompt = {
          message: "Join this group",
          action: "join",
        };
      }
    }

    return {
      id: group._id,
      shortId: group.shortId,
      name: group.name,
      description: group.description,
      preview: getMediaUrl(group.preview),
      isPublic: group.isPublic,
      isArchived: group.isArchived,
      isOnBreak: group.isOnBreak,
      memberCount,
      memberPreview,
      groupTypeName: groupType?.name,
      groupTypeSlug: groupType?.slug,
      // Community info for preview
      communityId: group.communityId,
      communityName: community?.name,
      communitySubdomain: community?.subdomain,
      communityLogo: getMediaUrl(community?.logo),
      // User access info
      hasAccess,
      userRole,
      userRequestStatus,
      accessPrompt,
      // Location info (only for members/public)
      city: hasAccess ? group.city : null,
      state: hasAccess ? group.state : null,
    };
  },
});

/**
 * Get groups by multiple IDs
 * Returns groups with their type names
 */
export const byIds = query({
  args: { groupIds: v.array(v.id("groups")) },
  handler: async (ctx, args) => {
    if (args.groupIds.length === 0) return [];

    // Limit input size to prevent unbounded queries
    if (args.groupIds.length > 100) {
      throw new Error("Cannot fetch more than 100 groups at once");
    }

    // Batch fetch all groups first
    const groups = await Promise.all(
      args.groupIds.map((groupId) => ctx.db.get(groupId))
    );
    const validGroups = groups.filter(
      (g): g is NonNullable<typeof g> => g !== null
    );

    // Collect unique groupTypeIds and batch fetch them
    const groupTypeIds = [
      ...new Set(
        validGroups
          .map((g) => g.groupTypeId)
          .filter((id): id is NonNullable<typeof id> => id !== undefined)
      ),
    ];
    const groupTypes = await Promise.all(
      groupTypeIds.map((id) => ctx.db.get(id))
    );
    const groupTypeMap = new Map(
      groupTypes
        .filter((gt): gt is NonNullable<typeof gt> => gt !== null)
        .map((gt) => [gt._id, gt])
    );

    return validGroups.map((group) => {
      const groupType = group.groupTypeId
        ? groupTypeMap.get(group.groupTypeId)
        : null;
      return {
        id: group._id,
        name: group.name,
        groupTypeName: groupType?.name,
        preview: getMediaUrl(group.preview),
      };
    });
  },
});

/**
 * List groups in a community
 */
export const listByCommunity = query({
  args: {
    communityId: v.id("communities"),
    includePrivate: v.optional(v.boolean()),
    ...paginationArgs,
  },
  handler: async (ctx, args) => {
    const { limit } = normalizePagination(args);

    let groups;
    if (args.includePrivate) {
      groups = await ctx.db
        .query("groups")
        .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
        .filter((q) => q.eq(q.field("isArchived"), false))
        .take(limit);
    } else {
      groups = await ctx.db
        .query("groups")
        .withIndex("by_community_public", (q) =>
          q.eq("communityId", args.communityId).eq("isPublic", true)
        )
        .filter((q) => q.eq(q.field("isArchived"), false))
        .take(limit);
    }

    return groups;
  },
});

/**
 * List groups for the authenticated user
 * Returns groups with Stream channel IDs for inbox display
 */
export const listForUser = query({
  args: {
    token: v.optional(v.string()),
    communityId: v.optional(v.id("communities")),
    ...paginationArgs,
  },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuth(ctx, args.token);
    if (!userId) return [];

    const { limit } = normalizePagination(args);

    // NOTE: We collect ALL memberships first (without pagination limit) because
    // the limit needs to be applied AFTER filtering by communityId.
    // Otherwise, if a user has many memberships across communities, the first N
    // memberships might all be from a different community, causing the inbox
    // to show empty even though they have groups in the current community.
    const allMemberships = await ctx.db
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

    if (allMemberships.length === 0) {
      return [];
    }

    // Batch fetch all groups first
    const groupIds = allMemberships.map((m) => m.groupId);
    const allGroups = await Promise.all(groupIds.map((id) => ctx.db.get(id)));
    const groupMap = new Map(
      allGroups
        .filter((g): g is NonNullable<typeof g> => g !== null)
        .map((g) => [g._id, g])
    );

    // Filter groups by community if specified and collect IDs we need
    const validGroups = allMemberships
      .map((m) => groupMap.get(m.groupId))
      .filter((g): g is NonNullable<typeof g> => {
        if (!g) return false;
        // Archived groups should not appear in user inbox/group lists.
        if (g.isArchived) return false;
        if (args.communityId && g.communityId !== args.communityId) return false;
        return true;
      });

    // Collect unique groupTypeIds
    const groupTypeIds = [
      ...new Set(
        validGroups
          .map((g) => g.groupTypeId)
          .filter((id): id is NonNullable<typeof id> => id !== undefined)
      ),
    ];

    // Batch fetch groupTypes
    const groupTypes = await Promise.all(
      groupTypeIds.map((id) => ctx.db.get(id))
    );

    const groupTypeMap = new Map(
      groupTypes
        .filter((gt): gt is NonNullable<typeof gt> => gt !== null)
        .map((gt) => [gt._id, gt])
    );

    // Build the result using the maps for O(1) lookup
    // Apply pagination limit AFTER filtering by community
    const result = allMemberships
      .map((membership) => {
        const group = groupMap.get(membership.groupId);
        if (!group) return null;

        // Archived groups should not appear in user inbox/group lists.
        if (group.isArchived) {
          return null;
        }

        // Filter by community if specified
        if (args.communityId && group.communityId !== args.communityId) {
          return null;
        }

        // Get group type for display
        const groupType = group.groupTypeId
          ? groupTypeMap.get(group.groupTypeId)
          : null;

        return {
          ...group,
          preview: getMediaUrl(group.preview),
          userRole: membership.role, // Used by frontend for leader badge
          joinedAt: membership.joinedAt,
          // Group type info for display
          groupType: groupType
            ? {
                _id: groupType._id,
                name: groupType.name,
                slug: groupType.slug,
                legacyId: groupType.legacyId,
              }
            : null,
        };
      })
      .filter(Boolean);

    // Apply pagination limit to the filtered results
    return result.slice(0, limit);
  },
});

/**
 * Search groups by name
 */
export const search = query({
  args: {
    communityId: v.id("communities"),
    searchTerm: v.string(),
    ...paginationArgs,
  },
  handler: async (ctx, args) => {
    const { limit } = normalizePagination(args);

    const groups = await ctx.db
      .query("groups")
      .withSearchIndex("search_name", (q) =>
        q.search("name", args.searchTerm).eq("communityId", args.communityId)
      )
      .filter((q) => q.eq(q.field("isArchived"), false))
      .take(limit);

    return groups;
  },
});

/**
 * List archived groups in a community (admin-only).
 * Used by Settings -> Quick Links -> Archived Groups.
 */
export const listArchivedByCommunity = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    ...paginationArgs,
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const isCommAdmin = await isCommunityAdmin(ctx, args.communityId, userId);
    if (!isCommAdmin) {
      throw new Error("Community admin role required");
    }

    const { limit } = normalizePagination(args);

    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("isArchived"), true))
      .take(limit);

    if (groups.length === 0) return [];

    const groupTypeIds = [
      ...new Set(
        groups
          .map((g) => g.groupTypeId)
          .filter((id): id is NonNullable<typeof id> => id !== undefined)
      ),
    ];
    const groupTypes = await Promise.all(groupTypeIds.map((id) => ctx.db.get(id)));
    const groupTypeMap = new Map(
      groupTypes
        .filter((gt): gt is NonNullable<typeof gt> => gt !== null)
        .map((gt) => [gt._id, gt])
    );

    // Sort archived groups by most recently updated first for easier management.
    const sorted = [...groups].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

    return sorted.map((group) => {
      const groupType = groupTypeMap.get(group.groupTypeId);
      return {
        ...group,
        preview: getMediaUrl(group.preview),
        groupTypeName: groupType?.name,
        groupTypeSlug: groupType?.slug,
      };
    });
  },
});

/**
 * Get group by ID with user's role (for leader checks)
 */
export const getByIdWithRole = query({
  args: {
    token: v.optional(v.string()),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    if (!group) return null;

    const userId = await getOptionalAuth(ctx, args.token);
    let userRole: string | undefined;

    if (userId) {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", args.groupId).eq("userId", userId)
        )
        .first();

      if (membership && !membership.leftAt) {
        userRole = membership.role;
      }
    }

    // Get group type name
    const groupType = group.groupTypeId
      ? await ctx.db.get(group.groupTypeId)
      : null;

    // Get community for timezone
    const community = await ctx.db.get(group.communityId);

    return {
      ...group,
      userRole,
      groupTypeName: groupType?.name,
      community: community
        ? { timezone: community.timezone }
        : undefined,
    };
  },
});

/**
 * Public query to get group by legacy ID.
 * Used by mobile app when route params contain legacy UUIDs.
 */
export const getByLegacyIdPublic = query({
  args: {
    token: v.optional(v.string()),
    legacyId: v.string(),
  },
  handler: async (ctx, args) => {
    const group = await ctx.db
      .query("groups")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.legacyId))
      .first();

    if (!group) return null;

    // Get group type for display name
    const groupType = group.groupTypeId
      ? await ctx.db.get(group.groupTypeId)
      : null;

    // Check user's role if authenticated
    const userId = await getOptionalAuth(ctx, args.token);
    let userRole: string | undefined;

    if (userId) {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", group._id).eq("userId", userId)
        )
        .first();

      if (membership && !membership.leftAt) {
        userRole = membership.role;
      }
    }

    return {
      id: group.legacyId,
      _id: group._id,
      name: group.name,
      description: group.description,
      preview: getMediaUrl(group.preview),
      groupTypeName: groupType?.name,
      groupTypeId: groupType?.legacyId,
      userRole,
      externalChatLink: group.externalChatLink,
      isAnnouncementGroup: group.isAnnouncementGroup,
    };
  },
});

/**
 * List all groups with legacy IDs for sync script
 * Returns minimal data needed for ID mapping
 */
export const listAllForSync = internalQuery({
  args: {},
  handler: async (ctx) => {
    const groups = await ctx.db.query("groups").collect();
    return groups.map((g) => ({
      _id: g._id,
      legacyId: g.legacyId,
    }));
  },
});
