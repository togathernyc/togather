/**
 * Message Functions for Convex-Native Messaging
 *
 * Send, edit, delete, and list messages with pagination.
 */

import { v, ConvexError } from "convex/values";
import { query, mutation, internalMutation } from "../../_generated/server";
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import {
  isActiveLeader,
  isCustomChannel,
  channelIsLeaderEnabled,
  channelEffectiveEnabledForGroup,
  isLeaderRole,
} from "../../lib/helpers";
import { getDisplayName, getMediaUrl } from "../../lib/utils";
import { isCommunityAdmin } from "../../lib/permissions";
import {
  getHostUserIds,
  isMeetingHost,
} from "../../lib/meetingPermissions";
import { checkRateLimit } from "../../lib/rateLimit";
import { DOMAIN_CONFIG } from "@togather/shared/config";
import { canAccessEventChannel } from "./eventChat";
import { isCommunityAdminForChannel } from "./helpers";
import { resolveChannelCommunityId } from "../../lib/messaging/communityScope";
import { getUsersWithNotificationsDisabled } from "../../lib/notifications/enabledStatus";
import { truncatePreview, LIST_PREVIEW_MAX } from "../../lib/text";

/**
 * Decorate a list of message rows with `senderNotificationsDisabled` so chat
 * surfaces can render the slashed-bell badge next to the sender's avatar.
 * Batches one pushTokens lookup per distinct senderId.
 */
async function attachSenderNotifsDisabled(
  ctx: QueryCtx,
  messages: Doc<"chatMessages">[],
): Promise<Array<Doc<"chatMessages"> & { senderNotificationsDisabled: boolean }>> {
  const senderIds = messages
    .map((m) => m.senderId)
    .filter((id): id is Id<"users"> => !!id);
  const disabled = await getUsersWithNotificationsDisabled(ctx, senderIds);
  return messages.map((m) => ({
    ...m,
    senderNotificationsDisabled: m.senderId ? disabled.has(m.senderId) : false,
  }));
}

/**
 * Override the denormalized `senderName` / `senderProfilePhoto` snapshots on a
 * single message with the sender's current values from the `users` table.
 *
 * Why: messages snapshot the sender's name + avatar at send time so reads can
 * stay single-table. When a user updates their profile, those snapshots go
 * stale on every existing message they sent. Resolving live at read time keeps
 * old chats in sync without touching every historical row.
 *
 * Falls back to the snapshot when the sender is missing (system/bot messages
 * without a senderId, or users that have since been deleted).
 */
function applyLiveSenderProfile<M extends Doc<"chatMessages">>(
  message: M,
  user: Doc<"users"> | null,
): M {
  if (!user) return message;
  return {
    ...message,
    senderName: getDisplayName(user.firstName, user.lastName),
    senderProfilePhoto: getMediaUrl(user.profilePhoto),
  };
}

/**
 * Batched form of `applyLiveSenderProfile` — fetches each unique sender once
 * and rewrites every message in the page with their current name + avatar.
 */
async function attachLiveSenderProfile<M extends Doc<"chatMessages">>(
  ctx: QueryCtx,
  messages: M[],
): Promise<M[]> {
  const uniqueSenderIds = Array.from(
    new Set(
      messages
        .map((m) => m.senderId)
        .filter((id): id is Id<"users"> => !!id),
    ),
  );
  if (uniqueSenderIds.length === 0) return messages;
  const users = await Promise.all(uniqueSenderIds.map((id) => ctx.db.get(id)));
  const userById = new Map<Id<"users">, Doc<"users">>();
  uniqueSenderIds.forEach((id, i) => {
    const u = users[i];
    if (u) userById.set(id, u);
  });
  return messages.map((m) =>
    m.senderId ? applyLiveSenderProfile(m, userById.get(m.senderId) ?? null) : m,
  );
}

/**
 * Same access check as `canAccessEventChannel` but keyed off a meeting doc
 * directly — used when the caller hasn't resolved a channel yet (e.g. the
 * first `sendMessage` call that lazy-creates the event channel).
 */
async function canAccessMeetingChat(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  meeting: Doc<"meetings">,
): Promise<boolean> {
  if (isMeetingHost(meeting, userId)) return true;

  // Delegated (no explicit host): leaders of the hosting group are the
  // effective host. Matches canAccessEventChannel.
  if (getHostUserIds(meeting).length === 0) {
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", meeting.groupId).eq("userId", userId),
      )
      .first();
    if (isActiveLeader(membership)) return true;
  }

  const rsvp = await ctx.db
    .query("meetingRsvps")
    .withIndex("by_meeting_user", (q) =>
      q.eq("meetingId", meeting._id).eq("userId", userId),
    )
    .first();
  if (!rsvp) return false;

  const options = meeting.rsvpOptions ?? [];
  const matched = options.find((opt) => opt.id === rsvp.rsvpOptionId);
  return Boolean(matched && matched.enabled);
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PAGE_SIZE = 50;

// Message type for preview generation (minimal interface for preview logic)
interface MessageForPreview {
  content: string;
  attachments?: Array<{
    type: string;
    url: string;
    name?: string;
    size?: number;
    mimeType?: string;
    thumbnailUrl?: string;
    waveform?: number[];
    duration?: number;
  }>;
}

/**
 * Generate a smart preview for a message based on its content and attachments.
 * Used for channel lastMessagePreview to show user-friendly strings like
 * "Sent a photo", "Sent a file", "Shared an event", etc.
 */
