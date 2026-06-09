/**
 * Rostering matrix — the data spine for the leader roster grid (ADR-023
 * follow-up). One read joins `neededRoles` + `roleAssignments` +
 * `eventAvailability` across a group's upcoming event plans so the grid can
 * render BOTH orientations from a single payload:
 *
 *   - role-centric: roles (rows) × events (columns), cell = coverage
 *   - people-centric: members (rows) × events (columns), cell = assignment,
 *     shaded by that member's availability
 *
 * It's effectively `events.getEvent` fanned across N plans, plus the
 * `availability.availabilityMatrix` lens, shaped for the grid. Reuses the
 * settled fill math (confirmed + unconfirmed = filled; declined reopens) and
 * the same-UTC-day double-booking rule as the rest of scheduling.
 *
 * Scheduler-gated: it exposes the whole roster's assignments + availability.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { isLeaderRole } from "../../lib/helpers";
import { requireGroupScheduler } from "./permissions";

/** Column cap — matches availabilityMatrix; a leader rosters a horizon. */
const MAX_EVENTS = 10;
const MS_PER_DAY = 86_400_000;
/** Statuses that consume a slot (mirrors events.ts FILLED_STATUSES). */
const FILLED = new Set(["confirmed", "unconfirmed"]);

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
/** Local-day bucket for the double-booking rule (mirrors assignments.ts). */
function utcDayBucket(eventDate: number): number {
  return Math.floor(eventDate / MS_PER_DAY) * MS_PER_DAY;
}

type CellStatus = "confirmed" | "unconfirmed" | "declined";
type Availability = "available" | "unavailable" | "no_response";

