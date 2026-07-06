/**
 * Shared Channel Mutations
 *
 * Operations specific to shared channels — channels that a primary group
 * shares with one or more secondary groups.
 *
 * Includes:
 * - inviteGroupToChannel: Primary group leader invites a secondary group
 * - respondToChannelInvite: Secondary group leader accepts/declines
 * - removeGroupFromChannel: Either leader removes a secondary group
 * - reorderSharedChannel: Secondary group leader reorders channel position
 */

import { v, ConvexError } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { MutationCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { isLeaderRole } from "../../lib/helpers";
import { getChannelSlug } from "../../lib/slugs";
import {
  updateChannelMemberCount,
  findAcceptedSharedAnnouncementsChannelsForGroup,
  type SharedGroupEntry,
} from "./helpers";
import { restoreOwnAnnouncementsChannelLogic } from "./channels";

// ============================================================================
// Shared Helpers
// ============================================================================

/**
 * Removes a group's entry from a shared channel's `sharedGroups` and
 * soft-deletes channel members who belong ONLY to the removed group (members
 * also in the primary group or another accepted group stay). Recomputes
 * `memberCount` and unsets `isShared` when no entries remain.
 *
 * Returns the removed entry, or null if the group wasn't on the channel.
 * Used by `removeGroupFromChannel` and by the announcements accept-switch
 * path in `respondToChannelInvite`.
 */
async function removeGroupEntryAndCleanupMembers(
  ctx: MutationCtx,
  channel: Doc<"chatChannels">,
  groupId: Id<"groups">,
  now: number
): Promise<SharedGroupEntry | null> {
  const existingSharedGroups = channel.sharedGroups ?? [];
  const groupIndex = existingSharedGroups.findIndex(
    (sg) => sg.groupId === groupId
  );
  if (groupIndex === -1) {
    return null;
  }

  const removedEntry = existingSharedGroups[groupIndex];

  // Remove the entry
  const updatedSharedGroups = existingSharedGroups.filter(
    (_, i) => i !== groupIndex
  );
  const isStillShared = updatedSharedGroups.length > 0;

  // Determine the set of remaining group IDs (primary + other accepted secondary groups)
  const remainingGroupIds = new Set<string>();
  if (channel.groupId) {
    remainingGroupIds.add(channel.groupId); // primary group always remains
  }
  for (const sg of updatedSharedGroups) {
    if (sg.status === "accepted") {
      remainingGroupIds.add(sg.groupId);
    }
  }

  // Get all active channel members
  const activeMembers = await ctx.db
    .query("chatChannelMembers")
    .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
    .filter((q) => q.eq(q.field("leftAt"), undefined))
    .collect();

  // For each active channel member, check if they belong to any remaining group
  for (const member of activeMembers) {
    let belongsToRemainingGroup = false;

    for (const gId of remainingGroupIds) {
      const gMembership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", gId as Id<"groups">).eq("userId", member.userId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();

      if (gMembership) {
        belongsToRemainingGroup = true;
        break;
      }
    }

    if (!belongsToRemainingGroup) {
      // Soft-delete the channel membership
      await ctx.db.patch(member._id, { leftAt: now });
    }
  }

  // Update the channel
  await ctx.db.patch(channel._id, {
    sharedGroups: updatedSharedGroups,
    isShared: isStillShared,
    updatedAt: now,
  });

  // Recompute member count
  await updateChannelMemberCount(ctx, channel._id);

  return removedEntry;
}

// ============================================================================
// Invitation Flow Mutations
// ============================================================================

/**
 * Invite a group to a shared channel.
 *
 * Only leaders of the primary group (the channel's owning group) can invite.
 * Appends a pending entry to the sharedGroups array and sets isShared to true.
 */
export const inviteGroupToChannel = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get the channel
    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError("Channel not found");
    }
    if (!channel.groupId) {
      throw new ConvexError("This operation is only valid for group channels");
    }
    const channelGroupId = channel.groupId;

    // Cannot invite the channel's own group
    if (args.groupId === channelGroupId) {
      throw new ConvexError("Cannot invite the channel's own group");
    }

    // Check that the user is a leader of the primary group
    const primaryGroupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", channelGroupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!primaryGroupMembership || !isLeaderRole(primaryGroupMembership.role)) {
      throw new ConvexError("Only group leaders can invite groups to a channel");
    }

    // Check that the invited group exists
    const invitedGroup = await ctx.db.get(args.groupId);
    if (!invitedGroup) {
      throw new ConvexError("Invited group not found");
    }

    // Enforce same-community sharing boundaries.
    // Shared channels are scoped to groups within the same community.
    const primaryGroup = await ctx.db.get(channelGroupId);
    if (!primaryGroup) {
      throw new ConvexError("Primary group not found");
    }
    if (invitedGroup.communityId !== primaryGroup.communityId) {
      throw new ConvexError("Can only invite groups from the same community");
    }

    // Duplicate check: cannot invite a group that's already in sharedGroups
    const existingSharedGroups = channel.sharedGroups ?? [];
    const alreadyInvited = existingSharedGroups.some(
      (sg) => sg.groupId === args.groupId
    );
    if (alreadyInvited) {
      throw new ConvexError("Group has already been invited to this channel");
    }

    const now = Date.now();

    // Append the new entry
    const updatedSharedGroups = [
      ...existingSharedGroups,
      {
        groupId: args.groupId,
        status: "pending" as const,
        invitedById: userId,
        invitedAt: now,
      },
    ];

    await ctx.db.patch(args.channelId, {
      isShared: true,
      sharedGroups: updatedSharedGroups,
      updatedAt: now,
    });

    // Notify leaders of the invited group
    await ctx.scheduler.runAfter(
      0,
      internal.functions.notifications.senders.notifySharedChannelInvite,
      {
        invitedGroupId: args.groupId,
        primaryGroupId: channelGroupId,
        inviterId: userId,
        channelId: args.channelId,
        channelName: channel.name,
        channelSlug: getChannelSlug(channel),
      }
    );
  },
});

