/**
 * Admin functions for community settings and group types management
 *
 * Includes:
 * - Community settings (get/update)
 * - Group types management (list/create/update)
 * - List all groups in community
 */

import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import { now, getMediaUrl } from "../../lib/utils";
import { requireAuth } from "../../lib/auth";
import { requireCommunityAdmin } from "./auth";

// ============================================================================
// Community Settings
// ============================================================================

/**
 * Get community settings
 */
export const getCommunitySettings = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const community = await ctx.db.get(args.communityId);
    if (!community) {
      throw new Error("Community not found");
    }

    return {
      id: community._id,
      name: community.name,
      logo: getMediaUrl(community.logo),
      subdomain: community.subdomain,
      addressLine1: community.addressLine1,
      addressLine2: community.addressLine2,
      city: community.city,
      state: community.state,
      zipCode: community.zipCode,
      country: community.country,
      primaryColor: community.primaryColor,
      secondaryColor: community.secondaryColor,
      exploreDefaultGroupTypes: community.exploreDefaultGroupTypes,
      exploreDefaultMeetingType: community.exploreDefaultMeetingType || null,
    };
  },
});

/**
 * Update community settings
 */
export const updateCommunitySettings = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    name: v.optional(v.string()),
    subdomain: v.optional(v.string()),
    addressLine1: v.optional(v.string()),
    addressLine2: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    country: v.optional(v.string()),
    primaryColor: v.optional(v.string()),
    secondaryColor: v.optional(v.string()),
    logo: v.optional(v.string()),
    exploreDefaultGroupTypes: v.optional(v.array(v.id("groupTypes"))),
    exploreDefaultMeetingType: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    // Check subdomain uniqueness if being changed
    if (args.subdomain) {
      const existing = await ctx.db
        .query("communities")
        .withIndex("by_subdomain", (q) => q.eq("subdomain", args.subdomain))
        .first();

      if (existing && existing._id !== args.communityId) {
        throw new Error("This subdomain is already in use");
      }
    }

    const { communityId, token: _token, ...updates } = args;

    // Filter out undefined values
    const cleanedUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );

    await ctx.db.patch(args.communityId, {
      ...cleanedUpdates,
      updatedAt: now(),
    });

    return await ctx.db.get(args.communityId);
  },
});

/**
 * Get explore page defaults for any community member (non-admin)
 *
 * Returns the admin-configured default filters for the explore page.
 * Used by the explore page to pre-filter groups for all community members.
 */
export const getExploreDefaults = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.token);

    const community = await ctx.db.get(args.communityId);
    if (!community) {
      throw new Error("Community not found");
    }

    return {
      groupTypes: community.exploreDefaultGroupTypes ?? [],
      meetingType: community.exploreDefaultMeetingType || null,
    };
  },
});

// ============================================================================
// Group Types
// ============================================================================

/**
 * List all group types for the community
 *
 * Optimized to fetch all groups once and count in memory instead of N+1 queries
 */
export const listGroupTypes = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const groupTypes = await ctx.db
      .query("groupTypes")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    // Fetch ALL non-archived groups for this community ONCE
    const allGroups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    // Build group count map by groupTypeId in memory
    const groupCountByType = new Map<typeof groupTypes[0]["_id"], number>();
    for (const group of allGroups) {
      if (group.groupTypeId) {
        groupCountByType.set(
          group.groupTypeId,
          (groupCountByType.get(group.groupTypeId) || 0) + 1
        );
      }
    }

    // Build result with counts from map (O(1) lookups)
    const groupTypesWithCounts = groupTypes.map((gt) => ({
      id: gt._id,
      name: gt.name,
      slug: gt.slug,
      description: gt.description,
      icon: gt.icon,
      isActive: gt.isActive,
      displayOrder: gt.displayOrder,
      groupCount: groupCountByType.get(gt._id) || 0,
    }));

    // Sort by displayOrder, then name
    groupTypesWithCounts.sort((a, b) => {
      if (a.displayOrder !== b.displayOrder) {
        return a.displayOrder - b.displayOrder;
      }
      return a.name.localeCompare(b.name);
    });

    return groupTypesWithCounts;
  },
});

