/**
 * Group mutations
 *
 * Write operations for groups (create, update, join, leave, etc.)
 */

import { v, ConvexError } from "convex/values";
import { mutation, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Doc, Id } from "../../_generated/dataModel";
import { now, generateShortId } from "../../lib/utils";
import { groupRoleValidator } from "../../lib/validators";
import { requireAuth } from "../../lib/auth";
import { validateScoreConfig, type ScoreConfig } from "../followupScoring";
import { VALID_CUSTOM_SLOTS } from "../../lib/followupConstants";
import { isCommunityAdmin, requireCommunityAdmin } from "../../lib/permissions";
import { isActiveLeader, isActiveMembership } from "../../lib/helpers";
import {
  DEFAULT_REMINDER_OFFSET_MS,
  DEFAULT_MEETING_DURATION_MS,
  DEFAULT_ATTENDANCE_CONFIRMATION_OFFSET_MS,
  DEFAULT_RSVP_OPTIONS,
} from "../../lib/meetingConfig";
import { syncUserChannelMembershipsLogic } from "../sync/memberships";
import { ensureChannelsForGroupLogic } from "../messaging/channels";
import { MutationCtx } from "../../_generated/server";

// ============================================================================
// Shared Helper Functions
// ============================================================================

/**
 * Initialize a newly created group with channels and community-wide event meetings.
 *
 * This function should be called after creating a group and its initial members.
 * It handles:
 * 1. Creating chat channels (main + leaders)
 * 2. Syncing all provided member IDs to their appropriate channels
 * 3. Auto-spawning meetings for any upcoming community-wide events
 *
 * IMPORTANT: This runs within the same transaction as the caller, ensuring atomicity.
 * If any step fails, the entire group creation will roll back.
 *
 * @param ctx - Mutation context
 * @param groupId - The newly created group's ID
 * @param groupName - The group's name (for channel naming)
 * @param communityId - The community this group belongs to
 * @param groupTypeId - The group type (for matching community-wide events)
 * @param memberIds - User IDs to sync to channels (typically the initial leaders)
 * @param channelCreatorId - User ID to attribute channel creation to
 */
export async function initializeGroupAfterCreation(
  ctx: MutationCtx,
  groupId: Id<"groups">,
  groupName: string,
  communityId: Id<"communities">,
  groupTypeId: Id<"groupTypes">,
  memberIds: Id<"users">[],
  channelCreatorId: Id<"users">
): Promise<void> {
  const timestamp = now();

  // 1. Create chat channels (main + leaders)
  await ensureChannelsForGroupLogic(ctx, groupId, channelCreatorId, groupName);

  // 2. Sync all members to their appropriate channels
  for (const memberId of memberIds) {
    await syncUserChannelMembershipsLogic(ctx, memberId, groupId);
  }

  // 3. Auto-spawn meetings for upcoming community-wide events
  const upcomingCommunityEvents = await ctx.db
    .query("communityWideEvents")
    .withIndex("by_community_groupType", (q) =>
      q.eq("communityId", communityId).eq("groupTypeId", groupTypeId)
    )
    .filter((q) =>
      q.and(
        q.eq(q.field("status"), "scheduled"),
        q.gt(q.field("scheduledAt"), timestamp)
      )
    )
    .collect();

  for (const event of upcomingCommunityEvents) {
    const reminderAt = event.scheduledAt - DEFAULT_REMINDER_OFFSET_MS;
    const meetingEndTime = event.scheduledAt + DEFAULT_MEETING_DURATION_MS;
    const attendanceConfirmationAt = meetingEndTime + DEFAULT_ATTENDANCE_CONFIRMATION_OFFSET_MS;

    const meetingId = await ctx.db.insert("meetings", {
      groupId,
      createdById: event.createdById,
      title: event.title,
      scheduledAt: event.scheduledAt,
      meetingType: event.meetingType,
      meetingLink: event.meetingLink,
      note: event.note,
      status: "scheduled",
      visibility: "community",
      createdAt: timestamp,
      communityWideEventId: event._id,
      isOverridden: false,
      shortId: generateShortId(),
      rsvpEnabled: true,
      rsvpOptions: DEFAULT_RSVP_OPTIONS,
      reminderAt,
      reminderSent: false,
      attendanceConfirmationAt,
      attendanceConfirmationSent: false,
    });

    if (reminderAt > timestamp) {
      await ctx.scheduler.runAt(
        reminderAt,
        internal.functions.scheduledJobs.sendMeetingReminder,
        { meetingId }
      );
    }

    if (attendanceConfirmationAt > timestamp) {
      await ctx.scheduler.runAt(
        attendanceConfirmationAt,
        internal.functions.scheduledJobs.sendAttendanceConfirmation,
        { meetingId }
      );
    }
  }

  console.log(`[initializeGroupAfterCreation] Group ${groupId} initialized with channels and ${upcomingCommunityEvents.length} community-wide event meetings`);
}

