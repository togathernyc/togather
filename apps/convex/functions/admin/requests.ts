/**
 * Admin functions for managing pending requests
 *
 * Includes:
 * - Pending join requests management
 * - Group creation requests
 */

import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { now, getMediaUrl, generateShortId } from "../../lib/utils";
import { requireAuth } from "../../lib/auth";
import { syncUserChannelMembershipsLogic } from "../sync/memberships";
import { initializeGroupAfterCreation } from "../groups/mutations";
import { requireCommunityAdmin, LEADER_ROLES } from "./auth";

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum number of leaders per group.
 * This bounds the sequential insert loop in reviewGroupCreationRequest.
 */
const MAX_LEADERS_PER_GROUP = 100;

// ============================================================================
// Pending Requests
// ============================================================================

/**
 * List all pending join requests across community
 *
 * Groups by requesting user with:
 * - User info
 * - List of pending requests
 * - Current group memberships
 * - Membership counts by type
 */
export const listPendingRequests = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    // Get all groups in community
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    const groupMap = new Map(groups.map((g) => [g._id, g]));
    const groupIds = new Set(groups.map((g) => g._id));

    // Pre-fetch ALL group types for this community upfront (O(1) lookups later)
    const groupTypes = await ctx.db
      .query("groupTypes")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    const groupTypeMap = new Map(groupTypes.map((gt) => [gt._id, gt]));

    // Get pending requests per group using compound index (much more efficient than global scan)
    // This queries only pending requests for groups in this community
    const pendingRequests = (
      await Promise.all(
        groups.map((group) =>
          ctx.db
            .query("groupMembers")
            .withIndex("by_group_requestStatus", (q) =>
              q.eq("groupId", group._id).eq("requestStatus", "pending")
            )
            .collect()
        )
      )
    ).flat();

    // Collect unique user IDs and batch fetch them
    const uniqueUserIds = [...new Set(pendingRequests.map((r) => r.userId))];
    const users = await Promise.all(uniqueUserIds.map((id) => ctx.db.get(id)));
    const userMap = new Map(
      users.filter((u): u is NonNullable<typeof u> => u !== null).map((u) => [u._id, u])
    );

    // Group by user
    const userRequestsMap = new Map<
      Id<"users">,
      {
        user: any;
        pendingRequests: any[];
      }
    >();

    for (const request of pendingRequests) {
      const group = groupMap.get(request.groupId);
      if (!group) continue;

      const user = userMap.get(request.userId);
      if (!user) continue;

      // Get group type from pre-fetched map
      const groupType = group.groupTypeId ? groupTypeMap.get(group.groupTypeId) : null;

      if (!userRequestsMap.has(request.userId)) {
        userRequestsMap.set(request.userId, {
          user: {
            id: request.userId,
            firstName: user.firstName || "",
            lastName: user.lastName || "",
            email: user.email || "",
            phone: user.phone || null,
            profilePhoto: getMediaUrl(user.profilePhoto),
          },
          pendingRequests: [],
        });
      }

      userRequestsMap.get(request.userId)!.pendingRequests.push({
        id: request._id,
        groupId: group._id,
        groupName: group.name,
        groupTypeId: groupType?._id || null,
        groupTypeName: groupType?.name || "",
        groupTypeSlug: groupType?.slug || "",
        requestedAt: request.requestedAt || request.joinedAt,
      });
    }

    // Get current memberships and counts for each user
    const results = await Promise.all(
      Array.from(userRequestsMap.values()).map(async (userEntry) => {
        // Get current active memberships
        const allMemberships = await ctx.db
          .query("groupMembers")
          .withIndex("by_user", (q) => q.eq("userId", userEntry.user.id))
          .collect();

        const currentMemberships = allMemberships.filter(
          (m) =>
            !m.leftAt &&
            groupIds.has(m.groupId) &&
            (m.requestStatus === null || m.requestStatus === "accepted")
        );

        // Count memberships by group type (using pre-fetched groupTypeMap)
        const membershipsByType = new Map<string, number>();
        for (const membership of currentMemberships) {
          const group = groupMap.get(membership.groupId);
          if (group?.groupTypeId) {
            const groupType = groupTypeMap.get(group.groupTypeId);
            if (groupType) {
              membershipsByType.set(
                groupType.slug,
                (membershipsByType.get(groupType.slug) || 0) + 1
              );
            }
          }
        }

        return {
          user: userEntry.user,
          pendingRequestsCount: userEntry.pendingRequests.length,
          pendingRequests: userEntry.pendingRequests,
          currentMemberships: currentMemberships.map((m) => {
            const group = groupMap.get(m.groupId);
            const groupType = group?.groupTypeId ? groupTypeMap.get(group.groupTypeId) : null;
            return {
              groupId: m.groupId,
              groupName: group?.name || "",
              groupTypeSlug: groupType?.slug || "",
              role: m.role,
              joinedAt: m.joinedAt,
            };
          }),
          membershipCountsByType: Object.fromEntries(membershipsByType),
        };
      })
    );

    // Sort by pending requests count descending
    results.sort((a, b) => b.pendingRequestsCount - a.pendingRequestsCount);

    return results;
  },
});

