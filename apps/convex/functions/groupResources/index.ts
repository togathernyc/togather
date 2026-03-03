/**
 * Group Resources Functions
 *
 * Queries and mutations for managing custom resource pages that groups can create.
 * Examples: "Welcome" page for new members, "Resources" with helpful links, etc.
 *
 * Resources can have visibility rules:
 * - "everyone": Visible to all group members
 * - "joined_within": Only visible to members who joined within X days
 * - "channel_members": Only visible to members of specific channels
 */

import { v } from "convex/values";
import { query, mutation, internalMutation } from "../../_generated/server";
import { Id } from "../../_generated/dataModel";
import { now } from "../../lib/utils";
import { requireAuth } from "../../lib/auth";
import { isCommunityAdmin } from "../../lib/permissions";
import { isActiveLeader, isActiveMembership } from "../../lib/helpers";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a user has permission to manage a group's resources.
 * User must be a group leader/admin or a community admin.
 *
 * @returns The group document if user has permission
 * @throws Error if user doesn't have permission
 */
async function requireGroupResourcePermission(
  ctx: { db: any },
  groupId: Id<"groups">,
  userId: Id<"users">,
  action: string
): Promise<{ group: NonNullable<Awaited<ReturnType<typeof ctx.db.get>>> }> {
  const group = await ctx.db.get(groupId);
  if (!group) {
    throw new Error("Group not found");
  }

  // Check if user is a group leader/admin
  const membership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q: any) =>
      q.eq("groupId", groupId).eq("userId", userId)
    )
    .first();

  const isGroupLeaderOrAdmin = isActiveLeader(membership);

  // Check if user is a community admin
  const isCommAdmin = await isCommunityAdmin(ctx, group.communityId, userId);

  if (!isGroupLeaderOrAdmin && !isCommAdmin) {
    throw new Error(`You don't have permission to ${action}`);
  }

  return { group };
}

/**
 * Check if a resource should be visible to a user based on visibility rules.
 */
function isResourceVisibleToUser(
  resource: {
    visibility: {
      type: "everyone" | "joined_within" | "channel_members";
      daysWithin?: number;
      channelIds?: Id<"chatChannels">[];
    };
  },
  membership: { joinedAt: number } | null,
  userChannelIds?: Id<"chatChannels">[]
): boolean {
  if (!membership) return false;

  const { type, daysWithin } = resource.visibility;

  if (type === "everyone") return true;

  if (type === "joined_within" && daysWithin !== undefined) {
    const joinedAt = membership.joinedAt;
    const daysSinceJoined = (Date.now() - joinedAt) / (1000 * 60 * 60 * 24);
    return daysSinceJoined <= daysWithin;
  }

  if (type === "channel_members" && resource.visibility.channelIds?.length) {
    return resource.visibility.channelIds.some(
      (id) => userChannelIds?.includes(id)
    );
  }

  return false;
}

/**
 * Generate a unique ID for sections.
 * Uses timestamp + random characters for uniqueness.
 */
function generateSectionId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const timestamp = Date.now().toString(36).slice(-4);
  let random = "";
  for (let i = 0; i < 8; i++) {
    random += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `sec_${timestamp}${random}`;
}

// ============================================================================
// Queries
// ============================================================================

/**
 * List all resources for a group (for settings/admin view).
 * Returns all resources ordered by `order` field.
 * Requires user to be member of group.
 */
export const listByGroup = query({
  args: {
    groupId: v.id("groups"),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Verify group exists
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new Error("Group not found");
    }

    // Check if user is a member of the group
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .first();

    if (!isActiveMembership(membership)) {
      throw new Error("You must be a member of this group to view resources");
    }

    // Get all resources for the group
    const resources = await ctx.db
      .query("groupResources")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    // Sort by order
    return resources.sort((a, b) => a.order - b.order);
  },
});

/**
 * Get a single resource with all details.
 * Returns full resource including sections.
 * Requires user to be member of the resource's group.
 */
export const getById = query({
  args: {
    resourceId: v.id("groupResources"),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get the resource
    const resource = await ctx.db.get(args.resourceId);
    if (!resource) {
      return null;
    }

    // Check if user is a member of the group
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", resource.groupId).eq("userId", userId)
      )
      .first();

    if (!isActiveMembership(membership)) {
      throw new Error("You must be a member of this group to view this resource");
    }

    return resource;
  },
});

