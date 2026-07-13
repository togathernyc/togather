/**
 * Event Handlers for Convex-Native Messaging
 *
 * Internal functions triggered by mutations to handle side effects.
 * These replace Stream Chat webhooks.
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalAction,
  internalQuery,
} from "../../_generated/server";
import type { ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { getChannelSlug } from "../../lib/slugs";
import { notifyBatch } from "../../lib/notifications/send";
import {
  chatRequestEmail,
  leaderDmEmail,
} from "../../lib/notifications/emailTemplates";
import {
  getLeaderDmRelationship,
  type LeaderDmRelationship,
} from "../../lib/leaderDm";

// ============================================================================
// Constants
// ============================================================================

const MAX_PREVIEW_LENGTH = 100;

/**
 * First-message notification copy per leadership relationship. The push keeps
 * the sender's name as its title and uses this relationship line (plus the
 * message preview) as the body; the email uses the matching subject and body.
 * Only a leader/co-lead's FIRST DM uses this copy — later messages fall back to
 * the standard accepted-DM push. Wording is adjustable at approval.
 */
const LEADER_DM_COPY: Record<
  Exclude<LeaderDmRelationship, "none">,
  {
    pushLine: string;
    emailLabel: string;
    emailBodyLine: (senderName: string) => string;
  }
> = {
  co_leader: {
    pushLine: "Your co-leader just messaged you",
    emailLabel: "co-leader",
    emailBodyLine: (s) =>
      `${s}, who co-leads a group with you, just sent you a message on Togather.`,
  },
  group_leader: {
    pushLine: "Your group leader messaged you",
    emailLabel: "group leader",
    emailBodyLine: (s) =>
      `${s} leads a group you're in and just sent you a message on Togather.`,
  },
  community_admin: {
    pushLine: "Your community leader messaged you",
    emailLabel: "community leader",
    emailBodyLine: (s) =>
      `${s}, an admin of your community, just sent you a message on Togather.`,
  },
};

// ============================================================================
// Notification routing
// ============================================================================

/** Where a single member's notification for a message should go. */
type RecipientBucket = "mention" | "regular" | "skip";

/**
 * Decide whether a channel member should be notified about a message and, if
 * so, in which bucket ("mention" → rich push + email, "regular" → push only).
 *
 * Top-level messages keep the original behavior: mentioned members get the
 * mention notification, everyone else gets a regular new-message push.
 *
 * Thread replies default to "mentions only" to avoid notification overload —
 * a member is not notified unless they were @mentioned. Members can override
 * this per thread via `chatThreadSubscriptions`:
 *   - "all":  notified on every reply (as a mention if also mentioned)
 *   - "none": never notified, even when mentioned
 */
export function decideRecipientBucket(opts: {
  isMentioned: boolean;
  isReply: boolean;
  threadState?: "all" | "none";
}): RecipientBucket {
  if (!opts.isReply) {
    return opts.isMentioned ? "mention" : "regular";
  }
  if (opts.threadState === "none") return "skip";
  if (opts.threadState === "all") {
    return opts.isMentioned ? "mention" : "regular";
  }
  // Default for thread replies: only notify members who were mentioned.
  return opts.isMentioned ? "mention" : "skip";
}

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handle message sent event.
 * Updates channel metadata and queues push notifications.
 * senderId is optional to support bot messages (which have no sender).
 */