export function generateMessagePreview(message: MessageForPreview): string {
  const content = message.content;
  const attachments = message.attachments;

  if (attachments && attachments.length > 0) {
    const imageCount = attachments.filter((a) => a.type === "image").length;
    const fileCount = attachments.filter((a) =>
      a.type === "file" || a.type === "document" || a.type === "audio" || a.type === "video"
    ).length;
    const audioCount = attachments.filter((a) => a.type === "audio").length;
    const videoCount = attachments.filter((a) => a.type === "video").length;

    if (imageCount > 0 && content.trim()) {
      // Has both images and text - show text
      return truncatePreview(content, LIST_PREVIEW_MAX, false);
    } else if (imageCount > 0) {
      // Only images
      return imageCount === 1 ? "Sent a photo" : `Sent ${imageCount} photos`;
    } else if (audioCount > 0) {
      // Audio files
      return audioCount === 1 ? "Sent an audio message" : `Sent ${audioCount} audio files`;
    } else if (videoCount > 0) {
      // Video files
      return videoCount === 1 ? "Sent a video" : `Sent ${videoCount} videos`;
    } else if (fileCount > 0) {
      // Documents and other files
      return fileCount === 1 ? "Sent a file" : `Sent ${fileCount} files`;
    } else {
      return truncatePreview(content, LIST_PREVIEW_MAX, false);
    }
  } else if (DOMAIN_CONFIG.eventLinkRegexSingle().test(content)) {
    // Event link shared
    return content.trim() === content.match(DOMAIN_CONFIG.eventLinkRegexSingle())?.[0]
      ? "Shared an event"
      : truncatePreview(content, LIST_PREVIEW_MAX, false);
  } else if (DOMAIN_CONFIG.toolLinkRegexSingle().test(content)) {
    // Tool link shared (Run Sheet, Resource)
    return content.trim() === content.match(DOMAIN_CONFIG.toolLinkRegexSingle())?.[0]
      ? "Shared a tool"
      : truncatePreview(content, LIST_PREVIEW_MAX, false);
  } else if (DOMAIN_CONFIG.groupLinkRegexSingle().test(content)) {
    // Group link shared
    return content.trim() === content.match(DOMAIN_CONFIG.groupLinkRegexSingle())?.[0]
      ? "Shared a group"
      : truncatePreview(content, LIST_PREVIEW_MAX, false);
  } else {
    return truncatePreview(content, LIST_PREVIEW_MAX, false);
  }
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Get a single message by ID.
 */
export const getMessage = query({
  args: {
    token: v.string(),
    messageId: v.id("chatMessages"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    try {
      const message = await ctx.db.get(args.messageId);
      if (!message || message.isDeleted) {
        return null;
      }

      const sender = message.senderId ? await ctx.db.get(message.senderId) : null;
      const enriched = applyLiveSenderProfile(message, sender);

      // Event channels use meeting-based access rather than chatChannelMembers
      // (non-group-members can still participate via RSVP).
      const channel = await ctx.db.get(message.channelId);
      if (channel?.channelType === "event") {
        if (!(await canAccessEventChannel(ctx, userId, channel))) {
          return null;
        }
        return enriched;
      }

      // Check if user has access to the channel
      const membership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", message.channelId).eq("userId", userId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();

      // Community admins may read messages in their community's group channels
      // without joining (read-only oversight).
      if (
        !membership &&
        !(channel && (await isCommunityAdminForChannel(ctx, channel, userId)))
      ) {
        return null;
      }

      return enriched;
    } catch (error) {
      console.error("[getMessage] Failed to fetch message:", error);
      return null;
    }
  },
});

// ============================================================================
// WhatsApp-shell reply/thread derivation (flag-on `getMessages` only)
// ============================================================================

/**
 * How many of a thread's newest visible replies we read per parent. Enough to
 * answer the activation question (0 / 1 / many) AND to fill the summary pill's
 * three overlapping replier avatars even when the same person replied several
 * times in a row.
 */
const WA_THREAD_PROBE = 10;

/**
 * Ceiling for an EXACT reply count on the summary pill. Past it the pill reads
 * "50+ replies" rather than a number.
 *
 * Tradeoff, deliberately chosen over the two alternatives:
 *  - We can NOT fall back to the parent's stored `threadReplyCount`. That is a
 *    monotonic send counter — never decremented on delete, and blind to
 *    blocking and to cross-channel rows — so it silently overstates the thread.
 *  - We can NOT `.collect()` the replies; a long thread would be an unbounded
 *    read.
 * So the count is exact up to a bound and honest ("50+") past it. The second,
 * wider read only happens for threads that overflow the small probe, which is
 * rare — an ordinary thread costs one indexed `take(11)`.
 */
const WA_THREAD_COUNT_CAP = 50;

/** A thread as this viewer sees it. */
interface WaThreadProbe {
  /** Newest-first visible replies, at most `WA_THREAD_PROBE` of them. */
  replies: Doc<"chatMessages">[];
  /** Visible reply count, exact unless `countCapped`. */
  count: number;
  /** The thread has more than `WA_THREAD_COUNT_CAP` visible replies. */
  countCapped: boolean;
}

/**
 * Everything a thread probe needs to decide what this viewer can actually see,
 * plus the per-handler memo. A reply counts toward a thread only when it is in
 * THIS channel and not from a blocked author — the same two rules the ordinary
 * row scan applies, so a thread can never surface a message the timeline itself
 * would have hidden.
 */
interface WaThreadScope {
  channelId: Id<"chatChannels">;
  blockedUserIds: Set<Id<"users">>;
  cache: Map<string, WaThreadProbe>;
}

/**
 * Both visibility rules as a Convex filter expression rather than a JS
 * post-filter. That matters: `.filter()` runs during the index scan, so
 * `.take(n)` still returns n *visible* rows. Filtering in JS after the take
 * would silently undercount a thread whose newest replies are blocked.
 */
function waVisibleReplyFilter(scope: WaThreadScope) {
  return (q: any) => {
    const conditions = [
      q.eq(q.field("isDeleted"), false),
      // Cross-channel defense: `by_parentMessage` is keyed on the parent alone,
      // so a reply written into another channel (only possible from rows
      // predating `sendMessage`'s same-channel check) would otherwise be
      // counted into — and avatar'd onto — this channel's thread.
      q.eq(q.field("channelId"), scope.channelId),
    ];
    for (const blockedId of scope.blockedUserIds) {
      conditions.push(q.neq(q.field("senderId"), blockedId));
    }
    return q.and(...conditions);
  };
}

/**
 * Read a parent message's newest visible replies, memoized per handler run.
 *
 * Called once per replied-to message in the page AND once per reply candidate
 * (to decide whether that reply is the thread's only one), so the cache is what
 * keeps this at one indexed read per *thread* rather than per row.
 *
 * Keyed on `parentMessageId` alone and never reads the parent doc, so it still
 * answers correctly for a reply whose parent was deleted.
 */
async function probeThread(
  ctx: QueryCtx,
  scope: WaThreadScope,
  parentMessageId: Id<"chatMessages">,
): Promise<WaThreadProbe> {
  const cached = scope.cache.get(parentMessageId);
  if (cached) return cached;

  // One extra row tells us whether the thread runs deeper than the probe,
  // without a second query for the overwhelmingly common shallow case.
  const rows = await ctx.db
    .query("chatMessages")
    .withIndex("by_parentMessage", (q) => q.eq("parentMessageId", parentMessageId))
    .filter(waVisibleReplyFilter(scope))
    .order("desc")
    .take(WA_THREAD_PROBE + 1);

  const replies = rows.slice(0, WA_THREAD_PROBE);
  let probe: WaThreadProbe;
  if (rows.length <= WA_THREAD_PROBE) {
    probe = { replies, count: rows.length, countCapped: false };
  } else {
    // Deep thread: pay one bounded wider read for an exact count up to the cap.
    const counted = await ctx.db
      .query("chatMessages")
      .withIndex("by_parentMessage", (q) => q.eq("parentMessageId", parentMessageId))
      .filter(waVisibleReplyFilter(scope))
      .order("desc")
      .take(WA_THREAD_COUNT_CAP + 1);
    probe = {
      replies,
      count: Math.min(counted.length, WA_THREAD_COUNT_CAP),
      countCapped: counted.length > WA_THREAD_COUNT_CAP,
    };
  }

  scope.cache.set(parentMessageId, probe);
  return probe;
}

/**
 * The quoted-parent context rendered INSIDE a reply's own bubble (the §5
 * "reply-quote bar"), denormalized here at read time.
 *
 * This is what replaces the old floating "ghost" pointer's pagination job: the
 * reply carries its parent's sender + snippet, so a reply can render its quote
 * correctly even when the parent is hundreds of messages further up and not in
 * the loaded window. A missing or soft-deleted parent yields
 * `parentDeleted: true`, which the client renders as WhatsApp's "Original
 * message was deleted" quote rather than a blank strip.
 *
 * A parent in a DIFFERENT channel gets the same deleted treatment, and — unlike
 * a genuinely deleted parent — carries no sender identity at all: quoting it
 * would republish channel A's author and text to every reader of channel B.
 * `sendMessage` now refuses to create such a reply; this is the read-side
 * defense for rows that predate that check.
 */
async function buildReplyQuote(
  ctx: QueryCtx,
  parentMessageId: Id<"chatMessages">,
  channelId: Id<"chatChannels">,
) {
  const parent = await ctx.db.get(parentMessageId);

  if (parent && parent.channelId !== channelId) {
    return {
      parentMessageId,
      parentDeleted: true,
      parentSenderId: undefined as Id<"users"> | undefined,
      parentSenderName: undefined as string | undefined,
      parentContent: "",
      parentAttachmentType: undefined as string | undefined,
      parentThumbnailUrl: undefined as string | undefined,
    };
  }

  if (!parent || parent.isDeleted) {
    return {
      parentMessageId,
      parentDeleted: true,
      parentSenderId: parent?.senderId,
      parentSenderName: parent?.senderName,
      parentContent: "",
      parentAttachmentType: undefined as string | undefined,
      parentThumbnailUrl: undefined as string | undefined,
    };
  }

  // §5 "optional thumbnail (28×28pt) if the quoted message had media". A video
  // only has one if it was captured at upload; without it the quote falls back
  // to its glyph + "Video", which renders on its own.
  const attachment = parent.attachments?.[0];
  const thumbnailSource =
    attachment?.type === "image"
      ? attachment.url
      : attachment?.type === "video"
        ? attachment.thumbnailUrl
        : undefined;

  return {
    parentMessageId,
    parentDeleted: false,
    parentSenderId: parent.senderId,
    parentSenderName: parent.senderName,
    parentContent: parent.content ?? "",
    parentAttachmentType: attachment?.type,
    parentThumbnailUrl: getMediaUrl(thumbnailSource),
  };
}

/**
 * Get messages for a channel with pagination.
 */
export const getMessages = query({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    /** Group context from the chat route (required for shared-channel visibility rules). */
    viewingGroupId: v.optional(v.id("groups")),
    /**
     * WhatsApp-shell reply rendering (flag-on clients only; see
     * `useWhatsappShell`). Flag-off callers omit it and get byte-identical
     * behaviour: every reply filtered out of the timeline, no decoration.
     *
     * When true:
     *  - a reply is ADMITTED to the timeline when it is its parent's ONLY live
     *    reply, and carries `replyQuote` (the quoted-parent context for the
     *    in-bubble §5 quote bar);
     *  - a message with TWO OR MORE live replies carries `threadSummary` (the
     *    one collapsed "N replies · <time> ›" pill) and its replies stay out of
     *    the timeline.
     * The 1-vs-2 boundary is the activation rule; see MessageList's flag-on
     * timeline for the full rationale and edge cases.
     */
    waReplies: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const limit = args.limit ?? DEFAULT_PAGE_SIZE;

    // Get the channel to check group membership
    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError("Channel not found");
    }

    // Event channels use meeting-based access (RSVPers may not be group members).
    // Short-circuit the group-membership gate below. When the viewer has
    // lost chat access mid-session (e.g. transferred hosting away without
    // having an RSVP), return an empty page instead of throwing — callers
    // are React useQuery hooks, and a hard throw crashes the UI tree via
    // the error boundary.
    if (channel.channelType === "event") {
      if (!(await canAccessEventChannel(ctx, userId, channel))) {
        return { messages: [], hasMore: false, cursor: undefined };
      }
    } else if (channel.isAdHoc || !channel.groupId) {
      // Ad-hoc DM/group_dm — no group to gate on. Caller must have an active
      // membership row (any requestState). Pending recipients can read the
      // first message preview that's already in the channel; the chat-room
      // banner gates replies until they accept, but they need to see the
      // history to make that choice.
      const adHocMembership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", args.channelId).eq("userId", userId),
        )
        .first();
      if (!adHocMembership || adHocMembership.leftAt !== undefined) {
        return { messages: [], hasMore: false, cursor: undefined };
      }
    } else {
      const channelGroupId = channel.groupId;
      // Check channel membership
      const channelMembership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", args.channelId).eq("userId", userId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();

      // Validate viewingGroupId is actually related to this channel
      let contextGroupId: Id<"groups"> = channelGroupId;
      if (args.viewingGroupId) {
        const isOwningGroup = args.viewingGroupId === channelGroupId;
        const isAcceptedSharedGroup = channel.sharedGroups?.some(
          (sg) => sg.groupId === args.viewingGroupId && sg.status === "accepted"
        );
        if (isOwningGroup || isAcceptedSharedGroup) {
          contextGroupId = args.viewingGroupId;
        }
        // If viewingGroupId is not valid, fall back to channel.groupId for auth check
      }
      const groupMembership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", contextGroupId).eq("userId", userId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();

      // Community admins get read-only oversight of any group's channels
      // without joining. Checked only when they aren't a channel member or
      // group leader, so the common paths skip the extra lookup.
      const isAdminViewer =
        !channelMembership &&
        !isLeaderRole(groupMembership?.role) &&
        (await isCommunityAdminForChannel(ctx, channel, userId));

      // If not a channel member, only group leaders/admins (or community admins)
      // may load messages. Return empty instead of throwing — `getMessages` is a
      // reactive query and a throw crashes the chat screen via ErrorBoundary when
      // membership is lost mid-session (e.g. user confirms a Leave Group alert
      // while the chat screen is still mounted). The screen's own navigation flow
      // handles the redirect; we just need to stop replying with messages.
      if (!channelMembership && !isLeaderRole(groupMembership?.role) && !isAdminViewer) {
        return { messages: [], hasMore: false, cursor: undefined };
      }

      // For bypassing global disabled check, consider leadership in owning group OR linked group
      const owningGroupMembership = args.viewingGroupId
        ? await ctx.db
            .query("groupMembers")
            .withIndex("by_group_user", (q) =>
              q.eq("groupId", channelGroupId).eq("userId", userId)
            )
            .filter((q) => q.eq(q.field("leftAt"), undefined))
            .first()
        : groupMembership;
      const isOwningGroupLeader = isLeaderRole(owningGroupMembership?.role);
      // Also check linked group leadership when viewing from a linked group
      const isLinkedGroupLeader =
        args.viewingGroupId && args.viewingGroupId !== channelGroupId
          ? isLeaderRole(groupMembership?.role)
          : false;

      const effectiveEnabled = args.viewingGroupId
        ? channelEffectiveEnabledForGroup(channel, args.viewingGroupId)
        : channelIsLeaderEnabled(channel);
      // Disabled leader-only channel for a non-leader viewer: same reasoning
      // as above — return empty rather than crash the chat screen.
      if (
        (isCustomChannel(channel.channelType) ||
          channel.channelType === "pco_services" ||
          channel.channelType === "announcements") &&
        !effectiveEnabled &&
        !isOwningGroupLeader &&
        !isLinkedGroupLeader &&
        !isAdminViewer
      ) {
        return { messages: [], hasMore: false, cursor: undefined };
      }
    }

    // Get blocked users to filter out their messages
    const blockedUsers = await ctx.db
      .query("chatUserBlocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", userId))
      .collect();

    const blockedUserIds = new Set(blockedUsers.map((b) => b.blockedId));

    // --- Index-driven pagination using by_channel_createdAt ---
    // Instead of .collect() on ALL messages, scan the index in desc order
    // and only read enough to fill one page. This is O(page_size) instead
    // of O(total_messages).
    //
    // Ordering is keyed on `createdAt` (not `lastActivityAt`) so a replied-to
    // message keeps its original chronological position — replying no longer
    // floats the parent to the bottom of the chat. `lastActivityAt` is still
    // returned on each message; the client uses it to float a content-free
    // "ghost" thread pointer at the bottom (see MessageList). Inbox room
    // ordering, which relies on the `lastActivityAt` bump, is unaffected.

    // Decode cursor: "timestamp:seenIds" for correct tie-breaking.
    // seenIds is a comma-separated list of message IDs already returned at the
    // cursor timestamp, so we can skip them without duplicates.
    let cursorTime: number | undefined;
    let cursorSeenIds: Set<string> | undefined;
    if (args.cursor) {
      const sepIdx = args.cursor.indexOf(":");
      if (sepIdx > 0) {
        cursorTime = Number(args.cursor.substring(0, sepIdx));
        const idsStr = args.cursor.substring(sepIdx + 1);
        cursorSeenIds = new Set(idsStr.split(","));
      }
    }

    // Over-fetch to account for filtered-out messages (deleted, blocked, replies).
    // Typically ~15% of messages are filtered, so 3x is generous.
    const OVER_FETCH_MULTIPLIER = 3;
    const fetchBatch = limit * OVER_FETCH_MULTIPLIER;
    const accepted: Doc<"chatMessages">[] = [];
    // One entry per thread touched while scanning this page — see `probeThread`.
    // Carries the viewer's visibility rules so a thread can never count or
    // avatar a reply the row scan itself would have hidden.
    const threadScope: WaThreadScope = {
      channelId: args.channelId,
      blockedUserIds,
      cache: new Map<string, WaThreadProbe>(),
    };
    // Track all message IDs we've already processed across batches to avoid
    // duplicates when using lte on the same timestamp boundary.
    const processedIds = new Set<string>(cursorSeenIds ?? []);
    let scanCursorTime = cursorTime;

    // Fetch in batches until we have enough accepted messages or run out
    let candidates = await ctx.db
      .query("chatMessages")
      .withIndex("by_channel_createdAt", (q) => {
        const q1 = q.eq("channelId", args.channelId);
        // Use lte to include messages at the cursor timestamp (we skip
        // already-seen ones by ID below). This avoids dropping messages
        // that share the same timestamp as the cursor.
        if (scanCursorTime !== undefined) {
          return q1.lte("createdAt", scanCursorTime);
        }
        return q1;
      })
      .order("desc")
      .take(fetchBatch);

    while (true) {
      if (candidates.length === 0) {
        break;
      }

      // Count how many candidates are genuinely new (not already processed)
      let newCandidateCount = 0;

      for (const m of candidates) {
        // Skip messages already processed (from previous page or previous batch)
        if (processedIds.has(m._id)) {
          continue;
        }
        processedIds.add(m._id);
        newCandidateCount++;

        // Filter: top-level, not deleted, not blocked
        if (m.isDeleted) continue;
        if (m.parentMessageId) {
          // Flag-off (and any caller that omits `waReplies`): replies never
          // appear in the timeline — they live only in the thread screen.
          if (!args.waReplies) continue;
          // Flag-on: admit a reply only while it is its parent's SOLE VISIBLE
          // reply. Comparing identity (not just `length === 1`) is what makes
          // this order-independent: whichever reply is the only one left
          // standing is the one that renders inline, no matter which arrived
          // first or which sibling was deleted.
          //
          // The probe applies the viewer's own visibility rules, so a lone
          // reply from a blocked author reads as zero visible replies here and
          // is skipped — the same disappearance their ordinary messages get,
          // rather than a bubble the blocked-check below would have to catch a
          // step later.
          const { replies: siblings } = await probeThread(
            ctx,
            threadScope,
            m.parentMessageId,
          );
          if (siblings.length !== 1 || siblings[0]._id !== m._id) continue;
        }
        if (m.senderId && blockedUserIds.has(m.senderId)) continue;

        accepted.push(m);

        // Collected enough (+1 to detect hasMore)
        if (accepted.length > limit) break;
      }

      if (accepted.length > limit || candidates.length < fetchBatch) {
        break;
      }

      // If every candidate in this batch was already in processedIds, we're
      // genuinely stuck (all messages at this timestamp were already seen).
      // Break to avoid an infinite loop. But if we saw new candidates that
      // were merely filtered out (deleted, blocked, etc.), keep scanning —
      // valid messages may exist further down the index.
      if (newCandidateCount === 0) {
        break;
      }

      // Advance scan cursor to the last candidate's timestamp for next batch
      const lastCandidate = candidates[candidates.length - 1];
      scanCursorTime = lastCandidate.createdAt;

      candidates = await ctx.db
        .query("chatMessages")
        .withIndex("by_channel_createdAt", (q) =>
          q.eq("channelId", args.channelId).lte("createdAt", scanCursorTime!)
        )
        .order("desc")
        .take(fetchBatch);
    }

    const hasMore = accepted.length > limit;
    const pageMessages = accepted.slice(0, limit);

    // Encode cursor: "timestamp:id1,id2,..." — includes all message IDs at the
    // last page entry's createdAt so the next page can skip them correctly.
    let cursor: string | undefined;
    if (pageMessages.length > 0) {
      const lastMsg = pageMessages[pageMessages.length - 1];
      const boundaryTime = lastMsg.createdAt;
      // Collect all accepted message IDs at the boundary timestamp
      const boundaryIds = new Set<string>();
      for (const m of pageMessages) {
        if (m.createdAt === boundaryTime) {
          boundaryIds.add(m._id);
        }
      }
      // Carry forward IDs already returned at this timestamp on EARLIER pages.
      // When a run of messages shares one createdAt and spans more than two
      // pages, the incoming cursor's seenIds (at the same boundaryTime) must be
      // preserved — otherwise messages returned two-or-more pages ago would be
      // re-served (the boundary-id list only covers the current page).
      if (cursorTime === boundaryTime && cursorSeenIds) {
        for (const id of cursorSeenIds) boundaryIds.add(id);
      }
      cursor = `${boundaryTime}:${[...boundaryIds].join(",")}`;
    }

    // Reverse to chronological order (oldest first, newest at bottom)
    // This is the expected order for chat UIs
    const chronologicalMessages = [...pageMessages].reverse();
    const withLiveProfile = await attachLiveSenderProfile(ctx, chronologicalMessages);
    const decorated = await attachSenderNotifsDisabled(ctx, withLiveProfile);

    if (!args.waReplies) {
      return {
        messages: decorated,
        hasMore,
        cursor,
      };
    }

    // --- Flag-on reply/thread decoration -----------------------------------
    //
    // Per-thread reads are already memoized from the scan above, so a message
    // that floated a probe while being admitted doesn't pay for a second one.
    //
    // The unread dot on a summary pill is an APPROXIMATION: there is no
    // per-thread read state in the schema (only per-channel `chatReadState`),
    // so "unread" means "a reply landed after you last read this channel".
    // Good enough to draw the eye; not exact per-thread bookkeeping.
    const readState = await ctx.db
      .query("chatReadState")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", userId),
      )
      .first();
    const lastReadAt = readState?.lastReadAt ?? 0;

    // Pass 1: work out what each row needs, collecting every user whose LIVE
    // name/avatar we'll have to resolve (quoted parents' authors + summary
    // repliers). Message rows snapshot those at send time and the timeline
    // already overrides them from `users` (`attachLiveSenderProfile`) — the
    // quote bar and pill must not regress to stale snapshots.
    type Plan =
      | { row: (typeof decorated)[number]; kind: "plain" }
      | {
          row: (typeof decorated)[number];
          kind: "reply";
          quote: Awaited<ReturnType<typeof buildReplyQuote>>;
        }
      | {
          row: (typeof decorated)[number];
          kind: "thread";
          probe: WaThreadProbe;
        };
    const plans: Plan[] = [];
    const liveUserIds = new Set<Id<"users">>();

    for (const m of decorated) {
      if (m.parentMessageId) {
        const quote = await buildReplyQuote(ctx, m.parentMessageId, args.channelId);
        if (quote.parentSenderId) liveUserIds.add(quote.parentSenderId);
        plans.push({ row: m, kind: "reply", quote });
        continue;
      }
      if (!m.threadReplyCount) {
        plans.push({ row: m, kind: "plain" });
        continue;
      }
      const probe = await probeThread(ctx, threadScope, m._id);
      // 0 visible replies (all deleted/blocked/cross-channel) or exactly 1
      // (which renders inline as its own bubble) → no pill. The pill is strictly
      // the "there's more in this conversation" affordance.
      if (probe.replies.length < 2) {
        plans.push({ row: m, kind: "plain" });
        continue;
      }
      for (const reply of probe.replies) {
        if (reply.senderId) liveUserIds.add(reply.senderId);
      }
      plans.push({ row: m, kind: "thread", probe });
    }

    const liveUserList = Array.from(liveUserIds);
    const liveUserDocs = await Promise.all(liveUserList.map((id) => ctx.db.get(id)));
    const liveUsers = new Map<Id<"users">, Doc<"users">>();
    liveUserList.forEach((id, i) => {
      const doc = liveUserDocs[i];
      if (doc) liveUsers.set(id, doc);
    });
    const liveName = (id: Id<"users"> | undefined, fallback: string | undefined) => {
      const doc = id ? liveUsers.get(id) : undefined;
      return doc ? getDisplayName(doc.firstName, doc.lastName) : fallback;
    };
    const livePhoto = (id: Id<"users"> | undefined) => {
      const doc = id ? liveUsers.get(id) : undefined;
      return doc?.profilePhoto ? (getMediaUrl(doc.profilePhoto) ?? undefined) : undefined;
    };

    // Pass 2: attach.
    const withThreads = plans.map((plan) => {
      if (plan.kind === "plain") return plan.row;
      if (plan.kind === "reply") {
        return {
          ...plan.row,
          replyQuote: {
            ...plan.quote,
            parentSenderName: liveName(
              plan.quote.parentSenderId,
              plan.quote.parentSenderName,
            ),
          },
        };
      }
      const repliers: Array<{
        userId?: Id<"users">;
        name?: string;
        profilePhoto?: string;
      }> = [];
      const seenRepliers = new Set<string>();
      for (const reply of plan.probe.replies) {
        const key = reply.senderId ?? `anon:${reply._id}`;
        if (seenRepliers.has(key)) continue;
        seenRepliers.add(key);
        repliers.push({
          userId: reply.senderId,
          name: liveName(reply.senderId, reply.senderName),
          profilePhoto: livePhoto(reply.senderId),
        });
        if (repliers.length === 3) break;
      }
      return {
        ...plan.row,
        threadSummary: {
          // Counted from the probe, never from the parent's stored
          // `threadReplyCount` — that is a monotonic send counter, blind to
          // deletes, blocks and cross-channel rows. Exact up to
          // WA_THREAD_COUNT_CAP; past it `replyCountCapped` tells the pill to
          // render "50+" rather than pretend to a number.
          replyCount: plan.probe.count,
          replyCountCapped: plan.probe.countCapped,
          lastReplyAt: plan.probe.replies[0].createdAt,
          // Your own reply is never "unread" — otherwise every thread you
          // just posted in would light up until you re-read the channel.
          hasUnread: plan.probe.replies.some(
            (r) => r.createdAt > lastReadAt && r.senderId !== userId,
          ),
          repliers,
        },
      };
    });

    return {
      messages: withThreads,
      hasMore,
      cursor,
    };
  },
});

