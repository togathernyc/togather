/**
 * Inbox message search.
 *
 * Full-text search over chat message bodies for the app inbox. The search index
 * is filtered to the caller's active community via the denormalized
 * `chatMessages.communityId` (so other tenants' messages are never scanned).
 * Results are then restricted to the channels the caller can actually read (the
 * same read boundary `getMessages` enforces) — Convex search filters can't OR
 * across the user's channel set, so that per-channel scoping is applied in the
 * handler after pulling community-scoped matches from the index.
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
import { requireCommunityMember } from "../scheduling/permissions";

/** Below this length a search is a no-op (avoids matching on single letters). */
const MIN_QUERY_LENGTH = 2;
/** Maximum results returned to the client after filtering. */
const SEARCH_RESULT_LIMIT = 40;
/** Page size when scanning the relevance-ranked search index. */
const SEARCH_PAGE_SIZE = 100;
/**
 * Hard cap on how many index rows we scan before giving up. The search index is
 * filtered to the caller's community, so scanned rows are already same-tenant;
 * we still page past channels the caller can't read (leaders-only channels, etc.)
 * until we fill the result limit, exhaust the matches, or hit this scan cap.
 */
const MAX_SCAN_DOCS = 600;

/**
 * Content types that aren't user-authored prose. System notices have body text
 * (e.g. "X joined the group") that would otherwise pollute search results.
 */
const NON_SEARCHABLE_CONTENT_TYPES = new Set(["system"]);

type SearchResult = {
  messageId: Id<"chatMessages">;
  /**
   * Parent message id when this hit is a thread reply; null for top-level
   * messages. Reply hits are routed to the parent (which is the message that
   * actually appears in the channel list) so the UI can scroll to it and
   * auto-open the thread.
   */
  parentMessageId: Id<"chatMessages"> | null;
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
 *  - Event channels are gated SOLELY by `canAccessEventChannel` (host /
 *    delegated leader / RSVP), with no membership-row requirement — matching
 *    getMessages, which routes event channels straight through that check.
 *    They are resolved in a dedicated pass over the caller's hosted / RSVP'd /
 *    led-group meetings, and group leadership alone never grants access to an
 *    explicit-host event channel.
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

  // Led groups, used both for the leader channel pass below and for resolving
  // delegated-host event-channel access (leaders of the hosting group can read
  // an event channel that has no explicit host — see canAccessEventChannel).
  const leaderGroupIds: Id<"groups">[] = [];

  // Leaders see every (non-archived) channel in their group, even without a
  // dedicated membership row. Leadership also bypasses the disabled-channel
  // gate, so these are added unconditionally — EXCEPT event channels, which
  // always gate on meeting-based access (host / delegated leader / RSVP) via
  // canAccessEventChannel, exactly as getMessages does. Leadership of the
  // hosting group alone does not grant read access to an explicit-host event,
  // so event channels are deferred to the canAccessEventChannel pass below.
  for (const [groupId, role] of groupRoleMap) {
    if (!isLeaderRole(role)) continue;
    const group = await getGroup(groupId as Id<"groups">);
    if (!group || group.isArchived || group.communityId !== communityId) continue;
    leaderGroupIds.push(groupId as Id<"groups">);
    const channels = await ctx.db
      .query("chatChannels")
      .withIndex("by_group", (q) => q.eq("groupId", groupId as Id<"groups">))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();
    for (const channel of channels) {
      channelCache.set(channel._id, channel);
      if (channel.channelType === "event") continue;
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

  // Event channels are readable purely via meeting-based access — host,
  // delegated leader, or RSVP — with NO chatChannelMembers row required (see
  // getMessages, which routes event channels straight through
  // canAccessEventChannel). A "Can't Go" RSVPer or a host who never opened the
  // chat can read it in-app, so search must surface it too. Gather the
  // meetings the caller could host/attend, resolve their event channels, and
  // gate each one through canAccessEventChannel exactly like getMessages —
  // never broader.
  const candidateMeetingIds = new Set<string>();

  // Meetings the caller created (host access).
  const createdMeetings = await ctx.db
    .query("meetings")
    .withIndex("by_createdBy", (q) => q.eq("createdById", userId))
    .collect();
  for (const meeting of createdMeetings) {
    candidateMeetingIds.add(meeting._id);
  }

  // Meetings the caller RSVP'd to (RSVP access).
  const rsvps = await ctx.db
    .query("meetingRsvps")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const rsvp of rsvps) {
    candidateMeetingIds.add(rsvp.meetingId);
  }

  // Meetings in groups the caller leads (delegated-host access for events with
  // no explicit host — canAccessEventChannel makes the final call).
  for (const groupId of leaderGroupIds) {
    const groupMeetings = await ctx.db
      .query("meetings")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    for (const meeting of groupMeetings) {
      candidateMeetingIds.add(meeting._id);
    }
  }

  for (const meetingId of candidateMeetingIds) {
    const channel = await ctx.db
      .query("chatChannels")
      .withIndex("by_meetingId", (q) =>
        q.eq("meetingId", meetingId as Id<"meetings">),
      )
      .first();
    if (!channel || channel.isArchived) continue;
    if (accessible.has(channel._id)) continue;

    // Community scoping: event channels inherit their hosting group's community.
    if (channel.groupId) {
      const group = await getGroup(channel.groupId);
      if (!group || group.isArchived || group.communityId !== communityId) continue;
    } else if (channel.communityId !== communityId) {
      continue;
    }

    if (!(await canAccessEventChannel(ctx, userId, channel))) continue;

    channelCache.set(channel._id, channel);
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

    // Defense-in-depth: fail fast if the caller isn't a member of the
    // community they're searching. The per-channel re-scoping below already
    // prevents cross-tenant leaks (every accessible channel is gated to
    // args.communityId), so this changes nothing for legitimate callers — it
    // just makes the tenant boundary self-evident and rejects a foreign
    // communityId outright instead of silently returning an empty list.
    await requireCommunityMember(ctx, args.communityId, userId);

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
          q
            .search("content", term)
            .eq("communityId", args.communityId)
            .eq("isDeleted", false),
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
          parentMessageId: message.parentMessageId ?? null,
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