/**
 * Create a new group type
 */
export const createGroupType = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    // Generate slug from name
    let baseSlug = args.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    // Ensure slug is unique within community
    let slug = baseSlug;
    let counter = 1;
    while (true) {
      const existing = await ctx.db
        .query("groupTypes")
        .withIndex("by_community_slug", (q) =>
          q.eq("communityId", args.communityId).eq("slug", slug)
        )
        .first();
      if (!existing) break;
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    // Get max displayOrder
    const existingTypes = await ctx.db
      .query("groupTypes")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    const maxOrder = existingTypes.reduce((max, t) => Math.max(max, t.displayOrder), 0);

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId: args.communityId,
      name: args.name,
      slug,
      description: args.description || "",
      icon: "people",
      isActive: true,
      displayOrder: maxOrder + 1,
      createdAt: now(),
    });

    return {
      id: groupTypeId,
      name: args.name,
      slug,
      description: args.description || "",
      icon: "people",
      isActive: true,
      displayOrder: maxOrder + 1,
      groupCount: 0,
    };
  },
});

/**
 * Update a group type
 */
export const updateGroupType = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    groupTypeId: v.id("groupTypes"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const existing = await ctx.db.get(args.groupTypeId);
    if (!existing || existing.communityId !== args.communityId) {
      throw new Error("Group type not found");
    }

    const updates: any = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description || "";

    await ctx.db.patch(args.groupTypeId, updates);

    const updated = await ctx.db.get(args.groupTypeId);

    // Get group count
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_groupType", (q) => q.eq("groupTypeId", args.groupTypeId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    return {
      id: updated?._id,
      name: updated?.name,
      slug: updated?.slug,
      description: updated?.description,
      icon: updated?.icon,
      isActive: updated?.isActive,
      displayOrder: updated?.displayOrder,
      groupCount: groups.length,
    };
  },
});

// ============================================================================
// Groups (Admin Dashboard)
// ============================================================================

/**
 * List all groups in the community (for admin dashboard)
 *
 * Optimized to pre-fetch groupTypes and batch member count queries
 */
export const listAllGroups = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    // Pre-fetch ALL group types for this community (avoid N+1)
    const groupTypes = await ctx.db
      .query("groupTypes")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    const groupTypeMap = new Map(groupTypes.map((gt) => [gt._id, gt]));

    // Sort: non-archived first, then by createdAt desc
    groups.sort((a, b) => {
      if (a.isArchived !== b.isArchived) {
        return a.isArchived ? 1 : -1;
      }
      return b.createdAt - a.createdAt;
    });

    // Fetch member counts in parallel for all groups
    // Using Promise.all is more efficient than sequential awaits
    const memberCountsPromises = groups.map(async (group) => {
      const members = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .filter((q) =>
          q.and(
            q.eq(q.field("leftAt"), undefined),
            q.or(
              q.eq(q.field("requestStatus"), null),
              q.eq(q.field("requestStatus"), "accepted")
            )
          )
        )
        .collect();
      return members.length;
    });

    const memberCounts = await Promise.all(memberCountsPromises);

    // Build result using pre-fetched data
    return groups.map((group, index) => {
      const groupType = group.groupTypeId ? groupTypeMap.get(group.groupTypeId) : null;
      return {
        id: group._id,
        name: group.name,
        description: group.description,
        groupTypeId: groupType?._id || null,
        groupTypeName: groupType?.name || "",
        groupTypeSlug: groupType?.slug || "",
        isArchived: group.isArchived,
        archivedAt: group.archivedAt || null,
        createdAt: group.createdAt,
        membersCount: memberCounts[index],
        defaultDay: group.defaultDay,
        defaultStartTime: group.defaultStartTime,
        defaultEndTime: group.defaultEndTime,
        city: group.city,
        state: group.state,
        zipCode: group.zipCode,
      };
    });
  },
});
