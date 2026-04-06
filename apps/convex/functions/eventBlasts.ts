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
import { isActiveLeader } from "../lib/helpers";
import { now } from "../lib/utils";

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

    // Verify the user is a leader of the meeting's group
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return [];

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", meeting.groupId).eq("userId", userId),
      )
      .first();

    if (!isActiveLeader(membership)) return [];

    const blasts = await ctx.db
      .query("eventBlasts")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .collect();

    // Sort by createdAt desc
    blasts.sort((a, b) => b.createdAt - a.createdAt);

    // Batch fetch sender names
    const senderIds = [...new Set(blasts.map((b) => b.sentById))];
    const senders = await Promise.all(senderIds.map((id) => ctx.db.get(id)));
    const senderMap = new Map<string, string>();
    senders.forEach((sender, i) => {
      if (sender) {
        const name = `${sender.firstName || ""} ${sender.lastName || ""}`.trim() || "Someone";
        senderMap.set(senderIds[i], name);
      }
    });

    return blasts.map((blast) => ({
      _id: blast._id,
      message: blast.message,
      channels: blast.channels,
      recipientCount: blast.recipientCount,
      status: blast.status,
      results: blast.results,
      createdAt: blast.createdAt,
      sentByName: senderMap.get(blast.sentById) || "Unknown",
    }));
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

    // Verify leader
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", meeting.groupId).eq("userId", userId)
      )
      .first();

    if (!isActiveLeader(membership)) {
      throw new Error("Only group leaders can send event blasts");
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
            title: meetingTitle,
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

      for (const { phone } of userPhones) {
        if (!phone) continue;
        try {
          await ctx.runAction(
            internal.functions.auth.phoneOtp.sendSMS,
            { phone, message: args.message }
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
