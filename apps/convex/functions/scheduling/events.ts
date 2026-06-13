/**
 * Scheduling — events & needed roles
 *
 * An `eventPlans` row is a dated rostering container owned by a campus group
 * (ADR-023). It is deliberately separate from `meetings` (Events-tab events);
 * an optional `meetingIds` array links the two when desired.
 *
 * `neededRoles` declare "we need N of role X" on an event, keyed by the
 * serving team that owns the role (ADR-025 — a team is a first-class `teams`
 * row). Fill summary counts `confirmed` + `unconfirmed` assignments as
 * filled — a `declined` assignment does NOT count, so the slot stays open for
 * the scheduler.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { MutationCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import {
  requireGroupMember,
  requireGroupScheduler,
  requirePlanScheduler,
} from "./permissions";
import { hydrateItem } from "./eventItems";
import {
  scheduleUnconfirmedReminders,
  cancelUnconfirmedReminders,
} from "./assignments";

/** Statuses that consume a slot in fill-summary math (ADR-023). */
const FILLED_STATUSES = new Set(["confirmed", "unconfirmed"]);

/**
 * Resolve a serving team and assert it belongs to `groupId`.
 *
 * Shared by every mutation that seeds `neededRoles` from a caller-supplied
 * `teamId` (`setNeededRoles`, `seedNeededRolesFromDefaults`). Without this
 * check a caller authorized for one group could declare a foreign team's
 * roles as needed and pull that team's volunteers into another group's
 * channel on publish.
 *
 * @throws ConvexError if the team is missing or belongs to a different group.
 */
async function requireGroupTeam(
  ctx: MutationCtx,
  teamId: Id<"teams">,
  groupId: Id<"groups">,
): Promise<Doc<"teams">> {
  const team = await ctx.db.get(teamId);
  if (!team) {
    throw new ConvexError("Team not found");
  }
  if (team.groupId !== groupId) {
    throw new ConvexError("Team does not belong to this event's group");
  }
  return team;
}

const timeValidator = v.object({
  label: v.string(),
  startsAt: v.number(),
});

/**
 * Create a dated event for a campus group. New events start in `draft`.
 *
 * Auth: group leader or community admin.
 */
export const createEvent = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    title: v.string(),
    eventDate: v.number(),
    times: v.array(timeValidator),
    notes: v.optional(v.string()),
    meetingIds: v.optional(v.array(v.id("meetings"))),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const group = await requireGroupScheduler(ctx, args.groupId, userId);

    const title = args.title.trim();
    if (!title) {
      throw new ConvexError("Event title cannot be empty");
    }

    const nowMs = Date.now();
    const planId = await ctx.db.insert("eventPlans", {
      groupId: args.groupId,
      communityId: group.communityId,
      title,
      eventDate: args.eventDate,
      times: args.times,
      status: "draft",
      notes: args.notes,
      meetingIds: args.meetingIds,
      createdAt: nowMs,
      createdById: userId,
      updatedAt: nowMs,
    });

    return { planId };
  },
});

/** Seven days in milliseconds — duplicated events default to next week. */
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Duplicate an event plan as a structure-only copy. Copies the title, times,
 * notes, and needed roles; the new plan starts in `draft` one week after the
 * source. Assignees (`roleAssignments`), `meetingIds`, and `pcoPlanId` are
 * deliberately NOT copied — duplication seeds a fresh roster to fill.
 *
 * Auth: group leader or community admin for the event's group (same as
 * `createEvent`).
 */
