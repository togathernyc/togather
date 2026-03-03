/**
 * Group Search functions
 *
 * Handles group search and type listing:
 * - List group types for a community
 * - Search groups with filters
 * - Public search by location (near me)
 * - Community members search
 */

import { v } from "convex/values";
import { query } from "../_generated/server";
import { normalizePagination, getMediaUrl } from "../lib/utils";
import { paginationArgs } from "../lib/validators";
import { requireAuth } from "../auth";
import { searchCommunityMembersInternal, type MemberSearchResult } from "../lib/memberSearch";

// ============================================================================
// Group Types
// ============================================================================

/**
 * List all group types for a community
 */
export const listTypes = query({
  args: {
    communityId: v.id("communities"),
  },
  handler: async (ctx, args): Promise<Array<{
    id: string;
    legacyId: string | undefined;
    name: string;
    slug: string;
    description: string | undefined;
    icon: string | undefined;
    isActive: boolean;
  }>> => {
    const types = await ctx.db
      .query("groupTypes")
      .withIndex("by_community_active", (q) =>
        q.eq("communityId", args.communityId).eq("isActive", true)
      )
      .collect();

    // Sort by name
    types.sort((a, b) => a.name.localeCompare(b.name));

    return types.map((t) => ({
      id: t._id,
      legacyId: t.legacyId,
      name: t.name,
      slug: t.slug,
      description: t.description,
      icon: t.icon,
      isActive: t.isActive,
    }));
  },
});

/**
 * Public endpoint to list group types for a community by subdomain
 */
export const listTypesBySubdomain = query({
  args: {
    communitySubdomain: v.string(),
  },
  handler: async (ctx, args): Promise<Array<{
    id: string;
    name: string;
    slug: string;
    description: string | undefined;
    icon: string | undefined;
  }>> => {
    // Find community by subdomain
    const community = await ctx.db
      .query("communities")
      .withIndex("by_subdomain", (q) =>
        q.eq("subdomain", args.communitySubdomain.toLowerCase())
      )
      .first();

    if (!community) {
      throw new Error("Community not found");
    }

    const types = await ctx.db
      .query("groupTypes")
      .withIndex("by_community_active", (q) =>
        q.eq("communityId", community._id).eq("isActive", true)
      )
      .collect();

    // Sort by display order
    types.sort((a, b) => a.displayOrder - b.displayOrder);

    return types.map((t) => ({
      id: t._id,
      name: t.name,
      slug: t.slug,
      description: t.description,
      icon: t.icon,
    }));
  },
});

// ============================================================================
// Group Search
// ============================================================================

/**
 * Search groups with optional filters
 */
export const searchGroups = query({
  args: {
    communityId: v.id("communities"),
    query: v.optional(v.string()),
    groupTypeId: v.optional(v.id("groupTypes")),
    ...paginationArgs,
  },
  handler: async (ctx, args): Promise<Array<{
    id: string;
    name: string;
    description: string | undefined;
    groupTypeId: string;
    groupTypeName: string | undefined;
    groupTypeSlug: string | undefined;
    memberCount: number;
    preview: string | undefined;
    isOnBreak: boolean;
    breakUntil: number | undefined;
    createdAt: number;
    addressLine1: string | undefined;
    addressLine2: string | undefined;
    city: string | undefined;
    state: string | undefined;
    zipCode: string | undefined;
    defaultMeetingType: number | undefined;
  }>> => {
    const { limit } = normalizePagination(args);
    const searchTerm = args.query?.toLowerCase();

    // Get groups for this community with safety limit
    let groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .take(200);

    // Filter by search query
    if (searchTerm) {
      groups = groups.filter((g) => {
        const name = (g.name || "").toLowerCase();
        const description = (g.description || "").toLowerCase();
        return name.includes(searchTerm) || description.includes(searchTerm);
      });
    }

    // Filter by group type
    if (args.groupTypeId) {
      groups = groups.filter((g) => g.groupTypeId === args.groupTypeId);
    }

    // Sort by name
    groups.sort((a, b) => a.name.localeCompare(b.name));

    // Apply limit
    groups = groups.slice(0, limit);

    // Pre-fetch all group types for this community (single query instead of N+1)
    const allGroupTypes = await ctx.db
      .query("groupTypes")
      .withIndex("by_community_active", (q) =>
        q.eq("communityId", args.communityId)
      )
      .collect();
    const groupTypeMap = new Map(allGroupTypes.map((gt) => [gt._id, gt]));

    // Batch fetch member counts - get all members for these groups in parallel
    // Use a reasonable limit per group to avoid excessive data transfer
    const memberCountsPromises = groups.map(async (group) => {
      const members = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .take(100); // Cap at 100 for display purposes
      return { groupId: group._id, count: members.length };
    });
    const memberCounts = await Promise.all(memberCountsPromises);
    const memberCountMap = new Map(memberCounts.map((mc) => [mc.groupId, mc.count]));

    // Build results using pre-fetched data
    const groupsWithDetails = groups.map((group) => {
      const groupType = group.groupTypeId
        ? groupTypeMap.get(group.groupTypeId)
        : null;

      return {
        id: group._id,
        name: group.name,
        description: group.description,
        groupTypeId: group.groupTypeId,
        groupTypeName: groupType?.name,
        groupTypeSlug: groupType?.slug,
        memberCount: memberCountMap.get(group._id) ?? 0,
        preview: getMediaUrl(group.preview),
        isOnBreak: group.isOnBreak || false,
        breakUntil: group.breakUntil,
        createdAt: group.createdAt,
        // Address fields
        addressLine1: group.addressLine1,
        addressLine2: group.addressLine2,
        city: group.city,
        state: group.state,
        zipCode: group.zipCode,
        defaultMeetingType: group.defaultMeetingType,
      };
    });

    return groupsWithDetails;
  },
});

