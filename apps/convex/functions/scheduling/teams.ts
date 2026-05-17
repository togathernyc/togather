/**
 * Scheduling — teams
 *
 * A "serving team" is just a chat channel with `isServingTeam = true`
 * (ADR-023, channel-as-team model). These functions opt a channel in/out of
 * being a team and list a campus group's team channels.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { requireAuth } from "../../lib/auth";
import { getDisplayName, getMediaUrl } from "../../lib/utils";
import { updateChannelMemberCount } from "../messaging/helpers";
import { isScheduler, requireGroupMember, requireScheduler } from "./permissions";

/**
 * Mark (or unmark) a channel as a serving team.
 *
 * Auth: channel admin/moderator, campus group leader, or community admin.
 * Returns the channel id and its new `isServingTeam` value.
 */
export const markChannelAsTeam = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    /** Defaults to `true` (mark as team). Pass `false` to unmark. */
    isTeam: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError("Channel not found");
    }
    if (!(await isScheduler(ctx, channel, userId))) {
      throw new ConvexError(
        "You must be a team admin, group leader, or community admin to set up a serving team",
      );
    }

    const isTeam = args.isTeam ?? true;
    await ctx.db.patch(args.channelId, {
      isServingTeam: isTeam,
      updatedAt: Date.now(),
    });

    return { channelId: args.channelId, isServingTeam: isTeam };
  },
});

/**
 * List the serving-team channels for a campus group.
 *
 * Auth: an active member of the group, or a community admin. Gating this
 * prevents an authenticated outsider from enumerating a private group's
 * team channel names and member counts.
 */
export const listTeamChannels = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireGroupMember(ctx, args.groupId, userId);

    const channels = await ctx.db
      .query("chatChannels")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    return channels
      .filter((channel) => channel.isServingTeam === true)
      .map((channel) => ({
        _id: channel._id,
        name: channel.name,
        channelType: channel.channelType,
        memberCount: channel.memberCount,
      }));
  },
});

// ============================================================================
// Permanent members
// ============================================================================
//
// An Event Team channel's day-to-day membership is auto-synced from event-plan
// assignments by `reconcileTeamChannel` — but that engine only ever touches
// `chatChannelMembers` rows tagged `syncSource === "event_plan"`. A "permanent
// member" is a `chatChannelMembers` row with NO `syncSource`: a leader added
// them by hand, and the rotation engine leaves them alone. They stay in the
// channel regardless of event plans, on top of whoever is auto-added.

/**
 * Add a permanent member to a (team) channel.
 *
 * Inserts a `chatChannelMembers` row with role `member` and no `syncSource`
 * so the auto-sync engine never removes it. Idempotent: if the user already
 * has an active membership row (synced or manual) this is a no-op — the goal
 * is simply "ensure the user is present in the channel".
 *
 * Auth: channel admin/moderator, campus group leader, or community admin.
 */
export const addPermanentMember = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const callerId = await requireAuth(ctx, args.token);
    await requireScheduler(ctx, args.channelId, callerId);

    const existing = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", args.userId),
      )
      .first();

    // Already present (active row, synced or manual) — nothing to do.
    if (existing && existing.leftAt === undefined) {
      return { channelId: args.channelId, userId: args.userId, added: false };
    }

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new ConvexError("User not found");
    }
    const displayName = getDisplayName(user.firstName, user.lastName);
    const profilePhoto = getMediaUrl(user.profilePhoto);

    if (existing) {
      // A previously soft-left row exists — revive it as a permanent member.
      await ctx.db.patch(existing._id, {
        leftAt: undefined,
        role: "member",
        syncSource: undefined,
        syncEventId: undefined,
        scheduledRemovalAt: undefined,
        syncMetadata: undefined,
        joinedAt: Date.now(),
        displayName,
        profilePhoto,
      });
    } else {
      await ctx.db.insert("chatChannelMembers", {
        channelId: args.channelId,
        userId: args.userId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
        displayName,
        profilePhoto,
      });
    }

    await updateChannelMemberCount(ctx, args.channelId);
    return { channelId: args.channelId, userId: args.userId, added: true };
  },
});

/**
 * Remove a permanent member from a (team) channel.
 *
 * Soft-removes (`leftAt`) the user's NON-synced membership row only. A synced
 * (`syncSource === "event_plan"`) row is never touched — it is owned by the
 * rotation engine and reflects a live event-plan assignment.
 *
 * Auth: channel admin/moderator, campus group leader, or community admin.
 */
export const removePermanentMember = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const callerId = await requireAuth(ctx, args.token);
    await requireScheduler(ctx, args.channelId, callerId);

    const rows = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", args.userId),
      )
      .collect();

    const manualRow = rows.find(
      (r) => r.leftAt === undefined && r.syncSource === undefined,
    );
    if (!manualRow) {
      throw new ConvexError("That person is not a permanent member.");
    }

    await ctx.db.patch(manualRow._id, { leftAt: Date.now() });
    await updateChannelMemberCount(ctx, args.channelId);
    return { channelId: args.channelId, userId: args.userId, removed: true };
  },
});

/**
 * List a (team) channel's permanent members — active rows with no
 * `syncSource`. Excludes auto-synced event-plan members.
 *
 * Auth: channel admin/moderator, campus group leader, or community admin.
 */
export const listPermanentMembers = query({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    const callerId = await requireAuth(ctx, args.token);
    await requireScheduler(ctx, args.channelId, callerId);

    const rows = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    const permanent = rows.filter((r) => r.syncSource === undefined);

    return Promise.all(
      permanent.map(async (row) => {
        const user = await ctx.db.get(row.userId);
        return {
          userId: row.userId,
          displayName: user
            ? getDisplayName(user.firstName, user.lastName)
            : (row.displayName ?? "Unknown"),
          profilePhoto: user
            ? getMediaUrl(user.profilePhoto)
            : row.profilePhoto,
          role: row.role,
          joinedAt: row.joinedAt,
        };
      }),
    );
  },
});