export const duplicateEvent = mutation({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const source = await ctx.db.get(args.planId);
    if (!source) {
      throw new ConvexError("Event not found");
    }

    // Same auth as createEvent: group leader or community admin for the group.
    const group = await requireGroupScheduler(ctx, source.groupId, userId);

    const nowMs = Date.now();

    // Duplicates default to the source's next weekly occurrence. When the
    // source is in the past (duplicating an old plan to re-run it), roll
    // forward by whole weeks so the copy lands on the next *upcoming*
    // occurrence — same weekday and time-of-day — instead of another past
    // draft the leader would then have to reschedule by hand.
    let eventDate = source.eventDate + ONE_WEEK_MS;
    const todayStart = startOfTodayMs();
    if (eventDate < todayStart) {
      const weeksBehind = Math.ceil((todayStart - eventDate) / ONE_WEEK_MS);
      eventDate += weeksBehind * ONE_WEEK_MS;
    }

    // Shift each time's absolute `startsAt` by the same offset the event moved,
    // so the copied times stay aligned with the new date (the label, e.g.
    // "9:00 AM", is preserved).
    const dateDelta = eventDate - source.eventDate;
    const newPlanId = await ctx.db.insert("eventPlans", {
      groupId: source.groupId,
      communityId: group.communityId,
      title: source.title,
      eventDate,
      times: source.times.map((t) => ({ ...t, startsAt: t.startsAt + dateDelta })),
      status: "draft",
      notes: source.notes,
      createdAt: nowMs,
      createdById: userId,
      updatedAt: nowMs,
    });

    // Copy needed-role declarations; leave assignments unfilled.
    const neededRoles = await ctx.db
      .query("neededRoles")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .collect();
    await Promise.all(
      neededRoles.map((role) =>
        ctx.db.insert("neededRoles", {
          planId: newPlanId,
          teamId: role.teamId,
          roleId: role.roleId,
          count: role.count,
        }),
      ),
    );

    // Copy the run sheet structure (ADR-026), including the role-only
    // `assignments` links: they reference `teamRoles` (shared across plans), so
    // each "Who's involved" chip stays valid and simply resolves to the new
    // plan's roster (empty until it is filled).
    const items = await ctx.db
      .query("eventItems")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .collect();
    await Promise.all(
      items.map((item) =>
        ctx.db.insert("eventItems", {
          planId: newPlanId,
          communityId: item.communityId,
          segment: item.segment,
          sequence: item.sequence,
          type: item.type,
          title: item.title,
          description: item.description,
          durationSec: item.durationSec,
          notes: item.notes,
          assignments: item.assignments,
          songDetails: item.songDetails,
          songId: item.songId,
          createdAt: nowMs,
          createdById: userId,
          updatedAt: nowMs,
        }),
      ),
    );

    return { planId: newPlanId };
  },
});

/**
 * Update an event's editable fields. Only provided fields change.
 *
 * Auth: group leader or community admin for the event's group.
 */
export const updateEvent = mutation({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
    title: v.optional(v.string()),
    eventDate: v.optional(v.number()),
    times: v.optional(v.array(timeValidator)),
    notes: v.optional(v.string()),
    meetingIds: v.optional(v.array(v.id("meetings"))),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requirePlanScheduler(ctx, args.planId, userId);

    const existing = await ctx.db.get(args.planId);

    const patch: Partial<Doc<"eventPlans">> = { updatedAt: Date.now() };
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) {
        throw new ConvexError("Event title cannot be empty");
      }
      patch.title = title;
    }
    if (args.eventDate !== undefined) patch.eventDate = args.eventDate;
    if (args.times !== undefined) patch.times = args.times;
    if (args.notes !== undefined) patch.notes = args.notes;
    if (args.meetingIds !== undefined) patch.meetingIds = args.meetingIds;

    await ctx.db.patch(args.planId, patch);

    // Keep the denormalized eventDate on assignments in sync so double-booking
    // queries stay correct after an event is rescheduled.
    if (args.eventDate !== undefined) {
      const assignments = await ctx.db
        .query("roleAssignments")
        .withIndex("by_plan", (q) => q.eq("planId", args.planId))
        .collect();
      await Promise.all(
        assignments.map((assignment) =>
          ctx.db.patch(assignment._id, { eventDate: args.eventDate! }),
        ),
      );
      // Rescheduling can move the event in or out of the team-channel
      // rotation window — reconcile each affected team so derived
      // membership updates now, not just on the daily cron (mirrors
      // deleteEvent / unassign).
      const teamIds = [...new Set(assignments.map((a) => a.teamId))];
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

      // A published event that moves dates needs its unconfirmed-reminder
      // jobs cancelled and re-scheduled against the new date (and the
      // already-fired flags reset). The helper reads the freshly-patched
      // plan, so it picks up the new `eventDate`. Drafts have no jobs yet.
      const dateChanged =
        existing && existing.eventDate !== args.eventDate;
      if (existing?.status === "published" && dateChanged) {
        await scheduleUnconfirmedReminders(ctx, args.planId);
      }
    }

    return { planId: args.planId };
  },
});

