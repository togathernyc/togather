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
import {
  canEditMeeting,
  getHostUserIds,
  isMeetingHost,
  resolveEventAdmins,
} from "../../lib/meetingPermissions";
import { isActiveLeader } from "../../lib/helpers";
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

  // Hosts always have access. When the event is delegated (hostUserIds is
  // explicitly empty), leaders of the hosting group are the effective host
  // and also get auto-access. When there's an explicit host, leaders must
  // RSVP or add themselves as a host to join the channel.
  if (isMeetingHost(meeting, userId)) return true;

  if (getHostUserIds(meeting).length === 0) {
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", meeting.groupId).eq("userId", userId),
      )
      .first();
    if (isActiveLeader(membership)) return true;
  }

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

/**
 * Editor-only view of the channel state. Returns the real `isEnabled`
 * value regardless of whether the caller can access the chat itself —
 * leaders/admins who can edit the meeting may not be RSVPers/hosts and
 * would otherwise see `null` from `getChannelByMeetingId` whether the
 * channel is disabled or nonexistent. Without this distinction the edit
 * form defaults to "enabled" and a no-op toggle never fires the persist
 * mutation, making re-enable impossible from that screen.
 *
 * Returns `{ exists: false, isEnabled: true }` when no channel row exists
 * yet (matches the default state on first materialization).
 */
export const getChannelStateForEditor = query({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ exists: boolean; isEnabled: boolean } | null> => {
    const userId = await requireAuth(ctx, args.token);

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return null;

    if (!(await canEditMeeting(ctx, userId, meeting))) {
      return null;
    }

    const channel = await ctx.db
      .query("chatChannels")
      .withIndex("by_meetingId", (q) => q.eq("meetingId", args.meetingId))
      .first();

    if (!channel) {
      return { exists: false, isEnabled: true };
    }

    return { exists: true, isEnabled: channel.isEnabled !== false };
  },
});

// ============================================================================
// Internal mutations
// ============================================================================

/**
 * Idempotently create the chat channel for an event and seat its admins.
 *
 * Call this the first time we need a channel for a meeting (e.g. when an
 * admin opens the chat UI, or on the first blast). Safe to call repeatedly —
 * if a channel already exists for the meeting, the existing id is returned.
 *
 * Seating model: admins (hosts when set, otherwise the group's active
 * leaders — see `resolveEventAdmins`) are seated here. RSVPer members are
 * added lazily by `openEventChat` (they only become subscribers after
 * explicitly opening the chat), which prevents unrelated push notifications
 * and caps the write set for this mutation regardless of RSVP scale.
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

    const admins = await resolveEventAdmins(ctx, meeting);
    if (admins.length === 0) {
      // No hosts AND no active leaders — we'd create a channel with no
      // admin, which can't be moderated. Refuse rather than orphan it.
      throw new Error(
        "Event has no host and the hosting group has no active leaders — cannot create chat channel",
      );
    }

    const ts = now();

    const channelId = await ctx.db.insert("chatChannels", {
      groupId: meeting.groupId,
      slug: `event-${meeting.shortId}`,
      channelType: "event",
      name: meeting.title || "Event chat",
      // `createdById` on the channel is metadata — set to the first admin so
      // existing UI that reads it has a real user to surface. Authority lives
      // on `chatChannelMembers.role === "admin"`.
      createdById: admins[0],
      createdAt: ts,
      updatedAt: ts,
      isArchived: false,
      isEnabled: true,
      meetingId: args.meetingId,
      memberCount: admins.length,
    });

    // Seat every admin. RSVPer members are seated lazily by openEventChat.
    for (const userId of admins) {
      await ctx.db.insert("chatChannelMembers", {
        channelId,
        userId,
        role: "admin",
        syncSource: "event_rsvp",
        joinedAt: ts,
        isMuted: false,
      });
    }

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
 * Admins (hosts / leaders in delegated mode) are never removed — un-RSVP
 * only drops "member"-role seats. No-op when the channel or membership
 * doesn't exist.
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

    const member = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", channel._id).eq("userId", args.userId),
      )
      .first();
    if (!member) return;

    // Admins stay — un-RSVP only removes "member"-role seats.
    if (member.role === "admin") return;

    await ctx.db.delete(member._id);
    await ctx.db.patch(channel._id, {
      memberCount: Math.max(0, channel.memberCount - 1),
    });
  },
});

/**
 * Reconcile the event chat's admin seating after hosts change. Called from
 * updateMeeting when `hostUserIds` is modified. No-op when the channel
 * doesn't exist yet (the next `ensureEventChannel` will use current hosts).
 *
 * Reconciliation:
 *   - Users who are now admins but missing → seat as admin.
 *   - Users who are now admins but already present as "member" → promote.
 *   - Users who are no longer admins but remain in the channel:
 *     - If they have a valid RSVP → demote to "member".
 *     - Otherwise → remove from channel.
 */