/**
 * Search groups with user's membership status
 */
export const searchGroupsWithMembership = query({
  args: {
    communityId: v.id("communities"),
    query: v.optional(v.string()),
    groupTypeId: v.optional(v.id("groupTypes")),
    token: v.string(),
    ...paginationArgs,
  },
  handler: async (ctx, args): Promise<Array<{
    id: string;
    name: string;
    description: string | undefined;
    groupTypeId: string;
    groupTypeName: string | undefined;
    groupTypeSlug: string | undefined;
    memberCount: number;
    preview: string | undefined;
    isOnBreak: boolean;
    breakUntil: number | undefined;
    createdAt: number;
    addressLine1: string | undefined;
    addressLine2: string | undefined;
    city: string | undefined;
    state: string | undefined;
    zipCode: string | undefined;
    defaultMeetingType: number | undefined;
    isMember: boolean;
    hasPendingRequest: boolean;
    userRole: string | null;
  }>> => {
    const userId = await requireAuth(ctx, args.token);
    const { limit } = normalizePagination(args);
    const searchTerm = args.query?.toLowerCase();

    // Get groups for this community with safety limit
    let groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .take(200);

    // Filter by search query
    if (searchTerm) {
      groups = groups.filter((g) => {
        const name = (g.name || "").toLowerCase();
        const description = (g.description || "").toLowerCase();
        return name.includes(searchTerm) || description.includes(searchTerm);
      });
    }

    // Filter by group type
    if (args.groupTypeId) {
      groups = groups.filter((g) => g.groupTypeId === args.groupTypeId);
    }

    // Sort by name
    groups.sort((a, b) => a.name.localeCompare(b.name));

    // Apply limit
    groups = groups.slice(0, limit);

    // Get user's memberships
    const userMemberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const membershipMap = new Map(
      userMemberships.map((m) => [m.groupId, m])
    );

    // Pre-fetch all group types for this community (single query instead of N+1)
    const allGroupTypes = await ctx.db
      .query("groupTypes")
      .withIndex("by_community_active", (q) =>
        q.eq("communityId", args.communityId)
      )
      .collect();
    const groupTypeMap = new Map(allGroupTypes.map((gt) => [gt._id, gt]));

    // Batch fetch member counts - get all members for these groups in parallel
    // Use a reasonable limit per group to avoid excessive data transfer
    const memberCountsPromises = groups.map(async (group) => {
      const members = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .take(100); // Cap at 100 for display purposes
      return { groupId: group._id, count: members.length };
    });
    const memberCounts = await Promise.all(memberCountsPromises);
    const memberCountMap = new Map(memberCounts.map((mc) => [mc.groupId, mc.count]));

    // Build results using pre-fetched data
    const groupsWithDetails = groups.map((group) => {
      const groupType = group.groupTypeId
        ? groupTypeMap.get(group.groupTypeId)
        : null;

      const membership = membershipMap.get(group._id);
      const isMember = !!(membership && !membership.leftAt);
      const hasPendingRequest = membership?.requestStatus === "pending" || false;

      return {
        id: group._id,
        name: group.name,
        description: group.description,
        groupTypeId: group.groupTypeId,
        groupTypeName: groupType?.name,
        groupTypeSlug: groupType?.slug,
        memberCount: memberCountMap.get(group._id) ?? 0,
        preview: getMediaUrl(group.preview),
        isOnBreak: group.isOnBreak || false,
        breakUntil: group.breakUntil,
        createdAt: group.createdAt,
        // Address fields
        addressLine1: group.addressLine1,
        addressLine2: group.addressLine2,
        city: group.city,
        state: group.state,
        zipCode: group.zipCode,
        defaultMeetingType: group.defaultMeetingType,
        // User status
        isMember,
        hasPendingRequest,
        userRole: isMember ? membership?.role : null,
      };
    });

    return groupsWithDetails;
  },
});

