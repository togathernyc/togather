/**
 * Event Chat functions
 *
 * Event chat channels let users who RSVP to an event access a chat scoped to
 * that event, reusing the existing `chatChannels` / `chatChannelMembers`
 * infrastructure. The event creator is the host (admin) and RSVPers are
 * auto-added as members. Channels are created on-demand via
 * `ensureEventChannel` and stay hidden from the inbox once an event is
 * sufficiently in the past (see `HIDE_AFTER_MS`).
 *
 * Permission model (v1):
 *   - Host: `meeting.createdById`.
 *   - Members: any user with a `meetingRsvps` row whose `rsvpOptionId`
 *     references an enabled option on the meeting.
 *
 * See ADR-022 and the event-chat spec for background.
 */

import { v } from "convex/values";
import { query, mutation, internalMutation } from "../../_generated/server";
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { requireAuth } from "../../lib/auth";
import { canEditMeeting } from "../../lib/meetingPermissions";
import { now } from "../../lib/utils";

// ============================================================================
// Constants
// ============================================================================

/** How long after an event's scheduledAt AND lastMessageAt before the channel is hidden from the inbox. Tune here. */
export const HIDE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

// ============================================================================
// Access helpers
// ============================================================================

/**
 * Does this user have access to this event chat channel?
 *
 * Returns false (caller should fall back to group-based access) if the
 * channel isn't an event channel or is missing its `meetingId`.
 *
 * v1: treat any RSVP row (with an enabled option) as chat access. Narrow
 * later if hosts want going-only.
 */
export async function canAccessEventChannel(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  channel: Doc<"chatChannels">,
): Promise<boolean> {
  if (channel.channelType !== "event") return false;
  if (!channel.meetingId) return false;

  const meeting = await ctx.db.get(channel.meetingId);
  if (!meeting) return false;

  // Host (event creator) always has access.
  if (meeting.createdById && userId === meeting.createdById) return true;

  // Otherwise, the user must have an RSVP row whose option is still enabled
  // on the meeting. v1: treat any RSVP row (with an enabled option) as chat
  // access. Narrow later if hosts want going-only.
  const rsvp = await ctx.db
    .query("meetingRsvps")
    .withIndex("by_meeting_user", (q) =>
      q.eq("meetingId", channel.meetingId!).eq("userId", userId),
    )
    .first();
  if (!rsvp) return false;

  const options = meeting.rsvpOptions ?? [];
  const matched = options.find((opt) => opt.id === rsvp.rsvpOptionId);
  return Boolean(matched && matched.enabled);
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Return the event chat channel for a given meeting, if the caller can see it.
 * Returns null when no channel exists yet or when the caller lacks access.
 */
export const getChannelByMeetingId = query({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const channel = await ctx.db
      .query("chatChannels")
      .withIndex("by_meetingId", (q) => q.eq("meetingId", args.meetingId))
      .first();

    if (!channel) return null;

    if (!(await canAccessEventChannel(ctx, userId, channel))) {
      return null;
    }

    return channel;
  },
});

// ============================================================================
// Internal mutations
// ============================================================================

/**
 * Idempotently create the chat channel for an event and seed its members.
 *
 * Call this the first time we need a channel for a meeting (e.g. on first
 * RSVP, or lazily when a host opens the chat UI). Safe to call repeatedly —
 * if a channel already exists for the meeting, the existing id is returned.
 */
export const ensureEventChannel = internalMutation({
  args: {
    meetingId: v.id("meetings"),
  },
  handler: async (ctx, args): Promise<Id<"chatChannels">> => {
    // Idempotency check.
    const existing = await ctx.db
      .query("chatChannels")
      .withIndex("by_meetingId", (q) => q.eq("meetingId", args.meetingId))
      .first();
    if (existing) return existing._id;

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) throw new Error("Meeting not found");

    if (!meeting.shortId) {
      throw new Error("Event is missing shortId — cannot create chat channel");
    }

    if (!meeting.createdById) {
      // createdById is optional in the schema but every modern meeting has one;
      // without it we can't seat a host and later permission checks break.
      throw new Error("Event is missing createdById — cannot create chat channel");
    }
    const hostUserId = meeting.createdById;

    const ts = now();

    const channelId = await ctx.db.insert("chatChannels", {
      groupId: meeting.groupId,
      slug: `event-${meeting.shortId}`,
      channelType: "event",
      name: meeting.title || "Event chat",
      createdById: hostUserId,
      createdAt: ts,
      updatedAt: ts,
      isArchived: false,
      isEnabled: true,
      meetingId: args.meetingId,
      memberCount: 0,
    });

    // Seat the host as admin.
    await ctx.db.insert("chatChannelMembers", {
      channelId,
      userId: hostUserId,
      role: "admin",
      syncSource: "event_rsvp",
      joinedAt: ts,
      isMuted: false,
    });

    // Seat every current RSVPer whose option is enabled.
    const rsvps = await ctx.db
      .query("meetingRsvps")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .collect();

    const enabledOptionIds = new Set(
      (meeting.rsvpOptions ?? [])
        .filter((opt) => opt.enabled)
        .map((opt) => opt.id),
    );

    let rsvpMemberCount = 0;
    for (const rsvp of rsvps) {
      if (rsvp.userId === hostUserId) continue; // host already seated
      if (!enabledOptionIds.has(rsvp.rsvpOptionId)) continue;

      await ctx.db.insert("chatChannelMembers", {
        channelId,
        userId: rsvp.userId,
        role: "member",
        syncSource: "event_rsvp",
        joinedAt: ts,
        isMuted: false,
      });
      rsvpMemberCount += 1;
    }

    await ctx.db.patch(channelId, {
      memberCount: 1 + rsvpMemberCount,
    });

    return channelId;
  },
});

