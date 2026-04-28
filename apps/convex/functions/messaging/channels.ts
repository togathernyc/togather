/**
 * Channel Functions for Convex-Native Messaging
 *
 * Channel CRUD operations, membership management, and access control.
 */

import { v, ConvexError } from "convex/values";
import { query, mutation, action, internalMutation } from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Id, Doc } from "../../_generated/dataModel";
import { requireAuth, requireAuthFromTokenAction } from "../../lib/auth";
import { getDisplayName, getMediaUrl } from "../../lib/utils";
import {
  isAutoChannel,
  isCustomChannel,
  isLeaderRole,
  channelIsLeaderEnabled,
  channelEffectiveEnabledForGroup,
} from "../../lib/helpers";
import { isCommunityAdmin } from "../../lib/permissions";
import { generateChannelSlug, getChannelSlug } from "../../lib/slugs";
import { internal } from "../../_generated/api";
import { syncUserChannelMembershipsLogic } from "../sync/memberships";
import { updateChannelMemberCount } from "./helpers";
import { matchesSearchTerms, parseSearchTerms } from "../../lib/memberSearch";
import { canAccessEventChannel } from "./eventChat";

// ============================================================================
// Constants
// ============================================================================

/**
 * How long an event chat can sit in the inbox without a new message before
 * it's hidden. The inbox surfaces an event only after its first message;
 * past this window of silence it drops off entirely. Kept separate from
 * eventChat.HIDE_AFTER_MS because the inbox gate no longer looks at the
 * event's scheduledAt — activity is all that matters here.
 */
export const INBOX_EVENT_HIDE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Shared channel sorting logic.
 *
 * Sort order:
 * 1. Main channel first
 * 2. Leaders channel second
 * 3. Pinned channels in their pinned order
 * 4. Unpinned channels by most recent message (DESC)
 * 5. Fallback: alphabetical by name
 *
 * @param channels - Array of channel objects with slug, channelType, name, and optional lastMessageAt
 * @param pinnedChannelSlugs - Ordered array of pinned channel slugs
 * @returns Sorted channels array (mutates in place)
 */
function sortChannelsByPinOrder<T extends {
  slug: string;
  channelType: string;
  name: string;
  lastMessageAt?: number | null;
}>(
  channels: T[],
  pinnedChannelSlugs: string[]
): T[] {
  const pinnedSlugSet = new Set(pinnedChannelSlugs);

  return channels.sort((a, b) => {
    // Main channel always first
    if (a.channelType === "main" && b.channelType !== "main") return -1;
    if (a.channelType !== "main" && b.channelType === "main") return 1;

    // Leaders channel second
    if (a.channelType === "leaders" && b.channelType !== "leaders") return -1;
    if (a.channelType !== "leaders" && b.channelType === "leaders") return 1;

    // Reach out channel third
    if (a.channelType === "reach_out" && b.channelType !== "reach_out") return -1;
    if (a.channelType !== "reach_out" && b.channelType === "reach_out") return 1;

    // Check if channels are pinned
    const aIsPinned = pinnedSlugSet.has(a.slug);
    const bIsPinned = pinnedSlugSet.has(b.slug);

    // Pinned channels come before unpinned
    if (aIsPinned && !bIsPinned) return -1;
    if (!aIsPinned && bIsPinned) return 1;

    // Both pinned: sort by pin order
    if (aIsPinned && bIsPinned) {
      return pinnedChannelSlugs.indexOf(a.slug) - pinnedChannelSlugs.indexOf(b.slug);
    }

    // Both unpinned: sort by most recent message DESC
    const aTime = a.lastMessageAt ?? 0;
    const bTime = b.lastMessageAt ?? 0;
    if (aTime !== bTime) return bTime - aTime;

    // Fallback: alphabetical by name
    return a.name.localeCompare(b.name);
  });
}

type LinkedGroupToggleResult =
  | { handled: false }
  | { handled: true; result: { channelId: Id<"chatChannels">; status: "already_disabled" | "already_enabled" | "disabled" | "enabled" | "linked_unhidden_but_globally_disabled" } };

/**
 * Helper for linked group leaders to toggle `hiddenFromNavigation` on a shared channel.
 * Returns `{ handled: false }` if the managing group is the owning group (caller should
 * fall through to global enable/disable logic). Otherwise returns the toggle result.
 *
 * Bug fix: Returns "linked_unhidden_but_globally_disabled" when re-enabling a linked
 * group's visibility but the channel is still globally disabled by the owning group.
 */
async function handleLinkedGroupToggle(
  ctx: MutationCtx,
  channel: Doc<"chatChannels">,
  managingGroupId: Id<"groups">,
  userId: Id<"users">,
  enabled: boolean,
  channelTypeLabel: string,
): Promise<LinkedGroupToggleResult> {
  if (!channel.isShared || managingGroupId === channel.groupId) {
    return { handled: false };
  }

  const sharedGroups = channel.sharedGroups ?? [];
  const entryIndex = sharedGroups.findIndex(
    (sg) => sg.groupId === managingGroupId && sg.status === "accepted",
  );
  if (entryIndex < 0) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "This channel is not linked to that group.",
    });
  }

  const linkMembership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q) =>
      q.eq("groupId", managingGroupId).eq("userId", userId),
    )
    .filter((q) => q.eq(q.field("leftAt"), undefined))
    .first();

  if (!isLeaderRole(linkMembership?.role)) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: `Only group leaders can enable or disable ${channelTypeLabel}`,
    });
  }

  const now = Date.now();
  const existing = sharedGroups[entryIndex]!;
  const currentlyHidden = existing.hiddenFromNavigation === true;

  if (!enabled) {
    if (currentlyHidden) {
      return { handled: true, result: { channelId: channel._id, status: "already_disabled" as const } };
    }
    // Always persist hiddenFromNavigation, even if globally disabled, so the
    // linked group's intent to hide is retained when the owning group re-enables.
    const updatedSharedGroups = [...sharedGroups];
    updatedSharedGroups[entryIndex] = {
      ...existing,
      hiddenFromNavigation: true,
    };
    await ctx.db.patch(channel._id, {
      sharedGroups: updatedSharedGroups,
      updatedAt: now,
    });
    return { handled: true, result: { channelId: channel._id, status: "disabled" as const } };
  }

  if (!currentlyHidden) {
    return { handled: true, result: { channelId: channel._id, status: "already_enabled" as const } };
  }

  const updatedSharedGroups = [...sharedGroups];
  updatedSharedGroups[entryIndex] = {
    ...existing,
    hiddenFromNavigation: undefined,
  };
  await ctx.db.patch(channel._id, {
    sharedGroups: updatedSharedGroups,
    updatedAt: now,
  });

  // Return accurate status: if the channel is globally disabled, reflect that
  if (!channelIsLeaderEnabled(channel)) {
    return { handled: true, result: { channelId: channel._id, status: "linked_unhidden_but_globally_disabled" as const } };
  }
  return { handled: true, result: { channelId: channel._id, status: "enabled" as const } };
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Get a channel by ID.
 */
export const getChannel = query({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      return null;
    }

    // Event channels use meeting-based access (non-group-members may participate
    // via RSVP). Short-circuit the group-membership gate below.
    if (channel.channelType === "event") {
      if (!(await canAccessEventChannel(ctx, userId, channel))) {
        return null;
      }
      return {
        ...channel,
        slug: getChannelSlug(channel),
      };
    }

    // Ad-hoc channels (dm, group_dm) — caller must have a member row. The
    // request-state gate (showing the chat as accepted vs pending) is handled
    // in the UI; this query just exposes the channel doc to anyone who's been
    // added. Declined / left rows (leftAt set) lose access.
    if (channel.isAdHoc || !channel.groupId) {
      const adHocMembership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", args.channelId).eq("userId", userId),
        )
        .first();
      if (!adHocMembership || adHocMembership.leftAt !== undefined) {
        return null;
      }
      return {
        ...channel,
        slug: getChannelSlug(channel),
      };
    }
    const groupId = channel.groupId;

    // Check channel membership
    const membership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    // Check group membership - required for ALL channel types
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    // Must be a group member to access any channel
    if (!groupMembership) {
      return null;
    }

    const isLeaderOrAdmin = isLeaderRole(groupMembership.role);

    // Leader-disabled custom/PCO: members cannot open the channel
    if (
      (isCustomChannel(channel.channelType) || channel.channelType === "pco_services") &&
      !channelIsLeaderEnabled(channel) &&
      !isLeaderOrAdmin
    ) {
      return null;
    }

    // For leaders channel, also require leader/admin role
    if (channel.channelType === "leaders") {
      if (!isLeaderOrAdmin && !membership) {
        return null;
      }
    }

    // For custom channels, must be a channel member
    if (isCustomChannel(channel.channelType) && !membership) {
      return null;
    }

    // Return channel with slug (fallback to "general" for main, channelType for others)
    return {
      ...channel,
      slug: getChannelSlug(channel),
    };
  },
});

/**
 * Get a channel by group ID and slug.
 * This is the primary query for URL-based channel routing.
 */
export const getChannelBySlug = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    // 1. Authenticate user
    const userId = await requireAuth(ctx, args.token);

    // 2. Query by_group_slug index for the channel (exclude archived channels)
    const channel = await ctx.db
      .query("chatChannels")
      .withIndex("by_group_slug", (q) =>
        q.eq("groupId", args.groupId).eq("slug", args.slug)
      )
      .filter((q) => q.eq(q.field("isArchived"), false))
      .first();

    // Also try matching by channelType for backwards compatibility
    // (e.g., "general" might be stored as slug, but "main" is channelType)
    let resolvedChannel = channel;
    if (!resolvedChannel) {
      // Map common slug names to channelType
      const slugToType: Record<string, string> = {
        general: "main",
        leaders: "leaders",
      };
      const channelType = slugToType[args.slug];
      if (channelType) {
        // Filter out archived channels in the query to avoid returning archived
        // channels when multiple channels of the same type exist
        resolvedChannel = await ctx.db
          .query("chatChannels")
          .withIndex("by_group_type", (q) =>
            q.eq("groupId", args.groupId).eq("channelType", channelType)
          )
          .filter((q) => q.eq(q.field("isArchived"), false))
          .first();
      }
    }

    // 2b. Shared channel fallback: if no channel found in this group,
    // check user's channel memberships for a shared channel matching the slug
    // where args.groupId is in sharedGroups with status "accepted"
    if (!resolvedChannel) {
      const groupMembershipForUrlGroup = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", args.groupId).eq("userId", userId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();
      const isLeaderForUrlGroup = isLeaderRole(groupMembershipForUrlGroup?.role);

      const userMemberships = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .collect();

      for (const membership of userMemberships) {
        const candidateChannel = await ctx.db.get(membership.channelId);
        if (!candidateChannel || candidateChannel.isArchived) continue;
        if (!candidateChannel.isShared) continue;
        const sharedCustomOrPco =
          isCustomChannel(candidateChannel.channelType) ||
          candidateChannel.channelType === "pco_services";
        if (
          sharedCustomOrPco &&
          !channelEffectiveEnabledForGroup(candidateChannel, args.groupId) &&
          !isLeaderForUrlGroup
        ) {
          continue;
        }

        // Match by slug
        const candidateSlug = getChannelSlug(candidateChannel);
        if (candidateSlug !== args.slug && candidateChannel.slug !== args.slug) continue;

        // Verify the requested groupId is in sharedGroups with "accepted" status
        const sharedEntry = candidateChannel.sharedGroups?.find(
          (sg) => sg.groupId === args.groupId && sg.status === "accepted"
        );
        if (sharedEntry) {
          resolvedChannel = candidateChannel;
          break;
        }
      }
    }

    if (!resolvedChannel) {
      return null;
    }

    // 3. Verify user has access (is group member of the URL's group)
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership) {
      return null;
    }

    // 4. Get user's channel membership info if exists
    const channelMembership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", resolvedChannel!._id).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    const isMember = !!channelMembership;
    const isLeaderOrAdmin = isLeaderRole(groupMembership.role);

    // Access control based on channel type
    if (resolvedChannel.channelType === "leaders") {
      if (!isLeaderOrAdmin && !isMember) {
        return null;
      }
    }

    // Custom and pco_services channels require membership (or leader/admin access)
    // For shared channels accessed from secondary group, channel membership is required
    if ((isCustomChannel(resolvedChannel.channelType) || resolvedChannel.channelType === "pco_services") &&
        !isMember && !isLeaderOrAdmin) {
      return null;
    }

    if (
      (isCustomChannel(resolvedChannel.channelType) || resolvedChannel.channelType === "pco_services") &&
      !channelEffectiveEnabledForGroup(resolvedChannel, args.groupId) &&
      !isLeaderOrAdmin
    ) {
      return null;
    }

    // 5. Return channel with membership info
    return {
      ...resolvedChannel,
      slug: getChannelSlug(resolvedChannel),
      isMember,
      role: channelMembership?.role,
      userGroupRole: groupMembership.role,
    };
  },
});

/**
 * Get channels for a group.
 * Returns all channels the user has access to (based on group role).
 * Note: For custom channels, user must also be a channel member to access.
 */
