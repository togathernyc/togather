/**
 * Cross-team channels — config mutations & queries
 *
 * A "cross-team channel" is a `chatChannels` row with
 * `channelType === "cross_team"`. It owns no roles or events of its own; its
 * membership is auto-synced — same rotation window and `event_plan` syncSource
 * as a serving team's channel — from `roleAssignments` across MULTIPLE source
 * serving teams (ADR-025 — a team is a first-class `teams` row). Each
 * `crossTeamSync.selectors` entry pulls in everyone assigned `roleId` on
 * `sourceTeamId`, or — when `roleId` is omitted — everyone assigned any role
 * on that source team.
 *
 * The actual membership reconcile lives in `teamChannelSync.ts`
 * (`reconcileCrossTeamChannelImpl`). These functions only manage the
 * channel's config and trigger a reconcile after a change.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { isLeaderRole } from "../../lib/helpers";
import { generateChannelSlug, getChannelSlug } from "../../lib/slugs";
import { getDisplayName, getMediaUrl } from "../../lib/utils";
import { updateChannelMemberCount } from "../messaging/helpers";
import { requireGroupMember, requireGroupScheduler } from "./permissions";
import {
  computeCrossTeamRoleMembers,
  reconcileCrossTeamChannelImpl,
} from "./teamChannelSync";

/** Validator for a single cross-team membership selector. */
const selectorValidator = v.object({
  sourceTeamId: v.id("teams"),
  roleId: v.optional(v.id("teamRoles")),
});

/** A single `chatChannels.sharedGroups` entry. */
type SharedGroupEntry = {
  groupId: Id<"groups">;
  status: "accepted";
  invitedById: Id<"users">;
  invitedAt: number;
  respondedById: Id<"users">;
  respondedAt: number;
};

/**
 * Resolve a cross-team channel's selectors into its channel-sharing config.
 *
 * A cross-team channel's source serving teams may live on OTHER campus groups
 * (e.g. a "Broadcast" channel drawing worship leaders from the Brooklyn AND
 * Manhattan campuses). For a synced member to see the channel nested under
 * their own campus in the inbox — rather than as a floating channel — the
 * channel is shared into every campus group that contributes a source team.
 *
 * Validates each distinct source team: it must exist and belong to the same
 * community as the cross-team channel's home group — so a selector cannot
 * reach into another community's teams.
 *
 * Returns `isShared`/`sharedGroups` to persist on the channel. When every
 * source team is in the home group, `isShared` is false and `sharedGroups` is
 * cleared (an entirely same-campus cross-team channel needs no sharing).
 */
async function resolveCrossTeamSharing(
  ctx: MutationCtx,
  selectors: Array<{ sourceTeamId: Id<"teams">; roleId?: Id<"teamRoles"> }>,
  homeGroupId: Id<"groups">,
  userId: Id<"users">,
): Promise<{ isShared: boolean; sharedGroups: SharedGroupEntry[] | undefined }> {
  const homeGroup = await ctx.db.get(homeGroupId);
  if (!homeGroup) {
    throw new ConvexError("Cross-team channel's home group not found.");
  }

  const sourceGroupIds = new Set<Id<"groups">>();
  const seenTeams = new Set<string>();
  for (const selector of selectors) {
    if (seenTeams.has(selector.sourceTeamId)) continue;
    seenTeams.add(selector.sourceTeamId);

    const sourceTeam = await ctx.db.get(selector.sourceTeamId);
    if (!sourceTeam) {
      throw new ConvexError("A selected source team no longer exists.");
    }
    if (sourceTeam.communityId !== homeGroup.communityId) {
      throw new ConvexError(
        "Cross-team source teams must be in the same community.",
      );
    }
    sourceGroupIds.add(sourceTeam.groupId);
  }

  const now = Date.now();
  const sharedGroups: SharedGroupEntry[] = [...sourceGroupIds]
    .filter((groupId) => groupId !== homeGroupId)
    .map((groupId) => ({
      groupId,
      status: "accepted" as const,
      invitedById: userId,
      invitedAt: now,
      respondedById: userId,
      respondedAt: now,
    }));

  return {
    isShared: sharedGroups.length > 0,
    sharedGroups: sharedGroups.length > 0 ? sharedGroups : undefined,
  };
}

/**
 * Create a cross-team channel and immediately populate its auto-synced
 * membership.
 *
 * Auth: `requireAuth`, then group-leader (matching `createCustomChannel`'s
 * creation gate). The creator is NOT added as a member — like an Event Team
 * channel, membership is purely auto-synced from event-plan assignments.
 *
 * Returns the new `channelId` and its generated `slug`.
 */
