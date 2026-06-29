/**
 * Inbox message search.
 *
 * Full-text search over chat message bodies for the app inbox. Results are
 * scoped to the caller's active community and restricted to channels the caller
 * can actually read (the same read boundary `getMessages` enforces). Convex
 * search-index filters can only match a single field value, so they can't OR
 * across the user's channel set — community/permission scoping is therefore
 * applied in the handler after pulling the top matches from the index.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import type { QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import {
  isCustomChannel,
  channelIsLeaderEnabled,
  isLeaderRole,
} from "../../lib/helpers";
import { canAccessEventChannel } from "./eventChat";

/** Below this length a search is a no-op (avoids matching on single letters). */
const MIN_QUERY_LENGTH = 2;
/**
 * Raw matches pulled from the search index before permission filtering. The
 * index returns globally relevance-ranked rows; we over-fetch so a reasonable
 * number survive the per-channel access filter below.
 */
const SEARCH_FETCH_LIMIT = 100;
/** Maximum results returned to the client after filtering. */
const SEARCH_RESULT_LIMIT = 40;

/**
 * Content types that aren't user-authored prose. System notices have body text
 * (e.g. "X joined the group") that would otherwise pollute search results.
 */
const NON_SEARCHABLE_CONTENT_TYPES = new Set(["system"]);

type SearchResult = {
  messageId: Id<"chatMessages">;
  channelId: Id<"chatChannels">;
  channelName: string;
  channelType: string;
  /** Channel slug — used to build the `/inbox/{groupId}/{slug}` deep link. */
  channelSlug: string | null;
  isAdHoc: boolean;
  groupId: Id<"groups"> | null;
  groupName: string | null;
  /** For event channels: the owning meeting's shortId for `/e/{shortId}`. */
  meetingShortId: string | null;
  content: string;
  senderId: Id<"users"> | null;
  senderName: string | null;
  createdAt: number;
};

/**
 * Resolve the set of channel IDs the caller can read within `communityId`.
 *
 * Mirrors the read boundary in `getMessages`:
 *  - Leaders of a group can read all of that group's channels.
 *  - Anyone with an active channel-membership row can read that channel
 *    (covers DMs, group_dm, event, custom, and shared channels).
 *  - Disabled leader-only channels (custom / pco_services / announcements)
 *    stay hidden from non-leader members.
 *  - Event channels additionally go through `canAccessEventChannel`.
 *
 * The set is bounded by the user's memberships + their leader groups' channels,
 * so this stays cheap regardless of total community size.
 */