/**
 * Review a pending join request
 *
 * Actions:
 * - accept: Set requestStatus='accepted', clear leftAt, set joinedAt
 * - decline: Set requestStatus='declined'
 */
export const reviewPendingRequest = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    membershipId: v.id("groupMembers"),
    action: v.union(v.literal("accept"), v.literal("decline")),
    declineReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const request = await ctx.db.get(args.membershipId);
    if (!request || request.requestStatus !== "pending") {
      throw new Error("Pending request not found");
    }

    // Verify group belongs to community
    const group = await ctx.db.get(request.groupId);
    if (!group || group.communityId !== args.communityId) {
      throw new Error("Request not found in this community");
    }

    const timestamp = now();

    if (args.action === "accept") {
      await ctx.db.patch(args.membershipId, {
        requestStatus: "accepted",
        leftAt: undefined,
        joinedAt: timestamp,
        requestReviewedAt: timestamp,
        requestReviewedById: userId,
      });

      console.log(`[reviewPendingRequest] Approved join request for user ${request.userId} in group ${request.groupId}, syncing channel memberships...`);

      // Sync channel memberships so the user can access group chat (transactional)
      await syncUserChannelMembershipsLogic(ctx, request.userId, request.groupId);

      console.log(`[reviewPendingRequest] Channel membership sync complete for user ${request.userId}`);

      // Create/update followup score for the approved member
      await ctx.scheduler.runAfter(
        0,
        internal.functions.followupScoreComputation.computeSingleMemberScore,
        { groupId: request.groupId, groupMemberId: args.membershipId }
      );

      await ctx.scheduler.runAfter(
        0,
        internal.functions.communityScoreComputation.recomputeForGroupMember,
        { groupId: request.groupId, userId: request.userId }
      );

      // Check if this is a returning member (had a previous membership before this join request)
      // When a new member creates a join request, joinedAt, leftAt, and requestedAt are all set
      // to the same timestamp. When a returning member creates a join request, their original
      // joinedAt is preserved, so joinedAt !== requestedAt indicates a returning member.
      const isReturningMember = request.joinedAt !== request.requestedAt;

      // Only trigger welcome bot for NEW members, not returning members (non-blocking)
      if (!isReturningMember) {
        await ctx.scheduler.runAfter(
          0,
          internal.functions.scheduledJobs.sendWelcomeMessage,
          {
            groupId: request.groupId,
            userId: request.userId,
          }
        );
      } else {
        console.log(`[reviewPendingRequest] Skipping welcome message for returning member ${request.userId} in group ${request.groupId}`);
      }
    } else {
      await ctx.db.patch(args.membershipId, {
        requestStatus: "declined",
        requestReviewedAt: timestamp,
        requestReviewedById: userId,
      });
    }

    const updatedRequest = await ctx.db.get(args.membershipId);
    return {
      id: updatedRequest?._id,
      status: updatedRequest?.requestStatus,
      reviewedAt: updatedRequest?.requestReviewedAt,
      reviewedById: updatedRequest?.requestReviewedById,
      joinedAt: updatedRequest?.joinedAt,
      leftAt: updatedRequest?.leftAt,
    };
  },
});

// ============================================================================
// Group Creation Requests
// ============================================================================

/**
 * List all pending group creation requests for the community
 */
