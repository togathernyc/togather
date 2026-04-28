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

const MAX_PREVIEW_LENGTH = 100;
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
function generateMessagePreview(message: MessageForPreview): string {
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
      return content.slice(0, MAX_PREVIEW_LENGTH);
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
      return content.slice(0, MAX_PREVIEW_LENGTH);
    }
  } else if (DOMAIN_CONFIG.eventLinkRegexSingle().test(content)) {
    // Event link shared
    return content.trim() === content.match(DOMAIN_CONFIG.eventLinkRegexSingle())?.[0]
      ? "Shared an event"
      : content.slice(0, MAX_PREVIEW_LENGTH);
  } else if (DOMAIN_CONFIG.toolLinkRegexSingle().test(content)) {
    // Tool link shared (Run Sheet, Resource)
    return content.trim() === content.match(DOMAIN_CONFIG.toolLinkRegexSingle())?.[0]
      ? "Shared a tool"
      : content.slice(0, MAX_PREVIEW_LENGTH);
  } else if (DOMAIN_CONFIG.groupLinkRegexSingle().test(content)) {
    // Group link shared
    return content.trim() === content.match(DOMAIN_CONFIG.groupLinkRegexSingle())?.[0]
      ? "Shared a group"
      : content.slice(0, MAX_PREVIEW_LENGTH);
  } else {
    return content.slice(0, MAX_PREVIEW_LENGTH);
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

      // Event channels use meeting-based access rather than chatChannelMembers
      // (non-group-members can still participate via RSVP).
      const channel = await ctx.db.get(message.channelId);
      if (channel?.channelType === "event") {
        if (!(await canAccessEventChannel(ctx, userId, channel))) {
          return null;
        }
        return message;
      }

      // Check if user has access to the channel
      const membership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", message.channelId).eq("userId", userId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();

      if (!membership) {
        return null;
      }

      return message;
    } catch (error) {
      console.error("[getMessage] Failed to fetch message:", error);
      return null;
    }
  },
});

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
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const limit = args.limit ?? DEFAULT_PAGE_SIZE;

    // Get the channel to check group membership
    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new Error("Channel not found");
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

      // If not a channel member, only group leaders/admins may load messages
      if (!channelMembership && !isLeaderRole(groupMembership?.role)) {
        throw new Error("Not a member of this channel");
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
      if (
        (isCustomChannel(channel.channelType) || channel.channelType === "pco_services") &&
        !effectiveEnabled &&
        !isOwningGroupLeader &&
        !isLinkedGroupLeader
      ) {
        throw new Error("Channel is not available");
      }
    }

    // Get blocked users to filter out their messages
    const blockedUsers = await ctx.db
      .query("chatUserBlocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", userId))
      .collect();

    const blockedUserIds = new Set(blockedUsers.map((b) => b.blockedId));

    // --- Index-driven pagination using by_channel_lastActivityAt ---
    // Instead of .collect() on ALL messages, scan the index in desc order
    // and only read enough to fill one page. This is O(page_size) instead
    // of O(total_messages).

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
    // Track all message IDs we've already processed across batches to avoid
    // duplicates when using lte on the same timestamp boundary.
    const processedIds = new Set<string>(cursorSeenIds ?? []);
    let scanCursorTime = cursorTime;

    // Fetch in batches until we have enough accepted messages or run out
    let candidates = await ctx.db
      .query("chatMessages")
      .withIndex("by_channel_lastActivityAt", (q) => {
        const q1 = q.eq("channelId", args.channelId);
        // Use lte to include messages at the cursor timestamp (we skip
        // already-seen ones by ID below). This avoids dropping messages
        // that share the same timestamp as the cursor.
        if (scanCursorTime !== undefined) {
          return q1.lte("lastActivityAt", scanCursorTime);
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
        if (m.parentMessageId) continue;
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
      scanCursorTime = lastCandidate.lastActivityAt ?? lastCandidate.createdAt;

      candidates = await ctx.db
        .query("chatMessages")
        .withIndex("by_channel_lastActivityAt", (q) =>
          q.eq("channelId", args.channelId).lte("lastActivityAt", scanCursorTime!)
        )
        .order("desc")
        .take(fetchBatch);
    }

    const hasMore = accepted.length > limit;
    const pageMessages = accepted.slice(0, limit);

    // Encode cursor: "timestamp:id1,id2,..." — includes all message IDs at the
    // last page entry's timestamp so the next page can skip them correctly.
    let cursor: string | undefined;
    if (pageMessages.length > 0) {
      const lastMsg = pageMessages[pageMessages.length - 1];
      const lastActivityAt = lastMsg.lastActivityAt ?? lastMsg.createdAt;
      // Collect all accepted message IDs at the boundary timestamp
      const boundaryIds: string[] = [];
      for (const m of pageMessages) {
        const t = m.lastActivityAt ?? m.createdAt;
        if (t === lastActivityAt) {
          boundaryIds.push(m._id);
        }
      }
      cursor = `${lastActivityAt}:${boundaryIds.join(",")}`;
    }

    // Reverse to chronological order (oldest first, newest at bottom)
    // This is the expected order for chat UIs
    const chronologicalMessages = [...pageMessages].reverse();

    return {
      messages: chronologicalMessages,
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

      if (!membership) {
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

    return {
      messages: replies,
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
    }

    // Get user info for denormalized fields
    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const senderName = getDisplayName(user.firstName, user.lastName);
    const senderProfilePhoto = getMediaUrl(user.profilePhoto);

    const now = Date.now();

    // Ad-hoc DM/group_dm gating: while ANY recipient is still in `requestState: "pending"`,
    // restrict the sender to text-only, ≤1000 chars, and 1 message per 24h per pending pair.
    // Sender themselves must be in `requestState: "accepted"` (declined/leftAt rows already
    // bounced by the membership check above). `pendingOthers` is reused after insert to
    // upsert the rate-limit rows.
    let pendingOthersForRateLimit: Array<{ userId: Id<"users"> }> = [];
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
        throw new Error("Accept the request before replying");
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
          throw new Error("Cannot send message in this chat");
        }
      }

      const pendingOthers = otherMembers.filter(
        (m) => m.userId !== userId && m.requestState === "pending",
      );

      if (pendingOthers.length > 0) {
        const PENDING_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
        const PENDING_MAX_TEXT_LENGTH = 1000;

        if (args.attachments && args.attachments.length > 0) {
          throw new Error(
            "Cannot send attachments until the recipient accepts the request",
          );
        }
        if (args.content.length > PENDING_MAX_TEXT_LENGTH) {
          throw new Error(
            `First message must be ${PENDING_MAX_TEXT_LENGTH} characters or fewer until accepted`,
          );
        }

        for (const r of pendingOthers) {
          const rl = await ctx.db
            .query("directMessageRateLimits")
            .withIndex("by_user_channel_recipient", (q) =>
              q
                .eq("userId", userId)
                .eq("channelId", channelId)
                .eq("recipientUserId", r.userId),
            )
            .first();
          if (
            rl &&
            rl.windowStartedAt > now - PENDING_RATE_LIMIT_WINDOW_MS &&
            rl.messageCount >= 1
          ) {
            throw new Error(
              "You can send only 1 message until the recipient accepts the request",
            );
          }
        }

        pendingOthersForRateLimit = pendingOthers.map((r) => ({
          userId: r.userId,
        }));
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

    // Upsert rate-limit rows for each pending recipient. Done after a successful
    // insert so a thrown rate-limit error doesn't leave stray counters behind.
    for (const r of pendingOthersForRateLimit) {
      const existingRl = await ctx.db
        .query("directMessageRateLimits")
        .withIndex("by_user_channel_recipient", (q) =>
          q
            .eq("userId", userId)
            .eq("channelId", channelId)
            .eq("recipientUserId", r.userId),
        )
        .first();
      if (existingRl) {
        await ctx.db.patch(existingRl._id, {
          windowStartedAt: now,
          messageCount: 1,
        });
      } else {
        await ctx.db.insert("directMessageRateLimits", {
          userId,
          channelId,
          recipientUserId: r.userId,
          windowStartedAt: now,
          messageCount: 1,
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
      lastMessagePreview: args.content.substring(0, MAX_PREVIEW_LENGTH),
      updatedAt: now,
    });

    return messageId;
  },
});
