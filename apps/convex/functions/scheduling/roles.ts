/**
 * Scheduling — team roles
 *
 * `teamRoles` are free-form labels owned by a serving team (ADR-025 — a team
 * is a first-class `teams` row, no longer a chat channel). No global
 * taxonomy, no qualification rules — anyone in the team's campus group can be
 * assigned any of that team's roles.
 *
 * Archived roles stay on past events but are excluded from `listRoles` and
 * from new-event seeding.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { requireAuth } from "../../lib/auth";
import {
  requireTeam,
  requireTeamGroupMember,
  requireTeamScheduler,
} from "./permissions";
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
 * Create a role on a serving team.
 * New roles are appended after the current highest `sortOrder`.
 *
 * Auth: scheduler for the team.
 */
export const createRole = mutation({
  args: {
    token: v.string(),
    teamId: v.id("teams"),
    name: v.string(),
    color: v.optional(v.string()),
    defaultNeeded: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const team = await requireTeamScheduler(ctx, args.teamId, userId);

    const name = args.name.trim();
    if (!name) {
      throw new ConvexError("Role name cannot be empty");
    }

    const existing = await ctx.db
      .query("teamRoles")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();
    const nextSortOrder =
      existing.reduce((max, role) => Math.max(max, role.sortOrder), -1) + 1;

    const roleId = await ctx.db.insert("teamRoles", {
      teamId: args.teamId,
      communityId: team.communityId,
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
 * Auth: scheduler for the role's team.
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
    await requireTeamScheduler(ctx, role.teamId, userId);

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
 * Auth: scheduler for the role's team.
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
    await requireTeamScheduler(ctx, role.teamId, userId);

    await ctx.db.patch(args.roleId, { isArchived: args.archived ?? true });
    return { roleId: args.roleId };
  },
});

/**
 * Reorder a team's roles. `orderedRoleIds` must contain exactly the team's
 * roles; each role is assigned its index as the new `sortOrder`.
 *
 * Auth: scheduler for the team.
 */
export const reorderRoles = mutation({
  args: {
    token: v.string(),
    teamId: v.id("teams"),
    orderedRoleIds: v.array(v.id("teamRoles")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireTeamScheduler(ctx, args.teamId, userId);

    const roles = await ctx.db
      .query("teamRoles")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();
    const roleIds = new Set(roles.map((role) => role._id));

    if (args.orderedRoleIds.length !== roles.length) {
      throw new ConvexError(
        "orderedRoleIds must include every role on the team exactly once",
      );
    }
    for (const id of args.orderedRoleIds) {
      if (!roleIds.has(id)) {
        throw new ConvexError("orderedRoleIds contains a role from another team");
      }
    }

    await Promise.all(
      args.orderedRoleIds.map((id, index) =>
        ctx.db.patch(id, { sortOrder: index }),
      ),
    );
    return { teamId: args.teamId };
  },
});

/**
 * List a team's non-archived roles, sorted by display order.
 *
 * Auth: an active member of the team's campus group, or a community admin —
 * a private team's role list should not be enumerable by arbitrary
 * authenticated users.
 */
export const listRoles = query({
  args: {
    token: v.string(),
    teamId: v.id("teams"),
    /** Include archived roles too (default false). */
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireTeamGroupMember(ctx, args.teamId, userId);

    const roles = await ctx.db
      .query("teamRoles")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
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
 * Suggest a starter role set for a team, inferred from its name.
 * Pure convenience — the caller edits/dismisses before any `teamRoles` rows
 * are written.
 *
 * Auth: an active member of the team's campus group, or a community admin —
 * the response echoes the team name, so it is gated like other team-scoped
 * reads.
 */
export const suggestStarterRoles = query({
  args: {
    token: v.string(),
    teamId: v.id("teams"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    await requireTeamGroupMember(ctx, args.teamId, userId);
    const team = await requireTeam(ctx, args.teamId);

    return {
      teamName: team.name,
      roles: suggestStarterRolesForName(team.name),
    };
  },
});