export const onMessageSent = internalMutation({
  args: {
    messageId: v.id("chatMessages"),
    channelId: v.id("chatChannels"),
    senderId: v.optional(v.id("users")),
    // Optional override for bot messages that don't have a sender record
    senderNameOverride: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message) return;

    // Dev-assistant bot: if a human @mentioned the @Togather sentinel bot, hand
    // the thread to the agent. Cheap on the hot path — the username lookup only
    // runs for messages that actually carry mentions (the vast majority don't),
    // and the flag/staff gates live inside processThreadMention.
    if (
      args.senderId &&
      message.mentionedUserIds &&
      message.mentionedUserIds.length > 0
    ) {
      const bot = await ctx.db
        .query("users")
        .withIndex("by_username", (q) => q.eq("username", "togather_bot"))
        .first();
      if (bot && message.mentionedUserIds.includes(bot._id)) {
        await ctx.scheduler.runAfter(
          0,
          internal.functions.devAssistant.actions.processThreadMention,
          {
            channelId: args.channelId,
            mentionMessageId: args.messageId,
            originatorUserId: args.senderId,
          },
        );
      }
    }

    // Generate preview for notifications (but don't update channel - sendMessage already does it
    // with smart previews like "Sent a photo" or "Sent X files")
    const preview = message.content.slice(0, MAX_PREVIEW_LENGTH);

    // Get all channel members (except sender if there is one)
    // For bot messages (no sender), all non-muted members are included
    const allMembers = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .filter((q) =>
        q.and(
          q.eq(q.field("leftAt"), undefined),
          q.eq(q.field("isMuted"), false)
        )
      )
      .collect();

    // Filter out sender if present
    const members = args.senderId
      ? allMembers.filter((m) => m.userId !== args.senderId)
      : allMembers;

    console.log(`[onMessageSent] Found ${members.length} eligible members for channel ${args.channelId}`);

    // Increment unread counts for members
    for (const member of members) {
      const readState = await ctx.db
        .query("chatReadState")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", args.channelId).eq("userId", member.userId)
        )
        .first();

      if (readState) {
        await ctx.db.patch(readState._id, {
          unreadCount: readState.unreadCount + 1,
        });
      } else {
        // Create read state if it doesn't exist (handles members added before read state system)
        await ctx.db.insert("chatReadState", {
          channelId: args.channelId,
          userId: member.userId,
          lastReadAt: 0, // Set to 0 so all messages appear unread
          unreadCount: 1,
        });
      }
    }

    // Blast-mirror messages carry blastId and are inserted by
    // eventBlasts.recordBlast, which already delivers the SMS via its own
    // channel. Skip the chat push fanout so recipients don't get a
    // duplicate push ~5s after the SMS. Unread increments above still run
    // so the Activity feed's inbox badge reflects the new message.
    if (message.blastId) return;

    // Thread replies (messages with a parentMessageId) default to "mentions
    // only" so members aren't notified about every reply. Members can opt in
    // ("all") or fully mute ("none") a thread; load those overrides once here
    // and apply them while partitioning recipients below.
    const threadId = message.parentMessageId;
    const isReply = !!threadId;
    const threadStates = new Map<string, "all" | "none">();
    if (threadId) {
      const subscriptions = await ctx.db
        .query("chatThreadSubscriptions")
        .withIndex("by_thread", (q) => q.eq("threadId", threadId))
        .collect();
      for (const sub of subscriptions) {
        threadStates.set(sub.userId, sub.state);
      }
    }

    // Send push notifications via centralized notification system
    // Schedule an action to send notifications (actions can make external API calls)
    if (members.length > 0) {
      const channel = await ctx.db.get(args.channelId);
      const sender = args.senderId ? await ctx.db.get(args.senderId) : null;

      // Determine sender name - use override for bots, otherwise get from sender record
      const senderName = args.senderNameOverride
        ? args.senderNameOverride
        : sender
          ? `${sender.firstName || ""} ${sender.lastName || ""}`.trim() || "Someone"
          : "Togather Bot";
      const senderAvatarUrl = message.senderProfilePhoto;
      const channelSlug = channel ? getChannelSlug(channel) : "general";

      // For event channels, look up the meeting's shortId so the push
      // notification can deep-link to /e/{shortId} instead of /inbox/...
      // (which was routing tappers into the group-chat stack and had no
      // event context).
      let meetingShortId: string | undefined = undefined;
      if (channel?.channelType === "event" && channel.meetingId) {
        const meeting = await ctx.db.get(channel.meetingId);
        if (meeting?.shortId) meetingShortId = meeting.shortId;
      }

      // For shared channels, each member may belong to a different group.
      // We need to route notifications to each member's actual group so tapping
      // the notification opens the correct group context.
      const isSharedChannel = channel?.isShared && channel.sharedGroups?.some(
        (sg) => sg.status === "accepted"
      );

      if (isSharedChannel && channel && channel.groupId) {
        // Collect all group IDs: primary + accepted shared groups
        const channelGroupId = channel.groupId;
        const allGroupIds: Id<"groups">[] = [channelGroupId];
        for (const sg of channel.sharedGroups || []) {
          if (sg.status === "accepted") {
            allGroupIds.push(sg.groupId);
          }
        }

        // For each member, determine which group they belong to
        // Map: groupId -> { group, mentionRecipients, regularRecipients }
        const groupBuckets = new Map<string, {
          groupId: Id<"groups">;
          groupName: string;
          communityId?: Id<"communities">;
          mentionRecipients: Id<"users">[];
          regularRecipients: Id<"users">[];
        }>();

        // Pre-fetch all groups
        const groupDocs = await Promise.all(allGroupIds.map((gId) => ctx.db.get(gId)));
        const groupMap = new Map<string, { _id: Id<"groups">; name: string; communityId?: Id<"communities"> }>();
        for (const g of groupDocs) {
          if (g) groupMap.set(g._id, { _id: g._id, name: g.name, communityId: g.communityId });
        }

        for (const member of members) {
          // Find which group this member belongs to
          let memberGroupId: Id<"groups"> | null = null;
          for (const gId of allGroupIds) {
            const gm = await ctx.db
              .query("groupMembers")
              .withIndex("by_group_user", (q) => q.eq("groupId", gId).eq("userId", member.userId))
              .first();
            if (gm && !gm.leftAt) {
              memberGroupId = gId;
              break;
            }
          }

          // Fallback to primary group if membership lookup fails
          const effectiveGroupId = memberGroupId || channelGroupId;
          const key = effectiveGroupId;

          if (!groupBuckets.has(key)) {
            const g = groupMap.get(effectiveGroupId);
            groupBuckets.set(key, {
              groupId: effectiveGroupId,
              groupName: g?.name || "Group Chat",
              communityId: g?.communityId,
              mentionRecipients: [],
              regularRecipients: [],
            });
          }

          const bucket = groupBuckets.get(key)!;
          const target = decideRecipientBucket({
            isMentioned: !!message.mentionedUserIds?.includes(member.userId),
            isReply,
            threadState: threadStates.get(member.userId),
          });
          if (target === "mention") {
            bucket.mentionRecipients.push(member.userId);
          } else if (target === "regular") {
            bucket.regularRecipients.push(member.userId);
          }
        }

        // Schedule one notification action per group bucket
        for (const bucket of groupBuckets.values()) {
          if (bucket.mentionRecipients.length === 0 && bucket.regularRecipients.length === 0) continue;
          console.log(`[onMessageSent] Scheduling notifications for group ${bucket.groupId}: ${bucket.mentionRecipients.length} mentions, ${bucket.regularRecipients.length} regular`);
          await ctx.scheduler.runAfter(0, internal.functions.messaging.events.sendMessageNotifications, {
            channelId: args.channelId,
            messageId: args.messageId,
            senderName,
            messagePreview: preview,
            senderAvatarUrl,
            groupId: bucket.groupId,
            groupName: bucket.groupName,
            communityId: bucket.communityId,
            channelName: channel.name,
            channelType: channel.channelType || "main",
            channelSlug,
            meetingShortId,
            mentionRecipients: bucket.mentionRecipients,
            regularRecipients: bucket.regularRecipients,
          });
        }
      } else if (channel?.isAdHoc) {
        // Ad-hoc DM / group_dm channels have their own notification copy:
        // no "Group Chat: <name>" subtitle, and pending requests get a
        // "would like to chat:" prefix. Routed through a dedicated action so
        // the standard formatter (which always includes "groupName: channel")
        // doesn't run for these channels.
        //
        // We separate recipients into:
        //   - "pending" recipients (their membership row is still pending) →
        //     first-message-of-request copy
        //   - "accepted" recipients → standard accepted-chat copy
        // The split is done here (per-recipient) so we can render different
        // bodies in a single fanout pass.
        const pendingRecipients: Id<"users">[] = [];
        const acceptedRecipients: Id<"users">[] = [];
        for (const member of members) {
          // DMs are low-volume, so replies still notify by default; only an
          // explicit "none" mute on the thread suppresses the notification.
          if (isReply && threadStates.get(member.userId) === "none") {
            continue;
          }
          if (member.requestState === "pending") {
            pendingRecipients.push(member.userId);
          } else {
            acceptedRecipients.push(member.userId);
          }
        }

        console.log(
          `[onMessageSent] Scheduling ad-hoc notifications: ${pendingRecipients.length} pending, ${acceptedRecipients.length} accepted`,
        );

        // The request email is "first-message-of-request" copy, so it should
        // only fire for the message that opened the request. Senders can send
        // legitimate follow-ups while the recipient is still pending, and each
        // of those re-runs this fanout — without this guard every follow-up
        // would email a pending recipient again. The opening message is the
        // earliest in the channel.
        const firstMessage = await ctx.db
          .query("chatMessages")
          .withIndex("by_channel_createdAt", (q) =>
            q.eq("channelId", args.channelId),
          )
          .order("asc")
          .first();
        const isInitialRequestMessage = firstMessage?._id === args.messageId;

        // On the opening message of a 1:1 DM, work out whether each accepted
        // recipient has a leadership tie to the sender. Leader/co-lead DMs are
        // created already-accepted, so their first message is exactly
        // `accepted && isInitialRequestMessage` — the re-check here
        // distinguishes them from the rare "recipient accepted an empty
        // request first" case (which returns "none" and falls through to the
        // normal accepted push). Group DMs are out of scope, and follow-up
        // messages never carry the special copy.
        const leaderRelationships: Array<{
          userId: Id<"users">;
          relationship: "co_leader" | "group_leader" | "community_admin";
        }> = [];
        if (
          isInitialRequestMessage &&
          channel.channelType === "dm" &&
          args.senderId &&
          channel.communityId
        ) {
          for (const recipientId of acceptedRecipients) {
            const relationship = await getLeaderDmRelationship(
              ctx,
              channel.communityId,
              args.senderId,
              recipientId,
            );
            if (relationship !== "none") {
              leaderRelationships.push({ userId: recipientId, relationship });
            }
          }
        }

        await ctx.scheduler.runAfter(
          0,
          internal.functions.messaging.events.sendAdHocMessageNotifications,
          {
            channelId: args.channelId,
            messageId: args.messageId,
            senderName,
            messagePreview: preview,
            senderAvatarUrl,
            communityId: channel.communityId,
            pendingRecipients,
            acceptedRecipients,
            isInitialRequestMessage,
            leaderRelationships,
          },
        );
      } else {
        // Non-shared channel: original single-group path. For ad-hoc DMs/group_dms,
        // channel.groupId is undefined so we fall back to channel.communityId directly
        // (the channel is the unit of routing here, not a group).
        const group = channel?.groupId ? await ctx.db.get(channel.groupId) : null;
        const community = group?.communityId
          ? await ctx.db.get(group.communityId)
          : channel?.communityId
            ? await ctx.db.get(channel.communityId)
            : null;

        const mentionRecipients: Id<"users">[] = [];
        const regularRecipients: Id<"users">[] = [];

        for (const member of members) {
          const target = decideRecipientBucket({
            isMentioned: !!message.mentionedUserIds?.includes(member.userId),
            isReply,
            threadState: threadStates.get(member.userId),
          });
          if (target === "mention") {
            mentionRecipients.push(member.userId);
          } else if (target === "regular") {
            regularRecipients.push(member.userId);
          }
        }

        console.log(`[onMessageSent] Scheduling notifications for ${mentionRecipients.length} mentions and ${regularRecipients.length} regular recipients`);
        console.log(`[onMessageSent] Regular recipient IDs: ${regularRecipients.join(', ')}`);

        await ctx.scheduler.runAfter(0, internal.functions.messaging.events.sendMessageNotifications, {
          channelId: args.channelId,
          messageId: args.messageId,
          senderName,
          messagePreview: preview,
          senderAvatarUrl,
          groupId: group?._id,
          groupName: group?.name || channel?.name || 'Group Chat',
          communityId: community?._id,
          channelName: channel?.name,
          channelType: channel?.channelType || "main",
          channelSlug,
          meetingShortId,
          mentionRecipients,
          regularRecipients,
        });
      }
    }
  },
});