export const getChannelsByGroup = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Check group membership
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership) {
      return [];
    }

    const channels = await ctx.db
      .query("chatChannels")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    // Get user's channel memberships for this group's channels
    const channelIds = channels.map((ch) => ch._id);
    const userChannelMemberships = new Set<string>();
    for (const channelId of channelIds) {
      const membership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", userId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();
      if (membership) {
        userChannelMemberships.add(channelId);
      }
    }

    // Filter based on role and membership
    const isLeader = isLeaderRole(groupMembership.role);

    const filteredChannels = channels.filter((channel) => {
      // Event channels are scoped to meetings, not surfaced on the group page.
      // They appear via getChannelByMeetingId / inbox.
      if (channel.channelType === "event") {
        return false;
      }
      // Leaders channel requires leader/admin role
      if (channel.channelType === "leaders") {
        return isLeader;
      }
      // Reach out channel is visible to all group members
      if (channel.channelType === "reach_out") {
        return true;
      }
      // Custom and pco_services channels require membership (or leader/admin access)
      if (isCustomChannel(channel.channelType) || channel.channelType === "pco_services") {
        if (!channelIsLeaderEnabled(channel) && !isLeader) {
          return false;
        }
        return userChannelMemberships.has(channel._id) || isLeader;
      }
      // Main channel is accessible to all group members
      return true;
    });

    // Return channels with slug fallback for backwards compatibility
    return filteredChannels.map((channel) => ({
      ...channel,
      slug: getChannelSlug(channel),
    }));
  },
});

/**
 * Get all channels for the current user.
 */
export const getUserChannels = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get all channel memberships
    const memberships = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    const groupMemberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();
    const roleByGroupId = new Map(
      groupMemberships.map((m) => [m.groupId, m.role])
    );

    const channelIds = memberships.map((m) => m.channelId);
    const channels = await Promise.all(channelIds.map((id) => ctx.db.get(id)));

    // Filter out null and archived channels, and add slug fallback
    return channels
      .filter((c): c is NonNullable<typeof c> => {
        if (c === null || c.isArchived) return false;
        if (!c.groupId) return false; // Skip ad-hoc channels (DM/group_dm)
        const role = roleByGroupId.get(c.groupId);
        const isLeader = isLeaderRole(role);
        if (
          (isCustomChannel(c.channelType) || c.channelType === "pco_services") &&
          !channelIsLeaderEnabled(c) &&
          !isLeader
        ) {
          return false;
        }
        return true;
      })
      .map((channel) => ({
        ...channel,
        slug: getChannelSlug(channel),
      }));
  },
});

/**
 * Get members of a channel with pagination.
 * Returns up to `limit` members starting after `cursor`.
 */
export const getChannelMembers = query({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const limit = Math.min(args.limit || 100, 500); // Default 100, max 500
    const searchTerms = parseSearchTerms(args.search || "");

    // Verify user has access to the channel
    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      return { members: [], nextCursor: null, totalCount: 0 };
    }
    if (!channel.groupId) {
      return { members: [], nextCursor: null, totalCount: 0 }; // Skip ad-hoc channels (DM/group_dm)
    }
    const groupId = channel.groupId;

    // Check membership
    const membership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!membership) {
      // If not a channel member, check elevated permissions:
      // - group leaders/admins can view members of any channel in their group
      // - community admins can manage/view members across all groups in community
      const groupMembership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", groupId).eq("userId", userId)
        )
        .filter((q) =>
          q.and(
            q.eq(q.field("leftAt"), undefined),
            q.or(
              q.eq(q.field("role"), "leader"),
              q.eq(q.field("role"), "admin")
            )
          )
        )
        .first();

      const group = await ctx.db.get(groupId);
      const isCommAdmin = group
        ? await isCommunityAdmin(ctx, group.communityId, userId)
        : false;

      if (!groupMembership && !isCommAdmin) {
        return { members: [], nextCursor: null, totalCount: 0 };
      }
    }

    if (searchTerms.length > 0) {
      // Search path: use users full-text index first, then intersect with channel membership.
      // This avoids loading all channel members in memory just to search.
      const userMap = new Map<Id<"users">, Doc<"users">>();
      const searchTakeLimit = Math.min(Math.max(limit * 6, 80), 300);

      for (const term of searchTerms) {
        if (!term) continue;
        const users = await ctx.db
          .query("users")
          .withSearchIndex("search_users", (q) => q.search("searchText", term))
          .take(searchTakeLimit);

        for (const user of users) {
          if (!userMap.has(user._id)) {
            userMap.set(user._id, user);
          }
        }
      }

      if (userMap.size === 0) {
        return { members: [], nextCursor: null, totalCount: 0 };
      }

      const candidateUsers = Array.from(userMap.values());
      const channelMemberships = await Promise.all(
        candidateUsers.map((user) =>
          ctx.db
            .query("chatChannelMembers")
            .withIndex("by_channel_user", (q) =>
              q.eq("channelId", args.channelId).eq("userId", user._id)
            )
            .filter((q) => q.eq(q.field("leftAt"), undefined))
            .first()
        )
      );

      const matchedMembers: Array<{
        member: NonNullable<(typeof channelMemberships)[number]>;
        user: Doc<"users">;
      }> = [];

      for (let i = 0; i < candidateUsers.length; i++) {
        const user = candidateUsers[i];
        const member = channelMemberships[i];
        if (!member) continue;

        if (
          !matchesSearchTerms(
            {
              firstName: user.firstName || "",
              lastName: user.lastName || "",
              email: user.email || "",
              phone: user.phone || "",
            },
            searchTerms
          )
        ) {
          continue;
        }

        matchedMembers.push({ member, user });
      }

      matchedMembers.sort((a, b) => {
        const aName = getDisplayName(a.user.firstName, a.user.lastName) || a.member.displayName || "";
        const bName = getDisplayName(b.user.firstName, b.user.lastName) || b.member.displayName || "";
        return aName.localeCompare(bName);
      });

      const cursorIndex = args.cursor ? parseInt(args.cursor, 10) : 0;
      const page = matchedMembers.slice(cursorIndex, cursorIndex + limit);
      const nextCursor =
        cursorIndex + limit < matchedMembers.length
          ? String(cursorIndex + limit)
          : null;

      return {
        members: page.map(({ member, user }) => ({
          id: member._id,
          userId: member.userId,
          displayName:
            getDisplayName(user.firstName, user.lastName) ||
            member.displayName ||
            "Unknown",
          profilePhoto: member.profilePhoto || getMediaUrl(user.profilePhoto) || undefined,
          role: member.role,
          syncSource: member.syncSource,
          syncMetadata: member.syncMetadata,
        })),
        nextCursor,
        totalCount: matchedMembers.length,
      };
    }

    // Browse path: channel-native pagination without loading all members.
    const query = ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .filter((q) => q.eq(q.field("leftAt"), undefined));

    // Get paginated results
    const result = await query.paginate({ numItems: limit + 1, cursor: args.cursor ? JSON.parse(args.cursor) : null });

    const hasMore = result.page.length > limit;
    const members = hasMore ? result.page.slice(0, limit) : result.page;

    // Enrich member data with fresh user info (denormalized displayName may be stale/missing)
    const enrichedMembers = await Promise.all(
      members.map(async (member) => {
        const user = await ctx.db.get(member.userId);
        const freshDisplayName = user
          ? getDisplayName(user.firstName, user.lastName)
          : member.displayName;

        return {
          id: member._id,
          userId: member.userId,
          displayName: freshDisplayName || member.displayName || "Unknown",
          profilePhoto: member.profilePhoto || (user ? getMediaUrl(user.profilePhoto) : undefined),
          role: member.role,
          syncSource: member.syncSource,
          syncMetadata: member.syncMetadata,
        };
      })
    );

    // Return member data with pagination info
    return {
      members: enrichedMembers,
      nextCursor: hasMore ? JSON.stringify(result.continueCursor) : null,
      // Note: totalCount is expensive for large channels, use channel.memberCount instead
      totalCount: channel.memberCount || 0,
    };
  },
});

/**
 * List all channels for a group with membership and unread info.
 * Returns channels sorted: main first, leaders second, custom channels alphabetically.
 */
export const listGroupChannels = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    includeArchived: v.optional(v.boolean()),
  },
  returns: v.array(v.object({
    _id: v.id("chatChannels"),
    slug: v.string(),
    channelType: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    memberCount: v.number(),
    isArchived: v.boolean(),
    isMember: v.boolean(),
    role: v.optional(v.string()),
    unreadCount: v.number(),
    isPinned: v.boolean(),
    lastMessageAt: v.optional(v.number()),
    isShared: v.optional(v.boolean()),
    isEnabled: v.boolean(),
  })),
  handler: async (ctx, args) => {
    // 1. Authenticate user
    const userId = await requireAuth(ctx, args.token);

    // 2. Verify user has group/community access
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      return [];
    }

    const isCommAdmin = await isCommunityAdmin(ctx, group.communityId, userId);

    // Group membership still gates non-admin access.
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership && !isCommAdmin) {
      return [];
    }

    const userIsLeaderOrAdmin = isCommAdmin || isLeaderRole(groupMembership?.role);
    // 2b. Get group to fetch pinned channel slugs
    const pinnedChannelSlugs: string[] = group?.pinnedChannelSlugs ?? [];

    // 3. Query all channels for group
    let channels = await ctx.db
      .query("chatChannels")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    // Filter by isArchived unless includeArchived is true
    if (!args.includeArchived) {
      channels = channels.filter((ch) => !ch.isArchived);
    }

    // 3b. Also find shared channels where this group appears in sharedGroups
    // with status "accepted". These are channels owned by other groups but
    // shared with this group.
    const allUserMemberships = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    const existingChannelIds = new Set(channels.map((ch) => ch._id));
    for (const membership of allUserMemberships) {
      if (existingChannelIds.has(membership.channelId)) continue;
      const candidateChannel = await ctx.db.get(membership.channelId);
      if (!candidateChannel) continue;
      if (!args.includeArchived && candidateChannel.isArchived) continue;
      if (!candidateChannel.isShared) continue;

      const sharedEntry = candidateChannel.sharedGroups?.find(
        (sg) => sg.groupId === args.groupId && sg.status === "accepted"
      );
      if (sharedEntry) {
        const sharedCustomOrPco =
          isCustomChannel(candidateChannel.channelType) ||
          candidateChannel.channelType === "pco_services";
        if (
          sharedCustomOrPco &&
          !channelEffectiveEnabledForGroup(candidateChannel, args.groupId) &&
          !userIsLeaderOrAdmin
        ) {
          continue;
        }
        channels.push(candidateChannel);
      }
    }

    // Get user's channel memberships for filtering custom channels
    const channelIds = channels.map((ch) => ch._id);
    const userChannelMemberships = new Set<string>();
    for (const channelId of channelIds) {
      const membership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", userId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();
      if (membership) {
        userChannelMemberships.add(channelId);
      }
    }

    // Filter channels based on access permissions
    channels = channels.filter((ch) => {
      // Event channels are scoped to meetings, not surfaced on the group page.
      // They appear via getChannelByMeetingId / inbox.
      if (ch.channelType === "event") {
        return false;
      }
      // Leaders channel only visible to leaders/admins
      if (ch.channelType === "leaders" && !userIsLeaderOrAdmin) {
        return false;
      }
      // Leaders/community admins see every channel on this list (including disabled, for toggles)
      if (userIsLeaderOrAdmin) {
        return true;
      }
      // Members: never show leader-disabled / linked-hidden channels on the group page
      if (!channelEffectiveEnabledForGroup(ch, args.groupId)) {
        return false;
      }
      // Reach out is visible to all group members when enabled
      if (ch.channelType === "reach_out") {
        return true;
      }
      // Regular members can only see custom/PCO channels they're members of
      const requiresMembership = isCustomChannel(ch.channelType) || ch.channelType === "pco_services";
      if (requiresMembership && !userChannelMemberships.has(ch._id)) {
        return false;
      }
      return true;
    });

    // 4. For each channel, get membership status (from cache) and unread count
    const result = await Promise.all(
      channels.map(async (channel) => {
        // Use cached membership check from above
        const isMember = userChannelMemberships.has(channel._id);

        // Get membership record for role info
        const membership = isMember
          ? await ctx.db
              .query("chatChannelMembers")
              .withIndex("by_channel_user", (q) =>
                q.eq("channelId", channel._id).eq("userId", userId)
              )
              .filter((q) => q.eq(q.field("leftAt"), undefined))
              .first()
          : null;

        // Get unread count from chatReadState
        let unreadCount = 0;
        if (isMember) {
          const readState = await ctx.db
            .query("chatReadState")
            .withIndex("by_channel_user", (q) =>
              q.eq("channelId", channel._id).eq("userId", userId)
            )
            .first();

          if (readState) {
            unreadCount = readState.unreadCount;
          } else {
            // No read state = user never opened channel, show capped unread count
            // We cap at 99 to avoid expensive full table scans
            const messages = await ctx.db
              .query("chatMessages")
              .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
              .filter((q) =>
                q.and(
                  q.eq(q.field("isDeleted"), false),
                  q.neq(q.field("senderId"), userId)
                )
              )
              .take(100);

            unreadCount = messages.length >= 100 ? 99 : messages.length;
          }
        }

        // Determine if channel is pinned
        const channelSlug = getChannelSlug(channel);
        const isPinned = pinnedChannelSlugs.includes(channelSlug);

        return {
          _id: channel._id,
          slug: channelSlug,
          channelType: channel.channelType,
          name: channel.name,
          description: channel.description,
          memberCount: channel.memberCount,
          isArchived: channel.isArchived,
          isMember,
          role: membership?.role,
          unreadCount,
          isPinned,
          lastMessageAt: channel.lastMessageAt,
          isShared: channel.isShared || undefined,
          isEnabled: channelEffectiveEnabledForGroup(channel, args.groupId),
        };
      })
    );

    // 5. Sort using shared helper
    sortChannelsByPinOrder(result, pinnedChannelSlugs);

    return result;
  },
});