/**
 * Respond to a channel invitation (accept or decline).
 *
 * Only leaders of the invited group can respond.
 * - Accept: updates entry status to "accepted" with responder info.
 * - Decline: removes the entry from sharedGroups.
 */
export const respondToChannelInvite = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    groupId: v.id("groups"),
    response: v.union(v.literal("accepted"), v.literal("declined")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get the channel
    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError("Channel not found");
    }

    // Check that the user is a leader of the invited group
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership || !isLeaderRole(groupMembership.role)) {
      throw new ConvexError("Only group leaders can respond to channel invites");
    }

    // Find the pending invite for this group
    const existingSharedGroups = channel.sharedGroups ?? [];
    const inviteIndex = existingSharedGroups.findIndex(
      (sg) => sg.groupId === args.groupId && sg.status === "pending"
    );

    if (inviteIndex === -1) {
      throw new ConvexError("No pending invite found for this group");
    }

    const now = Date.now();

    if (args.response === "accepted") {
      // Announcements shares have accept-time side effects: the accepting
      // group's members are backfilled into the shared channel and its own
      // announcements channel is disabled (prior state recorded so it can be
      // restored when the group later leaves the share).
      let previousAnnouncementsChannelEnabled: boolean | undefined;

      if (channel.channelType === "announcements") {
        // Guard: a group whose OWN announcements channel is itself shared
        // (pending or accepted entries) can't also receive announcements
        // through another group's channel — unshare first.
        const ownChannel = await ctx.db
          .query("chatChannels")
          .withIndex("by_group_type", (q) =>
            q.eq("groupId", args.groupId).eq("channelType", "announcements")
          )
          .first();
        if (ownChannel && (ownChannel.sharedGroups?.length ?? 0) > 0) {
          throw new ConvexError({
            code: "OWN_CHANNEL_SHARED",
            message:
              "This group's own Announcements channel is shared with other groups. Unshare it before accepting another group's Announcements channel.",
          });
        }

        // Accept = switch: if already an accepted secondary of a DIFFERENT
        // shared announcements channel, leave it (same cleanup as
        // removeGroupFromChannel) — but do NOT restore the own channel
        // mid-switch. Carry the OLD entry's recorded prior state onto the new
        // entry so the true original state is restored on the final leave.
        const acceptedShares = await findAcceptedSharedAnnouncementsChannelsForGroup(
          ctx,
          args.groupId
        );
        let switched = false;
        for (const { channel: otherChannel, entry: oldEntry } of acceptedShares) {
          if (otherChannel._id === args.channelId) continue;
          switched = true;
          previousAnnouncementsChannelEnabled =
            oldEntry.previousAnnouncementsChannelEnabled;
          await removeGroupEntryAndCleanupMembers(
            ctx,
            otherChannel,
            args.groupId,
            now
          );
        }

        const ownChannelEnabled =
          !!ownChannel &&
          ownChannel.isArchived !== true &&
          ownChannel.isEnabled !== false;

        if (!switched) {
          previousAnnouncementsChannelEnabled = ownChannelEnabled;
        }

        // Accepting disables the group's own announcements channel —
        // announcements now flow through the share.
        if (ownChannel && ownChannelEnabled) {
          await ctx.db.patch(ownChannel._id, {
            isEnabled: false,
            disabledByUserId: userId,
            updatedAt: now,
          });
        }
      }

      // Update the entry in place
      const updatedSharedGroups = [...existingSharedGroups];
      updatedSharedGroups[inviteIndex] = {
        ...updatedSharedGroups[inviteIndex],
        status: "accepted",
        respondedById: userId,
        respondedAt: now,
        ...(channel.channelType === "announcements"
          ? { previousAnnouncementsChannelEnabled }
          : {}),
      };

      await ctx.db.patch(args.channelId, {
        sharedGroups: updatedSharedGroups,
        updatedAt: now,
      });

      // Backfill: every active member of the accepting group becomes a
      // channel member (leaders mirror to channel role "admin"), in scheduled
      // batches. `recountMemberCount` because the channel already holds the
      // owning group's members.
      if (channel.channelType === "announcements") {
        await ctx.scheduler.runAfter(
          0,
          internal.functions.messaging.channels.populateChannelMembersBatch,
          {
            groupId: args.groupId,
            channelId: args.channelId,
            mirrorGroupRole: true,
            cursor: null,
            processed: 0,
            recountMemberCount: true,
          }
        );
      }
    } else {
      // Decline: remove the entry from sharedGroups
      const updatedSharedGroups = existingSharedGroups.filter(
        (_, i) => i !== inviteIndex
      );

      const isStillShared = updatedSharedGroups.length > 0;

      await ctx.db.patch(args.channelId, {
        sharedGroups: updatedSharedGroups,
        isShared: isStillShared,
        updatedAt: now,
      });
    }
  },
});