export const rosterMatrix = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    /** Event-column cap; clamped to [1, MAX_EVENTS]. */
    limit: v.optional(v.number()),
    includePast: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireGroupScheduler(ctx, args.groupId, userId);

    const cap = Math.max(
      1,
      Math.min(Math.floor(args.limit ?? MAX_EVENTS), MAX_EVENTS),
    );
    const cutoff = startOfTodayMs();
    const plans = (
      await ctx.db
        .query("eventPlans")
        .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
        .collect()
    )
      .filter((p) => args.includePast || p.eventDate >= cutoff)
      .sort((a, b) => a.eventDate - b.eventDate)
      .slice(0, cap);

    const events = plans.map((p) => ({
      _id: p._id,
      title: p.title,
      eventDate: p.eventDate,
      times: p.times,
      status: p.status, // "draft" | "published" — AssignSheet needs this
    }));

    // --- Fan out the three per-plan reads. ---
    const perPlan = await Promise.all(
      plans.map(async (plan) => {
        const [neededRoles, assignments, availability] = await Promise.all([
          ctx.db
            .query("neededRoles")
            .withIndex("by_plan", (q) => q.eq("planId", plan._id))
            .collect(),
          ctx.db
            .query("roleAssignments")
            .withIndex("by_plan", (q) => q.eq("planId", plan._id))
            .collect(),
          ctx.db
            .query("eventAvailability")
            .withIndex("by_plan", (q) => q.eq("planId", plan._id))
            .collect(),
        ]);
        return { plan, neededRoles, assignments, availability };
      }),
    );

    // --- Resolve display names for every role and user referenced. ---
    const roleIds = new Set<string>();
    const userIds = new Set<string>();
    for (const { neededRoles, assignments } of perPlan) {
      for (const n of neededRoles) roleIds.add(n.roleId as string);
      for (const a of assignments) {
        roleIds.add(a.roleId as string);
        userIds.add(a.userId as string);
      }
    }
    const roleDocs = new Map<string, Doc<"teamRoles">>();
    await Promise.all(
      [...roleIds].map(async (rid) => {
        const doc = await ctx.db.get(rid as Id<"teamRoles">);
        if (doc) roleDocs.set(rid, doc);
      }),
    );
    const teamIds = new Set<string>();
    for (const doc of roleDocs.values()) teamIds.add(doc.teamId as string);
    const teamDocs = new Map<string, Doc<"teams">>();
    await Promise.all(
      [...teamIds].map(async (tid) => {
        const doc = await ctx.db.get(tid as Id<"teams">);
        if (doc) teamDocs.set(tid, doc);
      }),
    );

    const userName = (uid: string, u: Doc<"users"> | null): string =>
      `${u?.firstName ?? ""} ${u?.lastName ?? ""}`.trim() || "Someone";

    // --- Role-centric cells: keyed `${roleId}:${planId}`. ---
    const userDocs = new Map<string, Doc<"users"> | null>();
    await Promise.all(
      [...userIds].map(async (uid) => {
        userDocs.set(uid, await ctx.db.get(uid as Id<"users">));
      }),
    );

    const roleCells: Record<
      string,
      {
        needed: number;
        filled: number;
        confirmed: number;
        open: number;
        occupants: Array<{
          assignmentId: Id<"roleAssignments">;
          userId: Id<"users">;
          userName: string;
          status: CellStatus;
        }>;
      }
    > = {};
    const eventCounts: Record<
      string,
      {
        available: number;
        unavailable: number;
        noResponse: number;
        openSlots: number;
        neededTotal: number;
      }
    > = {};

    for (const { plan, neededRoles, assignments, availability } of perPlan) {
      const planKey = plan._id as string;
      const assignsByRole = new Map<string, Doc<"roleAssignments">[]>();
      for (const a of assignments) {
        const arr = assignsByRole.get(a.roleId as string) ?? [];
        arr.push(a);
        assignsByRole.set(a.roleId as string, arr);
      }
      let openSlots = 0;
      let neededTotal = 0;
      for (const needed of neededRoles) {
        const list = assignsByRole.get(needed.roleId as string) ?? [];
        const filled = list.filter((a) => FILLED.has(a.status)).length;
        const confirmed = list.filter((a) => a.status === "confirmed").length;
        const open = Math.max(0, needed.count - filled);
        neededTotal += needed.count;
        openSlots += open;
        roleCells[`${needed.roleId}:${planKey}`] = {
          needed: needed.count,
          filled,
          confirmed,
          open,
          occupants: list.map((a) => ({
            assignmentId: a._id,
            userId: a.userId,
            userName: userName(a.userId as string, userDocs.get(a.userId as string) ?? null),
            status: a.status as CellStatus,
          })),
        };
      }
      eventCounts[planKey] = {
        // available/unavailable are filled below, counting ONLY active roster
        // members (a left/non-accepted member's stale row must not inflate the
        // tally or push noResponse negative).
        available: 0,
        unavailable: 0,
        noResponse: 0,
        openSlots,
        neededTotal,
      };
    }

    // --- Role + team row metadata (union across plans). ---
    const roles = [...roleDocs.values()]
      .map((doc) => ({
        roleId: doc._id,
        teamId: doc.teamId,
        roleName: doc.name,
        roleColor: doc.color,
        sortOrder: doc.sortOrder,
        teamName: teamDocs.get(doc.teamId as string)?.name ?? "Team",
      }))
      .sort(
        (a, b) =>
          a.teamName.localeCompare(b.teamName) ||
          a.sortOrder - b.sortOrder ||
          a.roleName.localeCompare(b.roleName),
      );
    const teams = [...teamDocs.values()]
      .map((t) => ({ teamId: t._id, teamName: t.name }))
      .sort((a, b) => a.teamName.localeCompare(b.teamName));

    // --- People-centric rows: active group members. ---
    const memberRows = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();
    const activeMembers = memberRows.filter(
      (m) => !m.requestStatus || m.requestStatus === "accepted",
    );
    const activeUserIds = new Set(activeMembers.map((m) => m.userId as string));

    // Per-event availability tallies, counting ONLY active members (stale rows
    // from people who left must not inflate available/unavailable).
    for (const { plan, availability } of perPlan) {
      const planKey = plan._id as string;
      for (const r of availability) {
        if (!activeUserIds.has(r.userId as string)) continue;
        if (r.status === "available") eventCounts[planKey].available += 1;
        else if (r.status === "unavailable")
          eventCounts[planKey].unavailable += 1;
      }
    }

    // Index availability + assignments by user for quick per-member assembly.
    const availByUserPlan = new Map<string, Availability>();
    const assignsByUser = new Map<
      string,
      Array<{
        assignmentId: Id<"roleAssignments">;
        planId: string;
        roleId: string;
        status: string;
      }>
    >();
    for (const { plan, assignments, availability } of perPlan) {
      for (const r of availability) {
        availByUserPlan.set(
          `${r.userId}:${plan._id}`,
          r.status as Availability,
        );
      }
      for (const a of assignments) {
        const arr = assignsByUser.get(a.userId as string) ?? [];
        arr.push({
          assignmentId: a._id,
          planId: plan._id as string,
          roleId: a.roleId as string,
          status: a.status,
        });
        assignsByUser.set(a.userId as string, arr);
      }
    }

    const members = await Promise.all(
      activeMembers.map(async (m) => {
        const uid = m.userId as string;
        const u = userDocs.get(uid) ?? (await ctx.db.get(m.userId));
        const myAssigns = assignsByUser.get(uid) ?? [];

        // Double-booking uses the member's FULL assignment set (denormalized
        // eventDate via by_user) — same scope as the assign mutation's check —
        // so a same-day conflict in another event/group or beyond the column
        // cap still flags. Counting only the matrix plans would under-report.
        const allAssigns = await ctx.db
          .query("roleAssignments")
          .withIndex("by_user", (q) => q.eq("userId", m.userId))
          .collect();
        const dayCounts = new Map<number, number>();
        for (const a of allAssigns) {
          if (a.status === "declined") continue;
          const day = utcDayBucket(a.eventDate);
          dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
        }

        let availableCount = 0;
        let load = 0;
        const cells: Record<
          string,
          {
            availability: Availability;
            assignments: Array<{
              assignmentId: Id<"roleAssignments">;
              roleId: Id<"teamRoles">;
              roleName: string;
              status: CellStatus;
            }>;
            doubleBooked: boolean;
          }
        > = {};
        for (const plan of plans) {
          const planKey = plan._id as string;
          const availability =
            availByUserPlan.get(`${uid}:${planKey}`) ?? "no_response";
          if (availability === "available") availableCount += 1;
          const planAssigns = myAssigns.filter((a) => a.planId === planKey);
          for (const a of planAssigns) {
            if (a.status !== "declined") load += 1;
          }
          const day = utcDayBucket(plan.eventDate);
          cells[planKey] = {
            availability,
            assignments: planAssigns.map((a) => ({
              assignmentId: a.assignmentId,
              roleId: a.roleId as Id<"teamRoles">,
              roleName: roleDocs.get(a.roleId)?.name ?? "Role",
              status: a.status as CellStatus,
            })),
            doubleBooked:
              (dayCounts.get(day) ?? 0) >= 2 &&
              planAssigns.some((a) => a.status !== "declined"),
          };
        }
        return {
          userId: m.userId,
          userName: userName(uid, u),
          isLeader: isLeaderRole(m.role),
          availableCount,
          load,
          cells,
        };
      }),
    );

    // Now that we know the active roster size, finish each event's
    // no-response tally (members with no availability row for that plan).
    for (const plan of plans) {
      const planKey = plan._id as string;
      const responded =
        eventCounts[planKey].available + eventCounts[planKey].unavailable;
      eventCounts[planKey].noResponse = Math.max(
        0,
        members.length - responded,
      );
    }

    // Default people order: most-available first, then name (client can re-sort).
    members.sort(
      (a, b) =>
        b.availableCount - a.availableCount ||
        a.userName.localeCompare(b.userName),
    );

    return {
      events,
      teams,
      roles: roles.map((r) => ({
        roleId: r.roleId,
        teamId: r.teamId,
        roleName: r.roleName,
        roleColor: r.roleColor,
        teamName: r.teamName,
      })),
      roleCells,
      members,
      eventCounts,
      summary: {
        totalMembers: members.length,
        respondedMembers: members.filter((m) =>
          plans.some(
            (p) => m.cells[p._id as string]?.availability !== "no_response",
          ),
        ).length,
      },
    };
  },
});