/**
 * Get inbox channels grouped by group for a user.
 * Returns channels organized by group with unread counts and last message info.
 *
 * This is the primary query for the chat inbox screen.
 */
export const getInboxChannels = query({
  args: {
    token: v.string(),
    communityId: v.optional(v.id("communities")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const inboxQueryNow = Date.now();

    // Get all active group memberships for this user
    const groupMemberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) =>
        q.and(
          q.eq(q.field("leftAt"), undefined),
          q.or(
            q.eq(q.field("requestStatus"), undefined),
            q.eq(q.field("requestStatus"), "accepted")
          )
        )
      )
      .collect();

    // NOTE: don't early-return on empty groupMemberships — a user with no group
    // memberships may still have event-channel memberships (event channels
    // allow non-group-members to participate via RSVP).

    // Build a map of groupId -> role
    const groupRoleMap = new Map<Id<"groups">, string>();
    for (const gm of groupMemberships) {
      groupRoleMap.set(gm.groupId, gm.role);
    }

    // Batch fetch all groups
    const groupIds = groupMemberships.map((m) => m.groupId);
    const allGroups = await Promise.all(groupIds.map((id) => ctx.db.get(id)));

    // Filter by community if specified, and exclude archived groups
    const validGroups = allGroups.filter(
      (g): g is NonNullable<typeof g> => {
        if (!g) return false;
        if (g.isArchived) return false;
        if (args.communityId && g.communityId !== args.communityId) return false;
        return true;
      }
    );

    // Collect unique groupTypeIds for batch fetch
    const groupTypeIds = [
      ...new Set(
        validGroups
          .map((g) => g.groupTypeId)
          .filter((id): id is NonNullable<typeof id> => id !== undefined)
      ),
    ];

    // Batch fetch group types
    const groupTypes = await Promise.all(
      groupTypeIds.map((id) => ctx.db.get(id))
    );
    const groupTypeMap = new Map(
      groupTypes
        .filter((gt): gt is NonNullable<typeof gt> => gt !== null)
        .map((gt) => [gt._id, gt])
    );

    // Get all channels for valid groups
    const validGroupIds = new Set(validGroups.map((g) => g._id));
    const allChannels: Doc<"chatChannels">[] = [];
    for (const groupId of validGroupIds) {
      const channels = await ctx.db
        .query("chatChannels")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .filter((q) => q.eq(q.field("isArchived"), false))
        .collect();
      allChannels.push(...channels);
    }

    // Get unread counts for all channels user is a member of
    const userChannelMemberships = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    const userChannelIds = new Set(userChannelMemberships.map((m) => m.channelId));

    // Get read states for all user's channels
    const unreadCounts = new Map<string, number>();
    for (const membership of userChannelMemberships) {
      const readState = await ctx.db
        .query("chatReadState")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", membership.channelId).eq("userId", userId)
        )
        .first();

      if (readState && readState.unreadCount > 0) {
        unreadCounts.set(membership.channelId, readState.unreadCount);
      } else if (!readState) {
        // Count unread messages if no read state exists
        const messages = await ctx.db
          .query("chatMessages")
          .withIndex("by_channel", (q) => q.eq("channelId", membership.channelId))
          .filter((q) =>
            q.and(
              q.eq(q.field("isDeleted"), false),
              q.neq(q.field("senderId"), userId)
            )
          )
          .collect();

        if (messages.length > 0) {
          unreadCounts.set(membership.channelId, messages.length);
        }
      }
    }

    // Find shared channels from user's memberships that aren't already in allChannels.
    // These are channels owned by other groups but shared with one of the user's groups.
    const allChannelIds = new Set(allChannels.map((ch) => ch._id));
    // Track event channels picked up from chatChannelMembers so we can ensure
    // their owning group appears in validGroups / groupRoleMap below.
    const eventChannelsToInclude: Doc<"chatChannels">[] = [];
    for (const membership of userChannelMemberships) {
      if (allChannelIds.has(membership.channelId)) continue;
      const candidateChannel = await ctx.db.get(membership.channelId);
      if (!candidateChannel || candidateChannel.isArchived) continue;

      // Event channels: user can see the channel via their chatChannelMembers
      // row regardless of whether they're in the owning group. Visibility
      // rules:
      //   - Hidden if globally disabled.
      //   - Hidden until the first message is sent (an admin-seated or
      //     RSVP-seated channel shouldn't clutter the inbox on its own).
      //   - Hidden after 2 days of inactivity (lastMessageAt older than
      //     INBOX_EVENT_HIDE_AFTER_MS), letting events float to the bottom
      //     organically and then drop off.
      if (candidateChannel.channelType === "event") {
        if (candidateChannel.isEnabled === false) continue;
        const lastMessageAt = candidateChannel.lastMessageAt ?? 0;
        if (lastMessageAt <= 0) continue;
        if (lastMessageAt < inboxQueryNow - INBOX_EVENT_HIDE_AFTER_MS) continue;
        eventChannelsToInclude.push(candidateChannel);
        continue;
      }

      if (!candidateChannel.isShared || !candidateChannel.sharedGroups) continue;

      // Check if any of the user's valid groups appear in sharedGroups with "accepted" status
      const hasAcceptedGroup = candidateChannel.sharedGroups.some(
        (sg) => validGroupIds.has(sg.groupId) && sg.status === "accepted"
      );
      if (hasAcceptedGroup) {
        const acceptedEntry = candidateChannel.sharedGroups.find(
          (sg) => validGroupIds.has(sg.groupId) && sg.status === "accepted"
        );
        const roleInLinkedGroup = acceptedEntry
          ? groupRoleMap.get(acceptedEntry.groupId)
          : undefined;
        const leaderInLinkedGroup = isLeaderRole(roleInLinkedGroup);
        const visibleInLinkedGroup = acceptedEntry
          ? channelEffectiveEnabledForGroup(candidateChannel, acceptedEntry.groupId)
          : channelIsLeaderEnabled(candidateChannel);
        if (
          (isCustomChannel(candidateChannel.channelType) ||
            candidateChannel.channelType === "pco_services") &&
          !visibleInLinkedGroup &&
          !leaderInLinkedGroup
        ) {
          continue;
        }
        allChannels.push(candidateChannel);
        allChannelIds.add(candidateChannel._id);
        // Also add to userChannelIds since we know user is a member
        userChannelIds.add(candidateChannel._id);
      }
    }

    // Event channels: surface every enabled event channel the user is a member
    // of, even when they're not a member of the owning group. We fetch the
    // owning group (and its group type) on demand and add it to validGroups
    // so the normal grouping step picks the channel up.
    for (const eventChannel of eventChannelsToInclude) {
      if (!eventChannel.groupId) continue; // Skip ad-hoc channels (DM/group_dm)
      const ecGroupId = eventChannel.groupId;
      const owningGroup = allGroups.find((g) => g && g._id === ecGroupId)
        ?? (await ctx.db.get(ecGroupId));
      if (!owningGroup || owningGroup.isArchived) continue;
      if (args.communityId && owningGroup.communityId !== args.communityId) continue;

      if (!validGroupIds.has(owningGroup._id)) {
        validGroups.push(owningGroup);
        validGroupIds.add(owningGroup._id);
        // Non-group-members default to "member" userRole for grouping only.
        if (!groupRoleMap.has(owningGroup._id)) {
          groupRoleMap.set(owningGroup._id, "member");
        }
        // Fetch missing group type for display metadata.
        if (owningGroup.groupTypeId && !groupTypeMap.has(owningGroup.groupTypeId)) {
          const gt = await ctx.db.get(owningGroup.groupTypeId);
          if (gt) groupTypeMap.set(gt._id, gt);
        }
      }
      allChannels.push(eventChannel);
      allChannelIds.add(eventChannel._id);
      userChannelIds.add(eventChannel._id);
    }

    // Pre-fetch meetings referenced by event channels so the inbox can show
    // event scheduling info (used by mobile to hide stale event channels).
    const eventMeetingIds = Array.from(
      new Set(
        allChannels
          .filter((ch) => ch.channelType === "event" && ch.meetingId)
          .map((ch) => ch.meetingId as Id<"meetings">),
      ),
    );
    const eventMeetingDocs = await Promise.all(
      eventMeetingIds.map((id) => ctx.db.get(id)),
    );
    const eventMeetingMap = new Map<
      Id<"meetings">,
      {
        scheduledAt: number | null;
        shortId: string | null;
        coverImage: string | null;
        location: string | null;
      }
    >();
    for (let i = 0; i < eventMeetingIds.length; i++) {
      const m = eventMeetingDocs[i];
      eventMeetingMap.set(eventMeetingIds[i], {
        scheduledAt: m && typeof m.scheduledAt === "number" ? m.scheduledAt : null,
        shortId: m && typeof m.shortId === "string" ? m.shortId : null,
        coverImage: m && m.coverImage ? getMediaUrl(m.coverImage) ?? null : null,
        location:
          m && typeof m.locationOverride === "string" && m.locationOverride.trim().length > 0
            ? m.locationOverride
            : null,
      });
    }

    // Build the result grouped by group
    const result: Array<{
      group: {
        _id: Id<"groups">;
        name: string;
        preview: string | undefined;
        groupTypeId: Id<"groupTypes">;
        groupTypeName: string | undefined;
        groupTypeSlug: string | undefined;
        isAnnouncementGroup: boolean | undefined;
      };
      channels: Array<{
        _id: Id<"chatChannels">;
        slug: string;
        channelType: string;
        name: string;
        lastMessagePreview: string | null;
        lastMessageAt: number | null;
        lastMessageSenderName: string | null;
        lastMessageSenderId: Id<"users"> | null;
        unreadCount: number;
        isShared: boolean | undefined;
        isEnabled: boolean | undefined;
        meetingId: Id<"meetings"> | undefined;
        meetingScheduledAt: number | null;
        /**
         * For event channels, the meeting's shareable shortId. Lets the mobile
         * inbox route event rows to `/e/{shortId}` (the event page with inline
         * Activity) instead of the standalone chat room.
         */
        meetingShortId: string | null;
        /**
         * For event channels, the meeting's cover image URL (resolved through
         * R2). The inbox uses this for the row avatar instead of the group's
         * preview image.
         */
        meetingCoverImage: string | null;
        /**
         * For event channels, the meeting's free-form location (address or
         * place name). Powers the Maps shortcut on the inbox row.
         */
        meetingLocation: string | null;
      }>;
      userRole: "leader" | "member";
    }> = [];

    for (const group of validGroups) {
      const groupType = groupTypeMap.get(group.groupTypeId);
      const userRole = groupRoleMap.get(group._id) || "member";
      const isLeaderOrAdmin = userRole === "leader" || userRole === "admin";

      // Get channels for this group, filtered by access
      // Includes both group-owned channels and shared channels from other groups
      const groupChannels = allChannels.filter((ch) => {
        // Channel belongs directly to this group
        if (ch.groupId === group._id) {
          // Leaders channel only visible to leaders/admins
          if (ch.channelType === "leaders" && !isLeaderOrAdmin) return false;
          // User must be a member of the channel
          if (!userChannelIds.has(ch._id)) return false;
          if (
            (isCustomChannel(ch.channelType) || ch.channelType === "pco_services") &&
            !channelIsLeaderEnabled(ch) &&
            !isLeaderOrAdmin
          ) {
            return false;
          }
          // Event channels: apply the same activity gate used for the
          // chatChannelMembers path above. Without this, group members of the
          // owning group would still see seeded-but-silent event channels in
          // their inbox, defeating the "first message" rule.
          if (ch.channelType === "event") {
            if (ch.isEnabled === false) return false;
            const lastMessageAt = ch.lastMessageAt ?? 0;
            if (lastMessageAt <= 0) return false;
            if (lastMessageAt < inboxQueryNow - INBOX_EVENT_HIDE_AFTER_MS) return false;
          }
          return true;
        }
        // Shared channel from another group: check if this group is in sharedGroups
        if (ch.isShared && ch.sharedGroups) {
          const sharedEntry = ch.sharedGroups.find(
            (sg) => sg.groupId === group._id && sg.status === "accepted"
          );
          if (sharedEntry && userChannelIds.has(ch._id)) {
            if (
              (isCustomChannel(ch.channelType) || ch.channelType === "pco_services") &&
              !channelEffectiveEnabledForGroup(ch, group._id) &&
              !isLeaderOrAdmin
            ) {
              return false;
            }
            return true;
          }
        }
        return false;
      });

      // Skip groups with no accessible channels
      if (groupChannels.length === 0) continue;

      // Get pinned channel slugs for this group (for sorting)
      const pinnedSlugs = group.pinnedChannelSlugs || [];

      // Map channels to include slug, then sort using shared helper
      const channelsWithSlug = groupChannels.map((ch) => ({
        ...ch,
        slug: getChannelSlug(ch),
      }));
      sortChannelsByPinOrder(channelsWithSlug, pinnedSlugs);

      const channels = channelsWithSlug.map((ch) => {
        // Determine display name based on channel type
        let displayName: string;
        if (ch.channelType === "main") {
          displayName = "General";
        } else if (ch.channelType === "leaders") {
          displayName = "Leaders";
        } else {
          // Custom channels use their actual name
          displayName = ch.name;
        }

        return {
          _id: ch._id,
          slug: ch.slug, // Already computed above
          channelType: ch.channelType,
          name: displayName,
          lastMessagePreview: ch.lastMessagePreview || null,
          lastMessageAt: ch.lastMessageAt || null,
          lastMessageSenderName: ch.lastMessageSenderName || null,
          lastMessageSenderId: ch.lastMessageSenderId || null,
          unreadCount: unreadCounts.get(ch._id) || 0,
          isShared: ch.isShared || undefined,
          isEnabled: ch.isEnabled,
          meetingId: ch.meetingId,
          meetingScheduledAt:
            ch.channelType === "event" && ch.meetingId
              ? eventMeetingMap.get(ch.meetingId)?.scheduledAt ?? null
              : null,
          meetingShortId:
            ch.channelType === "event" && ch.meetingId
              ? eventMeetingMap.get(ch.meetingId)?.shortId ?? null
              : null,
          meetingCoverImage:
            ch.channelType === "event" && ch.meetingId
              ? eventMeetingMap.get(ch.meetingId)?.coverImage ?? null
              : null,
          meetingLocation:
            ch.channelType === "event" && ch.meetingId
              ? eventMeetingMap.get(ch.meetingId)?.location ?? null
              : null,
        };
      });

      result.push({
        group: {
          _id: group._id,
          name: group.name,
          preview: getMediaUrl(group.preview),
          groupTypeId: group.groupTypeId,
          groupTypeName: groupType?.name,
          groupTypeSlug: groupType?.slug,
          isAnnouncementGroup: group.isAnnouncementGroup,
        },
        channels,
        userRole: isLeaderOrAdmin ? "leader" : "member",
      });
    }

    // Sort by most recent message across all channels in each group
    result.sort((a, b) => {
      // Announcement groups always first
      if (a.group.isAnnouncementGroup && !b.group.isAnnouncementGroup) return -1;
      if (!a.group.isAnnouncementGroup && b.group.isAnnouncementGroup) return 1;

      // Then by most recent message
      const aLastMessage = Math.max(...a.channels.map((c) => c.lastMessageAt || 0));
      const bLastMessage = Math.max(...b.channels.map((c) => c.lastMessageAt || 0));

      if (!aLastMessage && !bLastMessage) return 0;
      if (!aLastMessage) return 1;
      if (!bLastMessage) return -1;
      return bLastMessage - aLastMessage;
    });

    return result;
  },
});