/**
 * Remove a group from a shared channel (opt-out).
 *
 * Can be called by:
 * - A leader of the secondary group being removed (opt-out)
 * - A leader of the primary group (kick)
 *
 * Members who are ONLY in the removed group get soft-deleted from the channel.
 * Members who are also in the primary group or another accepted group stay.
 * memberCount is recomputed after cleanup.
 */
export const removeGroupFromChannel = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get the channel
    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError("Channel not found");
    }
    if (!channel.groupId) {
      throw new ConvexError("This operation is only valid for group channels");
    }
    const channelGroupId = channel.groupId;

    // Authorization: user must be a leader of either the primary group or the group being removed
    const primaryGroupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", channelGroupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    const targetGroupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    const isPrimaryLeader =
      primaryGroupMembership && isLeaderRole(primaryGroupMembership.role);
    const isTargetLeader =
      targetGroupMembership && isLeaderRole(targetGroupMembership.role);

    if (!isPrimaryLeader && !isTargetLeader) {
      throw new ConvexError(
        "Only leaders of the primary or secondary group can remove a group from the channel"
      );
    }

    const now = Date.now();

    // Remove the entry and soft-delete members exclusive to the removed group
    const removedEntry = await removeGroupEntryAndCleanupMembers(
      ctx,
      channel,
      args.groupId,
      now
    );

    if (!removedEntry) {
      throw new ConvexError("Group is not shared on this channel");
    }

    // Leaving an announcements share restores the group's own announcements
    // channel if accepting the share is what disabled it.
    if (
      channel.channelType === "announcements" &&
      removedEntry.status === "accepted" &&
      removedEntry.previousAnnouncementsChannelEnabled === true
    ) {
      await restoreOwnAnnouncementsChannelLogic(ctx, args.groupId, userId);
    }
  },
});