/**
 * Delete an event, cascading to its `neededRoles` and `roleAssignments`
 * (ADR-023 — channel/event deletion must cascade).
 *
 * Auth: group leader or community admin for the event's group.
 */
export const deleteEvent = mutation({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requirePlanScheduler(ctx, args.planId, userId);

    const [neededRoles, assignments, items] = await Promise.all([
      ctx.db
        .query("neededRoles")
        .withIndex("by_plan", (q) => q.eq("planId", args.planId))
        .collect(),
      ctx.db
        .query("roleAssignments")
        .withIndex("by_plan", (q) => q.eq("planId", args.planId))
        .collect(),
      // Run sheet items cascade with the plan (ADR-026).
      ctx.db
        .query("eventItems")
        .withIndex("by_plan", (q) => q.eq("planId", args.planId))
        .collect(),
    ]);

    // Distinct serving teams touched by this event's assignments — captured
    // before the deletes so we can reconcile them afterwards.
    const teamIds = [...new Set(assignments.map((a) => a.teamId))];

    // Cancel any pending unconfirmed-reminder jobs before the plan goes away,
    // so they don't fire against a deleted event.
    const plan = await ctx.db.get(args.planId);
    if (plan) {
      await cancelUnconfirmedReminders(ctx, plan);
    }

    await Promise.all([
      ...neededRoles.map((row) => ctx.db.delete(row._id)),
      ...assignments.map((row) => ctx.db.delete(row._id)),
      ...items.map((row) => ctx.db.delete(row._id)),
    ]);
    await ctx.db.delete(args.planId);

    // Auto-sync each affected team channel so its derived membership drops
    // the now-deleted assignees immediately rather than waiting for the
    // daily cron — mirrors `unassign`'s reconcile trigger — plus any
    // cross-team channel that draws from those serving teams.
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

    return {
      deletedNeededRoles: neededRoles.length,
      deletedAssignments: assignments.length,
      deletedItems: items.length,
    };
  },
});

/**
 * Declare the needed roles for an event ("2 Drums, 4 Vocals"). This replaces
 * the event's full set of `neededRoles` with the provided list. A `count` of
 * 0 (or omitting a role) removes that need.
 *
 * Auth: group leader or community admin for the event's group.
 */
