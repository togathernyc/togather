/**
 * Availability requests
 *
 * A leader posts an availability request into a chat channel to collect "who
 * can serve which upcoming event". Like polls, the request lives in its own
 * table and is referenced by a host `chatMessages` row
 * (`contentType: "availability_request"`, `availabilityRequestId`) so it flows
 * through the existing chat list, push, and notification pipelines for free.
 *
 * The card lists the group's upcoming event plans and lets each member toggle
 * available/unavailable inline. Responses are written to `eventAvailability`
 * via `scheduling/availability.setMyAvailability` — the request itself only
 * snapshots *which* events to ask about. See ADR-023.
 */

import { v, ConvexError } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { requireAuth } from "../../lib/auth";
import { getDisplayName, getMediaUrl, generateShortId } from "../../lib/utils";
import { checkRateLimit } from "../../lib/rateLimit";
import { requireGroupScheduler, requireGroupMember } from "../scheduling/permissions";
import { assertCanPostInChannel } from "./polls";

const MAX_MESSAGE_LENGTH = 280;
/** Cap on how many upcoming events a single request asks about. */
const MAX_EVENTS = 12;

/** Midnight (local server time) at the start of today, in ms. */
function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Post an availability request as a message in the given channel.
 *
 * The owning group is derived from the channel (`channel.groupId`) so the
 * composer doesn't have to plumb a group id through. Auth: the sender must be
 * a scheduler (group leader / community admin) for that group AND be allowed to
 * post in the channel. Collecting availability is a leader action, so this is
 * gated more tightly than a plain message or poll.
 *
 * `planIds` is optional — when omitted we snapshot the group's next upcoming
 * events (capped at MAX_EVENTS). When provided, the ids are validated to
 * belong to the group.
 */
export const sendAvailabilityRequest = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    message: v.optional(v.string()),
    planIds: v.optional(v.array(v.id("eventPlans"))),
    viewingGroupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Share the message rate-limit bucket (20/min) — a request fans out to
    // every channel member exactly like a normal send.
    await checkRateLimit(ctx, `msg:${userId}`, 20, 60_000);

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError("Channel not found");
    }
    if (!channel.groupId) {
      throw new ConvexError(
        "Availability requests can only be sent in a group channel",
      );
    }
    const groupId = channel.groupId;
    const group = await requireGroupScheduler(ctx, groupId, userId);
    await assertCanPostInChannel(ctx, userId, channel, args.viewingGroupId);

    const message = args.message?.trim();
    if (message && message.length > MAX_MESSAGE_LENGTH) {
      throw new ConvexError(
        `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer`,
      );
    }

    // Resolve the event set: caller-supplied (validated) or upcoming snapshot.
    let planIds: Id<"eventPlans">[];
    if (args.planIds && args.planIds.length > 0) {
      const plans = await Promise.all(
        args.planIds.map((id) => ctx.db.get(id)),
      );
      const valid = plans.filter(
        (p): p is NonNullable<typeof p> =>
          p !== null && p.groupId === groupId,
      );
      if (valid.length === 0) {
        throw new ConvexError("No valid events for this group");
      }
      planIds = valid
        .sort((a, b) => a.eventDate - b.eventDate)
        .slice(0, MAX_EVENTS)
        .map((p) => p._id);
    } else {
      const cutoff = startOfTodayMs();
      const upcoming = (
        await ctx.db
          .query("eventPlans")
          .withIndex("by_group", (q) => q.eq("groupId", groupId))
          .collect()
      )
        .filter((p) => p.eventDate >= cutoff)
        .sort((a, b) => a.eventDate - b.eventDate)
        .slice(0, MAX_EVENTS);
      if (upcoming.length === 0) {
        throw new ConvexError(
          "There are no upcoming events to collect availability for",
        );
      }
      planIds = upcoming.map((p) => p._id);
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new ConvexError("User not found");
    }
    const senderName = getDisplayName(user.firstName, user.lastName);
    const senderProfilePhoto = getMediaUrl(user.profilePhoto);
    const now = Date.now();

    // Insert host message first, then the request, then back-pointer the
    // message — all in one transaction so readers never see an inconsistent
    // state (mirrors createPoll).
    const content = message || "Availability request";
    const messageId = await ctx.db.insert("chatMessages", {
      channelId: args.channelId,
      senderId: userId,
      content,
      contentType: "availability_request",
      createdAt: now,
      isDeleted: false,
      senderName,
      senderProfilePhoto,
      lastActivityAt: now,
    });

    const requestId = await ctx.db.insert("availabilityRequests", {
      channelId: args.channelId,
      messageId,
      groupId,
      communityId: group.communityId,
      authorId: userId,
      message: message || undefined,
      planIds,
      // Every request is shareable as a public `/a/<token>` link, whether or
      // not it was also posted to chat.
      publicToken: generateShortId(),
      createdAt: now,
    });

    await ctx.db.patch(messageId, { availabilityRequestId: requestId });

    const previewBase = "🗓️ Availability request";
    await ctx.db.patch(args.channelId, {
      lastMessageAt: now,
      lastMessagePreview: previewBase,
      lastMessageSenderId: userId,
      lastMessageSenderName: senderName,
      updatedAt: now,
    });

    // Same notification fan-out as a normal message.
    await ctx.scheduler.runAfter(
      0,
      internal.functions.messaging.events.onMessageSent,
      {
        messageId,
        channelId: args.channelId,
        senderId: userId,
      },
    );

    return { requestId, messageId };
  },
});

/**
 * Hydrate an availability request for its card: the leader's note plus each
 * snapshotted event with the *viewer's* current response. Used by
 * `AvailabilityRequestCardFromMessage`.
 *
 * Auth: an active member of the request's group (or community admin).
 */
export const getAvailabilityRequest = query({
  args: {
    token: v.string(),
    requestId: v.id("availabilityRequests"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const request = await ctx.db.get(args.requestId);
    if (!request) return null;
    await requireGroupMember(ctx, request.groupId, userId);

    // Viewer's responses across this group, keyed by plan.
    const myRows = await ctx.db
      .query("eventAvailability")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", request.groupId).eq("userId", userId),
      )
      .collect();
    const byPlan = new Map(myRows.map((r) => [r.planId as string, r]));

    const events = (
      await Promise.all(
        request.planIds.map(async (planId) => {
          const plan = await ctx.db.get(planId);
          if (!plan) return null;
          const row = byPlan.get(planId);
          return {
            _id: plan._id,
            title: plan.title,
            eventDate: plan.eventDate,
            times: plan.times,
            myStatus: (row?.status as "available" | "unavailable") ?? null,
          };
        }),
      )
    ).filter((e): e is NonNullable<typeof e> => e !== null);

    return {
      _id: request._id,
      groupId: request.groupId,
      message: request.message,
      authorId: request.authorId,
      events,
    };
  },
});