// ============================================================================
// Channel Ordering Mutation
// ============================================================================

/**
 * Reorder a shared channel for a secondary group.
 *
 * Updates the `sortOrder` in the matching `sharedGroups` entry so that
 * the secondary group can control the position of this shared channel
 * in their channel list.
 *
 * - Only leaders of the secondary group can reorder.
 * - Cannot reorder for the primary group (use `pinnedChannelSlugs` instead).
 * - Can only reorder accepted shared channels (not pending).
 */
export const reorderSharedChannel = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    groupId: v.id("groups"), // The secondary group doing the reordering
    sortOrder: v.number(),
  },
  handler: async (ctx, args) => {
    // 1. Auth
    const userId = await requireAuth(ctx, args.token);

    // 2. Verify caller is leader of args.groupId
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!membership || !isLeaderRole(membership.role)) {
      throw new ConvexError(
        "You must be a leader of this group to reorder shared channels"
      );
    }

    // 3. Get channel, verify it's shared
    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError("Channel not found");
    }
    if (!channel.isShared || !channel.sharedGroups) {
      throw new ConvexError("This channel is not shared");
    }

    // 4. Cannot reorder for the primary group
    if (channel.groupId === args.groupId) {
      throw new ConvexError(
        "Cannot reorder for the primary group. Use pinnedChannelSlugs instead."
      );
    }

    // 5. Find the entry in sharedGroups for args.groupId with status "accepted"
    const entryIndex = channel.sharedGroups.findIndex(
      (sg) => sg.groupId === args.groupId
    );
    if (entryIndex === -1) {
      throw new ConvexError("This group is not part of this shared channel");
    }

    const entry = channel.sharedGroups[entryIndex];
    if (entry.status !== "accepted") {
      throw new ConvexError(
        "Can only reorder accepted shared channels, not pending ones"
      );
    }

    // 6. Update sortOrder in that entry
    const updatedSharedGroups = [...channel.sharedGroups];
    updatedSharedGroups[entryIndex] = {
      ...entry,
      sortOrder: args.sortOrder,
    };

    // 7. Patch the channel with updated sharedGroups array
    await ctx.db.patch(args.channelId, {
      sharedGroups: updatedSharedGroups,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// ============================================================================
// Queries
// ============================================================================

/**
 * List pending shared channel invitations for a group.
 *
 * Returns pending invites where the given group has been invited to a shared channel.
 * Only leaders of the group can see invites.
 */
export const listPendingInvitesForGroup = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Check that the user is a leader of the group
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!membership || !isLeaderRole(membership.role)) {
      return [];
    }

    // Find all shared channels where this group has a pending invite
    // Use index on isShared to avoid full table scan
    const sharedChannels = await ctx.db
      .query("chatChannels")
      .withIndex("by_isShared", (q) => q.eq("isShared", true))
      .filter((q) => q.eq(q.field("archivedAt"), undefined))
      .collect();

    const results = [];

    for (const channel of sharedChannels) {
      if (!channel.groupId) continue; // Skip ad-hoc channels (DM/group_dm)
      const sharedGroups = channel.sharedGroups ?? [];
      const pendingEntry = sharedGroups.find(
        (sg) => sg.groupId === args.groupId && sg.status === "pending"
      );

      if (!pendingEntry) continue;

      // Get primary group name
      const primaryGroup = await ctx.db.get(channel.groupId);
      const primaryGroupName = primaryGroup?.name ?? "Unknown Group";

      // Get inviter name
      let invitedByName = "Someone";
      if (pendingEntry.invitedById) {
        const inviter = await ctx.db.get(pendingEntry.invitedById as Id<"users">);
        if (inviter) {
          invitedByName = [inviter.firstName, inviter.lastName].filter(Boolean).join(" ") || "Someone";
        }
      }

      results.push({
        channelId: channel._id,
        channelName: channel.name,
        channelType: channel.channelType,
        channelSlug: getChannelSlug(channel),
        primaryGroupId: channel.groupId,
        primaryGroupName,
        invitedByName,
        invitedAt: pendingEntry.invitedAt,
      });
    }

    return results;
  },
});