/**
 * Get a single resource publicly (no auth required).
 * Used by tool short link pages to render resource content.
 * Requires a valid shortLinkId to verify access originates from a short link.
 * Returns null if resource not found, group is archived, or short link is invalid.
 */
export const getByIdPublic = query({
  args: {
    resourceId: v.id("groupResources"),
    shortLinkId: v.string(),
  },
  handler: async (ctx, args) => {
    // Verify the short link exists and matches this resource
    const shortLink = await ctx.db
      .query("toolShortLinks")
      .withIndex("by_shortId", (q) => q.eq("shortId", args.shortLinkId))
      .first();

    if (
      !shortLink ||
      shortLink.toolType !== "resource" ||
      shortLink.resourceId?.toString() !== args.resourceId.toString()
    ) {
      return null;
    }

    const resource = await ctx.db.get(args.resourceId);
    if (!resource) return null;

    // Check group is not archived
    const group = await ctx.db.get(resource.groupId);
    if (!group || group.isArchived) return null;

    return resource;
  },
});

/**
 * Get resources visible to current user (for toolbar).
 * Filters based on visibility rules:
 * - "everyone": always visible
 * - "joined_within": check user's membership createdAt against daysWithin
 * - "channel_members": check if user is a member of any required channel
 * Returns filtered list ordered by `order`.
 */