/**
 * Check if a user has permission to manage a group (is a leader/admin of the group,
 * or is a community admin). Returns the group if the user has permission,
 * throws an error otherwise.
 *
 * @param ctx - Mutation context
 * @param groupId - The group to check access for
 * @param userId - The user to check permissions for
 * @param action - Description of the action for error messages (e.g., "update toolbar settings")
 * @returns The group document if user has permission
 */
async function requireGroupLeaderOrCommunityAdmin(
  ctx: MutationCtx,
  groupId: Id<"groups">,
  userId: Id<"users">,
  action: string
): Promise<{ group: Doc<"groups"> }> {
  const group = await ctx.db.get(groupId);
  if (!group) {
    throw new Error("Group not found");
  }

  // Check if user is a group leader/admin
  const membership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q) =>
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

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new group
 */
export const create = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    name: v.string(),
    description: v.optional(v.string()),
    groupTypeId: v.id("groupTypes"),
    isPublic: v.optional(v.boolean()),
    // Optional meeting defaults
    defaultDay: v.optional(v.number()),
    defaultStartTime: v.optional(v.string()),
    defaultEndTime: v.optional(v.string()),
    defaultMeetingType: v.optional(v.number()),
    defaultMeetingLink: v.optional(v.string()),
    // Address fields
    addressLine1: v.optional(v.string()),
    addressLine2: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    zipCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Only community admins can create groups directly
    // Regular users should use the group creation request flow
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const timestamp = now();

    // Create the group
    const groupId = await ctx.db.insert("groups", {
      communityId: args.communityId,
      name: args.name,
      description: args.description,
      groupTypeId: args.groupTypeId,
      isPublic: args.isPublic ?? true,
      isArchived: false,
      shortId: generateShortId(), // For shareable links
      defaultDay: args.defaultDay,
      defaultStartTime: args.defaultStartTime,
      defaultEndTime: args.defaultEndTime,
      defaultMeetingType: args.defaultMeetingType,
      defaultMeetingLink: args.defaultMeetingLink,
      addressLine1: args.addressLine1,
      addressLine2: args.addressLine2,
      city: args.city,
      state: args.state,
      zipCode: args.zipCode,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Add creator as leader
    await ctx.db.insert("groupMembers", {
      groupId,
      userId,
      role: "leader",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    // Initialize group with channels and community-wide event meetings
    // This shared helper ensures consistent behavior across all group creation paths
    await initializeGroupAfterCreation(
      ctx,
      groupId,
      args.name,
      args.communityId,
      args.groupTypeId,
      [userId], // Creator is the only initial member
      userId    // Creator is also the channel creator
    );

    return groupId;
  },
});

/**
 * Update a group
 */
export const update = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    preview: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
    defaultDay: v.optional(v.number()),
    defaultStartTime: v.optional(v.string()),
    defaultEndTime: v.optional(v.string()),
    defaultMeetingType: v.optional(v.number()),
    defaultMeetingLink: v.optional(v.string()),
    addressLine1: v.optional(v.string()),
    addressLine2: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    isOnBreak: v.optional(v.boolean()),
    breakUntil: v.optional(v.number()),
    isArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Require authentication for updating groups
    const userId = await requireAuth(ctx, args.token);
    const { groupId, token: _token, ...updates } = args;

    // Check permission
    const { group: currentGroup } = await requireGroupLeaderOrCommunityAdmin(
      ctx,
      groupId,
      userId,
      "edit this group"
    );

    // Filter out undefined values
    const cleanedUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, val]) => val !== undefined)
    );

    // Automatically set/clear archivedAt based on isArchived
    if (args.isArchived === true) {
      (cleanedUpdates as Record<string, unknown>).archivedAt = now();
    } else if (args.isArchived === false) {
      (cleanedUpdates as Record<string, unknown>).archivedAt = undefined;
    }

    await ctx.db.patch(groupId, {
      ...cleanedUpdates,
      updatedAt: now(),
    });

    // ====================================================================
    // Archive cascade: when a group is archived, cascade to channels
    // ====================================================================
    if (args.isArchived === true) {
      const timestamp = now();

      // --- Primary group cascade ---
      // Archive all channels owned by this group
      const ownedChannels = await ctx.db
        .query("chatChannels")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect();

      for (const channel of ownedChannels) {
        // Preserve historical archive metadata if this channel was archived earlier.
        if (channel.isArchived) {
          continue;
        }

        // Archive the channel
        await ctx.db.patch(channel._id, {
          isArchived: true,
          archivedAt: timestamp,
          updatedAt: timestamp,
          memberCount: 0,
        });

        // Soft-delete all active channel members
        const activeMembers = await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
          .filter((q) => q.eq(q.field("leftAt"), undefined))
          .collect();

        for (const member of activeMembers) {
          await ctx.db.patch(member._id, { leftAt: timestamp });
        }
      }

      // --- Secondary group cascade ---
      // Remove this group from shared channels in the same community.
      // Shared channels are community-scoped, so avoid scanning globally.
      const communityGroups = await ctx.db
        .query("groups")
        .withIndex("by_community", (q) =>
          q.eq("communityId", currentGroup.communityId)
        )
        .collect();

      for (const communityGroup of communityGroups) {
        // Skip the archived group's own channels; primary cascade already handled them.
        if (communityGroup._id === groupId) {
          continue;
        }

        const communityGroupChannels = await ctx.db
          .query("chatChannels")
          .withIndex("by_group", (q) => q.eq("groupId", communityGroup._id))
          .collect();

        for (const channel of communityGroupChannels) {
          if (!channel.isShared) {
            continue;
          }

          const sharedGroups = channel.sharedGroups ?? [];
          const entryIndex = sharedGroups.findIndex(
            (sg) => sg.groupId === groupId
          );
          if (entryIndex === -1) continue;

          // Remove the archived group's entry from sharedGroups
          const updatedSharedGroups = sharedGroups.filter(
            (sg) => sg.groupId !== groupId
          );

          // Determine which members are exclusive to the removed group
          // and should be soft-deleted from the channel
          const remainingGroupIds = new Set([
            channel.groupId, // primary group
            ...updatedSharedGroups
              .filter((sg) => sg.status === "accepted")
              .map((sg) => sg.groupId),
          ]);

          // Get all active channel members
          const channelMembers = await ctx.db
            .query("chatChannelMembers")
            .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
            .filter((q) => q.eq(q.field("leftAt"), undefined))
            .collect();

          for (const cm of channelMembers) {
            // Check if this member belongs to any of the remaining groups
            let belongsToRemainingGroup = false;
            for (const remainingGId of remainingGroupIds) {
              const gm = await ctx.db
                .query("groupMembers")
                .withIndex("by_group_user", (q) =>
                  q.eq("groupId", remainingGId).eq("userId", cm.userId)
                )
                .filter((q) => q.eq(q.field("leftAt"), undefined))
                .first();
              if (gm) {
                belongsToRemainingGroup = true;
                break;
              }
            }

            if (!belongsToRemainingGroup) {
              await ctx.db.patch(cm._id, { leftAt: timestamp });
            }
          }

          // Recompute active member count after soft-deleting members
          const remainingActiveMembers = await ctx.db
            .query("chatChannelMembers")
            .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
            .filter((q) => q.eq(q.field("leftAt"), undefined))
            .collect();

          // Update the channel
          const channelUpdate: Record<string, unknown> = {
            sharedGroups: updatedSharedGroups,
            updatedAt: timestamp,
            memberCount: remainingActiveMembers.length,
          };
          if (updatedSharedGroups.length === 0) {
            channelUpdate.isShared = false;
          }
          await ctx.db.patch(channel._id, channelUpdate);
        }
      }
    }

    return await ctx.db.get(groupId);
  },
});