/**
 * List active shared channels for a group.
 *
 * Returns accepted shared channels where the group is a secondary participant.
 * Only leaders of the group can see these.
 */
export const listActiveSharedChannelsForGroup = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Check that the user is a leader of the group
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!membership || !isLeaderRole(membership.role)) {
      return [];
    }

    // Find all shared channels where this group has an accepted invite
    // Use index on isShared to avoid full table scan
    const sharedChannels = await ctx.db
      .query("chatChannels")
      .withIndex("by_isShared", (q) => q.eq("isShared", true))
      .filter((q) => q.eq(q.field("archivedAt"), undefined))
      .collect();

    const results = [];

    for (const channel of sharedChannels) {
      if (!channel.groupId) continue; // Skip ad-hoc channels (DM/group_dm)
      const sharedGroups = channel.sharedGroups ?? [];
      const acceptedEntry = sharedGroups.find(
        (sg) => sg.groupId === args.groupId && sg.status === "accepted"
      );

      if (!acceptedEntry) continue;

      // Get primary group name
      const primaryGroup = await ctx.db.get(channel.groupId);
      const primaryGroupName = primaryGroup?.name ?? "Unknown Group";

      results.push({
        channelId: channel._id,
        channelName: channel.name,
        channelType: channel.channelType,
        primaryGroupId: channel.groupId,
        primaryGroupName,
        memberCount: channel.memberCount ?? 0,
        acceptedAt: acceptedEntry.respondedAt,
      });
    }

    return results;
  },
});

// ============================================================================
// Cancel Invitation Mutation
// ============================================================================

/**
 * Cancel a pending channel invitation.
 *
 * Only leaders of the primary group (channel owner) can cancel invites.
 * Removes the pending entry from sharedGroups array.
 */
export const cancelChannelInvite = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get the channel
    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError("Channel not found");
    }
    if (!channel.groupId) {
      throw new ConvexError("This operation is only valid for group channels");
    }
    const channelGroupId = channel.groupId;

    // Check that the user is a leader of the primary group
    const primaryGroupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", channelGroupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!primaryGroupMembership || !isLeaderRole(primaryGroupMembership.role)) {
      throw new ConvexError("Only primary group leaders can cancel invitations");
    }

    // Find the pending invite for this group
    const existingSharedGroups = channel.sharedGroups ?? [];
    const inviteIndex = existingSharedGroups.findIndex(
      (sg) => sg.groupId === args.groupId && sg.status === "pending"
    );

    if (inviteIndex === -1) {
      throw new ConvexError("No pending invite found for this group");
    }

    const now = Date.now();

    // Remove the pending entry
    const updatedSharedGroups = existingSharedGroups.filter(
      (_, i) => i !== inviteIndex
    );

    const isStillShared = updatedSharedGroups.length > 0;

    await ctx.db.patch(args.channelId, {
      sharedGroups: updatedSharedGroups,
      isShared: isStillShared,
      updatedAt: now,
    });
  },
});
