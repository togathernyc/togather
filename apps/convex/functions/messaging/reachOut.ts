/**
 * Reach Out Requests
 *
 * Members submit requests via the "Reach Out" channel. These surface as
 * interactive cards in the leaders channel. Leaders assign, contact, and
 * resolve requests — all tracked and integrated into the followup system.
 */

import { v, ConvexError } from "convex/values";
import { query, mutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { getDisplayName, getMediaUrl } from "../../lib/utils";
import { isLeaderRole, isActiveMembership } from "../../lib/helpers";

// =============================================================================
// Queries
// =============================================================================

/**
 * Get the current user's submitted requests for a group.
 * Any group member can see their own requests.
 */
export const getMyRequests = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const requests = await ctx.db
      .query("reachOutRequests")
      .withIndex("by_submittedBy", (q) => q.eq("submittedById", userId))
      .collect();

    // Filter to this group and sort by createdAt desc
    const groupRequests = requests
      .filter((r) => r.groupId === args.groupId)
      .sort((a, b) => b.createdAt - a.createdAt);

    // Enrich with assignee info
    const enriched = await Promise.all(
      groupRequests.map(async (request) => {
        let assignee = null;
        if (request.assignedToId) {
          const assigneeUser = await ctx.db.get(request.assignedToId);
          if (assigneeUser) {
            assignee = {
              _id: assigneeUser._id,
              name: getDisplayName(assigneeUser.firstName, assigneeUser.lastName),
              profilePhoto: getMediaUrl(assigneeUser.profilePhoto),
            };
          }
        }

        // Member view: warm language, no internal details
        return {
          _id: request._id,
          content: request.content,
          status: request.status,
          assignee: assignee
            ? { _id: assignee._id, name: assignee.name, profilePhoto: assignee.profilePhoto }
            : null,
          hasBeenContacted: (request.contactActions ?? []).length > 0,
          createdAt: request.createdAt,
          updatedAt: request.updatedAt,
        };
      })
    );

    return enriched;
  },
});

/**
 * Get all requests for a group. Leaders/admins only.
 * Sorted by status priority (pending first) then recency.
 */
export const getGroupRequests = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Verify leader/admin role
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .first();

    if (!isActiveMembership(membership) || !isLeaderRole(membership.role)) {
      throw new ConvexError("Only leaders can view all requests");
    }

    const requests = await ctx.db
      .query("reachOutRequests")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    // Sort: pending > assigned > contacted > resolved, then newest first
    const statusOrder: Record<string, number> = {
      pending: 0,
      assigned: 1,
      contacted: 2,
      resolved: 3,
    };

    const sorted = requests.sort((a, b) => {
      const statusDiff = (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
      if (statusDiff !== 0) return statusDiff;
      return b.createdAt - a.createdAt;
    });

    // Enrich with submitter and assignee info
    const enriched = await Promise.all(
      sorted.map(async (request) => {
        const submitter = await ctx.db.get(request.submittedById);
        let assignee = null;
        if (request.assignedToId) {
          const assigneeUser = await ctx.db.get(request.assignedToId);
          if (assigneeUser) {
            assignee = {
              _id: assigneeUser._id,
              name: getDisplayName(assigneeUser.firstName, assigneeUser.lastName),
              profilePhoto: getMediaUrl(assigneeUser.profilePhoto),
            };
          }
        }

        let resolvedBy = null;
        if (request.resolvedById) {
          const resolvedByUser = await ctx.db.get(request.resolvedById);
          if (resolvedByUser) {
            resolvedBy = {
              _id: resolvedByUser._id,
              name: getDisplayName(resolvedByUser.firstName, resolvedByUser.lastName),
            };
          }
        }

        return {
          _id: request._id,
          content: request.content,
          status: request.status,
          submitter: submitter
            ? {
                _id: submitter._id,
                name: getDisplayName(submitter.firstName, submitter.lastName),
                profilePhoto: getMediaUrl(submitter.profilePhoto),
                phone: submitter.phone,
                email: submitter.email,
              }
            : null,
          assignee,
          contactActions: request.contactActions ?? [],
          resolvedBy,
          resolutionNotes: request.resolutionNotes,
          resolvedAt: request.resolvedAt,
          createdAt: request.createdAt,
          updatedAt: request.updatedAt,
        };
      })
    );

    return enriched;
  },
});

/**
 * Get a single request with full history.
 * Accessible by submitter or leaders.
 */