/**
 * Join a group
 */
export const join = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const timestamp = now();

    // Check if group exists and is not archived
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new Error("Group not found");
    }
    if (group.isArchived) {
      throw new Error("This group is archived and not accepting new members");
    }

    // Check if this is a private group
    if (!group.isPublic) {
      throw new Error("This is a private group. Please request to join.");
    }

    // Check if already a member
    const existing = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .first();

    if (existing) {
      // Reactivate if previously left
      if (existing.leftAt) {
        await ctx.db.patch(existing._id, {
          leftAt: undefined,
          joinedAt: timestamp,
        });
        // Sync channel memberships after rejoin (transactional)
        await syncUserChannelMembershipsLogic(ctx, userId, args.groupId);

        // Check and sync to PCO auto-channels (background job)
        // Delay allows any PCO person linking to complete first
        await ctx.scheduler.runAfter(
          2000,
          internal.functions.pcoServices.rotation.checkAndSyncUserToAutoChannels,
          { userId, groupId: args.groupId }
        );

        // Create followup score doc for reactivated member
        await ctx.scheduler.runAfter(
          0,
          internal.functions.followupScoreComputation.computeSingleMemberScore,
          { groupId: args.groupId, groupMemberId: existing._id }
        );
      }
      return existing._id;
    }

    // Create new membership
    const membershipId = await ctx.db.insert("groupMembers", {
      groupId: args.groupId,
      userId,
      role: "member",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    // Sync channel memberships after join (transactional)
    await syncUserChannelMembershipsLogic(ctx, userId, args.groupId);

    // Check and sync to PCO auto-channels (background job)
    // Delay allows any PCO person linking to complete first
    await ctx.scheduler.runAfter(
      2000,
      internal.functions.pcoServices.rotation.checkAndSyncUserToAutoChannels,
      { userId, groupId: args.groupId }
    );

    // Create followup score doc for new member
    await ctx.scheduler.runAfter(
      0,
      internal.functions.followupScoreComputation.computeSingleMemberScore,
      { groupId: args.groupId, groupMemberId: membershipId }
    );

    return membershipId;
  },
});

