/**
 * Scheduling — destructive team/role deletion (roster grid right-click).
 *
 * A leader can delete a whole serving team or a single role from the roster
 * grid. Both follow the established soft-delete pattern (ADR-025): the team /
 * role is *archived* (`isArchived: true`), never hard-deleted, so historical
 * assignments on past events still resolve. What we DO hard-delete is the
 * forward-looking scheduling state — `neededRoles` rows and `roleAssignments`
 * across all of the group's plans — because a deleted role/team must vanish
 * from every upcoming event's roster.
 *
 * Anyone still staffed on a future event is texted that their role was
 * removed, reusing the exact SMS primitive the publish path uses
 * (`auth.phoneOtp.sendSMS`) — a mutation can't run an action, so we schedule
 * an internal action that resolves phones and fans out the texts, mirroring
 * `assignments.sendAssignmentRequests`.
 *
 * Auth: `requireGroupScheduler` for the role/team's group (group leader or
 * community admin). Calling either mutation when nobody is staffed simply
 * archives + cleans up and sends no texts.
 */

import { ConvexError, v } from "convex/values";
import {
  mutation,
  internalAction,
  internalQuery,
} from "../../_generated/server";
import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { requireAuth } from "../../lib/auth";
import { purgeSyncedMembers } from "./teamChannelSync";
import { requireGroupScheduler } from "./permissions";

/**
 * A person who lost a role on a specific upcoming event — the unit the
 * notification action texts about. Carried through the scheduler boundary by
 * value because the underlying `roleAssignments` rows are deleted before the
 * action runs.
 */
type RemovedAssignment = {
  userId: Id<"users">;
  roleName: string;
  /** Event date (ms) the role was removed for. */
  eventDate: number;
};

const removedAssignmentValidator = v.object({
  userId: v.id("users"),
  roleName: v.string(),
  eventDate: v.number(),
});

/**
 * Delete `roleAssignments` + `neededRoles` for a set of roles across all of a
 * group's plans, returning the affected (user, role, date) tuples so the
 * caller can notify them. Only assignments whose `status !== "declined"` are
 * reported — a volunteer who already declined isn't "staffed" and shouldn't be
 * texted. Shared by `deleteRole` (one role) and `deleteTeam` (all the team's
 * roles).
 */
async function cascadeDeleteRoles(
  ctx: MutationCtx,
  roleIds: Set<Id<"teamRoles">>,
  roleNameById: Map<Id<"teamRoles">, string>,
): Promise<RemovedAssignment[]> {
  const removed: RemovedAssignment[] = [];

  for (const roleId of roleIds) {
    // Assignments for this role across every plan (the `by_role` index spans
    // all plans, so we don't need to enumerate plans ourselves).
    const assignments = await ctx.db
      .query("roleAssignments")
      .withIndex("by_role", (q) => q.eq("roleId", roleId))
      .collect();

    for (const a of assignments) {
      if (a.status !== "declined") {
        removed.push({
          userId: a.userId,
          roleName: roleNameById.get(roleId) ?? "your role",
          eventDate: a.eventDate,
        });
      }
      await ctx.db.delete(a._id);
    }

    // neededRoles for this role (the `by_plan_team` index is plan-scoped, so
    // we filter the role's team rows by roleId — a small set per plan).
    const needed = await ctx.db
      .query("neededRoles")
      .filter((q) => q.eq(q.field("roleId"), roleId))
      .collect();
    for (const n of needed) {
      await ctx.db.delete(n._id);
    }
  }

  return removed;
}

/**
 * Delete a single role: archive the `teamRole`, remove its `neededRoles` +
 * `roleAssignments` across all plans, and text everyone who was staffed.
 *
 * Auth: scheduler for the role's group.
 */