export const getRequestDetail = query({
  args: {
    token: v.string(),
    requestId: v.id("reachOutRequests"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const request = await ctx.db.get(args.requestId);
    if (!request) return null;

    // Check access: submitter or leader
    const isSubmitter = request.submittedById === userId;
    if (!isSubmitter) {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", request.groupId).eq("userId", userId)
        )
        .first();

      if (!isActiveMembership(membership) || !isLeaderRole(membership.role)) {
        throw new ConvexError("Access denied");
      }
    }

    const submitter = await ctx.db.get(request.submittedById);
    let assignee = null;
    if (request.assignedToId) {
      const assigneeUser = await ctx.db.get(request.assignedToId);
      if (assigneeUser) {
        assignee = {
          _id: assigneeUser._id,
          name: getDisplayName(assigneeUser.firstName, assigneeUser.lastName),
          profilePhoto: getMediaUrl(assigneeUser.profilePhoto),
          phone: assigneeUser.phone,
          email: assigneeUser.email,
        };
      }
    }

    let resolvedBy = null;
    if (request.resolvedById) {
      const resolvedByUser = await ctx.db.get(request.resolvedById);
      if (resolvedByUser) {
        resolvedBy = {
          _id: resolvedByUser._id,
          name: getDisplayName(resolvedByUser.firstName, resolvedByUser.lastName),
        };
      }
    }

    // Enrich contact actions with performer info
    const enrichedActions = await Promise.all(
      (request.contactActions ?? []).map(async (action) => {
        const performer = await ctx.db.get(action.performedById);
        return {
          ...action,
          performerName: performer
            ? getDisplayName(performer.firstName, performer.lastName)
            : "Unknown",
        };
      })
    );

    return {
      _id: request._id,
      groupId: request.groupId,
      content: request.content,
      status: request.status,
      submitter: submitter
        ? {
            _id: submitter._id,
            name: getDisplayName(submitter.firstName, submitter.lastName),
            profilePhoto: getMediaUrl(submitter.profilePhoto),
            phone: submitter.phone,
            email: submitter.email,
          }
        : null,
      assignee,
      contactActions: enrichedActions,
      resolvedBy,
      resolutionNotes: request.resolutionNotes,
      resolvedAt: request.resolvedAt,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  },
});

// =============================================================================
// Mutations
// =============================================================================

/**
 * Submit a new reach-out request.
 * Creates the request, posts a card to the leaders channel,
 * and creates a followup entry.
 */
export const submitRequest = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    channelId: v.id("chatChannels"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const now = Date.now();

    // Validate content
    const content = args.content.trim();
    if (!content) {
      throw new ConvexError("Request content cannot be empty");
    }

    // Verify the channel is a reach_out channel belonging to the specified group and not archived
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.channelType !== "reach_out" || channel.groupId !== args.groupId || channel.isArchived) {
      throw new ConvexError("Invalid reach out channel");
    }

    // Verify user is a group member
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .first();

    if (!isActiveMembership(membership)) {
      throw new ConvexError("Must be a group member");
    }

    // Find the leaders channel for this group
    const leadersChannel = await ctx.db
      .query("chatChannels")
      .withIndex("by_group_type", (q) =>
        q.eq("groupId", args.groupId).eq("channelType", "leaders")
      )
      .first();

    if (!leadersChannel || leadersChannel.isArchived) {
      throw new ConvexError("Leaders channel is not available");
    }

    // Get submitter info for the system message
    const submitter = await ctx.db.get(userId);
    const submitterName = submitter
      ? getDisplayName(submitter.firstName, submitter.lastName)
      : "A member";

    // Create the reach-out request
    const requestId = await ctx.db.insert("reachOutRequests", {
      groupId: args.groupId,
      channelId: args.channelId,
      leadersChannelId: leadersChannel._id,
      submittedById: userId,
      groupMemberId: membership._id,
      content,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    // Create canonical task mirror for leader workflows
    const taskId = await ctx.runMutation(
      internal.functions.tasks.index.createFromReachOutRequest,
      {
        groupId: args.groupId,
        submittedById: userId,
        requestId,
        content,
      }
    );

    // Post a card message to the leaders channel
    const preview = content.length > 100 ? content.substring(0, 97) + "..." : content;
    const messageId = await ctx.db.insert("chatMessages", {
      channelId: leadersChannel._id,
      senderId: userId,
      senderName: submitterName,
      senderProfilePhoto: submitter ? getMediaUrl(submitter.profilePhoto) : undefined,
      content: `${submitterName}: ${preview}`,
      contentType: "reach_out_request",
      reachOutRequestId: requestId,
      createdAt: now,
      isDeleted: false,
    });

    // Update the request with the message reference
    await ctx.db.patch(requestId, { leadersMessageId: messageId, taskId });

    // Update leaders channel metadata
    await ctx.db.patch(leadersChannel._id, {
      lastMessageAt: now,
      lastMessagePreview: `Reach out from ${submitterName}`,
      updatedAt: now,
    });

    // Trigger unread counts + push notifications for leaders
    await ctx.scheduler.runAfter(0, internal.functions.messaging.events.onMessageSent, {
      messageId,
      channelId: leadersChannel._id,
      senderId: userId,
    });

    // Create followup entry
    await ctx.db.insert("memberFollowups", {
      groupMemberId: membership._id,
      createdById: userId,
      type: "reach_out",
      content: `Reach out: ${content.substring(0, 100)}`,
      reachOutRequestId: requestId,
      createdAt: now,
    });

    return requestId;
  },
});

