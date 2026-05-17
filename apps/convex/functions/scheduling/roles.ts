/**
 * Scheduling — team roles
 *
 * `teamRoles` are free-form labels scoped to a serving-team channel
 * (ADR-023). No global taxonomy, no qualification rules — anyone in the
 * channel can be assigned any of that channel's roles.
 *
 * Archived roles stay on past events but are excluded from `listRoles` and
 * from new-event seeding.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { requireAuth } from "../../lib/auth";
import { requireChannelGroupMember, requireScheduler } from "./permissions";
import { suggestStarterRolesForName } from "./starterRoles";

/** Sort roles by `sortOrder`, then creation time as a stable tiebreaker. */
function bySortOrder<T extends { sortOrder: number; createdAt: number }>(
  a: T,
  b: T,
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.createdAt - b.createdAt;
}

/**
 * Create a role on a serving-team channel.
 * New roles are appended after the current highest `sortOrder`.
 *
 * Auth: scheduler for the channel.
 */
export const createRole = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    name: v.string(),
    color: v.optional(v.string()),
    defaultNeeded: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const channel = await requireScheduler(ctx, args.channelId, userId);

    const name = args.name.trim();
    if (!name) {
      throw new ConvexError("Role name cannot be empty");
    }

    const communityId =
      channel.communityId ??
      (channel.groupId
        ? (await ctx.db.get(channel.groupId))?.communityId
        : undefined);
    if (!communityId) {
      throw new ConvexError("Channel is not attached to a community");
    }

    const existing = await ctx.db
      .query("teamRoles")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .collect();
    const nextSortOrder =
      existing.reduce((max, role) => Math.max(max, role.sortOrder), -1) + 1;

    const roleId = await ctx.db.insert("teamRoles", {
      channelId: args.channelId,
      communityId,
      name,
      color: args.color,
      sortOrder: nextSortOrder,
      defaultNeeded: args.defaultNeeded,
      isArchived: false,
      createdAt: Date.now(),
      createdById: userId,
    });

    return { roleId };
  },
});

/**
 * Update a role's editable fields. Only provided fields change.
 *
 * Auth: scheduler for the role's channel.
 */
export const updateRole = mutation({
  args: {
    token: v.string(),
    roleId: v.id("teamRoles"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    defaultNeeded: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const role = await ctx.db.get(args.roleId);
    if (!role) {
      throw new ConvexError("Role not found");
    }
    await requireScheduler(ctx, role.channelId, userId);

    const patch: Partial<{
      name: string;
      color: string;
      defaultNeeded: number;
    }> = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) {
        throw new ConvexError("Role name cannot be empty");
      }
      patch.name = name;
    }
    if (args.color !== undefined) patch.color = args.color;
    if (args.defaultNeeded !== undefined) patch.defaultNeeded = args.defaultNeeded;

    await ctx.db.patch(args.roleId, patch);
    return { roleId: args.roleId };
  },
});

/**
 * Archive a role — it stays on past events but is hidden from `listRoles`
 * and excluded from new-event seeding (ADR-023).
 *
 * Auth: scheduler for the role's channel.
 */
export const archiveRole = mutation({
  args: {
    token: v.string(),
    roleId: v.id("teamRoles"),
    /** Pass `false` to un-archive. Defaults to `true`. */
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const role = await ctx.db.get(args.roleId);
    if (!role) {
      throw new ConvexError("Role not found");
    }
    await requireScheduler(ctx, role.channelId, userId);

    await ctx.db.patch(args.roleId, { isArchived: args.archived ?? true });
    return { roleId: args.roleId };
  },
});

/**
 * Reorder a channel's roles. `orderedRoleIds` must contain exactly the
 * channel's roles; each role is assigned its index as the new `sortOrder`.
 *
 * Auth: scheduler for the channel.
 */
export const reorderRoles = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    orderedRoleIds: v.array(v.id("teamRoles")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireScheduler(ctx, args.channelId, userId);

    const roles = await ctx.db
      .query("teamRoles")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .collect();
    const roleIds = new Set(roles.map((role) => role._id));

    if (args.orderedRoleIds.length !== roles.length) {
      throw new ConvexError(
        "orderedRoleIds must include every role on the channel exactly once",
      );
    }
    for (const id of args.orderedRoleIds) {
      if (!roleIds.has(id)) {
        throw new ConvexError("orderedRoleIds contains a role from another channel");
      }
    }

    await Promise.all(
      args.orderedRoleIds.map((id, index) =>
        ctx.db.patch(id, { sortOrder: index }),
      ),
    );
    return { channelId: args.channelId };
  },
});

/**
 * List a channel's non-archived roles, sorted by display order.
 *
 * Auth: an active member of the channel's campus group, or a community
 * admin — a private team's role list should not be enumerable by arbitrary
 * authenticated users.
 */
export const listRoles = query({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    /** Include archived roles too (default false). */
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireChannelGroupMember(ctx, args.channelId, userId);

    const roles = await ctx.db
      .query("teamRoles")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .collect();

    return roles
      .filter((role) => args.includeArchived || role.isArchived !== true)
      .sort(bySortOrder)
      .map((role) => ({
        _id: role._id,
        name: role.name,
        color: role.color,
        sortOrder: role.sortOrder,
        defaultNeeded: role.defaultNeeded,
        isArchived: role.isArchived === true,
      }));
  },
});

/**
 * Suggest a starter role set for a channel, inferred from its name.
 * Pure convenience — the caller edits/dismisses before any `teamRoles` rows
 * are written. Returns nothing if the channel does not exist.
 *
 * Auth: an active member of the channel's campus group, or a community
 * admin — the response echoes the channel name, so it is gated like other
 * channel-scoped reads.
 */
export const suggestStarterRoles = query({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const channel = await requireChannelGroupMember(
      ctx,
      args.channelId,
      userId,
    );

    return {
      channelName: channel.name,
      roles: suggestStarterRolesForName(channel.name),
    };
  },
});
