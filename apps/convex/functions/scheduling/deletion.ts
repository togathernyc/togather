/**
 * Scheduling — destructive team/role deletion (roster grid right-click).
 *
 * A leader can delete a whole serving team or a single role from the roster
 * grid. Both follow the established soft-delete pattern (ADR-025): the team /
 * role is *archived* (`isArchived: true`), never hard-deleted, so historical
 * assignments on past events still resolve. What we DO hard-delete is the
 * forward-looking scheduling state — `neededRoles` rows and `roleAssignments`
 * on the group's UPCOMING plans only (event date >= start of today) — because a
 * deleted role/team must vanish from every upcoming event's roster. Past plans'
 * neededRoles/assignments are left intact so historical rosters survive.
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
  query,
  internalAction,
  internalQuery,
} from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
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

/** Start-of-today (local) cutoff — mirrors `roster.ts`'s upcoming convention. */
function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Collect the IDs of a group's UPCOMING plans (event date >= start of today),
 * fetched once so the cascade can test plan membership without an N+1 lookup
 * per `neededRoles` row.
 */
async function upcomingPlanIds(
  ctx: QueryCtx | MutationCtx,
  groupId: Id<"groups">,
): Promise<Set<Id<"eventPlans">>> {
  const cutoff = startOfTodayMs();
  const plans = await ctx.db
    .query("eventPlans")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
  return new Set(
    plans.filter((p) => p.eventDate >= cutoff).map((p) => p._id),
  );
}

/** The cascade's side effects the caller still needs after it runs. */
type CascadeResult = {
  /** Affected (user, role, date) tuples to text. Past + declined excluded. */
  removed: RemovedAssignment[];
  /**
   * Serving teams that lost at least one assignment — the caller schedules a
   * channel reconcile for each so team / cross-team channel membership stays
   * correct after the bulk delete (mirroring the assign / unassign paths).
   */
  affectedTeamIds: Set<Id<"teams">>;
};

/**
 * Delete `roleAssignments` + `neededRoles` for a set of roles across the
 * group's UPCOMING plans only, returning the affected (user, role, date)
 * tuples so the caller can notify them, plus the serving teams whose channel
 * membership must be reconciled. Past plans are left intact: their historical
 * rosters must survive and we must not text anyone about a service that
 * already happened.
 *
 * Only assignments whose `status !== "declined"` are reported — a volunteer
 * who already declined isn't "staffed" and shouldn't be texted. Shared by
 * `deleteRole` (one role) and `deleteTeam` (all the team's roles).
 *
 * `neededRoles` has no `by_role` index, so rather than scan the whole table we
 * query the pre-collected upcoming plans via `by_plan` (bounded by plan count)
 * and drop the rows whose `roleId` is in the doomed set.
 */
async function cascadeDeleteRoles(
  ctx: MutationCtx,
  roleIds: Set<Id<"teamRoles">>,
  roleNameById: Map<Id<"teamRoles">, string>,
  upcomingPlans: Set<Id<"eventPlans">>,
): Promise<CascadeResult> {
  const removed: RemovedAssignment[] = [];
  const affectedTeamIds = new Set<Id<"teams">>();
  const cutoff = startOfTodayMs();

  for (const roleId of roleIds) {
    // Assignments for this role across every plan (the `by_role` index spans
    // all plans). Filter to upcoming events by the denormalized `eventDate`.
    const assignments = await ctx.db
      .query("roleAssignments")
      .withIndex("by_role", (q) => q.eq("roleId", roleId))
      .collect();

    for (const a of assignments) {
      if (a.eventDate < cutoff) continue; // past event — leave the row intact
      if (a.status !== "declined") {
        removed.push({
          userId: a.userId,
          roleName: roleNameById.get(roleId) ?? "your role",
          eventDate: a.eventDate,
        });
      }
      // The team's channel membership is derived from its assignments, so a
      // deletion must trigger the same reconcile that assign / unassign run.
      affectedTeamIds.add(a.teamId);
      await ctx.db.delete(a._id);
    }
  }

  // neededRoles for the doomed roles, on upcoming plans only. `neededRoles`
  // has no `by_role` index — querying per upcoming plan (`by_plan`) and
  // filtering by roleId is bounded by plan count instead of scanning the
  // whole table.
  for (const planId of upcomingPlans) {
    const needed = await ctx.db
      .query("neededRoles")
      .withIndex("by_plan", (q) => q.eq("planId", planId))
      .collect();
    for (const n of needed) {
      if (!roleIds.has(n.roleId)) continue;
      await ctx.db.delete(n._id);
    }
  }

  return { removed, affectedTeamIds };
}

/**
 * Schedule the team-channel + cross-team-channel reconciliations for every
 * serving team that lost assignments in the cascade. Mirrors the assign /
 * unassign / publish trigger sites so channel membership stays correct after
 * a bulk delete. Best-effort and idempotent — the reconcile recomputes the
 * full desired set, so a doubled schedule is harmless.
 */