/**
 * Check if any channel in a group has an auto channel configuration.
 * Used to determine if the "Sync" tool should be shown in the leader toolbar.
 */
export const hasAutoChannels = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Check group membership
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership) {
      return false;
    }

    // Get all channels for this group
    const channels = await ctx.db
      .query("chatChannels")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    // Check if any channel has an autoChannelConfig
    for (const channel of channels) {
      const config = await ctx.db
        .query("autoChannelConfigs")
        .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
        .first();

      if (config) {
        return true;
      }
    }

    return false;
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new channel.
 */
export const createChannel = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    channelType: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Check group membership
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership) {
      throw new Error("Not a member of this group");
    }

    // Leaders channel requires leader/admin role
    if (args.channelType === "leaders") {
      if (
        groupMembership.role !== "leader" &&
        groupMembership.role !== "admin"
      ) {
        throw new Error("Only leaders can create a leaders channel");
      }
    }

    const now = Date.now();

    // Generate slug for the channel
    // Get existing slugs for this group
    // Note: Convex mutations are fully atomic (single transaction), so there's no
    // TOCTOU race condition here - concurrent mutations serialize at DB level
    const existingChannels = await ctx.db
      .query("chatChannels")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    const existingSlugs = existingChannels
      .map((ch) => ch.slug)
      .filter((slug): slug is string => slug !== undefined);

    const slug = generateChannelSlug(args.name, existingSlugs);

    const channelId = await ctx.db.insert("chatChannels", {
      groupId: args.groupId,
      slug,
      channelType: args.channelType,
      name: args.name,
      description: args.description,
      createdById: userId,
      createdAt: now,
      updatedAt: now,
      isArchived: false,
      memberCount: 0,
    });

    return channelId;
  },
});

/**
 * Update channel details.
 */
export const updateChannel = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }
    if (!channel.groupId) {
      throw new Error("This operation is only valid for group channels");
    }
    const groupId = channel.groupId;

    // Check if user is admin of channel or group leader
    const membership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    const isChannelAdmin = membership?.role === "admin";
    const isGroupLeader = isLeaderRole(groupMembership?.role);

    if (!isChannelAdmin && !isGroupLeader) {
      throw new Error("Not authorized to update this channel");
    }

    const updates: Partial<{
      name: string;
      description: string;
      updatedAt: number;
    }> = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) {
      updates.name = args.name;
    }
    if (args.description !== undefined) {
      updates.description = args.description;
    }

    await ctx.db.patch(args.channelId, updates);
  },
});

/**
 * Archive a channel.
 */
export const archiveChannel = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }
    if (!channel.groupId) {
      throw new Error("This operation is only valid for group channels");
    }
    const groupId = channel.groupId;

    // Only group leaders/admins can archive
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (
      !groupMembership ||
      (groupMembership.role !== "leader" && groupMembership.role !== "admin")
    ) {
      throw new Error("Only group leaders can archive channels");
    }

    const now = Date.now();

    await ctx.db.patch(args.channelId, {
      isArchived: true,
      archivedAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Archive a custom channel.
 *
 * Only custom channels can be archived with this mutation.
 * Auto channels (main, leaders) must be disabled through group settings.
 *
 * Permissions:
 * - Channel owner can archive
 * - Any group leader/admin can archive
 */
export const archiveCustomChannel = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    // 1. Authenticate user
    const userId = await requireAuth(ctx, args.token);

    // 2. Get channel, throw if not found
    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Channel not found" });
    }
    if (!channel.groupId) {
      throw new ConvexError({ code: "INVALID_OPERATION", message: "This operation is only valid for group channels" });
    }
    const groupId = channel.groupId;

    // 3. If not custom channel, throw error
    if (!isCustomChannel(channel.channelType)) {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: "You can't archive auto channels. Disable them in group settings instead.",
      });
    }

    // 4. Verify caller is channel owner OR group leader
    // Get channel membership for caller
    const channelMembership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    // Get group membership for caller
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    const isChannelOwner = channelMembership?.role === "owner";
    const isGroupLeader = isLeaderRole(groupMembership?.role);
    const canArchive = isChannelOwner || isGroupLeader;

    // 5. If !canArchive, throw permission error
    if (!canArchive) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only the channel owner or group leaders can archive this channel",
      });
    }

    // 6. Update channel: isArchived, archivedAt, updatedAt
    const now = Date.now();
    await ctx.db.patch(args.channelId, {
      isArchived: true,
      archivedAt: now,
      updatedAt: now,
    });

    // 7. Remove all members (soft delete with leftAt)
    const activeMembers = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    for (const member of activeMembers) {
      await ctx.db.patch(member._id, {
        leftAt: now,
      });
    }

    // 8. Set member count to 0
    await ctx.db.patch(args.channelId, {
      memberCount: 0,
    });

    // 9. Return success
    return { success: true };
  },
});

/**
 * Unarchive a custom channel so leaders can reopen it (e.g. after disabling).
 *
 * Memberships are not restored; leaders can add members again from channel settings.
 * Only group leaders/admins may unarchive (owners may have no active membership after archive).
 */
export const unarchiveCustomChannel = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Channel not found" });
    }
    if (!channel.groupId) {
      throw new ConvexError({ code: "INVALID_OPERATION", message: "This operation is only valid for group channels" });
    }
    const groupId = channel.groupId;

    if (!isCustomChannel(channel.channelType)) {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: "Only custom channels can be unarchived here.",
      });
    }

    if (channel.isShared) {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: "Shared channels must be managed from the owning group.",
      });
    }

    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!isLeaderRole(groupMembership?.role)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only group leaders can enable custom channels",
      });
    }

    if (!channel.isArchived) {
      return { channelId: args.channelId, status: "already_enabled" as const };
    }

    const now = Date.now();
    await ctx.db.patch(args.channelId, {
      isArchived: false,
      archivedAt: undefined,
      updatedAt: now,
    });

    return { channelId: args.channelId, status: "enabled" as const };
  },
});

/**
 * Leader enable/disable for custom channels without changing memberships.
 * Distinct from archiveCustomChannel (soft delete + clear members).
 *
 * Linked group leaders toggle `hiddenFromNavigation` only; owning group toggles global `isEnabled`.
 */
export const setCustomChannelLeaderEnabled = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    enabled: v.boolean(),
    managingGroupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Channel not found" });
    }
    if (!channel.groupId) {
      throw new ConvexError({ code: "INVALID_OPERATION", message: "This operation is only valid for group channels" });
    }
    const groupId = channel.groupId;

    if (!isCustomChannel(channel.channelType)) {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: "Only custom channels support this toggle.",
      });
    }

    const managingGroupId = args.managingGroupId ?? groupId;

    const linkedResult = await handleLinkedGroupToggle(
      ctx,
      channel,
      managingGroupId,
      userId,
      args.enabled,
      "custom channels",
    );
    if (linkedResult.handled) {
      return linkedResult.result;
    }

    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!isLeaderRole(groupMembership?.role)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only group leaders can enable or disable custom channels",
      });
    }

    const now = Date.now();

    if (!args.enabled) {
      if (channel.isArchived || channel.isEnabled === false) {
        return { channelId: args.channelId, status: "already_disabled" as const };
      }
      await ctx.db.patch(args.channelId, {
        isEnabled: false,
        updatedAt: now,
      });
      return { channelId: args.channelId, status: "disabled" as const };
    }

    if (channel.isArchived) {
      await ctx.db.patch(args.channelId, {
        isArchived: false,
        archivedAt: undefined,
        isEnabled: true,
        updatedAt: now,
      });
      return { channelId: args.channelId, status: "enabled" as const };
    }

    if (channel.isEnabled !== false) {
      return { channelId: args.channelId, status: "already_enabled" as const };
    }

    await ctx.db.patch(args.channelId, {
      isEnabled: true,
      updatedAt: now,
    });
    return { channelId: args.channelId, status: "enabled" as const };
  },
});

/**
 * Archive a PCO auto channel and turn off sync (shared implementation).
 */
async function archivePcoChannelInTxn(
  ctx: MutationCtx,
  channelId: Id<"chatChannels">,
  now: number
): Promise<void> {
  const autoChannelConfig = await ctx.db
    .query("autoChannelConfigs")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .unique();

  if (autoChannelConfig) {
    await ctx.db.patch(autoChannelConfig._id, {
      isActive: false,
      updatedAt: now,
    });
  }

  await ctx.db.patch(channelId, {
    isArchived: true,
    archivedAt: now,
    updatedAt: now,
  });

  const activeMembers = await ctx.db
    .query("chatChannelMembers")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .filter((q) => q.eq(q.field("leftAt"), undefined))
    .collect();

  for (const member of activeMembers) {
    await ctx.db.patch(member._id, {
      leftAt: now,
    });
  }

  await ctx.db.patch(channelId, {
    memberCount: 0,
    updatedAt: now,
  });
}

/**
 * Archive a PCO auto channel.
 *
 * This archives the channel AND disables the auto-sync configuration.
 *
 * Permissions:
 * - Any group leader/admin can archive
 */
export const archivePcoChannel = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    // 1. Authenticate user
    const userId = await requireAuth(ctx, args.token);

    // 2. Get channel, throw if not found
    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Channel not found" });
    }
    if (!channel.groupId) {
      throw new ConvexError({ code: "INVALID_OPERATION", message: "This operation is only valid for group channels" });
    }
    const groupId = channel.groupId;

    // 3. Verify this is a PCO channel
    if (channel.channelType !== "pco_services") {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: "This operation is only for PCO auto channels.",
      });
    }

    // 4. Verify caller is group leader/admin
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    const isGroupLeader = isLeaderRole(groupMembership?.role);
    if (!isGroupLeader) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only group leaders can archive PCO channels",
      });
    }

    const now = Date.now();
    await archivePcoChannelInTxn(ctx, args.channelId, now);

    return { success: true };
  },
});

/**
 * Enable or disable a PCO auto channel for members (keeps memberships; turns sync off/on).
 * Re-enabling always schedules a resync so PCO remains source of truth.
 *
 * Owning group: updates global `isEnabled` and PCO sync. Linked group: only updates
 * `sharedGroups[].hiddenFromNavigation` for that group (owning group + sync unchanged).
 */