/**
 * Send push notifications for a new message.
 * Uses the centralized notification system.
 */
export const sendMessageNotifications = internalAction({
  args: {
    channelId: v.id("chatChannels"),
    messageId: v.id("chatMessages"),
    senderName: v.string(),
    messagePreview: v.string(),
    senderAvatarUrl: v.optional(v.string()),
    groupId: v.optional(v.id("groups")),
    groupName: v.string(),
    communityId: v.optional(v.id("communities")),
    channelName: v.optional(v.string()),
    channelType: v.optional(v.string()),
    channelSlug: v.optional(v.string()),
    /** For event-channel messages, the owning meeting's shortId. Lets us
     *  deep-link the push to `/e/{shortId}` instead of the inbox route. */
    meetingShortId: v.optional(v.string()),
    mentionRecipients: v.array(v.id("users")),
    regularRecipients: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    console.log(`[sendMessageNotifications] Starting with channelId=${args.channelId}, groupId=${args.groupId}, messageId=${args.messageId}, channelType=${args.channelType}, channelSlug=${args.channelSlug}, meetingShortId=${args.meetingShortId}`);

    // Event-channel messages deep-link to the event page rather than the
    // inbox chat room. The mobile app's notification handler prefers `url`
    // over `type`/`channelType` routing, so setting it here is sufficient.
    const isEventChannel = args.channelType === "event";
    const eventUrl =
      isEventChannel && args.meetingShortId
        ? `/e/${args.meetingShortId}?source=app`
        : undefined;

    // Preserve "event" in channelType for notifications from event channels so
    // the mobile fallback path doesn't mis-route them through `general`.
    const dataChannelType = isEventChannel
      ? "event"
      : args.channelType === "leaders"
        ? "leaders"
        : "general";
    const dataChannelSlug =
      args.channelSlug ||
      (args.channelType === "leaders" ? "leaders" : "general");

    // Send mention notifications (push + email)
    if (args.mentionRecipients.length > 0) {
      await notifyBatch(ctx, {
        type: "mention",
        userIds: args.mentionRecipients,
        data: {
          senderName: args.senderName,
          senderAvatarUrl: args.senderAvatarUrl,
          messagePreview: args.messagePreview,
          groupId: args.groupId,
          groupName: args.groupName,
          channelId: args.channelId,
          channelName: args.channelName,
          communityId: args.communityId,
          channelType: dataChannelType,
          channelSlug: dataChannelSlug,
          ...(eventUrl ? { url: eventUrl, shortId: args.meetingShortId } : {}),
        },
        groupId: args.groupId,
        communityId: args.communityId,
      });
    }

    // Send regular new message notifications (push only)
    if (args.regularRecipients.length > 0) {
      await notifyBatch(ctx, {
        type: "new_message",
        userIds: args.regularRecipients,
        data: {
          senderName: args.senderName,
          senderAvatarUrl: args.senderAvatarUrl,
          messagePreview: args.messagePreview,
          groupId: args.groupId,
          groupName: args.groupName,
          channelId: args.channelId,
          channelName: args.channelName,
          communityId: args.communityId,
          channelType: dataChannelType,
          channelSlug: dataChannelSlug,
          ...(eventUrl ? { url: eventUrl, shortId: args.meetingShortId } : {}),
        },
        groupId: args.groupId,
        communityId: args.communityId,
      });
    }

    console.log(
      `[sendMessageNotifications] Sent ${args.mentionRecipients.length} mention + ${args.regularRecipients.length} regular notifications for message ${args.messageId}`
    );
  },
});