export const listGroupCreationRequests = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const requests = await ctx.db
      .query("groupCreationRequests")
      .withIndex("by_community_status", (q) =>
        q.eq("communityId", args.communityId).eq("status", "pending")
      )
      .collect();

    // Sort by createdAt desc
    requests.sort((a, b) => b.createdAt - a.createdAt);

    return Promise.all(
      requests.map(async (request) => {
        const requester = await ctx.db.get(request.requesterId);
        const groupType = await ctx.db.get(request.groupTypeId);

        // Get requester stats
        const userCommunity = await ctx.db
          .query("userCommunities")
          .withIndex("by_user_community", (q) =>
            q.eq("userId", request.requesterId).eq("communityId", args.communityId)
          )
          .first();

        const memberships = await ctx.db
          .query("groupMembers")
          .withIndex("by_user", (q) => q.eq("userId", request.requesterId))
          .filter((q) => q.eq(q.field("leftAt"), undefined))
          .collect();

        // Filter to community groups
        const groups = await ctx.db
          .query("groups")
          .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
          .filter((q) => q.eq(q.field("isArchived"), false))
          .collect();
        const groupIds = new Set(groups.map((g) => g._id));

        const communityMemberships = memberships.filter((m) => groupIds.has(m.groupId));
        const groupCount = communityMemberships.length;
        const leaderCount = communityMemberships.filter((m) =>
          LEADER_ROLES.includes(m.role as any)
        ).length;

        // Get proposed leader details
        const proposedLeaderIds = request.proposedLeaderIds || [];
        const proposedLeaders = await Promise.all(
          proposedLeaderIds.map(async (id) => {
            const leader = await ctx.db.get(id as Id<"users">);
            if (!leader) return null;

            // Get leader's groups in this community
            const leaderMemberships = await ctx.db
              .query("groupMembers")
              .withIndex("by_user", (q) => q.eq("userId", id as Id<"users">))
              .filter((q) => q.eq(q.field("leftAt"), undefined))
              .collect();

            const leaderGroups = leaderMemberships
              .filter((m) => groupIds.has(m.groupId))
              .map((m) => {
                const group = groups.find((g) => g._id === m.groupId);
                return group ? group.name : null;
              })
              .filter(Boolean);

            return {
              id: leader._id,
              firstName: leader.firstName,
              lastName: leader.lastName,
              email: leader.email,
              phone: leader.phone,
              profilePhoto: getMediaUrl(leader.profilePhoto),
              groups: leaderGroups,
            };
          })
        );

        return {
          id: request._id,
          name: request.name,
          description: request.description,
          groupType: {
            id: groupType?._id,
            name: groupType?.name,
            slug: groupType?.slug,
            description: groupType?.description,
          },
          proposedStartDay: request.proposedStartDay,
          location: request.city && request.state ? `${request.city}, ${request.state}` : null,
          proposedLeaderCount: proposedLeaderIds.length,
          proposedLeaders: proposedLeaders.filter(Boolean),
          createdAt: request.createdAt,
          requester: {
            id: requester?._id,
            firstName: requester?.firstName,
            lastName: requester?.lastName,
            email: requester?.email,
            phone: requester?.phone,
            profilePhoto: getMediaUrl(requester?.profilePhoto),
            memberSince: userCommunity?.createdAt || null,
            groupCount,
            leaderCount,
          },
        };
      })
    );
  },
});

/**
 * Get single group creation request by ID
 */
export const getGroupCreationRequestById = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    requestId: v.id("groupCreationRequests"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const request = await ctx.db.get(args.requestId);
    if (!request || request.communityId !== args.communityId) {
      throw new Error("Request not found");
    }

    const requester = await ctx.db.get(request.requesterId);
    const groupType = await ctx.db.get(request.groupTypeId);
    const reviewer = request.reviewedById ? await ctx.db.get(request.reviewedById) : null;
    const createdGroup = request.createdGroupId ? await ctx.db.get(request.createdGroupId) : null;

    // Get requester stats
    const userCommunity = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", request.requesterId).eq("communityId", args.communityId)
      )
      .first();

    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", request.requesterId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();
    const groupIds = new Set(groups.map((g) => g._id));

    const communityMemberships = memberships.filter((m) => groupIds.has(m.groupId));
    const groupCount = communityMemberships.length;
    const leaderCount = communityMemberships.filter((m) =>
      LEADER_ROLES.includes(m.role as any)
    ).length;

    // Get proposed leader details
    const proposedLeaderIds = request.proposedLeaderIds || [];
    const proposedLeaders = await Promise.all(
      proposedLeaderIds.map(async (id) => {
        const leader = await ctx.db.get(id as Id<"users">);
        return leader
          ? {
              id: leader._id,
              firstName: leader.firstName,
              lastName: leader.lastName,
              email: leader.email,
              profilePhoto: getMediaUrl(leader.profilePhoto),
            }
          : null;
      })
    );

    // Get current groups for requester
    const currentGroups = await Promise.all(
      communityMemberships.map(async (m) => {
        const group = groups.find((g) => g._id === m.groupId);
        const gt = group?.groupTypeId ? await ctx.db.get(group.groupTypeId) : null;
        return {
          id: m.groupId,
          name: group?.name || "",
          groupTypeName: gt?.name || "",
          role: m.role,
        };
      })
    );

    return {
      id: request._id,
      status: request.status,
      name: request.name,
      description: request.description,
      groupType: {
        id: groupType?._id,
        name: groupType?.name,
        slug: groupType?.slug,
        description: groupType?.description,
      },
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
      preview: getMediaUrl(request.preview),
      proposedLeaders: proposedLeaders.filter(Boolean),
      createdAt: request.createdAt,
      reviewedAt: request.reviewedAt || null,
      declineReason: request.declineReason || null,
      createdGroup: createdGroup
        ? {
            id: createdGroup._id,
            name: createdGroup.name,
          }
        : null,
      requester: {
        id: requester?._id,
        firstName: requester?.firstName,
        lastName: requester?.lastName,
        email: requester?.email,
        phone: requester?.phone,
        profilePhoto: getMediaUrl(requester?.profilePhoto),
        memberSince: userCommunity?.createdAt || null,
        groupCount,
        leaderCount,
        currentGroups,
      },
    };
  },
});

