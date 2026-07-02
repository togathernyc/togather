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
import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { isLeaderRole } from "../../lib/helpers";
import { generateChannelSlug, getChannelSlug } from "../../lib/slugs";
import { requireGroupMember, requireGroupScheduler } from "./permissions";
import { reconcileCrossTeamChannelImpl } from "./teamChannelSync";

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