async function resolveAccessibleChannelIds(
  ctx: QueryCtx,
  userId: Id<"users">,
  communityId: Id<"communities">,
  channelCache: Map<string, Doc<"chatChannels"> | null>,
  groupCache: Map<string, Doc<"groups"> | null>,
): Promise<Set<string>> {
  const getGroup = async (id: Id<"groups">) => {
    if (!groupCache.has(id)) groupCache.set(id, await ctx.db.get(id));
    return groupCache.get(id) ?? null;
  };

  // Active group memberships → which groups the user leads.
  const groupMemberships = await ctx.db
    .query("groupMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .filter((q) =>
      q.and(
        q.eq(q.field("leftAt"), undefined),
        q.or(
          q.eq(q.field("requestStatus"), undefined),
          q.eq(q.field("requestStatus"), "accepted"),
        ),
      ),
    )
    .collect();
  const leaderGroupIds = new Set<string>(
    groupMemberships
      .filter((gm) => isLeaderRole(gm.role))
      .map((gm) => gm.groupId),
  );

  const accessible = new Set<string>();

  // Leaders see every (non-archived) channel in their group, even without a
  // dedicated membership row.
  for (const groupId of leaderGroupIds) {
    const group = await getGroup(groupId as Id<"groups">);
    if (!group || group.isArchived || group.communityId !== communityId) continue;
    const channels = await ctx.db
      .query("chatChannels")
      .withIndex("by_group", (q) => q.eq("groupId", groupId as Id<"groups">))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();
    for (const channel of channels) {
      channelCache.set(channel._id, channel);
      accessible.add(channel._id);
    }
  }

  // Channel-membership rows (DMs, group_dm, event, custom, shared, and group
  // channels the user explicitly belongs to).
  const memberships = await ctx.db
    .query("chatChannelMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .filter((q) => q.eq(q.field("leftAt"), undefined))
    .collect();

  for (const membership of memberships) {
    if (accessible.has(membership.channelId)) continue;
    if (membership.requestState === "declined") continue;

    if (!channelCache.has(membership.channelId)) {
      channelCache.set(membership.channelId, await ctx.db.get(membership.channelId));
    }
    const channel = channelCache.get(membership.channelId);
    if (!channel || channel.isArchived) continue;

    // Community scoping: group channels inherit the group's community; ad-hoc
    // (dm/group_dm) channels carry communityId directly.
    if (channel.groupId) {
      const group = await getGroup(channel.groupId);
      if (!group || group.isArchived || group.communityId !== communityId) continue;
    } else if (channel.communityId !== communityId) {
      continue;
    }

    if (channel.channelType === "event") {
      if (!(await canAccessEventChannel(ctx, userId, channel))) continue;
      accessible.add(channel._id);
      continue;
    }

    // Disabled leader-only channels are invisible to non-leader members.
    if (
      isCustomChannel(channel.channelType) ||
      channel.channelType === "pco_services" ||
      channel.channelType === "announcements"
    ) {
      const isLeaderHere = channel.groupId
        ? leaderGroupIds.has(channel.groupId)
        : false;
      if (!channelIsLeaderEnabled(channel) && !isLeaderHere) continue;
    }

    accessible.add(channel._id);
  }

  return accessible;
}

export const searchMessages = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    query: v.string(),
  },
  handler: async (ctx, args): Promise<{ results: SearchResult[]; truncated: boolean }> => {
    const userId = await requireAuth(ctx, args.token);

    const term = args.query.trim();
    if (term.length < MIN_QUERY_LENGTH) {
      return { results: [], truncated: false };
    }

    const channelCache = new Map<string, Doc<"chatChannels"> | null>();
    const groupCache = new Map<string, Doc<"groups"> | null>();

    const accessibleChannelIds = await resolveAccessibleChannelIds(
      ctx,
      userId,
      args.communityId,
      channelCache,
      groupCache,
    );
    if (accessibleChannelIds.size === 0) {
      return { results: [], truncated: false };
    }

    // Filter out messages from users the caller has blocked (parity with
    // getMessages).
    const blocks = await ctx.db
      .query("chatUserBlocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", userId))
      .collect();
    const blockedUserIds = new Set(blocks.map((b) => b.blockedId));

    const matches = await ctx.db
      .query("chatMessages")
      .withSearchIndex("search_content", (q) =>
        q.search("content", term).eq("isDeleted", false),
      )
      .take(SEARCH_FETCH_LIMIT);

    const meetingShortIdCache = new Map<string, string | null>();
    const getMeetingShortId = async (
      meetingId: Id<"meetings">,
    ): Promise<string | null> => {
      if (!meetingShortIdCache.has(meetingId)) {
        const meeting = await ctx.db.get(meetingId);
        meetingShortIdCache.set(meetingId, meeting?.shortId ?? null);
      }
      return meetingShortIdCache.get(meetingId) ?? null;
    };

    const results: SearchResult[] = [];
    for (const message of matches) {
      if (results.length >= SEARCH_RESULT_LIMIT) break;
      if (!accessibleChannelIds.has(message.channelId)) continue;
      if (NON_SEARCHABLE_CONTENT_TYPES.has(message.contentType)) continue;
      if (message.senderId && blockedUserIds.has(message.senderId)) continue;

      const channel = channelCache.get(message.channelId);
      if (!channel) continue;

      let groupName: string | null = null;
      if (channel.groupId) {
        const group = groupCache.get(channel.groupId);
        groupName = group?.name ?? null;
      }

      const meetingShortId =
        channel.channelType === "event" && channel.meetingId
          ? await getMeetingShortId(channel.meetingId)
          : null;

      results.push({
        messageId: message._id,
        channelId: message.channelId,
        channelName: channel.name,
        channelType: channel.channelType,
        channelSlug: channel.slug ?? null,
        isAdHoc: channel.isAdHoc ?? false,
        groupId: channel.groupId ?? null,
        groupName,
        meetingShortId,
        content: message.content,
        senderId: message.senderId ?? null,
        senderName: message.senderName ?? null,
        createdAt: message.createdAt,
      });
    }

    return {
      results,
      // True when the index returned the full fetch budget — there may be more
      // matches beyond what we ranked and filtered.
      truncated: matches.length >= SEARCH_FETCH_LIMIT,
    };
  },
});