export const togglePcoChannel = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    enabled: v.boolean(),
    managingGroupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const now = Date.now();

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Channel not found" });
    }
    if (!channel.groupId) {
      throw new ConvexError({ code: "INVALID_OPERATION", message: "This operation is only valid for group channels" });
    }
    const groupId = channel.groupId;

    if (channel.channelType !== "pco_services") {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: "This operation is only for PCO auto channels.",
      });
    }

    const managingGroupId = args.managingGroupId ?? groupId;

    const linkedResult = await handleLinkedGroupToggle(
      ctx,
      channel,
      managingGroupId,
      userId,
      args.enabled,
      "PCO channels",
    );
    if (linkedResult.handled) {
      return linkedResult.result;
    }

    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!isLeaderRole(groupMembership?.role)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only group leaders can enable or disable PCO channels",
      });
    }

    const autoConfig = await ctx.db
      .query("autoChannelConfigs")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .unique();

    if (!args.enabled) {
      if (channel.isArchived || channel.isEnabled === false) {
        return { channelId: args.channelId, status: "already_disabled" as const };
      }
      await ctx.db.patch(args.channelId, {
        isEnabled: false,
        updatedAt: now,
      });
      if (autoConfig) {
        await ctx.db.patch(autoConfig._id, {
          isActive: false,
          updatedAt: now,
        });
      }
      return { channelId: args.channelId, status: "disabled" as const };
    }

    // Enable: recover from archived (legacy full archive) or leader-disabled (isEnabled: false).
    if (channel.isArchived) {
      await ctx.db.patch(args.channelId, {
        isArchived: false,
        archivedAt: undefined,
        isEnabled: true,
        updatedAt: now,
      });
    } else if (channel.isEnabled !== false) {
      return { channelId: args.channelId, status: "already_enabled" as const };
    } else {
      await ctx.db.patch(args.channelId, {
        isEnabled: true,
        updatedAt: now,
      });
    }

    if (autoConfig) {
      await ctx.db.patch(autoConfig._id, {
        isActive: true,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.functions.pcoServices.rotation.syncAutoChannel,
        { configId: autoConfig._id }
      );
    }

    return { channelId: args.channelId, status: "enabled" as const };
  },
});

/**
 * Add a member to a channel.
 */
export const addMember = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    userId: v.id("users"),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const requestingUserId = await requireAuth(ctx, args.token);

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }
    if (!channel.groupId) {
      throw new Error("This operation is only valid for group channels");
    }
    const groupId = channel.groupId;

    // Check if the user to be added is a group member
    const targetGroupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", args.userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!targetGroupMembership) {
      throw new Error("User is not a member of the group");
    }

    // Check if already a member
    const existingMembership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", args.userId)
      )
      .first();

    const user = await ctx.db.get(args.userId);

    if (existingMembership) {
      if (!existingMembership.leftAt) {
        return; // Already an active member
      }
      // Rejoin
      await ctx.db.patch(existingMembership._id, {
        leftAt: undefined,
        role: args.role,
        joinedAt: Date.now(),
        displayName: user ? getDisplayName(user.firstName, user.lastName) : undefined,
        profilePhoto: user ? getMediaUrl(user.profilePhoto) : undefined,
      });
    } else {
      await ctx.db.insert("chatChannelMembers", {
        channelId: args.channelId,
        userId: args.userId,
        role: args.role,
        joinedAt: Date.now(),
        isMuted: false,
        displayName: user ? getDisplayName(user.firstName, user.lastName) : undefined,
        profilePhoto: user ? getMediaUrl(user.profilePhoto) : undefined,
      });
    }

    // Update member count by recomputing from actual membership records
    await updateChannelMemberCount(ctx, args.channelId);
  },
});

/**
 * Remove a member from a channel.
 */
export const removeMember = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const requestingUserId = await requireAuth(ctx, args.token);

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }

    const membership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", args.userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!membership) {
      return; // Not a member
    }

    await ctx.db.patch(membership._id, {
      leftAt: Date.now(),
    });

    // Update member count by recomputing from actual membership records
    await updateChannelMemberCount(ctx, args.channelId);
  },
});

/**
 * Update member role.
 */
export const updateMemberRole = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    userId: v.id("users"),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const requestingUserId = await requireAuth(ctx, args.token);

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }
    if (!channel.groupId) {
      throw new Error("This operation is only valid for group channels");
    }
    const groupId = channel.groupId;

    // Check if requester is admin
    const requesterMembership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", requestingUserId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    const requesterGroupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", requestingUserId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    const isChannelAdmin = requesterMembership?.role === "admin";
    const isGroupLeader =
      requesterGroupMembership?.role === "leader" ||
      requesterGroupMembership?.role === "admin";

    if (!isChannelAdmin && !isGroupLeader) {
      throw new Error("Not authorized to update member roles");
    }

    const membership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", args.userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!membership) {
      throw new Error("User is not a member of this channel");
    }

    await ctx.db.patch(membership._id, {
      role: args.role,
    });
  },
});

/**
 * Create a custom channel in a group.
 * Only group leaders can create custom channels.
 * The creator becomes the channel owner.
 */
export const createCustomChannel = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    name: v.string(),
    description: v.optional(v.string()),
    joinMode: v.optional(v.union(v.literal("open"), v.literal("approval_required"))),
  },
  returns: v.object({
    channelId: v.id("chatChannels"),
    slug: v.string(),
  }),
  handler: async (ctx, args) => {
    // 1. Authenticate user
    const userId = await requireAuth(ctx, args.token);

    // 2. Verify caller is group leader
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    const isLeader = isLeaderRole(groupMembership?.role);

    if (!groupMembership || !isLeader) {
      throw new ConvexError("Only group leaders can create channels.");
    }

    // 3. Count existing non-archived channels for this group
    const existingChannels = await ctx.db
      .query("chatChannels")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    if (existingChannels.length >= 20) {
      throw new ConvexError(
        "This group has reached the maximum of 20 channels. Archive some channels to create new ones."
      );
    }

    // 4. Validate name: trim, check 1-50 chars
    const trimmedName = args.name.trim();
    if (trimmedName.length < 1 || trimmedName.length > 50) {
      throw new ConvexError("Channel name must be 1-50 characters.");
    }

    // 4b. Validate name contains at least one alphanumeric character
    // This prevents names like "!!!" or "---" which would result in generic slugs
    if (!/[a-zA-Z0-9]/.test(trimmedName)) {
      throw new ConvexError("Channel name must contain at least one letter or number.");
    }

    // 5. Get existing slugs for this group
    // Note: Convex mutations are fully atomic (single transaction), so there's no
    // TOCTOU race condition here - concurrent mutations serialize at DB level
    const existingSlugs = existingChannels
      .map((ch) => ch.slug)
      .filter((slug): slug is string => slug !== undefined);

    // 6. Generate slug
    const slug = generateChannelSlug(trimmedName, existingSlugs);

    // 7. Insert chatChannels record
    const now = Date.now();
    const channelId = await ctx.db.insert("chatChannels", {
      groupId: args.groupId,
      slug,
      channelType: "custom",
      name: trimmedName,
      description: args.description,
      createdById: userId,
      createdAt: now,
      updatedAt: now,
      isArchived: false,
      memberCount: 1,
      joinMode: args.joinMode,
    });

    // 8. Insert chatChannelMembers record for the creator as owner
    const user = await ctx.db.get(userId);
    await ctx.db.insert("chatChannelMembers", {
      channelId,
      userId,
      role: "owner",
      joinedAt: now,
      isMuted: false,
      displayName: user ? getDisplayName(user.firstName, user.lastName) : undefined,
      profilePhoto: user ? getMediaUrl(user.profilePhoto) : undefined,
    });

    // 9. Return result
    return { channelId, slug };
  },
});

/**
 * Create an auto channel linked to an external integration (e.g., PCO Services).
 * Only group leaders can create auto channels.
 * The creator becomes the channel admin.
 *
 * Auto channels have their membership managed automatically by a sync process
 * based on the configured integration (e.g., PCO Services team schedules).
 */
export const createAutoChannel = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    name: v.string(),
    description: v.optional(v.string()),
    integrationType: v.union(v.literal("pco_services")), // Only pco_services is currently supported
    autoChannelConfig: v.object({
      // NEW: Filter-based configuration (preferred)
      filters: v.optional(
        v.object({
          serviceTypeIds: v.optional(v.array(v.string())),
          serviceTypeNames: v.optional(v.array(v.string())),
          teamIds: v.optional(v.array(v.string())),
          teamNames: v.optional(v.array(v.string())),
          // Support both strings and position objects with context
          positions: v.optional(
            v.array(
              v.union(
                v.string(),
                v.object({
                  name: v.string(),
                  teamId: v.optional(v.string()),
                  teamName: v.optional(v.string()),
                  serviceTypeId: v.optional(v.string()),
                  serviceTypeName: v.optional(v.string()),
                })
              )
            )
          ),
          statuses: v.optional(v.array(v.string())),
        })
      ),
      // LEGACY: Keep for backward compatibility
      serviceTypeId: v.optional(v.string()),
      serviceTypeName: v.optional(v.string()),
      syncScope: v.optional(v.string()), // "all_teams" | "single_team" | "multi_team"
      teamIds: v.optional(v.array(v.string())),
      teamNames: v.optional(v.array(v.string())),
      // Timing (required)
      addMembersDaysBefore: v.number(),
      removeMembersDaysAfter: v.number(),
    }),
  },
  returns: v.object({
    channelId: v.id("chatChannels"),
    slug: v.string(),
  }),
  handler: async (ctx, args) => {
    // 1. Authenticate user
    const userId = await requireAuth(ctx, args.token);

    // 2. Verify caller is group leader
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    const isLeader = isLeaderRole(groupMembership?.role);

    if (!groupMembership || !isLeader) {
      throw new ConvexError("Only group leaders can create auto channels.");
    }

    // 3. Get group to retrieve communityId
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new ConvexError("Group not found.");
    }

    // 3b. Verify PCO integration exists for the community
    const pcoIntegration = await ctx.db
      .query("communityIntegrations")
      .withIndex("by_community_type", (q) =>
        q.eq("communityId", group.communityId).eq("integrationType", "planning_center")
      )
      .first();

    if (!pcoIntegration) {
      throw new ConvexError({
        code: "NO_INTEGRATION",
        message: "Planning Center integration is not configured for this community. Connect to Planning Center first.",
      });
    }

    // 4. Count existing non-archived channels for this group
    const existingChannels = await ctx.db
      .query("chatChannels")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    if (existingChannels.length >= 20) {
      throw new ConvexError(
        "This group has reached the maximum of 20 channels. Archive some channels to create new ones."
      );
    }

    // 5. Validate name: trim, check 1-50 chars
    const trimmedName = args.name.trim();
    if (trimmedName.length < 1 || trimmedName.length > 50) {
      throw new ConvexError("Channel name must be 1-50 characters.");
    }

    // 5b. Validate name contains at least one alphanumeric character
    if (!/[a-zA-Z0-9]/.test(trimmedName)) {
      throw new ConvexError("Channel name must contain at least one letter or number.");
    }

    // 5c. Validate timing config values are non-negative
    if (args.autoChannelConfig.addMembersDaysBefore < 0) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "addMembersDaysBefore must be 0 or greater",
      });
    }
    if (args.autoChannelConfig.removeMembersDaysAfter < 0) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "removeMembersDaysAfter must be 0 or greater",
      });
    }

    // 5d. Validate that at least one service type is configured
    const hasFilters = args.autoChannelConfig.filters?.serviceTypeIds?.length;
    const hasLegacyServiceType = args.autoChannelConfig.serviceTypeId;
    if (!hasFilters && !hasLegacyServiceType) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "At least one service type must be selected",
      });
    }

    // 5e. Validate teamIds when syncScope requires teams (legacy validation)
    const syncScope = args.autoChannelConfig.syncScope;
    if ((syncScope === "single_team" || syncScope === "multi_team") &&
        (!args.autoChannelConfig.teamIds || args.autoChannelConfig.teamIds.length === 0) &&
        (!args.autoChannelConfig.filters?.teamIds || args.autoChannelConfig.filters.teamIds.length === 0)) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `teamIds must be provided when syncScope is ${syncScope}`,
      });
    }

    // 6. Get existing slugs for this group
    const existingSlugs = existingChannels
      .map((ch) => ch.slug)
      .filter((slug): slug is string => slug !== undefined);

    // 7. Generate slug
    const slug = generateChannelSlug(trimmedName, existingSlugs);

    // 8. Insert chatChannels record with channelType: "pco_services"
    const now = Date.now();
    const channelId = await ctx.db.insert("chatChannels", {
      groupId: args.groupId,
      slug,
      channelType: "pco_services", // Matches schema comment for PCO auto channels
      name: trimmedName,
      description: args.description,
      createdById: userId,
      createdAt: now,
      updatedAt: now,
      isArchived: false,
      memberCount: 0, // Members are added via PCO sync
    });

    // 9. Insert autoChannelConfigs record
    const configId = await ctx.db.insert("autoChannelConfigs", {
      communityId: group.communityId,
      channelId,
      integrationType: args.integrationType,
      config: {
        // Include the new filters object if provided
        filters: args.autoChannelConfig.filters,
        // Include legacy fields for backward compatibility
        serviceTypeId: args.autoChannelConfig.serviceTypeId,
        serviceTypeName: args.autoChannelConfig.serviceTypeName,
        syncScope: args.autoChannelConfig.syncScope,
        teamIds: args.autoChannelConfig.teamIds,
        teamNames: args.autoChannelConfig.teamNames,
        addMembersDaysBefore: args.autoChannelConfig.addMembersDaysBefore,
        removeMembersDaysAfter: args.autoChannelConfig.removeMembersDaysAfter,
      },
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // 10. Schedule immediate sync to populate channel membership
    await ctx.scheduler.runAfter(
      0, // Run immediately
      internal.functions.pcoServices.rotation.syncAutoChannel,
      { configId }
    );

    // 11. Return result
    return { channelId, slug };
  },
});