/**
 * Assign a request to a leader (self or another leader).
 */
export const assignRequest = mutation({
  args: {
    token: v.string(),
    requestId: v.id("reachOutRequests"),
    assignToUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const now = Date.now();

    const request = await ctx.db.get(args.requestId);
    if (!request) throw new ConvexError("Request not found");
    if (request.status === "revoked" || request.status === "resolved") {
      throw new ConvexError("Cannot modify a resolved or withdrawn request");
    }

    // Verify caller is a leader/admin
    const callerMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", request.groupId).eq("userId", userId)
      )
      .first();

    if (!isActiveMembership(callerMembership) || !isLeaderRole(callerMembership.role)) {
      throw new ConvexError("Only leaders can assign requests");
    }

    // Verify assignee is a leader/admin in this group
    const assigneeMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", request.groupId).eq("userId", args.assignToUserId)
      )
      .first();

    if (!isActiveMembership(assigneeMembership) || !isLeaderRole(assigneeMembership.role)) {
      throw new ConvexError("Can only assign to leaders");
    }

    await ctx.db.patch(args.requestId, {
      assignedToId: args.assignToUserId,
      assignedAt: now,
      status: "assigned",
      updatedAt: now,
    });

    await ctx.runMutation(internal.functions.tasks.index.syncReachOutTask, {
      requestId: args.requestId,
      status: "assigned",
      performedById: userId,
      assignedToId: args.assignToUserId,
    });
  },
});

/**
 * Log a contact action (call/text/email) on a request.
 */
export const logContactAction = mutation({
  args: {
    token: v.string(),
    requestId: v.id("reachOutRequests"),
    type: v.string(), // "call" | "text" | "email"
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const now = Date.now();

    const request = await ctx.db.get(args.requestId);
    if (!request) throw new ConvexError("Request not found");
    if (request.status === "revoked" || request.status === "resolved") {
      throw new ConvexError("Cannot modify a resolved or withdrawn request");
    }

    // Verify caller is a leader/admin
    const callerMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", request.groupId).eq("userId", userId)
      )
      .first();

    if (!isActiveMembership(callerMembership) || !isLeaderRole(callerMembership.role)) {
      throw new ConvexError("Only leaders can log contact actions");
    }

    const actionId = `${args.type}-${now}-${userId}`;
    const existingActions = request.contactActions ?? [];

    await ctx.db.patch(args.requestId, {
      contactActions: [
        ...existingActions,
        {
          id: actionId,
          type: args.type,
          performedById: userId,
          performedAt: now,
          notes: args.notes,
        },
      ],
      status: "contacted",
      updatedAt: now,
    });

    // Create followup entry
    const actionLabel = args.type === "call" ? "Called" : args.type === "text" ? "Texted" : "Emailed";
    const notesSuffix = args.notes ? ` — ${args.notes}` : "";

    await ctx.db.insert("memberFollowups", {
      groupMemberId: request.groupMemberId,
      createdById: userId,
      type: args.type as "call" | "text" | "email",
      content: `${actionLabel} re: reach-out request${notesSuffix}`,
      reachOutRequestId: request._id,
      createdAt: now,
    });
  },
});

/**
 * Resolve a request with required notes.
 */
