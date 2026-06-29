/**
 * Inbox message search.
 *
 * Full-text search over chat message bodies for the app inbox. Results are
 * scoped to the caller's active community and restricted to channels the caller
 * can actually read (the same read boundary `getMessages` enforces). Convex
 * search-index filters can only match a single field value, so they can't OR
 * across the user's channel set — community/permission scoping is therefore
 * applied in the handler after pulling matches from the index.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import type { QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import {
  isCustomChannel,
  channelIsLeaderEnabled,
  channelEffectiveEnabledForGroup,
  isLeaderRole,
} from "../../lib/helpers";
import { getChannelSlug } from "../../lib/slugs";
import { canAccessEventChannel } from "./eventChat";

/** Below this length a search is a no-op (avoids matching on single letters). */
const MIN_QUERY_LENGTH = 2;
/** Maximum results returned to the client after filtering. */
const SEARCH_RESULT_LIMIT = 40;
/** Page size when scanning the relevance-ranked search index. */
const SEARCH_PAGE_SIZE = 100;
/**
 * Hard cap on how many index rows we scan before giving up. The index returns
 * globally relevance-ranked rows and we filter to the caller's accessible
 * channels afterwards, so in a multi-community dataset the top rows may all be
 * inaccessible. We keep paging past those (rather than `.take(100)` once) until
 * we fill the result limit, exhaust the index, or hit this scan cap — bounding
 * cost while avoiding empty results when accessible matches exist deeper down.
 */
const MAX_SCAN_DOCS = 600;

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
  /** Channel slug (with back-compat fallback) for the `/inbox/{groupId}/{slug}` link. */
  channelSlug: string;
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
 *  - Disabled / per-group-hidden leader-only channels (custom / pco_services /
 *    announcements) stay hidden from non-leader members. Visibility is checked
 *    per the user's actual group context via `channelEffectiveEnabledForGroup`
 *    so a channel a linked group hid (`sharedGroups[].hiddenFromNavigation`)
 *    isn't exposed to that group's members.
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

  // Active group memberships → the user's role in each group.
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
  const groupRoleMap = new Map<string, string>(
    groupMemberships.map((gm) => [gm.groupId, gm.role]),
  );

  const accessible = new Set<string>();

  // Leaders see every (non-archived) channel in their group, even without a
  // dedicated membership row. Leadership also bypasses the disabled-channel
  // gate, so these are added unconditionally.
  for (const [groupId, role] of groupRoleMap) {
    if (!isLeaderRole(role)) continue;
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

    // Disabled / per-group-hidden leader-only channels are invisible to
    // non-leader members. Check visibility against each group context the user
    // actually has for this channel (owning group + any accepted shared group
    // they belong to), matching the inbox/routing visibility rules.
    if (
      isCustomChannel(channel.channelType) ||
      channel.channelType === "pco_services" ||
      channel.channelType === "announcements"
    ) {
      const contextGroupIds: Id<"groups">[] = [];
      if (channel.groupId && groupRoleMap.has(channel.groupId)) {
        contextGroupIds.push(channel.groupId);
      }
      if (channel.isShared && channel.sharedGroups) {
        for (const sg of channel.sharedGroups) {
          if (sg.status === "accepted" && groupRoleMap.has(sg.groupId)) {
            contextGroupIds.push(sg.groupId);
          }
        }
      }

      let visible: boolean;
      if (contextGroupIds.length === 0) {
        // Member of a channel without a tied group context (unusual); fall back
        // to the channel's global enabled flag.
        visible = channelIsLeaderEnabled(channel);
      } else {
        visible = contextGroupIds.some(
          (gid) =>
            channelEffectiveEnabledForGroup(channel, gid) ||
            isLeaderRole(groupRoleMap.get(gid)),
        );
      }
      if (!visible) continue;
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
    let scanned = 0;
    let cursor: string | null = null;
    let isDone = false;

    // Page through relevance-ranked matches, skipping ones in channels the
    // caller can't read, until we fill the result limit, exhaust the index, or
    // hit the scan cap.
    while (results.length < SEARCH_RESULT_LIMIT && scanned < MAX_SCAN_DOCS && !isDone) {
      const page = await ctx.db
        .query("chatMessages")
        .withSearchIndex("search_content", (q) =>
          q.search("content", term).eq("isDeleted", false),
        )
        .paginate({ cursor, numItems: SEARCH_PAGE_SIZE });

      scanned += page.page.length;
      cursor = page.continueCursor;
      isDone = page.isDone;

      for (const message of page.page) {
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
          channelSlug: getChannelSlug(channel),
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
    }

    return {
      results,
      // True when matches may exist beyond what we surfaced — we stopped at the
      // result limit or the scan cap before exhausting the index.
      truncated: !isDone,
    };
  },
});