export const setNeededRoles = mutation({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
    roles: v.array(
      v.object({
        teamId: v.id("teams"),
        roleId: v.id("teamRoles"),
        count: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const { plan } = await requirePlanScheduler(ctx, args.planId, userId);

    // Security: each teamId/roleId pair must be consistent and belong to this
    // event's group — otherwise a foreign team's role could be declared as
    // needed and pull volunteers into another group's channel on publish.
    for (const role of args.roles) {
      if (role.count <= 0) continue;
      const teamRole = await ctx.db.get(role.roleId);
      if (!teamRole) {
        throw new ConvexError("Role not found");
      }
      if (teamRole.teamId !== role.teamId) {
        throw new ConvexError("Role does not belong to the specified team");
      }
      await requireGroupTeam(ctx, role.teamId, plan.groupId);
    }

    const existing = await ctx.db
      .query("neededRoles")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .collect();
    await Promise.all(existing.map((row) => ctx.db.delete(row._id)));

    let written = 0;
    for (const role of args.roles) {
      if (role.count <= 0) continue;
      await ctx.db.insert("neededRoles", {
        planId: args.planId,
        teamId: role.teamId,
        roleId: role.roleId,
        count: role.count,
      });
      written += 1;
    }

    return { planId: args.planId, neededRoleCount: written };
  },
});

/**
 * Seed an event's `neededRoles` from the `defaultNeeded` of every
 * non-archived role on the given serving teams. Convenience for event setup;
 * roles with no `defaultNeeded` (or 0) are skipped.
 *
 * Auth: group leader or community admin for the event's group.
 */
export const seedNeededRolesFromDefaults = mutation({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
    teamIds: v.array(v.id("teams")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const { plan } = await requirePlanScheduler(ctx, args.planId, userId);

    let written = 0;
    for (const teamId of args.teamIds) {
      // Security: only seed from serving teams that belong to this event's
      // group — same check `setNeededRoles` / `assignRole` enforce.
      await requireGroupTeam(ctx, teamId, plan.groupId);

      const roles = await ctx.db
        .query("teamRoles")
        .withIndex("by_team", (q) => q.eq("teamId", teamId))
        .collect();
      for (const role of roles) {
        if (role.isArchived === true) continue;
        const count = role.defaultNeeded ?? 0;
        if (count <= 0) continue;
        await ctx.db.insert("neededRoles", {
          planId: args.planId,
          teamId,
          roleId: role._id,
          count,
        });
        written += 1;
      }
    }

    return { planId: args.planId, neededRoleCount: written };
  },
});

/**
 * Compute per-role fill summaries for a plan from its needed roles and
 * assignments. `filled` counts `confirmed` + `unconfirmed`; `declined` is
 * excluded so a declined slot reads as open.
 */
function buildFillSummary(
  neededRoles: Doc<"neededRoles">[],
  assignments: Doc<"roleAssignments">[],
) {
  const filledByRole = new Map<string, number>();
  const confirmedByRole = new Map<string, number>();
  for (const assignment of assignments) {
    if (!FILLED_STATUSES.has(assignment.status)) continue;
    const key = assignment.roleId;
    filledByRole.set(key, (filledByRole.get(key) ?? 0) + 1);
    if (assignment.status === "confirmed") {
      confirmedByRole.set(key, (confirmedByRole.get(key) ?? 0) + 1);
    }
  }

  let totalNeeded = 0;
  let totalFilled = 0;
  let totalConfirmed = 0;
  const roles = neededRoles.map((needed) => {
    const filled = filledByRole.get(needed.roleId) ?? 0;
    const confirmed = confirmedByRole.get(needed.roleId) ?? 0;
    totalNeeded += needed.count;
    // Over-assignment shouldn't make the event look >100% filled.
    totalFilled += Math.min(filled, needed.count);
    totalConfirmed += Math.min(confirmed, needed.count);
    return {
      roleId: needed.roleId,
      teamId: needed.teamId,
      needed: needed.count,
      filled,
      confirmed,
      open: Math.max(0, needed.count - filled),
    };
  });

  return { roles, totalNeeded, totalFilled, totalConfirmed };
}

/**
 * List a group's events, upcoming first, each with a fill summary.
 *
 * Auth: an active member of the group, or a community admin. Gating prevents
 * an authenticated outsider from reading a private group's event plans,
 * dates, notes, and fill summaries by supplying its `groupId`.
 */
export const listEvents = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    /** Include events whose date is in the past (default false). */
    includePast: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireGroupMember(ctx, args.groupId, userId);

    const plans = await ctx.db
      .query("eventPlans")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    const cutoff = startOfTodayMs();
    const visible = plans
      .filter((plan) => args.includePast || plan.eventDate >= cutoff)
      .sort((a, b) => a.eventDate - b.eventDate);

    return Promise.all(
      visible.map(async (plan) => {
        const [neededRoles, assignments] = await Promise.all([
          ctx.db
            .query("neededRoles")
            .withIndex("by_plan", (q) => q.eq("planId", plan._id))
            .collect(),
          ctx.db
            .query("roleAssignments")
            .withIndex("by_plan", (q) => q.eq("planId", plan._id))
            .collect(),
        ]);
        const fill = buildFillSummary(neededRoles, assignments);
        return {
          _id: plan._id,
          title: plan.title,
          eventDate: plan.eventDate,
          times: plan.times,
          status: plan.status,
          notes: plan.notes,
          fillSummary: fill,
        };
      }),
    );
  },
});

/**
 * Get a single event with its needed roles and assignments grouped by role.
 *
 * Auth: an active member of the event's group, or a community admin. Gating
 * prevents an authenticated outsider from reading another group's event
 * details — assignee names, statuses, and decline notes — via a guessed
 * `planId`.
 */