/**
 * Leave a channel (for custom channels only).
 *
 * Auto channels (main, leaders) cannot be left directly:
 * - Main channel: User must leave the group entirely
 * - Leaders channel: User's role must be changed to remove them
 *
 * For custom channels:
 * - If user is the owner and other members exist, ownership transfers to the oldest member
 * - If user is the last member, the channel is archived
 */
export const leaveChannel = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    // 1. Authenticate user
    const userId = await requireAuth(ctx, args.token);

    // 2. Get channel, throw if not found
    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError({
        code: "CHANNEL_NOT_FOUND",
        message: "Channel not found",
      });
    }

    // 3. Check if auto channel - block with helpful error
    if (isAutoChannel(channel.channelType)) {
      if (channel.channelType === "main") {
        throw new ConvexError({
          code: "CANNOT_LEAVE_AUTO_CHANNEL",
          message:
            "You can't leave the General channel. To leave, you need to leave the group entirely from group settings.",
        });
      } else if (channel.channelType === "leaders") {
        throw new ConvexError({
          code: "CANNOT_LEAVE_AUTO_CHANNEL",
          message:
            "You can't leave the Leaders channel directly. You're in this channel because you're a group leader. Ask another leader to change your role to Member, and you'll be automatically removed.",
        });
      }
    }

    // 4. Get user's channel membership, throw if not a member
    const membership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!membership) {
      throw new ConvexError({
        code: "NOT_A_MEMBER",
        message: "You are not a member of this channel",
      });
    }

    const now = Date.now();

    // 5. If user is owner, handle ownership transfer
    if (membership.role === "owner") {
      // Find other active members (excluding the leaving user)
      const otherMembers = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
        .filter((q) =>
          q.and(
            q.eq(q.field("leftAt"), undefined),
            q.neq(q.field("userId"), userId)
          )
        )
        .collect();

      if (otherMembers.length > 0) {
        // Sort by joinedAt to find the oldest member
        otherMembers.sort((a, b) => a.joinedAt - b.joinedAt);
        const newOwner = otherMembers[0];

        // Promote oldest member to owner
        await ctx.db.patch(newOwner._id, {
          role: "owner",
        });

        // Note: If a notification system exists, we could schedule a notification here
        // to inform the new owner about the ownership transfer
      }
    }

    // 6. Soft delete membership (set leftAt)
    await ctx.db.patch(membership._id, {
      leftAt: now,
    });

    // 7. Update member count by recomputing from actual membership records
    await updateChannelMemberCount(ctx, args.channelId);

    // 8. Check if channel is now empty and archive if so
    const remainingMembers = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!remainingMembers) {
      // No members left, archive the channel
      await ctx.db.patch(args.channelId, {
        isArchived: true,
        archivedAt: now,
        updatedAt: now,
      });
    }
  },
});

/**
 * Add multiple members to a custom channel.
 * Only works on custom channels (not main or leaders).
 * Caller must be the channel owner or a group leader.
 */
export const addChannelMembers = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    userIds: v.array(v.id("users")),
  },
  returns: v.object({ addedCount: v.number() }),
  handler: async (ctx, args) => {
    // 1. Authenticate user
    const callerId = await requireAuth(ctx, args.token);

    // 2. Get channel and verify it's custom type
    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }
    if (!channel.groupId) {
      throw new Error("This operation is only valid for group channels");
    }
    const groupId = channel.groupId;

    if (!isCustomChannel(channel.channelType)) {
      throw new Error("You can only add members to custom channels.");
    }

    // Check if channel is archived
    if (channel.isArchived) {
      throw new Error("Cannot add members to an archived channel.");
    }

    // 3. Check permission: caller is channel owner OR group leader
    // Check ownership via channel membership role, not createdById
    const callerChannelMembership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", callerId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    const isChannelOwner = callerChannelMembership?.role === "owner";

    const callerGroupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", callerId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    const isGroupLeader = isLeaderRole(callerGroupMembership?.role);

    if (!isChannelOwner && !isGroupLeader) {
      throw new Error("Only the channel owner or group leaders can add members.");
    }

    // 4. Validate userIds and enforce group eligibility
    const validUserIds: Id<"users">[] = [];
    const userDataMap = new Map<Id<"users">, { displayName: string; profilePhoto: string | undefined }>();
    const timestamp = Date.now();
    const isSharedChannel = channel.isShared === true;
    const eligibleGroupIds = new Set<Id<"groups">>([groupId]);
    const ineligibleUserDisplayNames: string[] = [];

    if (isSharedChannel) {
      for (const sharedGroup of channel.sharedGroups ?? []) {
        if (sharedGroup.status === "accepted") {
          eligibleGroupIds.add(sharedGroup.groupId);
        }
      }
    }

    for (const userId of args.userIds) {
      // Check if user exists
      const user = await ctx.db.get(userId);
      if (!user) {
        continue; // Skip invalid user IDs
      }

      if (isSharedChannel) {
        // Shared channels must not mutate primary group membership.
        // Users are only eligible if they already belong to the primary group
        // or any accepted shared secondary group.
        const userGroupMemberships = await ctx.db
          .query("groupMembers")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .filter((q) =>
            q.and(
              q.eq(q.field("leftAt"), undefined),
              q.or(
                q.eq(q.field("requestStatus"), undefined),
                q.eq(q.field("requestStatus"), null),
                q.eq(q.field("requestStatus"), "accepted")
              )
            )
          )
          .collect();

        const hasEligibleGroupMembership = userGroupMemberships.some((membership) =>
          eligibleGroupIds.has(membership.groupId)
        );

        if (!hasEligibleGroupMembership) {
          ineligibleUserDisplayNames.push(getDisplayName(user.firstName, user.lastName));
          continue;
        }
      } else {
        // Non-shared channels keep legacy behavior: add missing primary group memberships.
        const existingGroupMembership = await ctx.db
          .query("groupMembers")
          .withIndex("by_group_user", (q) =>
            q.eq("groupId", groupId).eq("userId", userId)
          )
          .first();

        const isActiveGroupMember = existingGroupMembership && !existingGroupMembership.leftAt;

        if (!isActiveGroupMember) {
          // Auto-add user to the group
          if (existingGroupMembership && existingGroupMembership.leftAt) {
            // Reactivate: clear leftAt, update joinedAt
            await ctx.db.patch(existingGroupMembership._id, {
              role: "member",
              leftAt: undefined,
              joinedAt: timestamp,
              notificationsEnabled: true,
            });
          } else {
            // Create new group membership
            await ctx.db.insert("groupMembers", {
              groupId,
              userId,
              role: "member",
              joinedAt: timestamp,
              notificationsEnabled: true,
            });

            // Trigger welcome message for NEW group members only
            await ctx.scheduler.runAfter(
              0,
              internal.functions.scheduledJobs.sendWelcomeMessage,
              {
                groupId,
                userId,
              }
            );
          }

          // Sync channel memberships for the newly added group member
          await syncUserChannelMembershipsLogic(ctx, userId, groupId);
        }
      }

      // User is eligible to be added to the channel
      validUserIds.push(userId);
      userDataMap.set(userId, {
        displayName: getDisplayName(user.firstName, user.lastName),
        profilePhoto: getMediaUrl(user.profilePhoto),
      });
    }

    if (isSharedChannel && ineligibleUserDisplayNames.length > 0) {
      const previewNames = ineligibleUserDisplayNames.slice(0, 3).join(", ");
      const suffix = ineligibleUserDisplayNames.length > 3 ? ", and others" : "";
      throw new Error(
        `Cannot add ${previewNames}${suffix}. Shared channel members must already belong to the primary group or an accepted shared group.`
      );
    }

    // 5. For each valid user, add or reactivate channel membership
    let addedCount = 0;

    for (const userId of validUserIds) {
      const existingMembership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", args.channelId).eq("userId", userId)
        )
        .first();

      const userData = userDataMap.get(userId);

      if (existingMembership) {
        if (existingMembership.leftAt) {
          // Reactivate: clear leftAt, update joinedAt
          await ctx.db.patch(existingMembership._id, {
            leftAt: undefined,
            joinedAt: timestamp,
            displayName: userData?.displayName,
            profilePhoto: userData?.profilePhoto,
          });
          addedCount++;
        }
        // If already active member, skip
      } else {
        // New member
        await ctx.db.insert("chatChannelMembers", {
          channelId: args.channelId,
          userId,
          role: "member",
          joinedAt: timestamp,
          isMuted: false,
          displayName: userData?.displayName,
          profilePhoto: userData?.profilePhoto,
        });
        addedCount++;
      }
    }

    // 6. Update channel memberCount
    await updateChannelMemberCount(ctx, args.channelId);

    // 7. Return addedCount
    return { addedCount };
  },
});

/**
 * Remove a member from a custom channel.
 *
 * Only works on custom channels (not main or leaders channels).
 * Requires the caller to be either:
 * - The channel owner (role === "owner" in chatChannelMembers)
 * - A group leader/admin
 *
 * Special handling:
 * - If removing the owner, promotes the next oldest member to owner
 * - If the last member is removed, archives the channel
 */
export const removeChannelMember = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // 1. Authenticate caller
    const callerId = await requireAuth(ctx, args.token);

    // 2. Get channel and verify it's a custom channel
    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError({
        code: "CHANNEL_NOT_FOUND",
        message: "Channel not found",
      });
    }
    if (!channel.groupId) {
      throw new ConvexError({
        code: "INVALID_CHANNEL_TYPE",
        message: "This operation is only valid for group channels",
      });
    }
    const groupId = channel.groupId;

    if (!isCustomChannel(channel.channelType)) {
      throw new ConvexError({
        code: "INVALID_CHANNEL_TYPE",
        message: "You can only remove members from custom channels.",
      });
    }

    // 3. Check permission: caller must be channel owner OR group leader
    // First, check if caller is the channel owner (role === "owner" in membership)
    const callerChannelMembership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", callerId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    const isChannelOwner = callerChannelMembership?.role === "owner";

    // Also check if caller is a group leader
    const callerGroupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", callerId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    const isGroupLeader = isLeaderRole(callerGroupMembership?.role);

    if (!isChannelOwner && !isGroupLeader) {
      throw new ConvexError({
        code: "PERMISSION_DENIED",
        message: "Only the channel owner or group leaders can remove members.",
      });
    }

    // 4. Get target user's channel membership
    const targetMembership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", args.userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!targetMembership) {
      throw new ConvexError({
        code: "NOT_A_MEMBER",
        message: "This person is not a member of this channel.",
      });
    }

    const now = Date.now();

    // 5. Handle owner removal - promote next oldest member
    const isRemovingOwner = targetMembership.role === "owner";
    if (isRemovingOwner) {
      // Find other active members, sorted by joinedAt (oldest first)
      const otherMembers = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
        .filter((q) =>
          q.and(
            q.eq(q.field("leftAt"), undefined),
            q.neq(q.field("userId"), args.userId)
          )
        )
        .collect();

      if (otherMembers.length > 0) {
        // Sort by joinedAt to find the oldest member
        otherMembers.sort((a, b) => a.joinedAt - b.joinedAt);
        const newOwner = otherMembers[0];

        // Promote oldest member to owner
        await ctx.db.patch(newOwner._id, {
          role: "owner",
        });
      }
    }

    // 6. Soft delete membership (set leftAt)
    await ctx.db.patch(targetMembership._id, {
      leftAt: now,
    });

    // 7. Update member count by recomputing from actual membership records
    await updateChannelMemberCount(ctx, args.channelId);

    // 8. Check if channel is now empty and archive if so
    const remainingMembersAfterRemoval = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!remainingMembersAfterRemoval) {
      // No members left, archive the channel
      await ctx.db.patch(args.channelId, {
        isArchived: true,
        archivedAt: now,
        updatedAt: now,
      });
    }
  },
});

// ============================================================================
// Channel Creation Logic (Reusable)
// ============================================================================

/**
 * ATOMIC CHANNEL CREATION LOGIC
 *
 * Creates main and leaders channels for a group if they don't exist.
 * This function can be called directly within any mutation for atomic,
 * transactional channel creation.
 *
 * IMPORTANT: Call this directly within your mutation for transactional guarantees.
 * Do NOT use scheduler.runAfter() or actions as that creates a race condition.
 *
 * @param ctx - The mutation context
 * @param groupId - The group to create channels for
 * @param createdById - The user ID to set as channel creator
 * @param groupName - The group name (for channel naming)
 * @returns Object with created flag and array of created channel IDs
 */