export const resolveRequest = mutation({
  args: {
    token: v.string(),
    requestId: v.id("reachOutRequests"),
    resolutionNotes: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const now = Date.now();

    const notes = args.resolutionNotes.trim();
    if (!notes) {
      throw new ConvexError("Resolution notes are required");
    }

    const request = await ctx.db.get(args.requestId);
    if (!request) throw new ConvexError("Request not found");
    if (request.status === "revoked") throw new ConvexError("Cannot modify a withdrawn request");

    // Verify caller is a leader/admin
    const callerMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", request.groupId).eq("userId", userId)
      )
      .first();

    if (!isActiveMembership(callerMembership) || !isLeaderRole(callerMembership.role)) {
      throw new ConvexError("Only leaders can resolve requests");
    }

    await ctx.db.patch(args.requestId, {
      status: "resolved",
      resolvedById: userId,
      resolvedAt: now,
      resolutionNotes: notes,
      updatedAt: now,
    });

    await ctx.runMutation(internal.functions.tasks.index.syncReachOutTask, {
      requestId: args.requestId,
      status: "resolved",
      performedById: userId,
    });

    // Create followup entry
    await ctx.db.insert("memberFollowups", {
      groupMemberId: request.groupMemberId,
      createdById: userId,
      type: "note",
      content: `Resolved reach-out: ${notes}`,
      reachOutRequestId: request._id,
      createdAt: now,
    });
  },
});

/**
 * Unassign a request, resetting it to pending.
 */
export const unassignRequest = mutation({
  args: {
    token: v.string(),
    requestId: v.id("reachOutRequests"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const now = Date.now();

    const request = await ctx.db.get(args.requestId);
    if (!request) throw new ConvexError("Request not found");
    if (request.status === "revoked" || request.status === "resolved") {
      throw new ConvexError("Cannot modify a resolved or withdrawn request");
    }

    // Verify caller is a leader/admin
    const callerMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", request.groupId).eq("userId", userId)
      )
      .first();

    if (!isActiveMembership(callerMembership) || !isLeaderRole(callerMembership.role)) {
      throw new ConvexError("Only leaders can unassign requests");
    }

    await ctx.db.patch(args.requestId, {
      assignedToId: undefined,
      assignedAt: undefined,
      status: "pending",
      updatedAt: now,
    });

    await ctx.runMutation(internal.functions.tasks.index.syncReachOutTask, {
      requestId: args.requestId,
      status: "pending",
      performedById: userId,
    });
  },
});

/**
 * Revoke (withdraw) a request. Only the original submitter can do this.
 * The request stays in history but is marked as revoked.
 */
export const revokeRequest = mutation({
  args: {
    token: v.string(),
    requestId: v.id("reachOutRequests"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const now = Date.now();

    const request = await ctx.db.get(args.requestId);
    if (!request) throw new ConvexError("Request not found");

    // Only the submitter can revoke
    if (request.submittedById !== userId) {
      throw new ConvexError("Only the person who submitted can withdraw this request");
    }

    // Can't revoke already resolved requests
    if (request.status === "resolved") {
      throw new ConvexError("Cannot withdraw a resolved request");
    }

    if (request.status === "revoked") {
      return; // Already revoked, no-op
    }

    await ctx.db.patch(args.requestId, {
      status: "revoked",
      updatedAt: now,
    });

    await ctx.runMutation(internal.functions.tasks.index.syncReachOutTask, {
      requestId: args.requestId,
      status: "revoked",
      performedById: userId,
    });
  },
});

/**
 * Get leaders for a group (used for the assign dropdown).
 */
export const getGroupLeaders = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Verify caller is a leader/admin
    const callerMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .first();

    if (!isActiveMembership(callerMembership) || !isLeaderRole(callerMembership.role)) {
      throw new ConvexError("Only leaders can view group leaders");
    }

    // Get all active leader/admin members
    const allMembers = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    const leaders = allMembers.filter(
      (m) => isActiveMembership(m) && isLeaderRole(m.role)
    );

    const enriched = await Promise.all(
      leaders.map(async (member) => {
        const user = await ctx.db.get(member.userId);
        return user
          ? {
              _id: user._id,
              name: getDisplayName(user.firstName, user.lastName),
              profilePhoto: getMediaUrl(user.profilePhoto),
            }
          : null;
      })
    );

    return enriched.filter(Boolean);
  },
});
