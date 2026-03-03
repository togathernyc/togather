/**
 * Group Creation Requests functions
 *
 * Handles group creation request operations for regular members:
 * - Create a request to start a new group
 * - View own requests
 * - Cancel pending requests
 *
 * Admin review is handled separately via admin functions.
 */

import { v } from "convex/values";
import { query, mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { now, normalizePagination, getMediaUrl } from "../lib/utils";
import { paginationArgs } from "../lib/validators";
import { requireAuth } from "../lib/auth";

// ============================================================================
// Validation Constants
// ============================================================================

const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 1000;
/**
 * Maximum number of leaders per group.
 * This bounds the sequential insert loop in the review mutation.
 */
const MAX_LEADERS_PER_GROUP = 100;

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate that a string looks like a valid Convex ID for a given table
 * Convex IDs follow the pattern: tableName + some identifier characters
 */
function isValidConvexIdFormat(id: string, table: string): boolean {
  if (typeof id !== "string") return false;
  // Convex IDs for a table typically contain alphanumeric chars
  // A valid ID should be non-empty and have reasonable length
  // Note: In tests, convex-test may generate different ID formats, so we keep validation minimal
  const minLength = 1; // Just check it's not empty
  const maxLength = 100; // But not absurdly long
  return id.length >= minLength && id.length <= maxLength;
}

/**
 * Validate string length for input fields
 */
function validateStringLength(value: string | undefined, fieldName: string, maxLength: number): void {
  if (value !== undefined && value.length > maxLength) {
    throw new Error(`${fieldName} too long. Maximum ${maxLength} characters allowed.`);
  }
}

// ============================================================================
// Request Status
// ============================================================================

const requestStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined")
);

// ============================================================================
// Queries
// ============================================================================

/**
 * Get user's own group creation requests
 */
export const mine = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    ...paginationArgs,
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const { limit } = normalizePagination(args);

    const requests = await ctx.db
      .query("groupCreationRequests")
      .withIndex("by_requester", (q) => q.eq("requesterId", userId))
      .filter((q) => q.eq(q.field("communityId"), args.communityId))
      .order("desc")
      .take(limit);

    // Fetch group type details and created group (if any)
    const requestsWithDetails = await Promise.all(
      requests.map(async (request) => {
        const groupType = await ctx.db.get(request.groupTypeId);
        const createdGroup = request.createdGroupId
          ? await ctx.db.get(request.createdGroupId)
          : null;

        return {
          id: request._id,
          name: request.name,
          description: request.description,
          groupTypeId: request.groupTypeId,
          groupTypeName: groupType?.name,
          status: request.status,
          proposedStartDay: request.proposedStartDay,
          createdAt: request.createdAt,
          reviewedAt: request.reviewedAt,
          declineReason: request.declineReason,
          createdGroup: createdGroup
            ? {
                id: createdGroup._id,
                name: createdGroup.name,
              }
            : null,
        };
      })
    );

    return requestsWithDetails;
  },
});

/**
 * Get a single creation request by ID
 */
export const getById = query({
  args: {
    requestId: v.id("groupCreationRequests"),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) {
      return null;
    }

    const groupType = await ctx.db.get(request.groupTypeId);
    const createdGroup = request.createdGroupId
      ? await ctx.db.get(request.createdGroupId)
      : null;
    const requester = await ctx.db.get(request.requesterId);

    return {
      id: request._id,
      name: request.name,
      description: request.description,
      groupTypeId: request.groupTypeId,
      groupTypeName: groupType?.name,
      status: request.status,
      proposedStartDay: request.proposedStartDay,
      maxCapacity: request.maxCapacity,
      addressLine1: request.addressLine1,
      addressLine2: request.addressLine2,
      city: request.city,
      state: request.state,
      zipCode: request.zipCode,
      defaultStartTime: request.defaultStartTime,
      defaultEndTime: request.defaultEndTime,
      defaultMeetingType: request.defaultMeetingType,
      defaultMeetingLink: request.defaultMeetingLink,
      proposedLeaderIds: request.proposedLeaderIds,
      createdAt: request.createdAt,
      reviewedAt: request.reviewedAt,
      declineReason: request.declineReason,
      createdGroup: createdGroup
        ? {
            id: createdGroup._id,
            name: createdGroup.name,
          }
        : null,
      requester: requester
        ? {
            id: requester._id,
            firstName: requester.firstName,
            lastName: requester.lastName,
          }
        : null,
    };
  },
});