export async function ensureChannelsForGroupLogic(
  ctx: MutationCtx,
  groupId: Id<"groups">,
  createdById: Id<"users">,
  groupName: string
): Promise<{ created: boolean; createdChannelIds: Id<"chatChannels">[] }> {
  // Check if channels already exist
  const existingChannels = await ctx.db
    .query("chatChannels")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .filter((q) => q.eq(q.field("isArchived"), false))
    .collect();

  const hasMain = existingChannels.some((ch) => ch.channelType === "main");
  const hasLeaders = existingChannels.some((ch) => ch.channelType === "leaders");

  const now = Date.now();
  const createdChannelIds: Id<"chatChannels">[] = [];

  // Create main channel if missing
  if (!hasMain) {
    const mainChannelId = await ctx.db.insert("chatChannels", {
      groupId,
      slug: "general", // Standard slug for main channel
      channelType: "main",
      name: `${groupName} - General`,
      description: `General chat for ${groupName}`,
      createdById,
      createdAt: now,
      updatedAt: now,
      isArchived: false,
      memberCount: 0,
    });
    createdChannelIds.push(mainChannelId);
  }

  // Create leaders channel if missing
  if (!hasLeaders) {
    const leadersChannelId = await ctx.db.insert("chatChannels", {
      groupId,
      slug: "leaders", // Standard slug for leaders channel
      channelType: "leaders",
      name: `${groupName} - Leaders Hub`,
      description: `Leaders-only chat for ${groupName}`,
      createdById,
      createdAt: now,
      updatedAt: now,
      isArchived: false,
      memberCount: 0,
    });
    createdChannelIds.push(leadersChannelId);
  }

  return {
    created: createdChannelIds.length > 0,
    createdChannelIds,
  };
}

/**
 * Internal mutation to ensure channels exist for a group.
 * Creates main and leaders channels if they don't exist.
 *
 * NOTE: Prefer using ensureChannelsForGroupLogic() directly within your mutation
 * for atomic/transactional guarantees. This internal mutation is kept for
 * backwards compatibility with existing actions.
 */
export const ensureChannelsForGroup = internalMutation({
  args: {
    groupId: v.id("groups"),
    createdById: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Get group to get name
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new Error("Group not found");
    }

    return ensureChannelsForGroupLogic(ctx, args.groupId, args.createdById, group.name);
  },
});

/**
 * Action to ensure channels exist for a group (creates if missing).
 *
 * NOTE: As of the atomicity fix, channels are now created atomically with the group
 * in the create mutation. This action is kept for backwards compatibility and as a
 * self-healing mechanism for any legacy groups that might be missing channels.
 *
 * This can be called from the frontend when channels are missing.
 */
export const ensureChannels = action({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args): Promise<{ created: boolean; createdChannelIds: Id<"chatChannels">[] }> => {
    // Verify token and get user ID string
    const tokenUserId = await requireAuthFromTokenAction(ctx, args.token);

    // Resolve to Convex user ID using internal query from users module
    const userLookup = await ctx.runQuery(
      internal.functions.users.resolveUserIdInternal,
      { tokenUserId }
    );
    if (!userLookup) {
      throw new Error("User not found");
    }
    const userId = userLookup.userId;

    // Verify user is a member using internal query
    const membership = await ctx.runQuery(
      internal.functions.groups.index.getMembershipInternal,
      {
        groupId: args.groupId,
        userId,
      }
    );

    if (!membership) {
      throw new Error("Not a member of this group");
    }

    // Ensure channels exist
    const result = await ctx.runMutation(internal.functions.messaging.channels.ensureChannelsForGroup, {
      groupId: args.groupId,
      createdById: userId,
    });

    return result;
  },
});

// ============================================================================
// Channel Membership Sync (Centralized)
// ============================================================================

/**
 * Test helper action to directly invoke channel membership sync.
 * This is used in tests because scheduler.runAfter doesn't work
 * synchronously in the test environment.
 */
export const testSyncUserChannelMemberships = action({
  args: {
    userId: v.id("users"),
    groupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.functions.messaging.channels.syncUserChannelMemberships, {
      userId: args.userId,
      groupId: args.groupId,
    });
  },
});

/**
 * Toggle the leaders channel for a group (enable/disable).
 *
 * When enabled:
 * - Unarchives the channel
 * - Re-adds all current group leaders as members
 *
 * When disabled:
 * - Archives the channel (preserves history)
 * - Removes all members (soft delete with leftAt)
 *
 * This operation is idempotent - calling with enabled=true when already
 * enabled is a no-op, and vice versa.
 */
export const toggleLeadersChannel = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const now = Date.now();

    // Verify caller is a group leader
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership) {
      throw new Error("Not a member of this group");
    }

    if (groupMembership.role !== "leader" && groupMembership.role !== "admin") {
      throw new Error("Only group leaders can toggle the leaders channel");
    }

    // Find the leaders channel for this group
    const leadersChannel = await ctx.db
      .query("chatChannels")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("channelType"), "leaders"))
      .first();

    if (!leadersChannel) {
      throw new Error("Leaders channel not found for this group");
    }

    // Check idempotency
    const isCurrentlyArchived = leadersChannel.isArchived === true;

    if (args.enabled && !isCurrentlyArchived) {
      // Already enabled, no-op
      return { channelId: leadersChannel._id, status: "already_enabled" };
    }

    if (!args.enabled && isCurrentlyArchived) {
      // Already disabled, no-op
      return { channelId: leadersChannel._id, status: "already_disabled" };
    }

    if (args.enabled) {
      // ENABLE: Unarchive channel and re-add all leaders

      // Unarchive the channel
      await ctx.db.patch(leadersChannel._id, {
        isArchived: false,
        archivedAt: undefined,
        updatedAt: now,
      });

      // Get all active group leaders
      const groupLeaders = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
        .filter((q) =>
          q.and(
            q.eq(q.field("leftAt"), undefined),
            q.or(
              q.eq(q.field("role"), "leader"),
              q.eq(q.field("role"), "admin")
            )
          )
        )
        .collect();

      // Re-add each leader to the channel
      for (const leader of groupLeaders) {
        const user = await ctx.db.get(leader.userId);
        const displayName = user ? getDisplayName(user.firstName, user.lastName) : undefined;
        const profilePhoto = user ? getMediaUrl(user.profilePhoto) : undefined;

        // Check if they have an existing membership record
        const existingMembership = await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", leadersChannel._id).eq("userId", leader.userId)
          )
          .first();

        if (existingMembership) {
          if (existingMembership.leftAt) {
            // Reactivate the membership
            await ctx.db.patch(existingMembership._id, {
              leftAt: undefined,
              joinedAt: now,
              role: "admin",
              displayName,
              profilePhoto,
            });
          }
          // else: already an active member, skip
        } else {
          // Create new membership
          await ctx.db.insert("chatChannelMembers", {
            channelId: leadersChannel._id,
            userId: leader.userId,
            role: "admin",
            joinedAt: now,
            isMuted: false,
            displayName,
            profilePhoto,
          });
        }
      }

      // Update member count
      await updateChannelMemberCount(ctx, leadersChannel._id);

      return { channelId: leadersChannel._id, status: "enabled" };
    } else {
      // DISABLE: Archive channel and remove all members

      // Archive the channel
      await ctx.db.patch(leadersChannel._id, {
        isArchived: true,
        archivedAt: now,
        updatedAt: now,
      });

      // Get all active members of the channel
      const activeMembers = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", leadersChannel._id))
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .collect();

      // Soft-delete each membership
      for (const member of activeMembers) {
        await ctx.db.patch(member._id, {
          leftAt: now,
        });
      }

      // Set member count to 0
      await ctx.db.patch(leadersChannel._id, {
        memberCount: 0,
      });

      return { channelId: leadersChannel._id, status: "disabled" };
    }
  },
});

/**
 * Toggle the Reach Out channel for a group.
 *
 * When enabled:
 * - Requires leaders channel to be enabled
 * - Creates or unarchives reach_out channel with slug "reach-out"
 * - Adds ALL active group members
 *
 * When disabled:
 * - Archives the channel
 * - Soft-deletes all memberships
 * - Clears reachOutConfig on the group
 */
export const toggleReachOutChannel = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const now = Date.now();

    // Verify caller is a group leader
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership) {
      throw new Error("Not a member of this group");
    }

    if (groupMembership.role !== "leader" && groupMembership.role !== "admin") {
      throw new Error("Only group leaders can toggle the reach out channel");
    }

    if (args.enabled) {
      // Verify leaders channel is enabled
      const leadersChannel = await ctx.db
        .query("chatChannels")
        .withIndex("by_group_type", (q) =>
          q.eq("groupId", args.groupId).eq("channelType", "leaders")
        )
        .first();

      if (!leadersChannel || leadersChannel.isArchived) {
        throw new Error("Leaders channel must be enabled before enabling Reach Out");
      }
    }

    // Find existing reach_out channel
    const existingChannel = await ctx.db
      .query("chatChannels")
      .withIndex("by_group_type", (q) =>
        q.eq("groupId", args.groupId).eq("channelType", "reach_out")
      )
      .first();

    if (args.enabled) {
      let channelId: Id<"chatChannels">;

      if (existingChannel && !existingChannel.isArchived) {
        // Already enabled
        return { channelId: existingChannel._id, status: "already_enabled" };
      }

      if (existingChannel) {
        // Unarchive existing channel
        await ctx.db.patch(existingChannel._id, {
          isArchived: false,
          archivedAt: undefined,
          updatedAt: now,
        });
        channelId = existingChannel._id;
      } else {
        // Create new reach_out channel
        channelId = await ctx.db.insert("chatChannels", {
          groupId: args.groupId,
          slug: "reach-out",
          channelType: "reach_out",
          name: "Reach Out",
          createdById: userId,
          createdAt: now,
          updatedAt: now,
          isArchived: false,
          memberCount: 0,
        });
      }

      // Add ALL active group members to the channel
      const allMembers = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .collect();

      for (const member of allMembers) {
        const user = await ctx.db.get(member.userId);
        const displayName = user ? getDisplayName(user.firstName, user.lastName) : undefined;
        const profilePhoto = user ? getMediaUrl(user.profilePhoto) : undefined;

        const existingMembership = await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", channelId).eq("userId", member.userId)
          )
          .first();

        if (existingMembership) {
          if (existingMembership.leftAt) {
            await ctx.db.patch(existingMembership._id, {
              leftAt: undefined,
              joinedAt: now,
              role: "member",
              displayName,
              profilePhoto,
            });
          }
        } else {
          await ctx.db.insert("chatChannelMembers", {
            channelId,
            userId: member.userId,
            role: "member",
            joinedAt: now,
            isMuted: false,
            displayName,
            profilePhoto,
          });
        }
      }

      await updateChannelMemberCount(ctx, channelId);

      // Update group config
      await ctx.db.patch(args.groupId, {
        reachOutConfig: { enabled: true },
      });

      return { channelId, status: "enabled" };
    } else {
      // DISABLE
      if (!existingChannel || existingChannel.isArchived) {
        return { channelId: existingChannel?._id, status: "already_disabled" };
      }

      // Archive the channel
      await ctx.db.patch(existingChannel._id, {
        isArchived: true,
        archivedAt: now,
        updatedAt: now,
      });

      // Soft-delete all members
      const activeMembers = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", existingChannel._id))
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .collect();

      for (const member of activeMembers) {
        await ctx.db.patch(member._id, { leftAt: now });
      }

      await ctx.db.patch(existingChannel._id, { memberCount: 0 });

      // Update group config
      await ctx.db.patch(args.groupId, {
        reachOutConfig: { enabled: false },
      });

      return { channelId: existingChannel._id, status: "disabled" };
    }
  },
});

/**
 * Toggle the General (main) channel for a group.
 *
 * When enabled: unarchives and adds all active group members.
 * When disabled: archives, clears memberships (same pattern as leaders channel).
 */
export const toggleMainChannel = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const now = Date.now();

    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership) {
      throw new Error("Not a member of this group");
    }

    if (groupMembership.role !== "leader" && groupMembership.role !== "admin") {
      throw new Error("Only group leaders can toggle the General channel");
    }

    const mainChannel = await ctx.db
      .query("chatChannels")
      .withIndex("by_group_type", (q) =>
        q.eq("groupId", args.groupId).eq("channelType", "main")
      )
      .first();

    if (!mainChannel) {
      throw new Error("General channel not found for this group");
    }

    const isCurrentlyArchived = mainChannel.isArchived === true;

    if (args.enabled && !isCurrentlyArchived) {
      return { channelId: mainChannel._id, status: "already_enabled" as const };
    }

    if (!args.enabled && isCurrentlyArchived) {
      return { channelId: mainChannel._id, status: "already_disabled" as const };
    }

    if (args.enabled) {
      await ctx.db.patch(mainChannel._id, {
        isArchived: false,
        archivedAt: undefined,
        updatedAt: now,
      });

      const allMembers = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .collect();

      for (const member of allMembers) {
        const user = await ctx.db.get(member.userId);
        const displayName = user ? getDisplayName(user.firstName, user.lastName) : undefined;
        const profilePhoto = user ? getMediaUrl(user.profilePhoto) : undefined;

        const existingMembership = await ctx.db
          .query("chatChannelMembers")
          .withIndex("by_channel_user", (q) =>
            q.eq("channelId", mainChannel._id).eq("userId", member.userId)
          )
          .first();

        if (existingMembership) {
          if (existingMembership.leftAt) {
            await ctx.db.patch(existingMembership._id, {
              leftAt: undefined,
              joinedAt: now,
              role: "member",
              displayName,
              profilePhoto,
            });
          }
        } else {
          await ctx.db.insert("chatChannelMembers", {
            channelId: mainChannel._id,
            userId: member.userId,
            role: "member",
            joinedAt: now,
            isMuted: false,
            displayName,
            profilePhoto,
          });
        }
      }

      await updateChannelMemberCount(ctx, mainChannel._id);
      return { channelId: mainChannel._id, status: "enabled" as const };
    }

    await ctx.db.patch(mainChannel._id, {
      isArchived: true,
      archivedAt: now,
      updatedAt: now,
    });

    const activeMembers = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", mainChannel._id))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    for (const member of activeMembers) {
      await ctx.db.patch(member._id, { leftAt: now });
    }

    await ctx.db.patch(mainChannel._id, { memberCount: 0, updatedAt: now });

    return { channelId: mainChannel._id, status: "disabled" as const };
  },
});