/**
 * Review a group creation request (approve or decline)
 */
export const reviewGroupCreationRequest = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    requestId: v.id("groupCreationRequests"),
    action: v.union(v.literal("approve"), v.literal("decline")),
    modifications: v.optional(
      v.object({
        name: v.optional(v.string()),
        description: v.optional(v.string()),
        groupTypeId: v.optional(v.id("groupTypes")),
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
        leaderIds: v.optional(v.array(v.id("users"))),
      })
    ),
    declineReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const request = await ctx.db.get(args.requestId);
    if (!request || request.communityId !== args.communityId || request.status !== "pending") {
      throw new Error("Pending request not found");
    }

    const timestamp = now();

    if (args.action === "decline") {
      await ctx.db.patch(args.requestId, {
        status: "declined",
        reviewedAt: timestamp,
        reviewedById: userId,
        declineReason: args.declineReason ?? undefined,
        updatedAt: timestamp,
      });

      return { success: true, action: "declined" as const };
    }

    // Approve - create the group
    const mods = args.modifications || {};
    const groupTypeId = mods.groupTypeId ?? request.groupTypeId;

    // Get the final group type
    const finalGroupType = await ctx.db.get(groupTypeId);
    if (!finalGroupType || finalGroupType.communityId !== args.communityId || !finalGroupType.isActive) {
      throw new Error("Invalid group type");
    }

    // Determine final leader IDs (requester is always included)
    const requesterId = request.requesterId;
    let finalLeaderIds: Id<"users">[];
    if (mods.leaderIds) {
      finalLeaderIds = Array.from(new Set([requesterId, ...mods.leaderIds]));
    } else {
      const proposedIds = (request.proposedLeaderIds || []) as Id<"users">[];
      finalLeaderIds = Array.from(new Set([requesterId, ...proposedIds]));
    }

    // Validate leader count to bound the sequential insert loop below
    if (finalLeaderIds.length > MAX_LEADERS_PER_GROUP) {
      throw new Error(`Maximum ${MAX_LEADERS_PER_GROUP} leaders allowed per group`);
    }

    // Create the group
    const groupId = await ctx.db.insert("groups", {
      communityId: args.communityId,
      groupTypeId,
      name: mods.name ?? request.name,
      description: mods.description ?? request.description,
      shortId: generateShortId(), // For shareable links
      isArchived: false,
      addressLine1: mods.addressLine1 ?? request.addressLine1,
      addressLine2: mods.addressLine2 ?? request.addressLine2,
      city: mods.city ?? request.city,
      state: mods.state ?? request.state,
      zipCode: mods.zipCode ?? request.zipCode,
      defaultDay: mods.proposedStartDay ?? request.proposedStartDay,
      defaultStartTime: mods.defaultStartTime ?? request.defaultStartTime,
      defaultEndTime: mods.defaultEndTime ?? request.defaultEndTime,
      defaultMeetingType: mods.defaultMeetingType ?? request.defaultMeetingType ?? 2,
      defaultMeetingLink: mods.defaultMeetingLink ?? request.defaultMeetingLink,
      preview: request.preview,
      isOnBreak: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Add all leaders as group members
    // NOTE: Sequential inserts are intentional here. The loop is bounded by MAX_LEADERS_PER_GROUP,
    // validated above. Convex doesn't support batch inserts.
    for (const leaderId of finalLeaderIds) {
      await ctx.db.insert("groupMembers", {
        groupId,
        userId: leaderId,
        role: "leader",
        joinedAt: timestamp,
        notificationsEnabled: true,
      });
    }

    // Initialize group with channels and community-wide event meetings
    // Uses shared helper to ensure consistent behavior with direct group creation
    const groupName = mods.name ?? request.name;
    await initializeGroupAfterCreation(
      ctx,
      groupId,
      groupName,
      args.communityId,
      groupTypeId,
      finalLeaderIds,  // All leaders get synced to channels
      requesterId      // Requester is the channel creator
    );

    // Update the request as approved
    await ctx.db.patch(args.requestId, {
      status: "approved",
      reviewedAt: timestamp,
      reviewedById: userId,
      createdGroupId: groupId,
      updatedAt: timestamp,
    });

    return {
      success: true,
      action: "approved" as const,
      group: {
        id: groupId,
        name: mods.name ?? request.name,
        groupTypeName: finalGroupType.name,
      },
    };
  },
});
