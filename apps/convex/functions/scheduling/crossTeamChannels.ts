/**
 * Cross-team channels — config mutations & queries
 *
 * A "cross-team channel" is a `chatChannels` row with
 * `channelType === "cross_team"`. It owns no roles or events of its own; its
 * membership is auto-synced — same rotation window and `event_plan` syncSource
 * as a serving-team channel — from `roleAssignments` across MULTIPLE source
 * serving-team channels. Each `crossTeamSync.selectors` entry pulls in everyone
 * assigned `roleId` on `sourceChannelId`, or — when `roleId` is omitted —
 * everyone assigned any role on that source team.
 *
 * The actual membership reconcile lives in `teamChannelSync.ts`
 * (`reconcileTeamChannelImpl`, which handles both serving-team and cross-team
 * channels). These functions only manage the channel's config and trigger a
 * reconcile after a change.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { isLeaderRole } from "../../lib/helpers";
import { generateChannelSlug } from "../../lib/slugs";
import { requireGroupMember, requireScheduler } from "./permissions";
import { reconcileTeamChannelImpl } from "./teamChannelSync";

/** Validator for a single cross-team membership selector. */
const selectorValidator = v.object({
  sourceChannelId: v.id("chatChannels"),
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
 * Validates each distinct source channel: it must exist, be a serving team,
 * and belong to the same community as the cross-team channel's home group —
 * so a selector cannot reach into another community's teams.
 *
 * Returns `isShared`/`sharedGroups` to persist on the channel. When every
 * source team is in the home group, `isShared` is false and `sharedGroups` is
 * cleared (an entirely same-campus cross-team channel needs no sharing).
 */
async function resolveCrossTeamSharing(
  ctx: MutationCtx,
  selectors: Array<{ sourceChannelId: Id<"chatChannels">; roleId?: Id<"teamRoles"> }>,
  homeGroupId: Id<"groups">,
  userId: Id<"users">,
): Promise<{ isShared: boolean; sharedGroups: SharedGroupEntry[] | undefined }> {
  const homeGroup = await ctx.db.get(homeGroupId);
  if (!homeGroup) {
    throw new ConvexError("Cross-team channel's home group not found.");
  }

  const sourceGroupIds = new Set<Id<"groups">>();
  const seenChannels = new Set<string>();
  for (const selector of selectors) {
    if (seenChannels.has(selector.sourceChannelId)) continue;
    seenChannels.add(selector.sourceChannelId);

    const sourceChannel = await ctx.db.get(selector.sourceChannelId);
    if (!sourceChannel) {
      throw new ConvexError("A selected source team no longer exists.");
    }
    if (sourceChannel.isServingTeam !== true) {
      throw new ConvexError(
        "A cross-team channel can only draw from serving teams.",
      );
    }
    if (!sourceChannel.groupId) {
      throw new ConvexError(
        "A selected source team is not attached to a campus group.",
      );
    }
    const sourceGroup = await ctx.db.get(sourceChannel.groupId);
    if (!sourceGroup || sourceGroup.communityId !== homeGroup.communityId) {
      throw new ConvexError(
        "Cross-team source teams must be in the same community.",
      );
    }
    sourceGroupIds.add(sourceChannel.groupId);
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
      crossTeamSync: { selectors: args.selectors },
      isShared,
      sharedGroups,
    });

    // Populate the channel's derived membership now rather than waiting for
    // the daily cron.
    await reconcileTeamChannelImpl(ctx, channelId);

    return { channelId, slug };
  },
});

/**
 * Update a cross-team channel's selectors and re-reconcile its membership.
 *
 * Auth: `requireScheduler` — channel admin/moderator, campus group leader, or
 * community admin.
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
    const channel = await requireScheduler(ctx, args.channelId, userId);

    if (channel.channelType !== "cross_team") {
      throw new ConvexError("Channel is not a cross-team channel");
    }
    if (args.selectors.length === 0) {
      throw new ConvexError("A cross-team channel needs at least one selector.");
    }
    if (!channel.groupId) {
      throw new ConvexError(
        "Cross-team channel is not attached to a campus group.",
      );
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
      crossTeamSync: { selectors: args.selectors },
      isShared,
      sharedGroups,
      updatedAt: Date.now(),
    });

    const result = await reconcileTeamChannelImpl(ctx, args.channelId);
    return {
      channelId: args.channelId,
      addedCount: result.added,
      removedCount: result.removed,
    };
  },
});

/**
 * List a campus group's cross-team channels, each with its selectors enriched
 * with the source team channel name and role name for UI display.
 *
 * Auth: an active member of the group, or a community admin — same read gate
 * as `listTeamChannels`.
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
            const sourceChannel = await ctx.db.get(selector.sourceChannelId);
            const role = selector.roleId
              ? await ctx.db.get(selector.roleId)
              : null;
            return {
              sourceChannelId: selector.sourceChannelId,
              sourceChannelName: sourceChannel?.name ?? "Unknown team",
              roleId: selector.roleId,
              roleName: role?.name ?? null,
            };
          }),
        );
        return {
          _id: channel._id,
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