// ============================================================================
// Public Search (No Auth Required)
// ============================================================================

/**
 * Calculate distance between two coordinates using Haversine formula
 */
function calculateDistanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3959; // Earth's radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Public search for groups near a location
 * No authentication required - designed for public "find groups near me" pages
 */
export const publicSearchNearLocation = query({
  args: {
    communitySubdomain: v.string(),
    groupTypeSlug: v.optional(v.string()),
    latitude: v.number(),
    longitude: v.number(),
    maxDistanceMiles: v.optional(v.number()),
    ...paginationArgs,
  },
  handler: async (ctx, args): Promise<{
    community: {
      id: string;
      name: string | undefined;
      subdomain: string | undefined;
      logo: string | undefined;
    };
    groups: Array<{
      id: string;
      name: string;
      description: string | undefined;
      preview: string | undefined;
      city: string | undefined;
      state: string | undefined;
      zipCode: string | undefined;
      isOnBreak: boolean;
      breakUntil: number | undefined;
      groupTypeName: string | undefined;
      groupTypeSlug: string | undefined;
      memberCount: number;
      distanceMiles: number;
    }>;
  }> => {
    const maxDistance = args.maxDistanceMiles ?? 50;
    const { limit } = normalizePagination(args);

    // Find community by subdomain
    const community = await ctx.db
      .query("communities")
      .withIndex("by_subdomain", (q) =>
        q.eq("subdomain", args.communitySubdomain.toLowerCase())
      )
      .first();

    if (!community) {
      throw new Error("Community not found");
    }

    // Find group type if specified
    let groupTypeId: string | undefined;
    if (args.groupTypeSlug) {
      const groupType = await ctx.db
        .query("groupTypes")
        .withIndex("by_community_slug", (q) =>
          q.eq("communityId", community._id).eq("slug", args.groupTypeSlug!)
        )
        .first();

      if (!groupType) {
        throw new Error("Group type not found");
      }

      groupTypeId = groupType._id;
    }

    // Get non-archived groups with coordinates (with safety limit)
    let groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", community._id))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .take(200);

    // Filter groups with valid coordinates
    groups = groups.filter(
      (g) =>
        g.coordinates &&
        g.coordinates.latitude !== undefined &&
        g.coordinates.longitude !== undefined
    );

    // Filter by group type if specified
    if (groupTypeId) {
      groups = groups.filter((g) => g.groupTypeId === groupTypeId);
    }

    // Calculate distances and filter by max distance
    const groupsWithDistance = groups
      .map((group) => {
        const distance = calculateDistanceMiles(
          args.latitude,
          args.longitude,
          group.coordinates!.latitude,
          group.coordinates!.longitude
        );
        return { group, distance };
      })
      .filter((g) => g.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance);

    // Apply limit
    const limitedGroups = groupsWithDistance.slice(0, limit);

    // Pre-fetch all group types for this community (single query instead of N+1)
    const allGroupTypes = await ctx.db
      .query("groupTypes")
      .withIndex("by_community_active", (q) =>
        q.eq("communityId", community._id)
      )
      .collect();
    const groupTypeMap = new Map(allGroupTypes.map((gt) => [gt._id, gt]));

    // Batch fetch member counts - get all members for these groups in parallel
    // Use a reasonable limit per group to avoid excessive data transfer
    const memberCountsPromises = limitedGroups.map(async ({ group }) => {
      const members = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .take(100); // Cap at 100 for display purposes
      return { groupId: group._id, count: members.length };
    });
    const memberCounts = await Promise.all(memberCountsPromises);
    const memberCountMap = new Map(memberCounts.map((mc) => [mc.groupId, mc.count]));

    // Build results using pre-fetched data
    const results = limitedGroups.map(({ group, distance }) => {
      const groupType = group.groupTypeId
        ? groupTypeMap.get(group.groupTypeId)
        : null;

      return {
        id: group._id,
        name: group.name,
        description: group.description,
        preview: getMediaUrl(group.preview),
        city: group.city,
        state: group.state,
        zipCode: group.zipCode,
        isOnBreak: group.isOnBreak || false,
        breakUntil: group.breakUntil,
        groupTypeName: groupType?.name,
        groupTypeSlug: groupType?.slug,
        memberCount: memberCountMap.get(group._id) ?? 0,
        distanceMiles: Math.round(distance * 10) / 10,
      };
    });

    return {
      community: {
        id: community._id,
        name: community.name,
        subdomain: community.subdomain,
        logo: getMediaUrl(community.logo),
      },
      groups: results,
    };
  },
});