/**
 * Leave a group
 */
export const leave = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .first();

    if (!membership) {
      throw new Error("Not a member of this group");
    }

    // Leaders cannot leave, they must transfer leadership first
    if (membership.role === "leader") {
      throw new Error("Leaders must transfer leadership before leaving");
    }

    // Soft delete - set leftAt
    await ctx.db.patch(membership._id, {
      leftAt: now(),
    });

    // Delete followup score doc for departing member
    await ctx.scheduler.runAfter(
      0,
      internal.functions.followupScoreComputation.deleteScoreDoc,
      { groupMemberId: membership._id }
    );

    // Sync channel memberships after leave (transactional - removes from all group channels)
    await syncUserChannelMembershipsLogic(ctx, userId, args.groupId);

    return true;
  },
});

/**
 * Update member role (for the target user, requires caller to be authenticated)
 */
export const updateMemberRole = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    targetUserId: v.id("users"),
    role: groupRoleValidator,
  },
  handler: async (ctx, args) => {
    // Require auth - caller must be authenticated
    const callerId = await requireAuth(ctx, args.token);

    // Get the group first to check if it's an announcement group
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new Error("Group not found");
    }

    // SECURITY: Block role changes in announcement groups
    // Announcement group roles are managed automatically based on community admin status
    if (group.isAnnouncementGroup) {
      throw new Error(
        "Cannot manually change roles in announcement groups. Roles are managed automatically based on community admin status."
      );
    }

    // Verify caller is a leader of this group
    const callerMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", callerId)
      )
      .first();

    if (!isActiveLeader(callerMembership)) {
      throw new Error("Only group leaders can change member roles");
    }

    // Find the target user's membership
    const targetMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", args.targetUserId)
      )
      .first();

    if (!isActiveMembership(targetMembership)) {
      throw new Error("Not a member of this group");
    }

    await ctx.db.patch(targetMembership._id, {
      role: args.role,
    });

    // Sync channel memberships after role change (transactional - handles leader promotion/demotion)
    await syncUserChannelMembershipsLogic(ctx, args.targetUserId, args.groupId);

    return true;
  },
});