async function scheduleChannelReconcile(
  ctx: MutationCtx,
  teamIds: Set<Id<"teams">>,
): Promise<void> {
  for (const teamId of teamIds) {
    await ctx.scheduler.runAfter(
      0,
      internal.functions.scheduling.teamChannelSync.reconcileTeamChannel,
      { teamId },
    );
    await ctx.scheduler.runAfter(
      0,
      internal.functions.scheduling.teamChannelSync
        .reconcileCrossTeamChannelsForSource,
      { sourceTeamId: teamId },
    );
  }
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

    const upcomingPlans = await upcomingPlanIds(ctx, team.groupId);
    const { removed, affectedTeamIds } = await cascadeDeleteRoles(
      ctx,
      new Set([args.roleId]),
      new Map([[args.roleId, role.name]]),
      upcomingPlans,
    );

    await ctx.db.patch(args.roleId, { isArchived: true });

    // Reconcile each affected team's channel + any cross-team channel that
    // drew members via these assignments.
    await scheduleChannelReconcile(ctx, affectedTeamIds);

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

    const upcomingPlans = await upcomingPlanIds(ctx, team.groupId);
    const { removed, affectedTeamIds } = await cascadeDeleteRoles(
      ctx,
      roleIds,
      roleNameById,
      upcomingPlans,
    );

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

    // Reconcile cross-team channels (and any other auto-synced surface) that
    // drew members from this team's now-deleted assignments. The team's own
    // channel is already archived above (and `reconcileTeamChannel`
    // short-circuits for archived teams), but cross-team channels selecting
    // from it still need their membership recomputed — this runs the same
    // `reconcileCrossTeamChannelsForSource` the assign / unassign paths do.
    await scheduleChannelReconcile(ctx, affectedTeamIds);

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

/**
 * Count the people (and dates) who would be texted if a role / team were
 * deleted right now — used by the delete-confirm modal so its warning reflects
 * EVERY upcoming assignment, not just the columns the roster grid happens to
 * have loaded (it caps visible columns and hides past by default, so the
 * client-side grid count can undercount who actually gets the removal text).
 *
 * Counts non-declined assignments on the group's UPCOMING plans only — the
 * exact set `cascadeDeleteRoles` would remove + notify. A person serving on
 * several upcoming dates is counted once in `peopleCount`; `dates` lists the
 * distinct event dates. `names` is a small preview for the modal.
 *
 * Pass exactly one of `roleId` (single role) or `teamId` (all the team's live
 * roles). Auth: scheduler for the role/team's group — the response leaks
 * volunteer names, and this gates the same destructive action.
 */
export const affectedByDeletion = query({
  args: {
    token: v.string(),
    roleId: v.optional(v.id("teamRoles")),
    teamId: v.optional(v.id("teams")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    if ((args.roleId === undefined) === (args.teamId === undefined)) {
      throw new ConvexError("Pass exactly one of roleId or teamId");
    }

    // Resolve the target's group + the set of role IDs in scope, and authorize.
    let groupId: Id<"groups">;
    let roleIds: Set<Id<"teamRoles">>;
    if (args.roleId !== undefined) {
      const role = await ctx.db.get(args.roleId);
      if (!role) throw new ConvexError("Role not found");
      const team = await ctx.db.get(role.teamId);
      if (!team) throw new ConvexError("Team not found");
      await requireGroupScheduler(ctx, team.groupId, userId);
      groupId = team.groupId;
      roleIds = new Set([args.roleId]);
    } else {
      const team = await ctx.db.get(args.teamId!);
      if (!team) throw new ConvexError("Team not found");
      await requireGroupScheduler(ctx, team.groupId, userId);
      groupId = team.groupId;
      const roles = await ctx.db
        .query("teamRoles")
        .withIndex("by_team", (q) => q.eq("teamId", args.teamId!))
        .collect();
      roleIds = new Set(
        roles.filter((r) => r.isArchived !== true).map((r) => r._id),
      );
    }

    const upcoming = await upcomingPlanIds(ctx, groupId);
    const cutoff = startOfTodayMs();

    // Distinct affected people and dates across the doomed roles' upcoming,
    // non-declined assignments — exactly what the cascade would text about.
    const userIds = new Set<Id<"users">>();
    const dates = new Set<number>();
    for (const roleId of roleIds) {
      const assignments = await ctx.db
        .query("roleAssignments")
        .withIndex("by_role", (q) => q.eq("roleId", roleId))
        .collect();
      for (const a of assignments) {
        if (a.eventDate < cutoff) continue;
        if (!upcoming.has(a.planId)) continue;
        if (a.status === "declined") continue;
        userIds.add(a.userId);
        dates.add(a.eventDate);
      }
    }

    // A small name preview for the modal — bounded so a huge roster doesn't
    // build a giant array. The headline count comes from `peopleCount`.
    const NAME_PREVIEW_LIMIT = 20;
    const names: string[] = [];
    for (const id of userIds) {
      if (names.length >= NAME_PREVIEW_LIMIT) break;
      const user = await ctx.db.get(id);
      names.push(
        `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || "Someone",
      );
    }

    return {
      peopleCount: userIds.size,
      dates: [...dates].sort((a, b) => a - b),
      names,
    };
  },
});
