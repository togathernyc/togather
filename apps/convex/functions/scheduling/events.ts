/**
 * Scheduling — events & needed roles
 *
 * An `eventPlans` row is a dated rostering container owned by a campus group
 * (ADR-023). It is deliberately separate from `meetings` (Events-tab events);
 * an optional `meetingIds` array links the two when desired.
 *
 * `neededRoles` declare "we need N of role X" on an event. Fill summary
 * counts `confirmed` + `unconfirmed` assignments as filled — a `declined`
 * assignment does NOT count, so the slot stays open for the scheduler.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { MutationCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import {
  requireGroupScheduler,
  requirePlanScheduler,
} from "./permissions";

/** Statuses that consume a slot in fill-summary math (ADR-023). */
const FILLED_STATUSES = new Set(["confirmed", "unconfirmed"]);

/**
 * Resolve a serving-team channel and assert it belongs to `groupId`.
 *
 * Shared by every mutation that seeds `neededRoles` from a caller-supplied
 * `channelId` (`setNeededRoles`, `seedNeededRolesFromDefaults`). Without this
 * check a caller authorized for one group could declare a foreign team's
 * roles as needed and pull that team's volunteers into another group's
 * channel on publish.
 *
 * @throws ConvexError if the channel is missing, not a serving team, or
 *   belongs to a different group.
 */
async function requireGroupServingChannel(
  ctx: MutationCtx,
  channelId: Id<"chatChannels">,
  groupId: Id<"groups">,
): Promise<Doc<"chatChannels">> {
  const channel = await ctx.db.get(channelId);
  if (!channel) {
    throw new ConvexError("Channel not found");
  }
  if (channel.isServingTeam !== true) {
    throw new ConvexError("Channel is not a serving team");
  }
  if (channel.groupId !== groupId) {
    throw new ConvexError(
      "Team channel does not belong to this event's group",
    );
  }
  return channel;
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
    const newPlanId = await ctx.db.insert("eventPlans", {
      groupId: source.groupId,
      communityId: group.communityId,
      title: source.title,
      eventDate: source.eventDate + ONE_WEEK_MS,
      times: source.times,
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
          channelId: role.channelId,
          roleId: role.roleId,
          count: role.count,
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
      // rotation window — reconcile each affected channel so derived
      // membership updates now, not just on the daily cron (mirrors
      // deleteEvent / unassign).
      const channelIds = [...new Set(assignments.map((a) => a.channelId))];
      for (const channelId of channelIds) {
        await ctx.scheduler.runAfter(
          0,
          internal.functions.scheduling.teamChannelSync.reconcileTeamChannel,
          { channelId },
        );
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

    const [neededRoles, assignments] = await Promise.all([
      ctx.db
        .query("neededRoles")
        .withIndex("by_plan", (q) => q.eq("planId", args.planId))
        .collect(),
      ctx.db
        .query("roleAssignments")
        .withIndex("by_plan", (q) => q.eq("planId", args.planId))
        .collect(),
    ]);

    // Distinct team channels touched by this event's assignments — captured
    // before the deletes so we can reconcile them afterwards.
    const channelIds = [...new Set(assignments.map((a) => a.channelId))];

    await Promise.all([
      ...neededRoles.map((row) => ctx.db.delete(row._id)),
      ...assignments.map((row) => ctx.db.delete(row._id)),
    ]);
    await ctx.db.delete(args.planId);

    // Auto-sync each affected team channel so its derived membership drops
    // the now-deleted assignees immediately rather than waiting for the
    // daily cron — mirrors `unassign`'s reconcile trigger.
    for (const channelId of channelIds) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.scheduling.teamChannelSync.reconcileTeamChannel,
        { channelId },
      );
    }

    return {
      deletedNeededRoles: neededRoles.length,
      deletedAssignments: assignments.length,
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
        channelId: v.id("chatChannels"),
        roleId: v.id("teamRoles"),
        count: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const { plan } = await requirePlanScheduler(ctx, args.planId, userId);

    // Security: each channelId/roleId pair must be consistent and belong to
    // this event's group — otherwise a foreign team's role could be declared
    // as needed and pull volunteers into another group's channel on publish.
    for (const role of args.roles) {
      if (role.count <= 0) continue;
      const teamRole = await ctx.db.get(role.roleId);
      if (!teamRole) {
        throw new ConvexError("Role not found");
      }
      if (teamRole.channelId !== role.channelId) {
        throw new ConvexError(
          "Role does not belong to the specified team channel",
        );
      }
      await requireGroupServingChannel(ctx, role.channelId, plan.groupId);
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
        channelId: role.channelId,
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
 * non-archived role on the given team channels. Convenience for event setup;
 * roles with no `defaultNeeded` (or 0) are skipped.
 *
 * Auth: group leader or community admin for the event's group.
 */
export const seedNeededRolesFromDefaults = mutation({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
    channelIds: v.array(v.id("chatChannels")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const { plan } = await requirePlanScheduler(ctx, args.planId, userId);

    let written = 0;
    for (const channelId of args.channelIds) {
      // Security: only seed from serving-team channels that belong to this
      // event's group — same check `setNeededRoles` / `assignRole` enforce.
      await requireGroupServingChannel(ctx, channelId, plan.groupId);

      const roles = await ctx.db
        .query("teamRoles")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect();
      for (const role of roles) {
        if (role.isArchived === true) continue;
        const count = role.defaultNeeded ?? 0;
        if (count <= 0) continue;
        await ctx.db.insert("neededRoles", {
          planId: args.planId,
          channelId,
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
      channelId: needed.channelId,
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
 * Auth: any authenticated user.
 */
export const listEvents = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    /** Include events whose date is in the past (default false). */
    includePast: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.token);

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
 * Auth: any authenticated user.
 */
export const getEvent = query({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.token);

    const plan = await ctx.db.get(args.planId);
    if (!plan) return null;

    const [neededRoles, assignments] = await Promise.all([
      ctx.db
        .query("neededRoles")
        .withIndex("by_plan", (q) => q.eq("planId", args.planId))
        .collect(),
      ctx.db
        .query("roleAssignments")
        .withIndex("by_plan", (q) => q.eq("planId", args.planId))
        .collect(),
    ]);

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
          channelId: needed.channelId,
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
    };
  },
});

/** Midnight (local server time) at the start of today, in ms. */
function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