/**
 * Backfill shortIds for existing groups that don't have one
 * Run this once after deploying the share feature
 *
 * Usage: npx convex run functions/groups:backfillShortIds
 */
export const backfillShortIds = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Get all groups without a shortId
    const groups = await ctx.db.query("groups").collect();
    const groupsWithoutShortId = groups.filter((g) => !g.shortId);

    let updated = 0;
    for (const group of groupsWithoutShortId) {
      await ctx.db.patch(group._id, {
        shortId: generateShortId(),
      });
      updated++;
    }

    return {
      total: groups.length,
      updated,
      message: `Backfilled shortIds for ${updated} groups`,
    };
  },
});

/**
 * Update the leader toolbar tools for a group
 */
export const updateLeaderToolbarTools = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    tools: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Check permission
    await requireGroupLeaderOrCommunityAdmin(
      ctx,
      args.groupId,
      userId,
      "update this group's tools"
    );

    // Validate tool IDs
    // NOTE: This list must match apps/mobile/features/chat/constants/toolbarTools.ts
    // Backend validates independently for security; frontend uses for UI rendering.
    const allowedBuiltInTools = ["attendance", "followup", "tasks", "events", "bots", "sync", "runsheet"];
    for (const tool of args.tools) {
      // Allow built-in tools
      if (allowedBuiltInTools.includes(tool)) {
        continue;
      }
      // Allow resource tools (format: resource:<resourceId>)
      if (tool.startsWith("resource:")) {
        const resourceId = tool.replace("resource:", "") as Id<"groupResources">;
        // Validate the resource exists and belongs to this group
        const resource = await ctx.db.get(resourceId);
        if (!resource || resource.groupId !== args.groupId) {
          throw new Error(`Invalid resource tool ID: ${tool}. Resource not found or doesn't belong to this group.`);
        }
        continue;
      }
      throw new Error(`Invalid tool ID: ${tool}. Allowed tools are: ${allowedBuiltInTools.join(", ")} or resource:<resourceId>`);
    }

    // Deduplicate while preserving order
    const uniqueTools = [...new Set(args.tools)];

    await ctx.db.patch(args.groupId, {
      leaderToolbarTools: uniqueTools,
      updatedAt: now(),
    });

    return { success: true };
  },
});

/**
 * Update toolbar visibility settings for a group
 * Controls which tools are visible to non-leader members
 */