export const createCrossTeamChannel = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    name: v.string(),
    description: v.optional(v.string()),
    selectors: v.array(selectorValidator),
  },
  returns: v.object({
    channelId: v.id("chatChannels"),
    slug: v.string(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Creation gate — mirrors `createCustomChannel`: group leader only.
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId),
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();
    if (!groupMembership || !isLeaderRole(groupMembership.role)) {
      throw new ConvexError("Only group leaders can create cross-team channels.");
    }

    const trimmedName = args.name.trim();
    if (trimmedName.length < 1 || trimmedName.length > 50) {
      throw new ConvexError("Channel name must be 1-50 characters.");
    }
    if (!/[a-zA-Z0-9]/.test(trimmedName)) {
      throw new ConvexError(
        "Channel name must contain at least one letter or number.",
      );
    }
    if (args.selectors.length === 0) {
      throw new ConvexError("A cross-team channel needs at least one selector.");
    }

    // Unique slug among the group's channels — same approach as createChannel.
    const existingChannels = await ctx.db
      .query("chatChannels")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const existingSlugs = existingChannels
      .map((ch) => ch.slug)
      .filter((slug): slug is string => slug !== undefined);
    const slug = generateChannelSlug(trimmedName, existingSlugs);

    // Share the channel into every other campus group that contributes a
    // source team, so cross-campus synced members see it under their own
    // group. Also validates the selectors all point at same-community teams.
    const { isShared, sharedGroups } = await resolveCrossTeamSharing(
      ctx,
      args.selectors,
      args.groupId,
      userId,
    );

    const now = Date.now();
    const channelId = await ctx.db.insert("chatChannels", {
      groupId: args.groupId,
      slug,
      channelType: "cross_team",
      name: trimmedName,
      description: args.description,
      createdById: userId,
      createdAt: now,
      updatedAt: now,
      isArchived: false,
      memberCount: 0,
      crossTeamSync: {
        selectors: args.selectors.map((s) => ({
          sourceTeamId: s.sourceTeamId,
          roleId: s.roleId,
        })),
      },
      isShared,
      sharedGroups,
    });

    // Populate the channel's derived membership now rather than waiting for
    // the daily cron.
    await reconcileCrossTeamChannelImpl(ctx, channelId);

    return { channelId, slug };
  },
});

/**
 * Update a cross-team channel's selectors and re-reconcile its membership.
 *
 * Auth: `requireGroupScheduler` — campus group leader or community admin for
 * the channel's home group.
 */
export const updateCrossTeamChannel = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    selectors: v.array(selectorValidator),
  },
  returns: v.object({
    channelId: v.id("chatChannels"),
    addedCount: v.number(),
    removedCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError("Channel not found");
    }
    if (channel.channelType !== "cross_team") {
      throw new ConvexError("Channel is not a cross-team channel");
    }
    if (!channel.groupId) {
      throw new ConvexError(
        "Cross-team channel is not attached to a campus group.",
      );
    }
    await requireGroupScheduler(ctx, channel.groupId, userId);

    if (args.selectors.length === 0) {
      throw new ConvexError("A cross-team channel needs at least one selector.");
    }

    // Recompute channel sharing from the new selectors — a campus group may
    // have just been added to (or dropped from) the channel's source teams.
    const { isShared, sharedGroups } = await resolveCrossTeamSharing(
      ctx,
      args.selectors,
      channel.groupId,
      userId,
    );

    await ctx.db.patch(args.channelId, {
      crossTeamSync: {
        selectors: args.selectors.map((s) => ({
          sourceTeamId: s.sourceTeamId,
          roleId: s.roleId,
        })),
      },
      isShared,
      sharedGroups,
      updatedAt: Date.now(),
    });

    const result = await reconcileCrossTeamChannelImpl(ctx, args.channelId);
    return {
      channelId: args.channelId,
      addedCount: result.added,
      removedCount: result.removed,
    };
  },
});

/**
 * List a campus group's cross-team channels, each with its selectors enriched
 * with the source team name and role name for UI display.
 *
 * Auth: an active member of the group, or a community admin.
 */
export const listCrossTeamChannels = query({
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

    const crossTeam = channels.filter(
      (channel) => channel.channelType === "cross_team",
    );

    return Promise.all(
      crossTeam.map(async (channel) => {
        const selectors = await Promise.all(
          (channel.crossTeamSync?.selectors ?? []).map(async (selector) => {
            const sourceTeam = await ctx.db.get(selector.sourceTeamId);
            const role = selector.roleId
              ? await ctx.db.get(selector.roleId)
              : null;
            return {
              sourceTeamId: selector.sourceTeamId,
              sourceTeamName: sourceTeam?.name ?? "Unknown team",
              roleId: selector.roleId,
              roleName: role?.name ?? null,
            };
          }),
        );
        return {
          _id: channel._id,
          slug: getChannelSlug(channel),
          name: channel.name,
          description: channel.description,
          channelType: channel.channelType,
          memberCount: channel.memberCount,
          selectors,
        };
      }),
    );
  },
});