/**
 * Add a user to the event chat for a meeting (e.g. when they RSVP).
 * No-op when the channel doesn't exist yet or the user is already a member.
 */
export const addEventChannelMember = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const channel = await ctx.db
      .query("chatChannels")
      .withIndex("by_meetingId", (q) => q.eq("meetingId", args.meetingId))
      .first();
    if (!channel) return;

    const existing = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", channel._id).eq("userId", args.userId),
      )
      .first();
    if (existing) return;

    await ctx.db.insert("chatChannelMembers", {
      channelId: channel._id,
      userId: args.userId,
      role: "member",
      syncSource: "event_rsvp",
      joinedAt: now(),
      isMuted: false,
    });

    await ctx.db.patch(channel._id, {
      memberCount: channel.memberCount + 1,
    });
  },
});

/**
 * Remove a user from the event chat for a meeting (e.g. when they un-RSVP).
 * The host is never removed. No-op when the channel or membership doesn't exist.
 */
export const removeEventChannelMember = internalMutation({
  args: {
    meetingId: v.id("meetings"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const channel = await ctx.db
      .query("chatChannels")
      .withIndex("by_meetingId", (q) => q.eq("meetingId", args.meetingId))
      .first();
    if (!channel) return;

    // Host always stays in the event chat.
    if (channel.createdById === args.userId) return;

    const member = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", channel._id).eq("userId", args.userId),
      )
      .first();
    if (!member) return;

    await ctx.db.delete(member._id);
    await ctx.db.patch(channel._id, {
      memberCount: Math.max(0, channel.memberCount - 1),
    });
  },
});

// ============================================================================
// Mutations (client-facing)
// ============================================================================

/**
 * Ensure the event chat channel exists and return its id + slug so the client
 * can route to the chat room. Called when a user taps "Chat" on the event
 * page — we eagerly materialize the channel here (rather than on first send)
 * because the chat room screen resolves channels by (groupId, slug) and has
 * no way to render a composer for a channel that doesn't exist yet.
 *
 * Access mirrors `canAccessEventChannel`: host OR any RSVPer whose option is
 * still enabled on the meeting.
 */
export const openEventChat = mutation({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ channelId: Id<"chatChannels">; slug: string }> => {
    const userId = await requireAuth(ctx, args.token);

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) throw new Error("Meeting not found");
    if (!meeting.shortId) {
      throw new Error("Event is missing shortId — cannot create chat channel");
    }

    // Access check — same rule as canAccessEventChannel but keyed off the
    // meeting since the channel may not exist yet.
    const isHost = meeting.createdById && meeting.createdById === userId;
    let hasAccess = Boolean(isHost);
    if (!hasAccess) {
      const rsvp = await ctx.db
        .query("meetingRsvps")
        .withIndex("by_meeting_user", (q) =>
          q.eq("meetingId", args.meetingId).eq("userId", userId),
        )
        .first();
      if (rsvp) {
        const matched = (meeting.rsvpOptions ?? []).find(
          (opt) => opt.id === rsvp.rsvpOptionId,
        );
        hasAccess = Boolean(matched && matched.enabled);
      }
    }
    if (!hasAccess) {
      throw new Error("You don't have access to this event's chat");
    }

    const channelId: Id<"chatChannels"> = await ctx.runMutation(
      internal.functions.messaging.eventChat.ensureEventChannel,
      { meetingId: args.meetingId },
    );

    return { channelId, slug: `event-${meeting.shortId}` };
  },
});

/**
 * Enable or disable an event chat channel. Disabling hides it from members
 * without destroying history; re-enabling restores access. Only the event
 * creator, group leaders, or community admins can toggle this (per ADR-022).
 */
export const setEventChannelEnabled = mutation({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
    enabled: v.boolean(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ channelId: Id<"chatChannels"> | null; enabled: boolean }> => {
    const userId = await requireAuth(ctx, args.token);

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) throw new Error("Meeting not found");

    if (!(await canEditMeeting(ctx, userId, meeting))) {
      throw new Error(
        "Only the event creator, group leaders, or community admins can manage the event chat",
      );
    }

    const channel = await ctx.db
      .query("chatChannels")
      .withIndex("by_meetingId", (q) => q.eq("meetingId", args.meetingId))
      .first();

    // Nothing to toggle if the channel hasn't been created yet.
    if (!channel) {
      return { channelId: null, enabled: args.enabled };
    }

    await ctx.db.patch(channel._id, {
      isEnabled: args.enabled,
      disabledByUserId: args.enabled ? undefined : userId,
      updatedAt: now(),
    });

    return { channelId: channel._id, enabled: args.enabled };
  },
});