/**
 * CENTRALIZED CHANNEL MEMBERSHIP SYNC
 *
 * This is the single source of truth for syncing a user's channel memberships.
 * Call this function whenever a user's group membership changes.
 *
 * It handles ALL scenarios:
 * - User joins group → Add to main channel (and leaders if leader/admin)
 * - User leaves group → Remove from all group channels
 * - User promoted to leader → Add to leaders channel
 * - User demoted from leader → Remove from leaders channel
 *
 * The function looks at the user's CURRENT state in groupMembers and ensures
 * their channel memberships match. This idempotent design means:
 * - It's safe to call multiple times
 * - It self-heals any inconsistencies
 * - One place to fix bugs
 *
 * @param userId - The user to sync
 * @param groupId - Optional: sync only channels for this group (faster)
 *                  If not provided, syncs ALL user's groups
 */
export const syncUserChannelMemberships = internalMutation({
  args: {
    userId: v.id("users"),
    groupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Get user info for denormalization
    const user = await ctx.db.get(args.userId);
    if (!user) {
      console.warn(`[syncUserChannelMemberships] User ${args.userId} not found`);
      return;
    }
    const displayName = getDisplayName(user.firstName, user.lastName);
    const profilePhoto = getMediaUrl(user.profilePhoto);

    // Store groupId in local variable for TypeScript narrowing
    const targetGroupId = args.groupId;

    // Get user's group memberships
    let groupMemberships;
    if (targetGroupId) {
      // Targeted sync - only for one group
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", targetGroupId).eq("userId", args.userId)
        )
        .first();
      groupMemberships = membership ? [membership] : [];
    } else {
      // Full sync - all user's groups
      groupMemberships = await ctx.db
        .query("groupMembers")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .collect();
    }

    // Build a map of group -> role (only active memberships)
    const groupRoleMap = new Map<Id<"groups">, string>();
    for (const gm of groupMemberships) {
      if (!gm.leftAt) {
        groupRoleMap.set(gm.groupId, gm.role);
      }
    }

    // Get channels to sync
    let channels;
    if (targetGroupId) {
      channels = await ctx.db
        .query("chatChannels")
        .withIndex("by_group", (q) => q.eq("groupId", targetGroupId))
        .filter((q) => q.eq(q.field("isArchived"), false))
        .collect();
    } else {
      // Get all channels for groups user is/was a member of
      const groupIds = [...new Set(groupMemberships.map((gm) => gm.groupId))];
      channels = [];
      for (const gId of groupIds) {
        const groupChannels = await ctx.db
          .query("chatChannels")
          .withIndex("by_group", (q) => q.eq("groupId", gId))
          .filter((q) => q.eq(q.field("isArchived"), false))
          .collect();
        channels.push(...groupChannels);
      }
    }

    // Sync each channel
    for (const channel of channels) {
      if (!channel.groupId) continue; // Skip ad-hoc channels (DM/group_dm)
      const groupRole = groupRoleMap.get(channel.groupId);
      const isActiveGroupMember = groupRole !== undefined;
      const isLeaderOrAdmin = groupRole === "leader" || groupRole === "admin";

      // Determine if user SHOULD be in this channel
      let shouldBeInChannel = false;
      if (channel.channelType === "main") {
        shouldBeInChannel = isActiveGroupMember;
      } else if (channel.channelType === "leaders") {
        shouldBeInChannel = isActiveGroupMember && isLeaderOrAdmin;
      } else if (channel.channelType === "reach_out") {
        shouldBeInChannel = isActiveGroupMember;
      }

      // Get current channel membership
      const currentMembership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channel._id).eq("userId", args.userId)
        )
        .first();

      const isCurrentlyInChannel = currentMembership && !currentMembership.leftAt;

      // Sync membership to desired state
      if (shouldBeInChannel && !isCurrentlyInChannel) {
        // ADD to channel
        if (currentMembership) {
          // Reactivate existing membership
          await ctx.db.patch(currentMembership._id, {
            leftAt: undefined,
            joinedAt: now,
            role: isLeaderOrAdmin ? "admin" : "member",
            displayName,
            profilePhoto,
          });
        } else {
          // Create new membership
          await ctx.db.insert("chatChannelMembers", {
            channelId: channel._id,
            userId: args.userId,
            role: isLeaderOrAdmin ? "admin" : "member",
            joinedAt: now,
            isMuted: false,
            displayName,
            profilePhoto,
          });
        }
      } else if (!shouldBeInChannel && isCurrentlyInChannel) {
        // REMOVE from channel (soft delete)
        await ctx.db.patch(currentMembership!._id, {
          leftAt: now,
        });
      }
      // else: already in correct state, no action needed

      // Update channel member count by recomputing from actual membership records
      await updateChannelMemberCount(ctx, channel._id);
    }
  },
});

// ============================================================================
// Auto Channel Management
// ============================================================================

/**
 * Update auto channel configuration.
 *
 * Allows updating the PCO sync settings for an auto channel:
 * - Service type and team selection
 * - Membership timing (days before/after)
 * - Active status (enable/disable syncing)
 *
 * Only group leaders can update auto channel configs.
 */
export const updateAutoChannelConfig = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    config: v.object({
      // NEW: Filter-based configuration (preferred)
      filters: v.optional(
        v.object({
          serviceTypeIds: v.optional(v.array(v.string())),
          serviceTypeNames: v.optional(v.array(v.string())),
          teamIds: v.optional(v.array(v.string())),
          teamNames: v.optional(v.array(v.string())),
          // Support both strings and position objects with context
          positions: v.optional(
            v.array(
              v.union(
                v.string(),
                v.object({
                  name: v.string(),
                  teamId: v.optional(v.string()),
                  teamName: v.optional(v.string()),
                  serviceTypeId: v.optional(v.string()),
                  serviceTypeName: v.optional(v.string()),
                })
              )
            )
          ),
          statuses: v.optional(v.array(v.string())),
        })
      ),
      // LEGACY: Keep for backward compatibility
      serviceTypeId: v.optional(v.string()),
      serviceTypeName: v.optional(v.string()),
      syncScope: v.optional(v.string()),
      teamIds: v.optional(v.array(v.string())),
      teamNames: v.optional(v.array(v.string())),
      addMembersDaysBefore: v.optional(v.number()),
      removeMembersDaysAfter: v.optional(v.number()),
    }),
    isActive: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // 1. Authenticate user
    const userId = await requireAuth(ctx, args.token);
    const now = Date.now();

    // 2. Get channel and verify it exists
    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Channel not found",
      });
    }
    if (!channel.groupId) {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: "This operation is only valid for group channels",
      });
    }
    const groupId = channel.groupId;

    // 3. Verify channel is an auto channel (pco_services type)
    if (channel.channelType !== "pco_services") {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: "This channel is not a PCO auto channel",
      });
    }

    // 4. Get group and verify user is a leader
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership || !isLeaderRole(groupMembership.role)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only group leaders can update auto channel settings",
      });
    }

    // 5. Get autoChannelConfigs record
    const autoConfig = await ctx.db
      .query("autoChannelConfigs")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .unique();

    if (!autoConfig) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Auto channel configuration not found",
      });
    }

    // 5b. Validate timing config values are non-negative
    if (args.config.addMembersDaysBefore !== undefined && args.config.addMembersDaysBefore < 0) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "addMembersDaysBefore must be 0 or greater",
      });
    }
    if (args.config.removeMembersDaysAfter !== undefined && args.config.removeMembersDaysAfter < 0) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "removeMembersDaysAfter must be 0 or greater",
      });
    }

    // 6. Build the updated config object
    // Start with existing config
    const updatedConfig = {
      ...autoConfig.config,
      // Update filters if provided (new format takes precedence)
      ...(args.config.filters !== undefined && {
        filters: args.config.filters,
      }),
      // Update legacy fields if provided
      ...(args.config.serviceTypeId !== undefined && {
        serviceTypeId: args.config.serviceTypeId,
      }),
      ...(args.config.serviceTypeName !== undefined && {
        serviceTypeName: args.config.serviceTypeName,
      }),
      ...(args.config.syncScope !== undefined && {
        syncScope: args.config.syncScope,
      }),
      ...(args.config.teamIds !== undefined && {
        teamIds: args.config.teamIds,
      }),
      ...(args.config.teamNames !== undefined && {
        teamNames: args.config.teamNames,
      }),
      ...(args.config.addMembersDaysBefore !== undefined && {
        addMembersDaysBefore: args.config.addMembersDaysBefore,
      }),
      ...(args.config.removeMembersDaysAfter !== undefined && {
        removeMembersDaysAfter: args.config.removeMembersDaysAfter,
      }),
    };

    // 6b. Validate teamIds when syncScope requires teams (check resulting config)
    const resultingSyncScope = updatedConfig.syncScope;
    const resultingTeamIds = updatedConfig.teamIds;
    if ((resultingSyncScope === "single_team" || resultingSyncScope === "multi_team") &&
        (!resultingTeamIds || resultingTeamIds.length === 0)) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `teamIds must be provided when syncScope is ${resultingSyncScope}`,
      });
    }

    // 7. Update the config
    const updates: {
      config: typeof updatedConfig;
      updatedAt: number;
      isActive?: boolean;
    } = {
      config: updatedConfig,
      updatedAt: now,
    };

    // Update isActive if provided
    if (args.isActive !== undefined) {
      updates.isActive = args.isActive;
    }

    await ctx.db.patch(autoConfig._id, updates);

    return null;
  },
});

/**
 * Disable auto channel syncing.
 *
 * Sets isActive to false on the autoChannelConfigs record.
 * The channel remains but membership will no longer be synced from PCO.
 *
 * Only group leaders can disable auto channel syncing.
 */
export const disableAutoChannel = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // 1. Authenticate user
    const userId = await requireAuth(ctx, args.token);
    const now = Date.now();

    // 2. Get channel and verify it exists
    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Channel not found",
      });
    }
    if (!channel.groupId) {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: "This operation is only valid for group channels",
      });
    }
    const groupId = channel.groupId;

    // 3. Verify channel is an auto channel
    if (channel.channelType !== "pco_services") {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: "This channel is not a PCO auto channel",
      });
    }

    // 4. Get group and verify user is a leader
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership || !isLeaderRole(groupMembership.role)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only group leaders can disable auto channel syncing",
      });
    }

    // 5. Get autoChannelConfigs record
    const autoConfig = await ctx.db
      .query("autoChannelConfigs")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .unique();

    if (!autoConfig) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Auto channel configuration not found",
      });
    }

    // 6. Set isActive to false
    await ctx.db.patch(autoConfig._id, {
      isActive: false,
      updatedAt: now,
    });

    return null;
  },
});

/**
 * Update the pinned channels for a group.
 *
 * Leaders can set which channels appear pinned and in what order.
 * Pinned channels appear after main/leaders channels and before unpinned channels.
 *
 * @param pinnedChannelSlugs - Ordered array of channel slugs to pin
 */
export const updatePinnedChannels = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    pinnedChannelSlugs: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Authenticate user
    const userId = await requireAuth(ctx, args.token);

    // 2. Get group
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new ConvexError({
        code: "GROUP_NOT_FOUND",
        message: "Group not found",
      });
    }

    // 3. Verify user is a group leader
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    if (!groupMembership || !isLeaderRole(groupMembership.role)) {
      throw new ConvexError({
        code: "NOT_AUTHORIZED",
        message: "Only group leaders can update pinned channels",
      });
    }

    // 4. Get all channels for this group to validate slugs
    const groupChannels = await ctx.db
      .query("chatChannels")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    // 5. Filter to only include slugs that exist and aren't main/leaders (those have fixed positions)
    const pinnableChannels = groupChannels.filter(
      (ch) => ch.channelType !== "main" && ch.channelType !== "leaders"
    );
    const validSlugs = new Set(pinnableChannels.map((ch) => getChannelSlug(ch)));

    const validPinnedSlugs = args.pinnedChannelSlugs.filter((slug) =>
      validSlugs.has(slug)
    );

    // 6. Update group with new pinned slugs
    await ctx.db.patch(args.groupId, {
      pinnedChannelSlugs: validPinnedSlugs,
    });

    return { success: true, pinnedCount: validPinnedSlugs.length };
  },
});