export const reconcileEventChannelAdmins = internalMutation({
  args: {
    meetingId: v.id("meetings"),
  },
  handler: async (ctx, args) => {
    const channel = await ctx.db
      .query("chatChannels")
      .withIndex("by_meetingId", (q) => q.eq("meetingId", args.meetingId))
      .first();
    if (!channel) return;

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return;

    const targetAdmins = await resolveEventAdmins(ctx, meeting);
    const targetSet = new Set(targetAdmins.map((id) => String(id)));

    const members = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .collect();
    const currentById = new Map(members.map((m) => [String(m.userId), m]));

    const rsvpOptions = meeting.rsvpOptions ?? [];
    const ts = now();
    let memberDelta = 0;

    // Seat missing admins; promote existing members.
    for (const userId of targetAdmins) {
      const existing = currentById.get(String(userId));
      if (!existing) {
        await ctx.db.insert("chatChannelMembers", {
          channelId: channel._id,
          userId,
          role: "admin",
          syncSource: "event_rsvp",
          joinedAt: ts,
          isMuted: false,
        });
        memberDelta += 1;
      } else if (existing.role !== "admin") {
        await ctx.db.patch(existing._id, { role: "admin" });
      }
    }

    // Demote or remove users who are no longer admins.
    for (const member of members) {
      if (member.role !== "admin") continue;
      if (targetSet.has(String(member.userId))) continue;

      const rsvp = await ctx.db
        .query("meetingRsvps")
        .withIndex("by_meeting_user", (q) =>
          q.eq("meetingId", args.meetingId).eq("userId", member.userId),
        )
        .first();
      const hasActiveRsvp = rsvp
        ? Boolean(
            rsvpOptions.find((opt) => opt.id === rsvp.rsvpOptionId && opt.enabled),
          )
        : false;

      if (hasActiveRsvp) {
        await ctx.db.patch(member._id, { role: "member" });
      } else {
        await ctx.db.delete(member._id);
        memberDelta -= 1;
      }
    }

    if (memberDelta !== 0) {
      await ctx.db.patch(channel._id, {
        memberCount: Math.max(0, channel.memberCount + memberDelta),
        updatedAt: ts,
      });
    }
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
    const isHost = isMeetingHost(meeting, userId);
    let isAdmin = isHost;

    // In delegated mode (no explicit host), leaders are the effective host
    // and get admin access — mirror the seating logic in ensureEventChannel.
    if (!isAdmin && getHostUserIds(meeting).length === 0) {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", meeting.groupId).eq("userId", userId),
        )
        .first();
      if (isActiveLeader(membership)) {
        isAdmin = true;
      }
    }

    let hasAccess = isAdmin;
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

    // Lazily seat the caller as a channel member if they aren't already.
    // Admins (hosts / delegated-mode leaders) were seated by
    // ensureEventChannel; RSVPers are seated only on their first
    // openEventChat so they don't start receiving push notifications for
    // events they haven't looked at.
    if (!isAdmin) {
      const existingMembership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", userId),
        )
        .first();

      if (!existingMembership) {
        await ctx.db.insert("chatChannelMembers", {
          channelId,
          userId,
          role: "member",
          syncSource: "event_rsvp",
          joinedAt: now(),
          isMuted: false,
        });
        const channel = await ctx.db.get(channelId);
        if (channel) {
          await ctx.db.patch(channelId, {
            memberCount: (channel.memberCount ?? 0) + 1,
          });
        }
      }
    }

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

    // Materialize the channel before patching so a host disabling chat
    // before any message has been sent still persists. Otherwise ensureEventChannel
    // would lazy-create it with isEnabled: true on the first later send,
    // silently undoing the host's action.
    const channelId = await ctx.runMutation(
      internal.functions.messaging.eventChat.ensureEventChannel,
      { meetingId: args.meetingId },
    );

    await ctx.db.patch(channelId, {
      isEnabled: args.enabled,
      disabledByUserId: args.enabled ? undefined : userId,
      updatedAt: now(),
    });

    return { channelId, enabled: args.enabled };
  },
});