export const updateToolbarVisibility = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    showToolbarToMembers: v.optional(v.boolean()),
    toolVisibility: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Check permission
    await requireGroupLeaderOrCommunityAdmin(
      ctx,
      args.groupId,
      userId,
      "update toolbar visibility settings"
    );

    // Validate toolVisibility values if provided
    if (args.toolVisibility) {
      const allowedVisibilities = ["leaders", "everyone"];
      for (const [toolId, visibility] of Object.entries(args.toolVisibility)) {
        if (!allowedVisibilities.includes(visibility)) {
          throw new Error(`Invalid visibility "${visibility}" for tool "${toolId}". Allowed values are: ${allowedVisibilities.join(", ")}`);
        }
      }
    }

    // Build the update object (only include fields that were provided)
    const updates: Record<string, unknown> = {
      updatedAt: now(),
    };

    if (args.showToolbarToMembers !== undefined) {
      updates.showToolbarToMembers = args.showToolbarToMembers;
    }

    if (args.toolVisibility !== undefined) {
      updates.toolVisibility = args.toolVisibility;
    }

    await ctx.db.patch(args.groupId, updates);

    return { success: true };
  },
});

/**
 * Update Run Sheet configuration for a group
 * Stores default service type filters and view preferences
 */
export const updateRunSheetConfig = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    runSheetConfig: v.object({
      defaultServiceTypeIds: v.optional(v.array(v.string())),
      defaultView: v.optional(v.string()),
      chipConfig: v.optional(
        v.object({
          hidden: v.array(v.string()),
          order: v.array(v.string()),
        })
      ),
    }),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Check permission
    await requireGroupLeaderOrCommunityAdmin(
      ctx,
      args.groupId,
      userId,
      "update run sheet config"
    );

    // Validate defaultView if provided
    if (args.runSheetConfig.defaultView) {
      const allowedViews = ["compact", "detailed"];
      if (!allowedViews.includes(args.runSheetConfig.defaultView)) {
        throw new Error(`Invalid view "${args.runSheetConfig.defaultView}". Allowed values are: ${allowedViews.join(", ")}`);
      }
    }

    await ctx.db.patch(args.groupId, {
      runSheetConfig: args.runSheetConfig,
      updatedAt: now(),
    });

    return { success: true };
  },
});

/**
 * Update follow-up score configuration for a group
 * Allows group leaders/community admins to define custom scoring formulas.
 * Pass undefined/null to reset to defaults.
 */
export const updateFollowupScoreConfig = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    followupScoreConfig: v.optional(v.object({
      scores: v.array(v.object({
        id: v.string(),
        name: v.string(),
        variables: v.array(v.object({
          variableId: v.string(),
          weight: v.number(),
        })),
      })),
      memberSubtitle: v.optional(v.string()),
      alerts: v.optional(v.array(v.object({
        id: v.string(),
        variableId: v.string(),
        operator: v.string(),
        threshold: v.number(),
        label: v.optional(v.string()),
      }))),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Check permission
    await requireGroupLeaderOrCommunityAdmin(
      ctx,
      args.groupId,
      userId,
      "update follow-up score configuration"
    );

    // If config provided, validate it
    if (args.followupScoreConfig) {
      validateScoreConfig(args.followupScoreConfig as ScoreConfig);
    }

    await ctx.db.patch(args.groupId, {
      followupScoreConfig: args.followupScoreConfig,
      updatedAt: now(),
    });

    // Recompute all scores for this group since the scoring formula changed
    await ctx.scheduler.runAfter(
      0,
      internal.functions.followupScoreComputation.computeGroupScores,
      { groupId: args.groupId, trigger: "score_config_update" }
    );

    return { success: true };
  },
});

/**
 * Manually refresh the follow-up denormalized table for a group.
 * Useful when leaders want an immediate recomputation instead of waiting for cron/event updates.
 */
export const refreshFollowupScores = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const { group } = await requireGroupLeaderOrCommunityAdmin(
      ctx,
      args.groupId,
      userId,
      "refresh follow-up scores"
    );

    if (group.followupRefreshState?.status === "running") {
      return {
        success: true,
        alreadyRunning: true,
        runId: group.followupRefreshState.runId,
        startedAt: group.followupRefreshState.startedAt,
      };
    }

    const startedAt = now();
    const runId = `manual_${startedAt}_${Math.random().toString(36).slice(2, 8)}`;

    await ctx.db.patch(args.groupId, {
      followupRefreshState: {
        status: "running",
        runId,
        startedAt,
        requestedById: userId,
        trigger: "manual",
      },
      updatedAt: startedAt,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.functions.followupScoreComputation.computeGroupScores,
      { groupId: args.groupId, runId, requestedById: userId, trigger: "manual" }
    );

    return { success: true, alreadyRunning: false, runId, startedAt };
  },
});

