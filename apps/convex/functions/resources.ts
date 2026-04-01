/**
 * Resources functions
 *
 * Functions for community resources, settings, and discovery.
 * Handles community configuration and public search endpoints.
 */

import { v } from "convex/values";
import { query } from "../_generated/server";
import { normalizePagination, getMediaUrl } from "../lib/utils";
import { paginationArgs } from "../lib/validators";

// ============================================================================
// Community Settings
// ============================================================================

/**
 * Get community settings
 *
 * Returns settings and configuration for a community including
 * enabled group types and feature flags.
 */
export const communitySettings = query({
  args: {
    communityId: v.id("communities"),
  },
  handler: async (ctx, args): Promise<{
    id: string;
    legacyId: number | null;
    name: string;
    subdomain: string | null;
    logo: string | null;
    primaryColor: string | null;
    secondaryColor: string | null;
    timezone: string | null;
    enabledGroupTypes: Array<{
      id: string;
      legacyId: string | undefined;
      name: string;
      slug: string;
      icon: string | null;
      isActive: boolean;
    }>;
    settings: {
      allowDinnerParties: boolean;
      allowTeams: boolean;
      allowTables: boolean;
    };
  }> => {
    const community = await ctx.db.get(args.communityId);

    if (!community) {
      throw new Error("Community not found");
    }

    // Get group types for this community
    const groupTypes = await ctx.db
      .query("groupTypes")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    return {
      id: community._id,
      legacyId: community.legacyId ? Number(community.legacyId) : null,
      name: community.name || "",
      subdomain: community.subdomain || null,
      logo: getMediaUrl(community.logo) ?? null,
      primaryColor: community.primaryColor || null,
      secondaryColor: community.secondaryColor || null,
      timezone: community.timezone || null,
      enabledGroupTypes: groupTypes.map((gt) => ({
        id: gt._id,
        legacyId: gt.legacyId,
        name: gt.name || "",
        slug: gt.slug || "",
        icon: gt.icon || null,
        isActive: gt.isActive,
      })),
      settings: {
        allowDinnerParties: groupTypes.some((gt) => gt.slug === "dinner_parties"),
        allowTeams: groupTypes.some((gt) => gt.slug === "teams"),
        allowTables: groupTypes.some((gt) => gt.slug === "tables"),
      },
    };
  },
});

// ============================================================================
// Community Search (Public Endpoints)
// ============================================================================

/**
 * Search for a community by subdomain
 *
 * Returns community details if found by subdomain (e.g., "fount" -> fount.<baseDomain>)
 * Public endpoint used during sign-up flow.
 */
export const communitySearchBySubdomain = query({
  args: {
    subdomain: v.string(),
  },
  handler: async (ctx, args): Promise<{
    id: string;
    legacyId: number | null;
    name: string;
    subdomain: string | null;
    logo: string | null;
  }> => {
    if (!args.subdomain || args.subdomain.length === 0) {
      throw new Error("Subdomain is required");
    }

    const community = await ctx.db
      .query("communities")
      .withIndex("by_subdomain", (q) =>
        q.eq("subdomain", args.subdomain.toLowerCase())
      )
      .first();

    if (!community) {
      throw new Error("Community not found");
    }

    return {
      id: community._id,
      legacyId: community.legacyId ? Number(community.legacyId) : null,
      name: community.name || "",
      subdomain: community.subdomain || null,
      logo: getMediaUrl(community.logo) ?? null,
    };
  },
});

/**
 * Get locations for a community
 *
 * NOTE: LocationCategory model was deleted from Django backend.
 * This endpoint returns an empty array for backwards compatibility.
 * Mobile app should be updated to remove location selection from sign-up flow.
 */
export const getCommunityLocations = query({
  args: {
    communityId: v.id("communities"),
  },
  handler: async (_ctx, _args): Promise<never[]> => {
    // LocationCategory model deleted - return empty array
    return [];
  },
});

/**
 * Search for communities by name or subdomain
 *
 * Public endpoint used during sign-up flow for community discovery.
 * Searches both name and subdomain fields (case-insensitive).
 */