/**
 * Public endpoint to get group details by ID
 * No authentication required - returns limited public info
 */
export const publicGroupDetail = query({
  args: {
    groupId: v.id("groups"),
    communitySubdomain: v.string(),
  },
  handler: async (ctx, args): Promise<{
    id: string;
    name: string;
    description: string | undefined;
    preview: string | undefined;
    city: string | undefined;
    state: string | undefined;
    zipCode: string | undefined;
    isOnBreak: boolean;
    breakUntil: number | undefined;
    groupTypeName: string | undefined;
    groupTypeSlug: string | undefined;
    memberCount: number;
    defaultDay: number | undefined;
    defaultStartTime: string | undefined;
    community: {
      id: string;
      name: string | undefined;
      subdomain: string | undefined;
      logo: string | undefined;
    };
  }> => {
    // Find community by subdomain
    const community = await ctx.db
      .query("communities")
      .withIndex("by_subdomain", (q) =>
        q.eq("subdomain", args.communitySubdomain.toLowerCase())
      )
      .first();

    if (!community) {
      throw new Error("Community not found");
    }

    // Find the group
    const group = await ctx.db.get(args.groupId);

    if (!group || group.communityId !== community._id || group.isArchived) {
      throw new Error("Group not found");
    }

    const groupType = group.groupTypeId
      ? await ctx.db.get(group.groupTypeId)
      : null;

    const members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", group._id))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    return {
      id: group._id,
      name: group.name,
      description: group.description,
      preview: getMediaUrl(group.preview),
      city: group.city,
      state: group.state,
      zipCode: group.zipCode,
      isOnBreak: group.isOnBreak || false,
      breakUntil: group.breakUntil,
      groupTypeName: groupType?.name,
      groupTypeSlug: groupType?.slug,
      memberCount: members.length,
      defaultDay: group.defaultDay,
      defaultStartTime: group.defaultStartTime,
      community: {
        id: community._id,
        name: community.name,
        subdomain: community.subdomain,
        logo: getMediaUrl(community.logo),
      },
    };
  },
});

// ============================================================================
// Community Members Search
// ============================================================================

/**
 * Search community members (for adding to groups, proposing leaders, etc.)
 * Available to all authenticated community members
 *
 * Supports:
 * - Comma-separated search terms: "john, jane, 555-1234"
 * - Phone number normalization: "(555) 123-4567" matches "5551234567"
 * - Full-text search on name, email
 * - Rich results with email, phone, groupsCount
 */
export const searchCommunityMembers = query({
  args: {
    communityId: v.id("communities"),
    search: v.string(),
    excludeUserIds: v.optional(v.array(v.id("users"))),
    token: v.string(),
    /** If true, includes the current user in results (default: false, excludes current user) */
    includeSelf: v.optional(v.boolean()),
    ...paginationArgs,
  },
  handler: async (ctx, args): Promise<MemberSearchResult[]> => {
    const userId = await requireAuth(ctx, args.token);

    if (!args.search.trim()) {
      return [];
    }

    // Use the shared search helper
    // Only exclude current user if includeSelf is not explicitly true
    const excludeUserIds = args.includeSelf
      ? (args.excludeUserIds || [])
      : [...(args.excludeUserIds || []), userId];

    return searchCommunityMembersInternal(ctx, {
      communityId: args.communityId,
      search: args.search,
      excludeUserIds,
      limit: Math.min(args.limit ?? 20, 50),
    });
  },
});

/**
 * Public endpoint for link preview metadata
 * Returns community info and optional group type info for OG tags
 */
export const publicLinkPreview = query({
  args: {
    communitySubdomain: v.string(),
    groupTypeSlug: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    community: {
      id: string;
      name: string | undefined;
      subdomain: string | undefined;
      logo: string | undefined;
    };
    groupType: {
      id: string;
      name: string;
      slug: string;
      description: string | undefined;
    } | null;
  }> => {
    const community = await ctx.db
      .query("communities")
      .withIndex("by_subdomain", (q) =>
        q.eq("subdomain", args.communitySubdomain.toLowerCase())
      )
      .first();

    if (!community) {
      throw new Error("Community not found");
    }

    let groupType = null;
    if (args.groupTypeSlug) {
      groupType = await ctx.db
        .query("groupTypes")
        .withIndex("by_community_slug", (q) =>
          q.eq("communityId", community._id).eq("slug", args.groupTypeSlug!)
        )
        .first();
    }

    return {
      community: {
        id: community._id,
        name: community.name,
        subdomain: community.subdomain,
        logo: getMediaUrl(community.logo),
      },
      groupType: groupType
        ? {
            id: groupType._id,
            name: groupType.name,
            slug: groupType.slug,
            description: groupType.description,
          }
        : null,
    };
  },
});