/**
 * Save follow-up column configuration (column order, visibility, custom fields).
 * Pass undefined to clear the config.
 */
const SLOT_PREFIX_TYPE: Record<string, string[]> = {
  customText: ["text", "dropdown", "multiselect"],
  customNum: ["number"],
  customBool: ["boolean"],
};

export const saveFollowupColumnConfig = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    followupColumnConfig: v.optional(v.object({
      columnOrder: v.array(v.string()),
      hiddenColumns: v.array(v.string()),
      customFields: v.array(v.object({
        slot: v.string(),
        name: v.string(),
        type: v.string(),
        options: v.optional(v.array(v.string())),
      })),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const { group } = await requireGroupLeaderOrCommunityAdmin(
      ctx,
      args.groupId,
      userId,
      "update follow-up column configuration"
    );

    // Validate if config provided
    if (args.followupColumnConfig) {
      const existingFieldsBySlot = new Map(
        ((group.followupColumnConfig as any)?.customFields ?? []).map((field: any) => [
          field.slot,
          field,
        ])
      );
      const usedSlots = new Set<string>();
      for (const field of args.followupColumnConfig.customFields) {
        // Validate slot name
        if (!VALID_CUSTOM_SLOTS.has(field.slot)) {
          throw new ConvexError(`Invalid slot name: ${field.slot}`);
        }
        // Validate no duplicate slots
        if (usedSlots.has(field.slot)) {
          throw new ConvexError(`Duplicate slot: ${field.slot}`);
        }
        usedSlots.add(field.slot);
        // Validate type matches slot prefix
        const prefix = field.slot.replace(/\d+$/, "");
        const allowedTypes = SLOT_PREFIX_TYPE[prefix];
        if (!allowedTypes || !allowedTypes.includes(field.type)) {
          throw new ConvexError(`Slot ${field.slot} does not support type "${field.type}"`);
        }
        if (field.type === "dropdown" || field.type === "multiselect") {
          const options = field.options?.map((opt) => opt.trim()).filter(Boolean) ?? [];
          if (options.length === 0) {
            const existingField = existingFieldsBySlot.get(field.slot) as
              | { type?: string; options?: string[] }
              | undefined;
            const existingOptions = existingField?.options?.map((opt) => opt.trim()).filter(Boolean) ?? [];
            const isLegacyInvalidField =
              !!existingField &&
              existingField.type === field.type &&
              existingOptions.length === 0;
            if (!isLegacyInvalidField) {
              throw new ConvexError(`Field "${field.name}" requires at least one option`);
            }
          }
          if (options.some((opt) => opt.includes(";"))) {
            throw new ConvexError(`Field "${field.name}" options cannot contain semicolons`);
          }
        }
      }
    }

    await ctx.db.patch(args.groupId, {
      followupColumnConfig: args.followupColumnConfig,
      updatedAt: now(),
    });

    return { success: true };
  },
});

/**
 * Update a custom display name for a built-in tool.
 * Pass an empty string or undefined to reset to the default label.
 */
export const updateToolDisplayName = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    toolId: v.string(),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    await requireGroupLeaderOrCommunityAdmin(
      ctx,
      args.groupId,
      userId,
      "update tool display name"
    );

    const group = await ctx.db.get(args.groupId);
    if (!group) throw new Error("Group not found");

    const current = group.toolDisplayNames ?? {};
    const trimmed = args.displayName?.trim();

    if (trimmed) {
      current[args.toolId] = trimmed;
    } else {
      delete current[args.toolId];
    }

    await ctx.db.patch(args.groupId, {
      toolDisplayNames: Object.keys(current).length > 0 ? current : undefined,
      updatedAt: now(),
    });

    return { success: true };
  },
});