export const getVisibleForUser = query({
  args: {
    groupId: v.id("groups"),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Verify group exists
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new Error("Group not found");
    }

    // Get user's membership
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .first();

    if (!isActiveMembership(membership)) {
      return []; // User is not a member, return empty array
    }

    // Get all resources for the group
    const resources = await ctx.db
      .query("groupResources")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    // Check if any resource uses channel_members visibility
    const hasChannelVisibility = resources.some(
      (r) => r.visibility.type === "channel_members"
    );

    // Only fetch channel memberships if needed
    let userChannelIds: Id<"chatChannels">[] | undefined;
    if (hasChannelVisibility) {
      const channelMemberships = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .collect();
      userChannelIds = channelMemberships.map((m) => m.channelId);
    }

    // Filter by visibility rules
    const visibleResources = resources.filter((resource) =>
      isResourceVisibleToUser(resource, membership, userChannelIds)
    );

    // Sort by order
    return visibleResources.sort((a, b) => a.order - b.order);
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new resource.
 * Requires user to be group leader or community admin.
 * Sets `order` to be last (max order + 1).
 * Sets `sections: []`, `createdAt`, `updatedAt`, `createdBy`.
 * Returns the new resource ID.
 */
export const create = mutation({
  args: {
    groupId: v.id("groups"),
    title: v.string(),
    icon: v.optional(v.string()),
    visibility: v.object({
      type: v.union(
        v.literal("everyone"),
        v.literal("joined_within"),
        v.literal("channel_members")
      ),
      daysWithin: v.optional(v.number()),
      channelIds: v.optional(v.array(v.id("chatChannels"))),
    }),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Validate channel_members visibility has at least one channel
    if (
      args.visibility.type === "channel_members" &&
      (!args.visibility.channelIds || args.visibility.channelIds.length === 0)
    ) {
      throw new Error("channel_members visibility requires at least one channel");
    }

    // Check permission
    await requireGroupResourcePermission(
      ctx,
      args.groupId,
      userId,
      "create resources for this group"
    );

    // Get existing resources to calculate order
    const existingResources = await ctx.db
      .query("groupResources")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    const maxOrder = existingResources.reduce(
      (max, r) => Math.max(max, r.order),
      -1
    );

    const timestamp = now();

    // Create the resource
    const resourceId = await ctx.db.insert("groupResources", {
      groupId: args.groupId,
      title: args.title,
      icon: args.icon,
      visibility: args.visibility,
      sections: [],
      order: maxOrder + 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: userId,
    });

    return resourceId;
  },
});

/**
 * Update resource metadata.
 * Requires user to be group leader or community admin.
 * Updates `updatedAt`.
 */
export const update = mutation({
  args: {
    resourceId: v.id("groupResources"),
    title: v.optional(v.string()),
    icon: v.optional(v.string()),
    visibility: v.optional(
      v.object({
        type: v.union(
          v.literal("everyone"),
          v.literal("joined_within"),
          v.literal("channel_members")
        ),
        daysWithin: v.optional(v.number()),
        channelIds: v.optional(v.array(v.id("chatChannels"))),
      })
    ),
    order: v.optional(v.number()),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get the resource
    const resource = await ctx.db.get(args.resourceId);
    if (!resource) {
      throw new Error("Resource not found");
    }

    // Validate channel_members visibility has at least one channel
    if (
      args.visibility?.type === "channel_members" &&
      (!args.visibility.channelIds || args.visibility.channelIds.length === 0)
    ) {
      throw new Error("channel_members visibility requires at least one channel");
    }

    // Check permission
    await requireGroupResourcePermission(
      ctx,
      resource.groupId,
      userId,
      "update this resource"
    );

    // Build updates object
    const updates: Record<string, any> = {
      updatedAt: now(),
    };

    if (args.title !== undefined) updates.title = args.title;
    if (args.icon !== undefined) updates.icon = args.icon;
    if (args.visibility !== undefined) updates.visibility = args.visibility;
    if (args.order !== undefined) updates.order = args.order;

    await ctx.db.patch(args.resourceId, updates);

    return args.resourceId;
  },
});

/**
 * Delete a resource.
 * Requires user to be group leader or community admin.
 * Also removes the resource from leaderToolbarTools if present.
 */
export const remove = mutation({
  args: {
    resourceId: v.id("groupResources"),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get the resource
    const resource = await ctx.db.get(args.resourceId);
    if (!resource) {
      throw new Error("Resource not found");
    }

    // Check permission
    await requireGroupResourcePermission(
      ctx,
      resource.groupId,
      userId,
      "delete this resource"
    );

    // Remove resource from group's leaderToolbarTools if present
    const group = await ctx.db.get(resource.groupId);
    if (group?.leaderToolbarTools) {
      const resourceToolId = `resource:${args.resourceId}`;
      const updatedTools = group.leaderToolbarTools.filter(
        (tool) => tool !== resourceToolId
      );
      if (updatedTools.length !== group.leaderToolbarTools.length) {
        await ctx.db.patch(resource.groupId, {
          leaderToolbarTools: updatedTools,
        });
      }
    }

    // Delete any tool short links pointing to this resource
    const toolLinks = await ctx.db
      .query("toolShortLinks")
      .withIndex("by_group_toolType_resourceId", (q) =>
        q
          .eq("groupId", resource.groupId)
          .eq("toolType", "resource")
          .eq("resourceId", args.resourceId)
      )
      .collect();

    for (const link of toolLinks) {
      await ctx.db.delete(link._id);
    }

    await ctx.db.delete(args.resourceId);

    return true;
  },
});

/**
 * Add a section to a resource.
 * Generates unique `id` for section.
 * Sets `order` to be last (max order + 1).
 * Updates resource's `updatedAt`.
 */
export const addSection = mutation({
  args: {
    resourceId: v.id("groupResources"),
    title: v.string(),
    description: v.optional(v.string()),
    imageUrls: v.optional(v.array(v.string())),
    linkUrl: v.optional(v.string()),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get the resource
    const resource = await ctx.db.get(args.resourceId);
    if (!resource) {
      throw new Error("Resource not found");
    }

    // Check permission
    await requireGroupResourcePermission(
      ctx,
      resource.groupId,
      userId,
      "add sections to this resource"
    );

    // Calculate order for new section
    const maxOrder = resource.sections.reduce(
      (max, s) => Math.max(max, s.order),
      -1
    );

    // Create new section
    const newSection = {
      id: generateSectionId(),
      title: args.title,
      description: args.description,
      imageUrls: args.imageUrls,
      linkUrl: args.linkUrl,
      order: maxOrder + 1,
    };

    // Update resource with new section
    await ctx.db.patch(args.resourceId, {
      sections: [...resource.sections, newSection],
      updatedAt: now(),
    });

    return newSection.id;
  },
});

/**
 * Update a section.
 * Requires user to be group leader or community admin.
 * Updates resource's `updatedAt`.
 */
export const updateSection = mutation({
  args: {
    resourceId: v.id("groupResources"),
    sectionId: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    imageUrls: v.optional(v.array(v.string())),
    linkUrl: v.optional(v.string()),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get the resource
    const resource = await ctx.db.get(args.resourceId);
    if (!resource) {
      throw new Error("Resource not found");
    }

    // Check permission
    await requireGroupResourcePermission(
      ctx,
      resource.groupId,
      userId,
      "update sections in this resource"
    );

    // Find and update the section
    const sectionIndex = resource.sections.findIndex(
      (s) => s.id === args.sectionId
    );
    if (sectionIndex === -1) {
      throw new Error("Section not found");
    }

    const updatedSections = [...resource.sections];
    const section = updatedSections[sectionIndex];

    if (args.title !== undefined) section.title = args.title;
    if (args.description !== undefined) section.description = args.description;
    if (args.imageUrls !== undefined) section.imageUrls = args.imageUrls;
    if (args.linkUrl !== undefined) section.linkUrl = args.linkUrl;

    await ctx.db.patch(args.resourceId, {
      sections: updatedSections,
      updatedAt: now(),
    });

    return args.sectionId;
  },
});

/**
 * Delete a section.
 * Requires user to be group leader or community admin.
 * Updates resource's `updatedAt`.
 */
export const deleteSection = mutation({
  args: {
    resourceId: v.id("groupResources"),
    sectionId: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get the resource
    const resource = await ctx.db.get(args.resourceId);
    if (!resource) {
      throw new Error("Resource not found");
    }

    // Check permission
    await requireGroupResourcePermission(
      ctx,
      resource.groupId,
      userId,
      "delete sections from this resource"
    );

    // Find the section
    const sectionExists = resource.sections.some((s) => s.id === args.sectionId);
    if (!sectionExists) {
      throw new Error("Section not found");
    }

    // Remove the section
    const updatedSections = resource.sections.filter(
      (s) => s.id !== args.sectionId
    );

    await ctx.db.patch(args.resourceId, {
      sections: updatedSections,
      updatedAt: now(),
    });

    return true;
  },
});

/**
 * Reorder sections.
 * Updates order of sections based on array position.
 * Requires user to be group leader or community admin.
 */
export const reorderSections = mutation({
  args: {
    resourceId: v.id("groupResources"),
    sectionIds: v.array(v.string()),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get the resource
    const resource = await ctx.db.get(args.resourceId);
    if (!resource) {
      throw new Error("Resource not found");
    }

    // Check permission
    await requireGroupResourcePermission(
      ctx,
      resource.groupId,
      userId,
      "reorder sections in this resource"
    );

    // Verify all section IDs exist
    const existingSectionIds = new Set(resource.sections.map((s) => s.id));
    for (const sectionId of args.sectionIds) {
      if (!existingSectionIds.has(sectionId)) {
        throw new Error(`Section ${sectionId} not found`);
      }
    }

    // Create a map of section ID to section
    const sectionMap = new Map(resource.sections.map((s) => [s.id, s]));

    // Reorder sections based on the provided array
    const reorderedSections = args.sectionIds.map((sectionId, index) => {
      const section = sectionMap.get(sectionId)!;
      return { ...section, order: index };
    });

    // Add any sections that weren't in the reorder list (shouldn't happen, but be safe)
    const reorderedIds = new Set(args.sectionIds);
    const remainingSections = resource.sections
      .filter((s) => !reorderedIds.has(s.id))
      .map((s, index) => ({
        ...s,
        order: reorderedSections.length + index,
      }));

    await ctx.db.patch(args.resourceId, {
      sections: [...reorderedSections, ...remainingSections],
      updatedAt: now(),
    });

    return true;
  },
});

/**
 * Migration: convert legacy `imageUrl` (string) to `imageUrls` (string[]).
 * Run once after deploying the schema change:
 *   npx convex run functions/groupResources/index:migrateImageUrlToImageUrls
 */
export const migrateImageUrlToImageUrls = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allResources = await ctx.db.query("groupResources").collect();
    let migratedCount = 0;

    for (const resource of allResources) {
      let changed = false;
      const updatedSections = resource.sections.map((section: any) => {
        if (section.imageUrl && !section.imageUrls) {
          changed = true;
          const { imageUrl, ...rest } = section;
          return { ...rest, imageUrls: [imageUrl] };
        }
        if (section.imageUrl && section.imageUrls) {
          changed = true;
          const { imageUrl, ...rest } = section;
          return rest;
        }
        return section;
      });

      if (changed) {
        await ctx.db.patch(resource._id, {
          sections: updatedSections,
          updatedAt: now(),
        });
        migratedCount++;
      }
    }

    return { migratedCount };
  },
});