/**
 * Truncate a string to `max` chars, suffixing "…" if truncation occurred.
 */
function truncateForBody(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + "…";
}

/**
 * Send push notifications for a new message in an ad-hoc DM / group_dm channel.
 *
 * Distinct from `sendMessageNotifications` because:
 *   - Body never includes the legacy "Group Chat: General" subtitle that the
 *     standard formatter always emits.
 *   - "Pending" recipients (whose membership row is still pending) get a
 *     "would like to chat:" prefix on the body.
 *   - Group_dms render the channel name (or first 2 other-member names) into
 *     the title so multi-person threads are distinguishable from 1:1 DMs.
 *
 * The push payload `data` carries `requestState` so the client can route the
 * tap correctly (request inbox vs. accepted thread).
 */
export const sendAdHocMessageNotifications = internalAction({
  args: {
    channelId: v.id("chatChannels"),
    messageId: v.id("chatMessages"),
    senderName: v.string(),
    messagePreview: v.string(),
    senderAvatarUrl: v.optional(v.string()),
    communityId: v.optional(v.id("communities")),
    /** Members whose membership row is still in `requestState: "pending"`. */
    pendingRecipients: v.array(v.id("users")),
    /** Members whose membership row is `accepted` (or legacy/undefined). */
    acceptedRecipients: v.array(v.id("users")),
    /**
     * True when this is the opening message of the request (the earliest in
     * the channel). Only then do pending recipients get the request email —
     * follow-up messages before acceptance stay push-only so a pending
     * conversation doesn't email on every message.
     */
    isInitialRequestMessage: v.optional(v.boolean()),
    /**
     * Accepted recipients (on the opening message of a 1:1 DM) who have a
     * leadership tie to the sender. Their first message gets relationship-
     * specific push + email copy instead of the generic accepted-DM push.
     */
    leaderRelationships: v.optional(
      v.array(
        v.object({
          userId: v.id("users"),
          relationship: v.union(
            v.literal("co_leader"),
            v.literal("group_leader"),
            v.literal("community_admin"),
          ),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    console.log(
      `[sendAdHocMessageNotifications] channelId=${args.channelId}, pending=${args.pendingRecipients.length}, accepted=${args.acceptedRecipients.length}`,
    );

    // Truncate the body's message excerpt. Match the previous fanout's
    // ~120-char ceiling so iOS/Android push surfaces don't ellipsize twice.
    const MAX_BODY_PREVIEW = 120;
    const previewBody = truncateForBody(args.messagePreview, MAX_BODY_PREVIEW);

    // Resolve channel + non-sender accepted member names so group_dms can
    // render "<sender> in <channelName | first-two-others>" titles when
    // there's no explicit channel name.
    const channelInfo = await ctx.runQuery(
      internal.functions.messaging.events.getAdHocChannelInfo,
      { channelId: args.channelId },
    );
    const channelType: "dm" | "group_dm" =
      (channelInfo?.channelType as "dm" | "group_dm") ?? "dm";
    const channelName = channelInfo?.channelName ?? "";

    // Build the accepted-recipient title once. For group_dms with no name we
    // fall back to listing up to the first 2 other-member display names so
    // the recipient sees who else is in the thread.
    let acceptedTitle: string;
    if (channelType === "group_dm") {
      if (channelName.trim().length > 0) {
        acceptedTitle = `${args.senderName} in ${channelName.trim()}`;
      } else {
        const others = (channelInfo?.otherDisplayNames ?? []).slice(0, 2);
        acceptedTitle =
          others.length > 0
            ? `${args.senderName} in ${others.join(", ")}`
            : args.senderName;
      }
    } else {
      // 1:1 dm — title is just the sender name; body is the message text.
      acceptedTitle = args.senderName;
    }

    const baseData = {
      type: "new_message" as const,
      channelId: args.channelId,
      channelType,
      channelName,
      communityId: args.communityId,
      senderAvatarUrl: args.senderAvatarUrl,
      isAdHoc: true,
      // Pre-computed deep link for ad-hoc threads. The client routes pending
      // recipients to the requests inbox via `requestState` below.
      url: `/inbox/dm/${args.channelId}`,
    };

    // Pending recipients: first-message-of-a-request copy.
    // On the opening message of the request, build a personalized email payload
    // that is sent in conjunction with the push so users hear about a new
    // message request even when they aren't actively using the app. Follow-up
    // messages sent while the recipient is still pending stay push-only.
    if (args.pendingRecipients.length > 0) {
      const pendingTitle = args.senderName;
      const pendingBody = `would like to chat: ${previewBody}`;
      const isGroupChat = channelType === "group_dm";
      for (const userId of args.pendingRecipients) {
        // Only the opening message of the request carries an email — build the
        // personalized payload just for that case so follow-ups skip the extra
        // lookup and HTML render entirely.
        let requestEmail:
          | { subject: string; htmlBody: string; notificationType: string }
          | undefined;
        if (args.isInitialRequestMessage) {
          const userInfo = await ctx.runQuery(
            internal.functions.notifications.internal.getUserEmailInfo,
            { userId },
          );
          const emailHtml = chatRequestEmail({
            senderName: args.senderName,
            isGroupChat,
            channelName: isGroupChat ? channelName : undefined,
            messagePreview: args.messagePreview,
            firstName: userInfo?.firstName,
          });
          const emailSubject = isGroupChat
            ? channelName.trim().length > 0
              ? `${args.senderName} added you to ${channelName.trim()}`
              : `${args.senderName} added you to a group chat`
            : `${args.senderName} would like to chat`;
          requestEmail = {
            subject: emailSubject,
            htmlBody: emailHtml,
            notificationType: "chat_request",
          };
        }
        await sendAdHocPushToUser(ctx, {
          userId,
          title: pendingTitle,
          body: pendingBody,
          data: { ...baseData, requestState: "pending" },
          communityId: args.communityId,
          requestEmail,
        });
      }
    }

    // Accepted recipients: standard accepted-chat copy, except a leader/co-lead's
    // FIRST DM, which gets relationship-specific copy plus a one-off heads-up
    // email (normal accepted DMs stay push-only). `leaderRelationships` is only
    // populated on the opening message, so every later message lands here with
    // an empty map and uses the standard push.
    if (args.acceptedRecipients.length > 0) {
      const relationshipByUser = new Map(
        (args.leaderRelationships ?? []).map((r) => [r.userId, r.relationship]),
      );
      for (const userId of args.acceptedRecipients) {
        const relationship = args.isInitialRequestMessage
          ? relationshipByUser.get(userId)
          : undefined;

        if (relationship) {
          const copy = LEADER_DM_COPY[relationship];
          // Push: sender name as the title, relationship line + preview as the
          // body so the recipient sees why the sender is in their inbox.
          const leaderBody =
            previewBody.length > 0
              ? `${copy.pushLine} · ${previewBody}`
              : copy.pushLine;
          const userInfo = await ctx.runQuery(
            internal.functions.notifications.internal.getUserEmailInfo,
            { userId },
          );
          const emailHtml = leaderDmEmail({
            senderName: args.senderName,
            relationshipLabel: copy.emailLabel,
            bodyLine: copy.emailBodyLine(args.senderName),
            messagePreview: args.messagePreview,
            firstName: userInfo?.firstName,
          });
          await sendAdHocPushToUser(ctx, {
            userId,
            title: args.senderName,
            body: leaderBody,
            data: { ...baseData, requestState: "accepted" },
            communityId: args.communityId,
            requestEmail: {
              subject: `Your ${copy.emailLabel} ${args.senderName} messaged you`,
              htmlBody: emailHtml,
              notificationType: "chat_request",
            },
          });
        } else {
          await sendAdHocPushToUser(ctx, {
            userId,
            title: acceptedTitle,
            body: previewBody,
            data: { ...baseData, requestState: "accepted" },
            communityId: args.communityId,
          });
        }
      }
    }
  },
});

/**
 * Internal query: minimal channel info needed by the ad-hoc push fanout.
 * Returns `channelType`, the channel name, and up to a handful of accepted
 * member display names for the title fallback.
 */
export const getAdHocChannelInfo = internalQuery({
  args: { channelId: v.id("chatChannels") },
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel) return null;

    const members = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    const otherDisplayNames = members
      .map((m) => m.displayName ?? "")
      .filter((n) => n.trim().length > 0);

    return {
      channelType: channel.channelType,
      channelName: channel.name ?? "",
      otherDisplayNames,
    };
  },
});

/**
 * Send a single push to one user with custom title/body. Mirrors the
 * essentials of `sendPushChannel` (token lookup → batch push → notification
 * record) without invoking the standard formatter, which always emits the
 * "groupName: channelLabel" subtitle that we want to suppress for ad-hoc
 * channels.
 */
async function sendAdHocPushToUser(
  ctx: ActionCtx,
  args: {
    userId: Id<"users">;
    title: string;
    body: string;
    data: Record<string, unknown>;
    communityId?: Id<"communities">;
    /**
     * Optional email sent in conjunction with the push. Used for chat requests
     * so the recipient hears about a new message request by email even when
     * they aren't actively using the app — independent of whether push lands.
     * Respects the recipient's `emailNotificationsEnabled` preference. Only
     * requests pass this; accepted-chat messages stay push-only so the inbox
     * doesn't double-notify on every reply.
     */
    requestEmail?: {
      subject: string;
      htmlBody: string;
      notificationType: string;
    };
  },
): Promise<void> {
  const tokens = await ctx.runQuery(
    internal.functions.notifications.tokens.getActiveTokensForUser,
    { userId: args.userId },
  );

  const trackingId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const notificationData = {
    ...args.data,
    trackingId,
  };

  let pushOk = false;
  if (tokens.length > 0) {
    const notifications = tokens.map((t: { token: string }) => ({
      token: t.token,
      title: args.title,
      body: args.body,
      data: notificationData,
      imageUrl:
        typeof args.data.senderAvatarUrl === "string"
          ? args.data.senderAvatarUrl
          : undefined,
    }));

    const result = await ctx.runAction(
      internal.functions.notifications.internal.sendBatchPushNotifications,
      { notifications },
    );
    pushOk = result.success;
  } else {
    console.log(
      `[sendAdHocMessageNotifications] No active push tokens for user ${args.userId}`,
    );
  }

  // Email the recipient in conjunction with the push (not only as a fallback)
  // so a new message request reaches them even when they aren't actively using
  // the app. Only requests pass `requestEmail` — accepted-chat messages stay
  // push-only so the inbox doesn't double-notify on every reply.
  if (args.requestEmail) {
    const userInfo = await ctx.runQuery(
      internal.functions.notifications.internal.getUserEmailInfo,
      { userId: args.userId },
    );
    if (userInfo?.email && userInfo.emailNotificationsEnabled) {
      await ctx.runAction(
        internal.functions.notifications.internal.sendEmailNotification,
        {
          to: userInfo.email,
          subject: args.requestEmail.subject,
          htmlBody: args.requestEmail.htmlBody,
          notificationType: args.requestEmail.notificationType,
        },
      );
      console.log(
        `[sendAdHocMessageNotifications] Request email sent to ${userInfo.email}`,
      );
    }
  }

  await ctx.runMutation(
    internal.functions.notifications.mutations.createNotification,
    {
      userId: args.userId,
      communityId: args.communityId,
      notificationType: "new_message",
      title: args.title,
      body: args.body,
      data: notificationData,
      status: pushOk || args.requestEmail ? "sent" : "failed",
      trackingId,
    },
  );
}

/**
 * Handle member added to channel.
 * Updates channel member count and initializes read state.
 */
export const onMemberAdded = internalMutation({
  args: {
    channelId: v.id("chatChannels"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel) return;

    // Update member count
    await ctx.db.patch(args.channelId, {
      memberCount: (channel.memberCount || 0) + 1,
    });

    // Initialize read state for new member
    const existingReadState = await ctx.db
      .query("chatReadState")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", args.userId)
      )
      .first();

    if (!existingReadState) {
      await ctx.db.insert("chatReadState", {
        channelId: args.channelId,
        userId: args.userId,
        lastReadAt: Date.now(),
        unreadCount: 0,
      });
    }
  },
});

/**
 * Handle member removed from channel.
 * Updates channel member count and cleans up read state.
 */
export const onMemberRemoved = internalMutation({
  args: {
    channelId: v.id("chatChannels"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel) return;

    // Update member count
    const newCount = Math.max(0, (channel.memberCount || 0) - 1);
    await ctx.db.patch(args.channelId, {
      memberCount: newCount,
    });

    // Clean up read state
    const readState = await ctx.db
      .query("chatReadState")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", args.userId)
      )
      .first();

    if (readState) {
      await ctx.db.delete(readState._id);
    }
  },
});

/**
 * Handle channel archived.
 * Cleans up typing indicators.
 */
export const onChannelArchived = internalMutation({
  args: {
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    // Clean up typing indicators
    const typingIndicators = await ctx.db
      .query("chatTypingIndicators")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .collect();

    for (const indicator of typingIndicators) {
      await ctx.db.delete(indicator._id);
    }
  },
});

/**
 * Handle thread reply.
 * Increments thread reply count on parent message.
 */
export const onThreadReply = internalMutation({
  args: {
    parentMessageId: v.id("chatMessages"),
  },
  handler: async (ctx, args) => {
    const parentMessage = await ctx.db.get(args.parentMessageId);
    if (!parentMessage) return;

    await ctx.db.patch(args.parentMessageId, {
      threadReplyCount: (parentMessage.threadReplyCount || 0) + 1,
    });
  },
});
