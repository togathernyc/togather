/**
 * Event Blast functions
 *
 * Allows leaders to send message blasts (SMS/push) to attendees who
 * RSVPed "Going" to an event. Blasts are recorded for history.
 */

import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { canEditMeeting } from "../lib/meetingPermissions";
import { now, getMediaUrl } from "../lib/utils";
import { DOMAIN_CONFIG } from "@togather/shared/config";

// ============================================================================
// Queries
// ============================================================================

/**
 * List blasts for a meeting, ordered by most recent first
 */
export const list = query({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return [];

    // Creator, group leaders, and community admins can see the blast log —
    // hosts who sent the messages need to see what they sent (ADR-022).
    if (!(await canEditMeeting(ctx, userId, meeting))) return [];

    const blasts = await ctx.db
      .query("eventBlasts")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .collect();

    // Sort by createdAt desc
    blasts.sort((a, b) => b.createdAt - a.createdAt);

    // Batch fetch sender info
    const senderIds = [...new Set(blasts.map((b) => b.sentById))];
    const senders = await Promise.all(senderIds.map((id) => ctx.db.get(id)));
    const senderMap = new Map<string, { name: string; profilePhoto: string | undefined }>();
    senders.forEach((sender, i) => {
      if (sender) {
        const name = `${sender.firstName || ""} ${sender.lastName || ""}`.trim() || "Someone";
        senderMap.set(senderIds[i], { name, profilePhoto: getMediaUrl(sender.profilePhoto) });
      }
    });

    return blasts.map((blast) => {
      const sender = senderMap.get(blast.sentById);
      return {
        _id: blast._id,
        message: blast.message,
        channels: blast.channels,
        recipientCount: blast.recipientCount,
        status: blast.status,
        results: blast.results,
        createdAt: blast.createdAt,
        sentByName: sender?.name || "Unknown",
        sentByPhoto: sender?.profilePhoto ?? null,
      };
    });
  },
});

// ============================================================================
// Mutations (client-facing)
// ============================================================================

/**
 * Initiate a message blast — validates leader auth and schedules the send action
 */
export const initiate = mutation({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
    message: v.string(),
    channels: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) throw new Error("Meeting not found");

    // Creator, group leaders, and community admins can message attendees.
    // Mirrors the ADR-022 edit/cancel permission set — the event host
    // reasonably wants to reach out to people who RSVPed.
    if (!(await canEditMeeting(ctx, userId, meeting))) {
      throw new Error(
        "Only the event creator, group leaders, or community admins can message attendees"
      );
    }

    // Schedule the send action
    await ctx.scheduler.runAfter(0, internal.functions.eventBlasts.send, {
      meetingId: args.meetingId,
      groupId: meeting.groupId,
      userId,
      message: args.message,
      channels: args.channels,
    });

    return { success: true };
  },
});

// ============================================================================
// Internal action (does the actual sending)
// ============================================================================

/**
 * Send a message blast to all attendees who RSVPed "Going" (optionId 1)
 */