export const deleteRole = mutation({
  args: {
    token: v.string(),
    roleId: v.id("teamRoles"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const role = await ctx.db.get(args.roleId);
    if (!role) {
      throw new ConvexError("Role not found");
    }
    const team = await ctx.db.get(role.teamId);
    if (!team) {
      throw new ConvexError("Team not found");
    }
    await requireGroupScheduler(ctx, team.groupId, userId);

    const removed = await cascadeDeleteRoles(
      ctx,
      new Set([args.roleId]),
      new Map([[args.roleId, role.name]]),
    );

    await ctx.db.patch(args.roleId, { isArchived: true });

    if (removed.length > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.scheduling.deletion.notifyRoleRemovals,
        { removed },
      );
    }

    return { roleId: args.roleId, notifiedCount: removed.length };
  },
});

/**
 * Delete a whole team: archive the `team` (and its chat channel, mirroring
 * `archiveTeam`), archive its non-archived roles, remove their `neededRoles` +
 * `roleAssignments` across all plans, and text everyone who was staffed.
 *
 * Auth: scheduler for the team's group.
 */
export const deleteTeam = mutation({
  args: {
    token: v.string(),
    teamId: v.id("teams"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const team = await ctx.db.get(args.teamId);
    if (!team) {
      throw new ConvexError("Team not found");
    }
    await requireGroupScheduler(ctx, team.groupId, userId);

    // The team's live (non-archived) roles — these get archived + cascaded.
    const roles = await ctx.db
      .query("teamRoles")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();
    const liveRoles = roles.filter((r) => r.isArchived !== true);

    const roleIds = new Set(liveRoles.map((r) => r._id));
    const roleNameById = new Map(liveRoles.map((r) => [r._id, r.name]));

    const removed = await cascadeDeleteRoles(ctx, roleIds, roleNameById);

    for (const r of liveRoles) {
      await ctx.db.patch(r._id, { isArchived: true });
    }

    // Archive the team + its chat channel exactly like `archiveTeam` does, so
    // we don't orphan or hard-break the channel.
    const now = Date.now();
    await ctx.db.patch(args.teamId, { isArchived: true, updatedAt: now });
    if (team.channelId) {
      await ctx.db.patch(team.channelId, {
        isArchived: true,
        archivedAt: now,
        updatedAt: now,
      });
      await purgeSyncedMembers(ctx, team.channelId);
    }

    if (removed.length > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.scheduling.deletion.notifyRoleRemovals,
        { removed },
      );
    }

    return { teamId: args.teamId, notifiedCount: removed.length };
  },
});

/**
 * Internal: resolve phones for users who lost a role and return one tuple per
 * (user, role, event date). Kept as a query so the action can read the DB.
 */
export const getRemovalPhones = internalQuery({
  args: { removed: v.array(removedAssignmentValidator) },
  handler: async (ctx, args) => {
    const out: Array<{
      phone: string;
      roleName: string;
      eventDate: number;
    }> = [];
    // Cache user lookups so a person staffed on several events is fetched once.
    const phoneByUser = new Map<Id<"users">, string | null>();
    for (const r of args.removed) {
      if (!phoneByUser.has(r.userId)) {
        const user = await ctx.db.get(r.userId);
        phoneByUser.set(r.userId, user?.phone ?? null);
      }
      const phone = phoneByUser.get(r.userId);
      if (phone) {
        out.push({ phone, roleName: r.roleName, eventDate: r.eventDate });
      }
    }
    return out;
  },
});

/**
 * Internal: text each affected person that their role was removed for a given
 * event date. Reuses the publish-path SMS primitive
 * (`auth.phoneOtp.sendSMS`); each send is best-effort. One message per
 * (user, role, date) removed.
 */
export const notifyRoleRemovals = internalAction({
  args: { removed: v.array(removedAssignmentValidator) },
  handler: async (ctx, args) => {
    const targets = await ctx.runQuery(
      internal.functions.scheduling.deletion.getRemovalPhones,
      { removed: args.removed },
    );

    let smsSent = 0;
    for (const t of targets) {
      const eventDate = new Date(t.eventDate).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      const message =
        `Your ${t.roleName} role for ${eventDate} has been removed.`;
      try {
        await ctx.runAction(internal.functions.auth.phoneOtp.sendSMS, {
          phone: t.phone,
          message,
        });
        smsSent += 1;
      } catch {
        // Best-effort: a failed text must not abort the rest of the fan-out.
      }
    }
    return { smsSent };
  },
});