export const getEvent = query({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const plan = await ctx.db.get(args.planId);
    if (!plan) return null;

    await requireGroupMember(ctx, plan.groupId, userId);

    const [neededRoles, assignments, rawItems] = await Promise.all([
      ctx.db
        .query("neededRoles")
        .withIndex("by_plan", (q) => q.eq("planId", args.planId))
        .collect(),
      ctx.db
        .query("roleAssignments")
        .withIndex("by_plan", (q) => q.eq("planId", args.planId))
        .collect(),
      ctx.db
        .query("eventItems")
        .withIndex("by_plan", (q) => q.eq("planId", args.planId))
        .collect(),
    ]);

    // Run sheet items with their linked library song joined (ADR-027), in the
    // same before → during → after, then sequence, order as `listItems`.
    const SEGMENT_RANK: Record<string, number> = { before: 0, during: 1, after: 2 };
    const segRank = (s: string | undefined) => SEGMENT_RANK[s ?? "during"] ?? 1;
    rawItems.sort(
      (a, b) => segRank(a.segment) - segRank(b.segment) || a.sequence - b.sequence,
    );
    const items = await Promise.all(rawItems.map((item) => hydrateItem(ctx, item)));

    const fill = buildFillSummary(neededRoles, assignments);
    const fillByRole = new Map(fill.roles.map((r) => [r.roleId as string, r]));

    // Group assignments by role and join in volunteer display info.
    const assignmentsByRole = new Map<
      string,
      Array<{
        _id: Id<"roleAssignments">;
        userId: Id<"users">;
        userName: string;
        status: string;
        timeLabel?: string;
        declineNote?: string;
      }>
    >();
    for (const assignment of assignments) {
      const user = await ctx.db.get(assignment.userId);
      const userName =
        `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || "Someone";
      const list = assignmentsByRole.get(assignment.roleId) ?? [];
      list.push({
        _id: assignment._id,
        userId: assignment.userId,
        userName,
        status: assignment.status,
        timeLabel: assignment.timeLabel,
        declineNote: assignment.declineNote,
      });
      assignmentsByRole.set(assignment.roleId, list);
    }

    const roles = await Promise.all(
      neededRoles.map(async (needed) => {
        const role = await ctx.db.get(needed.roleId);
        const summary = fillByRole.get(needed.roleId);
        return {
          roleId: needed.roleId,
          teamId: needed.teamId,
          roleName: role?.name ?? "Role",
          roleColor: role?.color,
          needed: needed.count,
          filled: summary?.filled ?? 0,
          open: summary?.open ?? needed.count,
          assignments: assignmentsByRole.get(needed.roleId) ?? [],
        };
      }),
    );

    return {
      _id: plan._id,
      groupId: plan.groupId,
      title: plan.title,
      eventDate: plan.eventDate,
      times: plan.times,
      status: plan.status,
      notes: plan.notes,
      meetingIds: plan.meetingIds,
      fillSummary: { totalNeeded: fill.totalNeeded, totalFilled: fill.totalFilled },
      roles,
      items,
    };
  },
});

/**
 * Whether a group has any native run sheet to show — i.e. at least one
 * `eventPlan` that has at least one `eventItem` (ADR-026). Used to decide
 * whether the "Run Sheet" toolbar tool should surface for a non-PCO group.
 *
 * Auth: like `hasAutoChannels`, this gates on group membership but returns
 * `false` (rather than throwing) for non-members so the toolbar filter can
 * call it for everyone without breaking outsiders / loading states.
 */
export const groupHasRunSheet = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId),
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();
    if (!membership) return false;

    const plans = await ctx.db
      .query("eventPlans")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    // Only count upcoming plans: the native run-sheet tool renders
    // `listEvents` (upcoming-only), so a group whose only run-sheet items live
    // on past plans would otherwise show the tool but open to an empty
    // "No upcoming event plans" state. Match that cutoff here.
    const cutoff = startOfTodayMs();
    for (const plan of plans) {
      if (plan.eventDate < cutoff) continue;
      const firstItem = await ctx.db
        .query("eventItems")
        .withIndex("by_plan", (q) => q.eq("planId", plan._id))
        .first();
      if (firstItem) return true;
    }

    return false;
  },
});

/** Midnight (local server time) at the start of today, in ms. */
function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