export const send = internalAction({
  args: {
    meetingId: v.id("meetings"),
    groupId: v.id("groups"),
    userId: v.id("users"),
    message: v.string(),
    channels: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // Get meeting info
    const meeting = await ctx.runQuery(
      internal.functions.notifications.internal.getMeetingInfo,
      { meetingId: args.meetingId }
    );
    if (!meeting) throw new Error("Meeting not found");

    // Get group info for notification image
    const groupInfo = await ctx.runQuery(
      internal.functions.notifications.internal.getGroupInfo,
      { groupId: args.groupId }
    );

    // Get sender info for notification image
    const senderInfo = await ctx.runQuery(
      internal.functions.eventBlasts.getSenderInfo,
      { userId: args.userId }
    );

    // Get all RSVPs for this meeting (optionId 1 = "Going")
    const rsvpUserIds: Id<"users">[] = await ctx.runQuery(
      internal.functions.eventBlasts.getRsvpUserIds,
      { meetingId: args.meetingId, optionId: 1 }
    );

    const communityId = groupInfo?.communityId as Id<"communities">;

    if (rsvpUserIds.length === 0) {
      await ctx.runMutation(internal.functions.eventBlasts.recordBlast, {
        meetingId: args.meetingId,
        groupId: args.groupId,
        communityId,
        sentById: args.userId,
        message: args.message,
        channels: args.channels,
        recipientCount: 0,
        status: "failed",
        results: { pushSucceeded: 0, pushFailed: 0, smsSucceeded: 0, smsFailed: 0 },
      });
      return { success: true, recipientCount: 0 };
    }

    const results = {
      pushSucceeded: 0,
      pushFailed: 0,
      smsSucceeded: 0,
      smsFailed: 0,
    };

    // Send push notifications
    if (args.channels.includes("push")) {
      const tokenResults: Array<{ userId: string; tokens: string[] }> =
        await ctx.runQuery(
          internal.functions.notifications.tokens.getActiveTokensForUsers,
          { userIds: rsvpUserIds }
        );

      const meetingTitle = meeting.title || "Event";
      const notifications = tokenResults.flatMap(
        (result: { userId: string; tokens: string[] }) =>
          result.tokens.map((token: string) => ({
            token,
            title: `Message from ${meetingTitle} host`,
            body: args.message,
            data: {
              type: "event_blast",
              groupId: args.groupId,
              communityId: groupInfo?.communityId,
              shortId: meeting.shortId,
              url: meeting.shortId
                ? `/e/${meeting.shortId}?source=app`
                : undefined,
            },
            imageUrl:
              senderInfo?.profilePhoto ||
              groupInfo?.groupPhotoUrl ||
              groupInfo?.communityLogoUrl ||
              groupInfo?.groupAvatarUrl,
          }))
      );

      if (notifications.length > 0) {
        const pushResult = await ctx.runAction(
          internal.functions.notifications.internal.sendBatchPushNotifications,
          { notifications }
        );
        results.pushSucceeded = pushResult.success ? notifications.length : 0;
        results.pushFailed = pushResult.success ? 0 : notifications.length;
      }
    }

    // Send SMS
    if (args.channels.includes("sms")) {
      const userPhones: Array<{ userId: string; phone: string | null }> =
        await ctx.runQuery(internal.functions.eventBlasts.getUserPhones, {
          userIds: rsvpUserIds,
        });

      const eventTitle = meeting.title || "Event";
      const eventUrl = meeting.shortId ? DOMAIN_CONFIG.eventShareUrl(meeting.shortId) : "";
      const smsPrefix = `The host of ${eventTitle} sent a new message:\n\n`;
      const smsSuffix = eventUrl ? `\n\n${eventUrl}` : "";
      // Twilio SMS limit is 1600 chars; truncate the user message to fit
      const maxBodyLen = 1600 - smsPrefix.length - smsSuffix.length;
      const truncatedMessage = args.message.length > maxBodyLen
        ? args.message.slice(0, maxBodyLen - 1) + "…"
        : args.message;
      const smsBody = smsPrefix + truncatedMessage + smsSuffix;

      for (const { phone } of userPhones) {
        if (!phone) continue;
        try {
          await ctx.runAction(
            internal.functions.auth.phoneOtp.sendSMS,
            { phone, message: smsBody }
          );
          results.smsSucceeded++;
        } catch {
          results.smsFailed++;
        }
      }
    }

    const totalSucceeded = results.pushSucceeded + results.smsSucceeded;
    const totalFailed = results.pushFailed + results.smsFailed;
    const status =
      totalSucceeded === 0 && totalFailed === 0
        ? "failed"
        : totalFailed === 0
          ? "sent"
          : totalSucceeded === 0
            ? "failed"
            : "partial";

    await ctx.runMutation(internal.functions.eventBlasts.recordBlast, {
      meetingId: args.meetingId,
      groupId: args.groupId,
      communityId,
      sentById: args.userId,
      message: args.message,
      channels: args.channels,
      recipientCount: rsvpUserIds.length,
      status,
      results,
    });

    return { success: true, recipientCount: rsvpUserIds.length, results };
  },
});

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Get user IDs who RSVPed with a specific option
 */
export const getRsvpUserIds = internalQuery({
  args: {
    meetingId: v.id("meetings"),
    optionId: v.number(),
  },
  handler: async (ctx, args) => {
    const rsvps = await ctx.db
      .query("meetingRsvps")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .filter((q) => q.eq(q.field("rsvpOptionId"), args.optionId))
      .collect();

    return rsvps.map((r) => r.userId);
  },
});

/**
 * Get sender info (name, profile photo) for blast notifications
 */
export const getSenderInfo = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;
    return {
      name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Someone",
      profilePhoto: getMediaUrl(user.profilePhoto) ?? null,
    };
  },
});

/**
 * Get phone numbers for a list of users
 */
export const getUserPhones = internalQuery({
  args: {
    userIds: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    const users = await Promise.all(args.userIds.map((id) => ctx.db.get(id)));
    return args.userIds.map((id, i) => ({
      userId: id,
      phone: users[i]?.phone || null,
    }));
  },
});

/**
 * Record a blast in the database
 */
export const recordBlast = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    groupId: v.id("groups"),
    communityId: v.id("communities"),
    sentById: v.id("users"),
    message: v.string(),
    channels: v.array(v.string()),
    recipientCount: v.number(),
    status: v.string(),
    results: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("eventBlasts", {
      meetingId: args.meetingId,
      groupId: args.groupId,
      communityId: args.communityId,
      sentById: args.sentById,
      message: args.message,
      channels: args.channels,
      recipientCount: args.recipientCount,
      status: args.status,
      results: args.results,
      createdAt: now(),
    });
  },
});