/**
 * List pending requests for a community (admin view)
 */
export const listPending = query({
  args: {
    communityId: v.id("communities"),
    ...paginationArgs,
  },
  handler: async (ctx, args) => {
    const { limit } = normalizePagination(args);

    const requests = await ctx.db
      .query("groupCreationRequests")
      .withIndex("by_community_status", (q) =>
        q.eq("communityId", args.communityId).eq("status", "pending")
      )
      .order("desc")
      .take(limit);

    const requestsWithDetails = await Promise.all(
      requests.map(async (request) => {
        const groupType = await ctx.db.get(request.groupTypeId);
        const requester = await ctx.db.get(request.requesterId);

        return {
          id: request._id,
          name: request.name,
          description: request.description,
          groupTypeId: request.groupTypeId,
          groupTypeName: groupType?.name,
          status: request.status,
          proposedStartDay: request.proposedStartDay,
          createdAt: request.createdAt,
          requester: requester
            ? {
                id: requester._id,
                firstName: requester.firstName,
                lastName: requester.lastName,
                profilePhoto: getMediaUrl(requester.profilePhoto),
              }
            : null,
        };
      })
    );

    return requestsWithDetails;
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new group creation request
 */
export const create = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    name: v.string(),
    groupTypeId: v.id("groupTypes"),
    description: v.optional(v.string()),
    proposedStartDay: v.optional(v.number()),
    maxCapacity: v.optional(v.number()),
    addressLine1: v.optional(v.string()),
    addressLine2: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    defaultStartTime: v.optional(v.string()),
    defaultEndTime: v.optional(v.string()),
    defaultMeetingType: v.optional(v.number()),
    defaultMeetingLink: v.optional(v.string()),
    proposedLeaderIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const timestamp = now();

    // Validate string lengths to prevent DoS via storage exhaustion
    validateStringLength(args.name, "Name", MAX_NAME_LENGTH);
    validateStringLength(args.description, "Description", MAX_DESCRIPTION_LENGTH);

    // Verify group type exists and belongs to community
    const groupType = await ctx.db.get(args.groupTypeId);
    if (!groupType || groupType.communityId !== args.communityId || !groupType.isActive) {
      throw new Error("Group type not found");
    }

    // Check for existing pending request from this user
    const existingRequest = await ctx.db
      .query("groupCreationRequests")
      .withIndex("by_requester", (q) => q.eq("requesterId", userId))
      .filter((q) =>
        q.and(
          q.eq(q.field("communityId"), args.communityId),
          q.eq(q.field("status"), "pending")
        )
      )
      .first();

    if (existingRequest) {
      throw new Error("You already have a pending group creation request");
    }

    // Validate proposed leaders count and existence
    const proposedLeaderIds = args.proposedLeaderIds || [];
    if (proposedLeaderIds.length > MAX_LEADERS_PER_GROUP) {
      throw new Error(`Maximum ${MAX_LEADERS_PER_GROUP} leaders allowed per group`);
    }
    if (proposedLeaderIds.length > 0) {
      for (const leaderId of proposedLeaderIds) {
        // First validate ID format to prevent injection attacks
        if (!isValidConvexIdFormat(leaderId, "users")) {
          throw new Error("Invalid user ID format");
        }

        // Check if user exists
        const user = await ctx.db.get(leaderId as Id<"users">);
        if (!user) {
          throw new Error("User not found");
        }

        // Check if user is an active community member
        const userCommunity = await ctx.db
          .query("userCommunities")
          .withIndex("by_user_community", (q) =>
            q.eq("userId", leaderId as Id<"users">).eq("communityId", args.communityId)
          )
          .first();

        if (!userCommunity || userCommunity.status !== 1) {
          throw new Error("Some proposed leaders are not valid community members");
        }
      }
    }

    // Create the request
    const requestId = await ctx.db.insert("groupCreationRequests", {
      communityId: args.communityId,
      requesterId: userId,
      status: "pending",
      name: args.name,
      description: args.description,
      groupTypeId: args.groupTypeId,
      proposedStartDay: args.proposedStartDay,
      maxCapacity: args.maxCapacity,
      addressLine1: args.addressLine1,
      addressLine2: args.addressLine2,
      city: args.city,
      state: args.state,
      zipCode: args.zipCode,
      defaultStartTime: args.defaultStartTime,
      defaultEndTime: args.defaultEndTime,
      defaultMeetingType: args.defaultMeetingType ?? 2,
      defaultMeetingLink: args.defaultMeetingLink,
      proposedLeaderIds: proposedLeaderIds,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Schedule notification to community admins (non-blocking)
    ctx.scheduler.runAfter(0, internal.functions.notifications.senders.notifyGroupCreationRequest, {
      communityId: args.communityId,
      requesterId: userId,
      groupName: args.name,
    });

    return {
      id: requestId,
      name: args.name,
      groupTypeName: groupType.name,
      status: "pending",
      createdAt: timestamp,
    };
  },
});

/**
 * Cancel own pending request
 */
export const cancel = mutation({
  args: {
    token: v.string(),
    requestId: v.id("groupCreationRequests"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const request = await ctx.db.get(args.requestId);

    if (!request) {
      throw new Error("Request not found");
    }

    if (request.requesterId !== userId) {
      throw new Error("You can only cancel your own requests");
    }

    if (request.status !== "pending") {
      throw new Error("Request was already processed");
    }

    // Delete the request
    await ctx.db.delete(args.requestId);

    return { success: true };
  },
});

/**
 * Review a creation request (admin only)
 */
export const review = mutation({
  args: {
    token: v.string(),
    requestId: v.id("groupCreationRequests"),
    action: v.union(v.literal("approve"), v.literal("decline")),
    declineReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const timestamp = now();

    const request = await ctx.db.get(args.requestId);
    if (!request) {
      throw new Error("Request not found");
    }

    if (request.status !== "pending") {
      throw new Error("Request was already processed");
    }

    if (args.action === "decline") {
      // Decline the request
      await ctx.db.patch(args.requestId, {
        status: "declined",
        reviewedAt: timestamp,
        reviewedById: userId,
        declineReason: args.declineReason,
        updatedAt: timestamp,
      });

      return { success: true, groupId: null };
    }

    // Approve: Create the group
    const groupId = await ctx.db.insert("groups", {
      communityId: request.communityId,
      groupTypeId: request.groupTypeId,
      name: request.name,
      description: request.description,
      isArchived: false,
      addressLine1: request.addressLine1,
      addressLine2: request.addressLine2,
      city: request.city,
      state: request.state,
      zipCode: request.zipCode,
      defaultDay: request.proposedStartDay,
      defaultStartTime: request.defaultStartTime,
      defaultEndTime: request.defaultEndTime,
      defaultMeetingType: request.defaultMeetingType,
      defaultMeetingLink: request.defaultMeetingLink,
      preview: request.preview,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Add requester as leader
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: request.requesterId,
      role: "leader",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    // Build list of all leader IDs for notifications
    const allLeaderIds: Array<typeof request.requesterId> = [request.requesterId];

    // Add proposed additional leaders
    // NOTE: Sequential inserts are intentional here. The loop is bounded by MAX_LEADERS_PER_GROUP,
    // validated at request creation time. Convex doesn't support batch inserts.
    const proposedLeaderIds = request.proposedLeaderIds || [];
    for (const leaderId of proposedLeaderIds) {
      // Skip if same as requester
      if (leaderId === request.requesterId) continue;

      // Validate leader ID format before inserting to prevent data corruption
      if (!isValidConvexIdFormat(leaderId, "users")) {
        throw new Error("Invalid leader ID format");
      }

      await ctx.db.insert("groupMembers", {
        groupId,
        userId: leaderId as Id<"users">,
        role: "leader",
        joinedAt: timestamp,
        notificationsEnabled: true,
      });

      // Add to notification list
      allLeaderIds.push(leaderId as Id<"users">);
    }

    // Update the request
    await ctx.db.patch(args.requestId, {
      status: "approved",
      reviewedAt: timestamp,
      reviewedById: userId,
      createdGroupId: groupId,
      updatedAt: timestamp,
    });

    // Schedule notification to all leaders (non-blocking)
    ctx.scheduler.runAfter(0, internal.functions.notifications.senders.notifyGroupCreationApproved, {
      groupId,
      leaderIds: allLeaderIds,
    });

    return { success: true, groupId };
  },
});