/**
 * Get thread replies for a parent message.
 */
export const getThreadReplies = query({
  args: {
    token: v.string(),
    parentMessageId: v.id("chatMessages"),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const limit = args.limit ?? DEFAULT_PAGE_SIZE;

    const parentMessage = await ctx.db.get(args.parentMessageId);
    if (!parentMessage) {
      throw new Error("Parent message not found");
    }

    // Event channels use meeting-based access (RSVPers may not be group members).
    const channel = await ctx.db.get(parentMessage.channelId);
    if (channel?.channelType === "event") {
      if (!(await canAccessEventChannel(ctx, userId, channel))) {
        throw new Error("Not a member of this channel");
      }
    } else {
      // Check channel membership
      const membership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", parentMessage.channelId).eq("userId", userId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();

      // Community admins may read threads in their community's group channels
      // without joining (read-only oversight).
      if (
        !membership &&
        !(channel && (await isCommunityAdminForChannel(ctx, channel, userId)))
      ) {
        throw new Error("Not a member of this channel");
      }
    }

    const replies = await ctx.db
      .query("chatMessages")
      .withIndex("by_parentMessage", (q) => q.eq("parentMessageId", args.parentMessageId))
      .filter((q) => q.eq(q.field("isDeleted"), false))
      .order("asc")
      .take(limit);

    const hasMore = replies.length === limit;
    const cursor = replies.length > 0 ? replies[replies.length - 1]._id : undefined;
    const withLiveProfile = await attachLiveSenderProfile(ctx, replies);
    const decorated = await attachSenderNotifsDisabled(ctx, withLiveProfile);

    return {
      messages: decorated,
      hasMore,
      cursor,
    };
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Send a message to a channel.
 *
 * Accepts EITHER `channelId` (existing callers, all channel types) OR
 * `meetingId` (event-chat lazy-create path). Exactly one must be provided.
 * When `meetingId` is passed, the event channel is created if it doesn't
 * exist yet and the message is sent into it.
 */
export const sendMessage = mutation({
  args: {
    token: v.string(),
    channelId: v.optional(v.id("chatChannels")),
    meetingId: v.optional(v.id("meetings")),
    content: v.string(),
    attachments: v.optional(
      v.array(
        v.object({
          type: v.string(),
          url: v.string(),
          name: v.optional(v.string()),
          size: v.optional(v.number()),
          mimeType: v.optional(v.string()),
          thumbnailUrl: v.optional(v.string()),
          waveform: v.optional(v.array(v.number())),
          duration: v.optional(v.number()),
        })
      )
    ),
    parentMessageId: v.optional(v.id("chatMessages")),
    mentionedUserIds: v.optional(v.array(v.id("users"))),
    hideLinkPreview: v.optional(v.boolean()),
    viewingGroupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Require exactly one of channelId / meetingId.
    if (!args.channelId && !args.meetingId) {
      throw new Error("sendMessage requires either channelId or meetingId");
    }
    if (args.channelId && args.meetingId) {
      throw new Error("sendMessage accepts channelId or meetingId, not both");
    }

    // Global rate limit: 20 messages per minute per user
    await checkRateLimit(ctx, `msg:${userId}`, 20, 60_000);

    // Resolve the target channelId. For event-chat lazy-create, we verify
    // meeting access first, then ensure the channel exists, then proceed.
    let channelId: Id<"chatChannels">;
    if (args.meetingId) {
      const meeting = await ctx.db.get(args.meetingId);
      if (!meeting) {
        throw new Error("Meeting not found");
      }
      if (!(await canAccessMeetingChat(ctx, userId, meeting))) {
        throw new Error("Not a member of this channel");
      }
      channelId = await ctx.runMutation(
        internal.functions.messaging.eventChat.ensureEventChannel,
        { meetingId: args.meetingId },
      );
    } else {
      channelId = args.channelId!;
    }

    const channel = await ctx.db.get(channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }

    // Event channel permission path: meeting-based access, not group-based.
    if (channel.channelType === "event") {
      if (!(await canAccessEventChannel(ctx, userId, channel))) {
        throw new Error("Not a member of this channel");
      }
      if (channel.isEnabled === false) {
        throw new Error("Event chat is disabled");
      }
    } else {
      // Check channel membership
      const membership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", userId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();

      if (!membership) {
        throw new Error("Not a member of this channel");
      }

      // Auto group channels (General / Reach Out) are archived the instant a
      // leader disables them, but their member rows are soft-deleted
      // asynchronously by `clearChannelMembersBatch`. Without this guard a
      // client holding the channelId could keep posting to an archived channel
      // during that clear window (its membership row is still active). Reject
      // sends to any archived channel immediately. (Announcements re-checks
      // isArchived below alongside its leader-only gate.)
      if (channel.isArchived) {
        throw new Error("This channel is disabled");
      }

      if (args.viewingGroupId) {
        if (
          (isCustomChannel(channel.channelType) || channel.channelType === "pco_services") &&
          !channelEffectiveEnabledForGroup(channel, args.viewingGroupId)
        ) {
          throw new Error("This channel is disabled");
        }
      } else {
        if (
          (isCustomChannel(channel.channelType) || channel.channelType === "pco_services") &&
          !channelIsLeaderEnabled(channel)
        ) {
          throw new Error("This channel is disabled");
        }
      }

      // Announcements channels are leader-broadcast: every active group
      // member is a channel member (so unread counts work) but only group
      // leaders can post. Block sends from non-leaders here regardless of
      // channel-member role, since channel role is denormalized at sync time
      // and may lag the source-of-truth on `groupMembers`. For shared
      // announcements channels, leaders of any ACCEPTED secondary group can
      // post too; pending invitees get nothing.
      if (channel.channelType === "announcements") {
        if (!channelIsLeaderEnabled(channel) || channel.isArchived) {
          throw new Error("This channel is disabled");
        }
        if (!channel.groupId) {
          throw new Error("Invalid announcements channel");
        }
        const groupMembership = await ctx.db
          .query("groupMembers")
          .withIndex("by_group_user", (q) =>
            q.eq("groupId", channel.groupId!).eq("userId", userId)
          )
          .filter((q) => q.eq(q.field("leftAt"), undefined))
          .first();
        let canPost = isLeaderRole(groupMembership?.role);
        if (!canPost) {
          for (const sg of channel.sharedGroups ?? []) {
            if (sg.status !== "accepted") continue;
            const secondaryMembership = await ctx.db
              .query("groupMembers")
              .withIndex("by_group_user", (q) =>
                q.eq("groupId", sg.groupId).eq("userId", userId)
              )
              .filter((q) => q.eq(q.field("leftAt"), undefined))
              .first();
            if (isLeaderRole(secondaryMembership?.role)) {
              canPost = true;
              break;
            }
          }
        }
        if (!canPost) {
          throw new ConvexError({
            code: "FORBIDDEN",
            message: "Only group leaders can post in Announcements",
          });
        }
      }
    }

    // Get user info for denormalized fields
    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const senderName = getDisplayName(user.firstName, user.lastName);
    const senderProfilePhoto = getMediaUrl(user.profilePhoto);

    const now = Date.now();

    // Ad-hoc DM/group_dm gating: while ANY recipient is still in
    // `requestState: "pending"`, restrict the sender to text-only and
    // ≤1000 chars per message. Sender themselves must be in
    // `requestState: "accepted"` (declined/leftAt rows already bounced by
    // the membership check above).
    //
    // Historically there was also a 1-message-per-24h cap per pending pair,
    // intended as a stranger-spam defense. It was removed because ad-hoc
    // channels are already scoped to shared community membership — the
    // recipient and sender aren't strangers — and the cap surfaced as a
    // confusing "failed" error on legitimate follow-ups before acceptance.
    if (channel.isAdHoc) {
      const senderMembership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", userId),
        )
        .first();
      if (
        !senderMembership ||
        senderMembership.leftAt !== undefined ||
        senderMembership.requestState !== "accepted"
      ) {
        throw new ConvexError("Accept the request before replying");
      }

      // Profile photo is a hard requirement on every send to an ad-hoc
      // channel — not just at create / accept time. Without this re-check,
      // a user who had a photo at request-accept time could remove it later
      // and keep messaging. Frontend mirrors this with a sticky banner
      // that blocks the composer when the local user has no photo.
      const sender = await ctx.db.get(userId);
      if (
        !sender?.profilePhoto ||
        sender.profilePhoto.trim() === ""
      ) {
        throw new ConvexError("PROFILE_PHOTO_REQUIRED");
      }

      const otherMembers = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .collect();

      // Block enforcement on ad-hoc channels: if ANY active recipient has
      // blocked the sender, the send is rejected. The message would otherwise
      // be inserted (the existing notification path silences blocked users,
      // but the message stays in the channel doc and stays visible to the
      // blocker if they reopen the chat). A generic error keeps the block
      // silent — the sender doesn't learn who blocked them.
      for (const m of otherMembers) {
        if (m.userId === userId) continue;
        const block = await ctx.db
          .query("chatUserBlocks")
          .withIndex("by_blocker_blocked", (q) =>
            q.eq("blockerId", m.userId).eq("blockedId", userId),
          )
          .first();
        if (block) {
          throw new ConvexError("Cannot send message in this chat");
        }
      }

      const hasPendingOthers = otherMembers.some(
        (m) => m.userId !== userId && m.requestState === "pending",
      );

      if (hasPendingOthers) {
        const PENDING_MAX_TEXT_LENGTH = 1000;

        if (args.attachments && args.attachments.length > 0) {
          throw new ConvexError(
            "Cannot send attachments until the recipient accepts the request",
          );
        }
        if (args.content.length > PENDING_MAX_TEXT_LENGTH) {
          throw new ConvexError(
            `Messages must be ${PENDING_MAX_TEXT_LENGTH} characters or fewer until the recipient accepts`,
          );
        }
      }
    }

    // A thread lives entirely inside one channel. Nothing enforced that before,
    // so a client could reply in channel B to a parent in channel A — and then
    // `getMessages`' quote bar would republish channel A's author and text to
    // every reader of channel B, whether or not they can see channel A.
    // Reject at the source; `buildReplyQuote` also refuses to quote a
    // cross-channel parent, covering rows written before this check existed.
    if (args.parentMessageId) {
      const parentMessage = await ctx.db.get(args.parentMessageId);
      if (!parentMessage) {
        throw new ConvexError("Parent message not found");
      }
      if (parentMessage.channelId !== channelId) {
        throw new ConvexError("Cannot reply to a message in another channel");
      }
    }

    // Determine content type
    let contentType = "text";
    if (args.attachments && args.attachments.length > 0) {
      const hasImage = args.attachments.some((a) => a.type === "image");
      const hasFile = args.attachments.some((a) => a.type === "file");
      if (hasImage) contentType = "image";
      else if (hasFile) contentType = "file";
    }

    const messageId = await ctx.db.insert("chatMessages", {
      channelId,
      communityId: await resolveChannelCommunityId(ctx, channelId),
      senderId: userId,
      content: args.content,
      contentType,
      attachments: args.attachments,
      parentMessageId: args.parentMessageId,
      createdAt: now,
      isDeleted: false,
      senderName,
      senderProfilePhoto,
      mentionedUserIds: args.mentionedUserIds,
      hideLinkPreview: args.hideLinkPreview,
      // Set lastActivityAt for top-level messages (used for thread bump ordering)
      ...(!args.parentMessageId ? { lastActivityAt: now } : {}),
    });

    // Update channel with last message info (for inbox preview)
    // Generate smart preview based on content type
    const preview = generateMessagePreview({
      content: args.content,
      attachments: args.attachments,
    });

    await ctx.db.patch(channelId, {
      lastMessageAt: now,
      lastMessagePreview: preview,
      lastMessageSenderId: userId,
      lastMessageSenderName: senderName,
      updatedAt: now,
    });

    // If this is a thread reply, update parent message
    if (args.parentMessageId) {
      const parentMessage = await ctx.db.get(args.parentMessageId);
      if (parentMessage) {
        await ctx.db.patch(args.parentMessageId, {
          threadReplyCount: (parentMessage.threadReplyCount || 0) + 1,
          lastActivityAt: now,
        });
      }
    }

    // Trigger notification and unread count logic
    await ctx.scheduler.runAfter(0, internal.functions.messaging.events.onMessageSent, {
      messageId,
      channelId,
      senderId: userId,
    });

    return messageId;
  },
});

/**
 * Edit a message.
 */
export const editMessage = mutation({
  args: {
    token: v.string(),
    messageId: v.id("chatMessages"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    if (message.isDeleted) {
      throw new Error("Cannot edit a deleted message");
    }

    // Only the sender can edit their own message
    if (message.senderId !== userId) {
      throw new Error("You can only edit your own messages");
    }

    const now = Date.now();

    await ctx.db.patch(args.messageId, {
      content: args.content,
      editedAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Delete a message (soft delete).
 */
export const deleteMessage = mutation({
  args: {
    token: v.string(),
    messageId: v.id("chatMessages"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    if (message.isDeleted) {
      return; // Already deleted
    }

    // Check if user can delete
    const isOwner = message.senderId === userId;

    // Check if user is moderator or admin in channel
    const membership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", message.channelId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();

    const isChannelModerator =
      membership?.role === "moderator" || membership?.role === "admin";

    // Check if user is leader/admin in the associated group
    // Get the channel to find the groupId
    const channel = await ctx.db.get(message.channelId);
    let isGroupLeader = false;
    let isCommunityAdminUser = false;

    if (channel?.groupId) {
      const groupId = channel.groupId;
      const groupMembership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", groupId).eq("userId", userId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();

      isGroupLeader = isLeaderRole(groupMembership?.role);

      // Community admins (ADMIN or PRIMARY_ADMIN) can delete any message in groups within their community
      const group = await ctx.db.get(groupId);
      if (group?.communityId) {
        isCommunityAdminUser = await isCommunityAdmin(ctx, group.communityId, userId);
      }
    }

    if (!isOwner && !isChannelModerator && !isGroupLeader && !isCommunityAdminUser) {
      throw new Error("You can only delete your own messages");
    }

    const now = Date.now();

    await ctx.db.patch(args.messageId, {
      isDeleted: true,
      deletedAt: now,
      deletedById: userId,
    });

    // Poll messages have side data: a `polls` row + every `pollVotes` row
    // for that poll. Without cascading here, deleting a poll message
    // through the generic message-actions menu (long-press → Delete) would
    // soft-delete the chat row but leave the poll active in the database
    // — `getPoll` would still resolve, votes would persist, and the
    // dedicated `polls.deletePoll` path becomes the only way to clean up.
    if (message.contentType === "poll" && message.pollId) {
      const votes = await ctx.db
        .query("pollVotes")
        .withIndex("by_poll", (q) => q.eq("pollId", message.pollId!))
        .collect();
      for (const v of votes) {
        await ctx.db.delete(v._id);
      }
      await ctx.db.delete(message.pollId);
    }

    // Update channel preview if the deleted message was the most recent
    // Re-read channel (already fetched above, but re-read for freshest lastMessageAt)
    const freshChannel = await ctx.db.get(message.channelId);
    if (freshChannel && freshChannel.lastMessageAt && message.createdAt >= freshChannel.lastMessageAt) {
      const previousMessage = await ctx.db
        .query("chatMessages")
        .withIndex("by_channel_createdAt", (q) => q.eq("channelId", message.channelId))
        .order("desc")
        .filter((q) =>
          q.and(
            q.eq(q.field("isDeleted"), false),
            q.neq(q.field("_id"), args.messageId),
            q.eq(q.field("parentMessageId"), undefined)
          )
        )
        .first();

      if (previousMessage) {
        const preview = generateMessagePreview({
          content: previousMessage.content,
          attachments: previousMessage.attachments,
        });
        await ctx.db.patch(message.channelId, {
          lastMessageAt: previousMessage.createdAt,
          lastMessagePreview: preview,
          lastMessageSenderId: previousMessage.senderId,
          lastMessageSenderName: previousMessage.senderName,
          updatedAt: now,
        });
      } else {
        await ctx.db.patch(message.channelId, {
          lastMessageAt: undefined,
          lastMessagePreview: undefined,
          lastMessageSenderId: undefined,
          lastMessageSenderName: undefined,
          updatedAt: now,
        });
      }
    }
  },
});

/**
 * Send a system message (for notifications, bots, etc.)
 * This is an internal mutation that bypasses auth checks.
 */
export const sendSystemMessage = internalMutation({
  args: {
    channelId: v.id("chatChannels"),
    content: v.string(),
    contentType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Verify channel exists
    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new Error("Channel not found");
    }

    // Create system message (no senderId = system message)
    const messageId = await ctx.db.insert("chatMessages", {
      channelId: args.channelId,
      communityId: await resolveChannelCommunityId(ctx, args.channelId),
      // senderId is optional in schema for system/bot messages
      content: args.content,
      contentType: args.contentType || "system",
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
      lastActivityAt: now,
    });

    // Update channel metadata
    await ctx.db.patch(args.channelId, {
      lastMessageAt: now,
      lastMessagePreview: truncatePreview(args.content, LIST_PREVIEW_MAX, false),
      updatedAt: now,
    });

    return messageId;
  },
});
