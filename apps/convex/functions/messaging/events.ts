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

// ============================================================================
// Constants
// ============================================================================

const MAX_PREVIEW_LENGTH = 100;

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
          if (message.mentionedUserIds?.includes(member.userId)) {
            bucket.mentionRecipients.push(member.userId);
          } else {
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
          if (member.requestState === "pending") {
            pendingRecipients.push(member.userId);
          } else {
            acceptedRecipients.push(member.userId);
          }
        }

        console.log(
          `[onMessageSent] Scheduling ad-hoc notifications: ${pendingRecipients.length} pending, ${acceptedRecipients.length} accepted`,
        );

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
          if (message.mentionedUserIds?.includes(member.userId)) {
            mentionRecipients.push(member.userId);
          } else {
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
    if (args.pendingRecipients.length > 0) {
      const pendingTitle = args.senderName;
      const pendingBody = `would like to chat: ${previewBody}`;
      for (const userId of args.pendingRecipients) {
        await sendAdHocPushToUser(ctx, {
          userId,
          title: pendingTitle,
          body: pendingBody,
          data: { ...baseData, requestState: "pending" },
          communityId: args.communityId,
        });
      }
    }

    // Accepted recipients: standard accepted-chat copy.
    if (args.acceptedRecipients.length > 0) {
      for (const userId of args.acceptedRecipients) {
        await sendAdHocPushToUser(ctx, {
          userId,
          title: acceptedTitle,
          body: previewBody,
          data: { ...baseData, requestState: "accepted" },
          communityId: args.communityId,
        });
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
  },
): Promise<void> {
  const tokens = await ctx.runQuery(
    internal.functions.notifications.tokens.getActiveTokensForUser,
    { userId: args.userId },
  );
  if (tokens.length === 0) {
    console.log(
      `[sendAdHocMessageNotifications] No active push tokens for user ${args.userId} — skipping`,
    );
    return;
  }

  const trackingId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const notificationData = {
    ...args.data,
    trackingId,
  };

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

  await ctx.runMutation(
    internal.functions.notifications.mutations.createNotification,
    {
      userId: args.userId,
      communityId: args.communityId,
      notificationType: "new_message",
      title: args.title,
      body: args.body,
      data: notificationData,
      status: result.success ? "sent" : "failed",
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
