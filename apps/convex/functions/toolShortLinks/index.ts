/**
 * Tool Short Links Functions
 *
 * Manages short URLs for sharing direct links to group tools (Run Sheet, Resources, Tasks).
 * Example: togather.nyc/t/abc123 → Task for "Production Team"
 *
 * - getByShortId: Public query (no auth) to resolve a short link
 * - getOrCreate: Authenticated mutation to generate or retrieve a short link
 */

import { v } from "convex/values";
import { query, mutation, internalQuery } from "../../_generated/server";
import { requireAuth } from "../../lib/auth";
import { generateShortId, getMediaUrl } from "../../lib/utils";
import { isActiveMembership } from "../../lib/helpers";

// ============================================================================
// Queries
// ============================================================================

/**
 * Resolve a tool short link by its shortId.
 * No auth required — anyone with the link can view tool info.
 * Returns null if not found or if the group is archived.
 */
export const getByShortId = query({
  args: { shortId: v.string() },
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query("toolShortLinks")
      .withIndex("by_shortId", (q) => q.eq("shortId", args.shortId))
      .first();

    if (!link) return null;

    // Get the group
    const group = await ctx.db.get(link.groupId);
    if (!group || group.isArchived) return null;

    // Get community name
    const community = await ctx.db.get(group.communityId);

    // Build base response
    const result: Record<string, unknown> = {
      shortId: link.shortId,
      toolType: link.toolType,
      groupId: link.groupId,
      groupName: group.name,
      groupShortId: group.shortId,
      communityName: community?.name,
      groupImage: getMediaUrl(group.preview),
      communityLogo: getMediaUrl(community?.logo),
    };

    // If resource, include resource details + first image for OG tags
    if (link.toolType === "resource" && link.resourceId) {
      const resource = await ctx.db.get(link.resourceId);
      if (!resource) return null; // Resource was deleted
      result.resourceId = link.resourceId;
      result.resourceTitle = resource.title;
      result.resourceIcon = resource.icon;

      // Get first image from resource sections for link preview
      const sortedSections = [...resource.sections].sort((a, b) => a.order - b.order);
      for (const section of sortedSections) {
        if (section.imageUrls && section.imageUrls.length > 0) {
          result.resourceImage = getMediaUrl(section.imageUrls[0]);
          break;
        }
      }
    }

    // If task, include task details
    if (link.toolType === "task" && link.taskId) {
      const task = await ctx.db.get(link.taskId);
      if (!task) return null; // Task was deleted
      if (task.groupId.toString() !== link.groupId.toString()) return null;
      result.taskId = link.taskId;
      result.taskTitle = task.title;
      result.taskStatus = task.status;
    }

    return result;
  },
});

/**
 * Internal query to verify a short link matches a given tool type and group.
 * Used by actions (e.g., getRunSheetPublic) that can't access the DB directly.
 * Returns true if the short link is valid for the given tool type and group.
 */
export const verifyShortLink = internalQuery({
  args: {
    shortLinkId: v.string(),
    toolType: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query("toolShortLinks")
      .withIndex("by_shortId", (q) => q.eq("shortId", args.shortLinkId))
      .first();

    if (!link) return false;
    if (link.toolType !== args.toolType) return false;
    if (link.groupId.toString() !== args.groupId.toString()) return false;

    return true;
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Get or create a short link for a group tool.
 * Requires authentication — only group members can generate links.
 * Returns the existing short link if one already exists for this tool.
 */
export const getOrCreate = mutation({
  args: {
    groupId: v.id("groups"),
    toolType: v.string(), // "runsheet" | "resource" | "task"
    resourceId: v.optional(v.id("groupResources")),
    taskId: v.optional(v.id("tasks")),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Verify group exists
    const group = await ctx.db.get(args.groupId);
    if (!group) throw new Error("Group not found");

    // Verify user is a member
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .first();

    if (!isActiveMembership(membership)) {
      throw new Error("You must be a member of this group to share tools");
    }

    // Validate shape for each link type
    if (args.toolType === "resource" && !args.resourceId) {
      throw new Error("resourceId is required when toolType is 'resource'");
    }
    if (args.toolType === "task" && !args.taskId) {
      throw new Error("taskId is required when toolType is 'task'");
    }
    if (args.toolType === "runsheet" && (args.resourceId || args.taskId)) {
      throw new Error("runsheet links cannot include resourceId or taskId");
    }
    if (args.toolType === "resource" && args.taskId) {
      throw new Error("resource links cannot include taskId");
    }
    if (args.toolType === "task" && args.resourceId) {
      throw new Error("task links cannot include resourceId");
    }

    // Verify shared task belongs to this group
    if (args.toolType === "task" && args.taskId) {
      const task = await ctx.db.get(args.taskId);
      if (!task) throw new Error("Task not found");
      if (task.groupId.toString() !== args.groupId.toString()) {
        throw new Error("Task does not belong to this group");
      }
    }

    // Check for existing link
    let existingLink;
    if (args.toolType === "resource" && args.resourceId) {
      // For resources, match on groupId + toolType + resourceId
      existingLink = await ctx.db
        .query("toolShortLinks")
        .withIndex("by_group_toolType_resourceId", (q) =>
          q
            .eq("groupId", args.groupId)
            .eq("toolType", args.toolType)
            .eq("resourceId", args.resourceId)
        )
        .first();
    } else if (args.toolType === "task" && args.taskId) {
      existingLink = await ctx.db
        .query("toolShortLinks")
        .withIndex("by_group_toolType_taskId", (q) =>
          q
            .eq("groupId", args.groupId)
            .eq("toolType", args.toolType)
            .eq("taskId", args.taskId)
        )
        .first();
    } else {
      // For runsheet, match on groupId + toolType only
      existingLink = await ctx.db
        .query("toolShortLinks")
        .withIndex("by_group_toolType", (q) =>
          q.eq("groupId", args.groupId).eq("toolType", args.toolType)
        )
        .first();
    }

    if (existingLink) {
      return existingLink.shortId;
    }

    // Create new short link
    const shortId = generateShortId();
    await ctx.db.insert("toolShortLinks", {
      shortId,
      groupId: args.groupId,
      toolType: args.toolType,
      resourceId: args.resourceId,
      taskId: args.taskId,
      createdAt: Date.now(),
      createdBy: userId,
    });

    return shortId;
  },
});