export const communitySearch = query({
  args: {
    query: v.string(),
    ...paginationArgs,
  },
  handler: async (ctx, args): Promise<{
    data: Array<{
      id: string;
      legacyId: number | null;
      name: string;
      subdomain: string;
      logo: string | null;
      city: string | null;
      state: string | null;
    }>;
  }> => {
    if (!args.query || args.query.length === 0) {
      throw new Error("Search query is required");
    }

    const { limit } = normalizePagination(args);
    const searchQuery = args.query.toLowerCase();

    // Get communities with a reasonable limit for in-memory filtering
    // Note: For large datasets, consider using a search index
    // Convex supports full-text search: https://docs.convex.dev/search
    const allCommunities = await ctx.db
      .query("communities")
      .take(200); // Reduced limit - most apps have fewer than 200 communities

    const matchingCommunities = allCommunities.filter((c) => {
      const nameMatch = c.name?.toLowerCase().includes(searchQuery);
      const subdomainMatch = c.subdomain?.toLowerCase().includes(searchQuery);
      return nameMatch || subdomainMatch;
    });

    // Take only the requested limit
    const communities = matchingCommunities.slice(0, limit);

    return {
      data: communities.map((c) => ({
        id: c._id,
        legacyId: c.legacyId ? Number(c.legacyId) : null,
        name: c.name || "",
        subdomain: c.subdomain || "",
        logo: getMediaUrl(c.logo) ?? null,
        city: c.city || null,
        state: c.state || null,
      })),
    };
  },
});

// ============================================================================
// Group Types
// ============================================================================

/**
 * Get all group types for a community
 */
export const getGroupTypes = query({
  args: {
    communityId: v.id("communities"),
    activeOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Array<{
    _id: string;
    _creationTime: number;
    legacyId?: string;
    communityId: string;
    name: string;
    slug: string;
    description?: string;
    icon?: string;
    isActive: boolean;
    createdAt: number;
    displayOrder: number;
  }>> => {
    let groupTypesQuery = ctx.db
      .query("groupTypes")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId));

    const groupTypes = await groupTypesQuery.collect();

    // Filter by active status if requested
    const filtered = args.activeOnly
      ? groupTypes.filter((gt) => gt.isActive)
      : groupTypes;

    // Sort by display order
    return filtered.sort((a, b) => a.displayOrder - b.displayOrder);
  },
});

/**
 * Get a single group type by slug
 */
export const getGroupTypeBySlug = query({
  args: {
    communityId: v.id("communities"),
    slug: v.string(),
  },
  handler: async (ctx, args): Promise<{
    _id: string;
    _creationTime: number;
    legacyId?: string;
    communityId: string;
    name: string;
    slug: string;
    description?: string;
    icon?: string;
    isActive: boolean;
    createdAt: number;
    displayOrder: number;
  } | null> => {
    return await ctx.db
      .query("groupTypes")
      .withIndex("by_community_slug", (q) =>
        q.eq("communityId", args.communityId).eq("slug", args.slug)
      )
      .first();
  },
});

// ============================================================================
// Community Stats (Placeholder for future implementation)
// ============================================================================

/**
 * Get basic community stats
 *
 * Returns aggregate statistics for a community dashboard.
 */
export const getCommunityStats = query({
  args: {
    communityId: v.id("communities"),
  },
  handler: async (ctx, args): Promise<{
    totalGroups: number;
    activeGroups: number;
    archivedGroups: number;
    groupTypes: number;
  }> => {
    const community = await ctx.db.get(args.communityId);
    if (!community) {
      throw new Error("Community not found");
    }

    // Get counts with safety limit
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .take(500); // Safety limit to prevent unbounded queries

    const activeGroups = groups.filter((g) => !g.isArchived);

    // Get group types count with safety limit
    const groupTypes = await ctx.db
      .query("groupTypes")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .take(100); // Safety limit

    return {
      totalGroups: groups.length,
      activeGroups: activeGroups.length,
      archivedGroups: groups.length - activeGroups.length,
      groupTypes: groupTypes.length,
      // Note: Member counts would require userCommunities table query
      // TODO: Add member stats when userCommunities is populated
    };
  },
});