// ============================================================================
// Permanent members — manually pinned members of a cross-team channel
// ============================================================================
//
// A cross-team channel's roster is otherwise entirely auto-synced from event-
// plan role assignments (see `computeCrossTeamRoleMembers`). "Permanent"
// members are `chatChannelMembers` rows a leader pinned by hand
// (`isPermanent === true`); the reconcile engine never removes them. These
// mirror the team-keyed `addPermanentMember` / `removePermanentMember` in
// `teams.ts`, but are keyed on the cross-team `channelId` (which owns no
// `teams` row).

/**
 * Resolve a cross-team channel for a group leader, throwing `ConvexError` if
 * the channel is missing, not a cross-team channel, has no home group, or the
 * caller does not lead that group. Mirrors `createCrossTeamChannel`'s gate.
 */
async function requireCrossTeamChannelLeader(
  ctx: MutationCtx,
  channelId: Id<"chatChannels">,
  userId: Id<"users">,
): Promise<Doc<"chatChannels">> {
  const channel = await ctx.db.get(channelId);
  if (!channel) {
    throw new ConvexError("Channel not found");
  }
  if (channel.channelType !== "cross_team") {
    throw new ConvexError("Channel is not a cross-team channel");
  }
  const groupId = channel.groupId;
  if (!groupId) {
    throw new ConvexError(
      "Cross-team channel is not attached to a campus group.",
    );
  }
  const groupMembership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q) =>
      q.eq("groupId", groupId).eq("userId", userId),
    )
    .filter((q) => q.eq(q.field("leftAt"), undefined))
    .first();
  if (!groupMembership || !isLeaderRole(groupMembership.role)) {
    throw new ConvexError(
      "Only group leaders can manage cross-team channel members.",
    );
  }
  return channel;
}

/**
 * The active membership row for `(channelId, userId)`, or null. There is at
 * most one active (non-left) row per pair by construction.
 */
async function activeMembership(
  ctx: QueryCtx | MutationCtx,
  channelId: Id<"chatChannels">,
  userId: Id<"users">,
): Promise<Doc<"chatChannelMembers"> | null> {
  return ctx.db
    .query("chatChannelMembers")
    .withIndex("by_channel_user", (q) =>
      q.eq("channelId", channelId).eq("userId", userId),
    )
    .filter((q) => q.eq(q.field("leftAt"), undefined))
    .first();
}

/**
 * Channel Info membership for a cross-team channel, split into two sections:
 *
 *   - `permanentMembers`: active rows with `isPermanent === true` — the
 *     manually pinned members ("Added manually", removable).
 *   - `syncedRoleMembers`: derived live from `computeCrossTeamRoleMembers`,
 *     ONE entry per (user, role) they currently match ("Team · Role",
 *     read-only). A user matching two roles yields two entries.
 *
 * A member who is both pinned AND currently role-matched appears in BOTH lists
 * (the UI renders a card in each section). Auth: an active member of the
 * channel's home group, or a community admin.
 */
