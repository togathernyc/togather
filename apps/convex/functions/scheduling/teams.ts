/**
 * Scheduling — teams
 *
 * A "serving team" is just a chat channel with `isServingTeam = true`
 * (ADR-023, channel-as-team model). These functions opt a channel in/out of
 * being a team and list a campus group's team channels.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { getDisplayName, getMediaUrl } from "../../lib/utils";
import { updateChannelMemberCount } from "../messaging/helpers";
import { isScheduler, requireGroupMember, requireScheduler } from "./permissions";
import { purgeSyncedMembers } from "./teamChannelSync";

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

    // Disabling the team flag: the rotation engine (`reconcileTeamChannel`)
    // early-returns for non-serving channels and the daily cron skips them,
    // so any currently auto-synced members would be stranded as active
    // members forever. Soft-remove them now and fix `memberCount`.
    let removedSyncedMembers = 0;
    if (!isTeam) {
      removedSyncedMembers = await purgeSyncedMembers(ctx, args.channelId);
    }

    return {
      channelId: args.channelId,
      isServingTeam: isTeam,
      removedSyncedMembers,
    };
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

/**
 * List every serving-team channel across the caller's community, organized by
 * the group that owns it and enriched with each team's (non-archived) roles.
 *
 * Powers the cross-team channel picker: a leader first narrows down which
 * groups to draw from, then picks roles from the teams in those groups. Only
 * groups that actually have a serving team are returned, so the picker never
 * lists groups with nothing to offer.
 *
 * Auth: an active member of `groupId` (the group the picker is opened from),
 * or a community admin — the same read gate as `listTeamChannels`.
 */
export const listCommunityServingTeams = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const group = await requireGroupMember(ctx, args.groupId, userId);

    const communityGroups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", group.communityId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    const result: Array<{
      group: { _id: Id<"groups">; name: string };
      teams: Array<{
        _id: Id<"chatChannels">;
        name: string;
        channelType: string;
        memberCount: number;
        roles: Array<{
          _id: Id<"teamRoles">;
          name: string;
          color?: string;
          sortOrder: number;
        }>;
      }>;
    }> = [];

    for (const g of communityGroups) {
      const channels = await ctx.db
        .query("chatChannels")
        .withIndex("by_group", (q) => q.eq("groupId", g._id))
        .filter((q) => q.eq(q.field("isArchived"), false))
        .collect();
      const teamChannels = channels.filter((c) => c.isServingTeam === true);
      if (teamChannels.length === 0) continue;

      const teams = await Promise.all(
        teamChannels.map(async (team) => {
          const roles = await ctx.db
            .query("teamRoles")
            .withIndex("by_channel", (q) => q.eq("channelId", team._id))
            .collect();
          return {
            _id: team._id,
            name: team.name,
            channelType: team.channelType,
            memberCount: team.memberCount,
            roles: roles
              .filter((role) => role.isArchived !== true)
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((role) => ({
                _id: role._id,
                name: role.name,
                color: role.color,
                sortOrder: role.sortOrder,
              })),
          };
        }),
      );

      result.push({ group: { _id: g._id, name: g.name }, teams });
    }

    // The picker's own group first, then alphabetical by group name.
    result.sort((a, b) => {
      if (a.group._id === args.groupId) return -1;
      if (b.group._id === args.groupId) return 1;
      return a.group.name.localeCompare(b.group.name);
    });

    return result;
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