export const getCrossTeamChannelMembership = query({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  returns: v.object({
    permanentMembers: v.array(
      v.object({
        userId: v.id("users"),
        name: v.string(),
        avatarUrl: v.optional(v.string()),
      }),
    ),
    syncedRoleMembers: v.array(
      v.object({
        userId: v.id("users"),
        name: v.string(),
        avatarUrl: v.optional(v.string()),
        roleId: v.id("teamRoles"),
        roleName: v.string(),
        teamId: v.id("teams"),
        teamName: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError("Channel not found");
    }
    if (channel.channelType !== "cross_team") {
      throw new ConvexError("Channel is not a cross-team channel");
    }
    if (!channel.groupId) {
      throw new ConvexError(
        "Cross-team channel is not attached to a campus group.",
      );
    }
    await requireGroupMember(ctx, channel.groupId, userId);

    // --- Permanent (manually pinned) members ---------------------------
    const activeRows = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    const permanentMembers = await Promise.all(
      activeRows
        .filter((row) => row.isPermanent === true)
        .map(async (row) => {
          const user = await ctx.db.get(row.userId);
          return {
            userId: row.userId,
            name: user
              ? getDisplayName(user.firstName, user.lastName)
              : (row.displayName ?? "Unknown"),
            avatarUrl: user
              ? getMediaUrl(user.profilePhoto)
              : row.profilePhoto,
          };
        }),
    );

    // --- Synced-by-role members — one card per (user, role) ------------
    const assignments = await computeCrossTeamRoleMembers(ctx, channel);
    const seen = new Set<string>();
    const syncedRoleMembers: Array<{
      userId: Id<"users">;
      name: string;
      avatarUrl: string | undefined;
      roleId: Id<"teamRoles">;
      roleName: string;
      teamId: Id<"teams">;
      teamName: string;
    }> = [];
    for (const assignment of assignments) {
      const key = `${assignment.userId}:${assignment.roleId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const [user, role, team] = await Promise.all([
        ctx.db.get(assignment.userId),
        ctx.db.get(assignment.roleId),
        ctx.db.get(assignment.teamId),
      ]);
      syncedRoleMembers.push({
        userId: assignment.userId,
        name: user
          ? getDisplayName(user.firstName, user.lastName)
          : "Unknown",
        avatarUrl: user ? getMediaUrl(user.profilePhoto) : undefined,
        roleId: assignment.roleId,
        roleName: role?.name ?? "Unknown role",
        teamId: assignment.teamId,
        teamName: team?.name ?? "Unknown team",
      });
    }

    return { permanentMembers, syncedRoleMembers };
  },
});

/**
 * Pin a permanent member on a cross-team channel.
 *
 * Idempotent. If the user already has an active row (synced or manual) it is
 * flagged `isPermanent: true` — a role-synced member becomes ALSO permanent
 * without duplicating rows. A soft-left row is revived as a plain permanent
 * member; otherwise a fresh manual row is inserted.
 *
 * Auth: a leader of the channel's home group.
 */
export const addPermanentMemberToChannel = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    userId: v.id("users"),
  },
  returns: v.object({
    channelId: v.id("chatChannels"),
    userId: v.id("users"),
    added: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const callerId = await requireAuth(ctx, args.token);
    await requireCrossTeamChannelLeader(ctx, args.channelId, callerId);

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new ConvexError("User not found");
    }
    const displayName = getDisplayName(user.firstName, user.lastName);
    const profilePhoto = getMediaUrl(user.profilePhoto);

    const active = await activeMembership(ctx, args.channelId, args.userId);
    if (active) {
      // Already in the channel (synced or manual) — just pin them. Leaves any
      // `syncSource`/metadata intact so a synced member stays role-matched.
      await ctx.db.patch(active._id, { isPermanent: true });
      await updateChannelMemberCount(ctx, args.channelId);
      return { channelId: args.channelId, userId: args.userId, added: true };
    }

    // Revive a prior soft-left row as a plain permanent member, else insert.
    const softLeft = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", args.channelId).eq("userId", args.userId),
      )
      .first();
    if (softLeft) {
      await ctx.db.patch(softLeft._id, {
        leftAt: undefined,
        isPermanent: true,
        role: "member",
        syncSource: undefined,
        syncEventId: undefined,
        scheduledRemovalAt: undefined,
        syncMetadata: undefined,
        joinedAt: Date.now(),
        isMuted: false,
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
        isPermanent: true,
        displayName,
        profilePhoto,
      });
    }

    await updateChannelMemberCount(ctx, args.channelId);
    return { channelId: args.channelId, userId: args.userId, added: true };
  },
});

/**
 * Unpin a permanent member from a cross-team channel.
 *
 * Clears `isPermanent` on the user's active row, then decides whether they stay
 * in the channel based on their LIVE roster status — NOT the stale `syncSource`
 * tag. If they are still role-matched (`computeCrossTeamRoleMembers`), the row
 * stays active and they remain via their role; otherwise the row is soft-
 * removed and they leave the channel.
 *
 * (`syncSource` is unreliable here: the reconcile guard preserves a pinned row
 * with `syncSource === "event_plan"` long after the user left the roster window,
 * and a purely-permanent member can be live-rostered while keeping
 * `syncSource === undefined`. Only the live selector pass is authoritative.)
 *
 * Throws `ConvexError` if the user has no active row or is not permanent.
 * Auth: a leader of the channel's home group.
 */
export const removePermanentMemberFromChannel = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    userId: v.id("users"),
  },
  returns: v.object({
    channelId: v.id("chatChannels"),
    userId: v.id("users"),
    removed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const callerId = await requireAuth(ctx, args.token);
    const channel = await requireCrossTeamChannelLeader(
      ctx,
      args.channelId,
      callerId,
    );

    const active = await activeMembership(ctx, args.channelId, args.userId);
    if (!active || active.isPermanent !== true) {
      throw new ConvexError("That person is not a permanent member.");
    }

    const roleMembers = await computeCrossTeamRoleMembers(ctx, channel);
    const stillRoleMatched = roleMembers.some(
      (m) => m.userId === args.userId,
    );

    if (!stillRoleMatched) {
      // No live role match — unpinning removes them from the channel entirely.
      await ctx.db.patch(active._id, { isPermanent: false, leftAt: Date.now() });
    } else {
      // Still a live synced member — just unpin, leave the row active.
      await ctx.db.patch(active._id, { isPermanent: false });
    }

    await updateChannelMemberCount(ctx, args.channelId);
    return { channelId: args.channelId, userId: args.userId, removed: true };
  },
});
