/**
 * Scheduling — member availability
 *
 * Collects *intentional availability* for event plans: a member says "I am
 * available to serve this date." This is the piece ADR-023 deferred. Key
 * semantics:
 *
 *   - Availability is recorded per (plan, user) — at the event-plan level, not
 *     per time-slot (a deliberate v1 simplification).
 *   - Being available does NOT schedule the member. Leaders still assign people
 *     to roles via `roleAssignments`; availability is only an input to that
 *     decision, surfaced in the leader assign grid.
 *   - The absence of a row means "no response", rendered distinctly from an
 *     explicit "unavailable".
 *
 * The same `setMyAvailability` mutation backs both surfaces (the in-chat
 * availability card and the dedicated "My Availability" page), so there is a
 * single source of truth.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { isLeaderRole } from "../../lib/helpers";
import { requireGroupMember, requireGroupScheduler } from "./permissions";

/** Valid availability states a member can report. */
const AVAILABILITY_STATUSES = new Set(["available", "unavailable"]);
const MAX_NOTE_LENGTH = 280;

/** Midnight (local server time) at the start of today, in ms. */
function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const statusValidator = v.union(
  v.literal("available"),
  v.literal("unavailable"),
);

// ============================================================================
// Mutations — a member records their own availability
// ============================================================================

/**
 * Upsert the calling member's availability for a single event plan.
 *
 * Auth: an active member of the event's group (or community admin). A member
 * can only ever write their own row — `userId` is taken from the token, never
 * an argument.
 */
export const setMyAvailability = mutation({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
    status: statusValidator,
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const plan = await ctx.db.get(args.planId);
    if (!plan) {
      throw new ConvexError("Event not found");
    }
    await requireGroupMember(ctx, plan.groupId, userId);

    if (!AVAILABILITY_STATUSES.has(args.status)) {
      throw new ConvexError("Invalid availability status");
    }
    const note = args.note?.trim();
    if (note && note.length > MAX_NOTE_LENGTH) {
      throw new ConvexError(
        `Note must be ${MAX_NOTE_LENGTH} characters or fewer`,
      );
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("eventAvailability")
      .withIndex("by_plan_user", (q) =>
        q.eq("planId", args.planId).eq("userId", userId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        note: note || undefined,
        updatedAt: now,
      });
      return existing._id;
    }

    return ctx.db.insert("eventAvailability", {
      planId: args.planId,
      groupId: plan.groupId,
      communityId: plan.communityId,
      userId,
      status: args.status,
      note: note || undefined,
      respondedAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Clear the calling member's availability for an event plan, returning it to
 * the "no response" state. Used when a member taps an already-selected option
 * to deselect it. No-op if there is no row.
 */
export const clearMyAvailability = mutation({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const existing = await ctx.db
      .query("eventAvailability")
      .withIndex("by_plan_user", (q) =>
        q.eq("planId", args.planId).eq("userId", userId),
      )
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});

// ============================================================================
// Queries
// ============================================================================

/**
 * The calling member's view of their availability across a group's upcoming
 * event plans. Powers both the "My Availability" page and the in-chat card.
 *
 * Returns events in date order, each annotated with the member's current
 * response (`status: "available" | "unavailable" | null`). `null` means the
 * member has not responded yet.
 *
 * Auth: an active member of the group (or community admin).
 */
export const myUpcomingAvailability = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    /** Include events whose date is in the past (default false). */
    includePast: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireGroupMember(ctx, args.groupId, userId);

    const cutoff = startOfTodayMs();
    const plans = (
      await ctx.db
        .query("eventPlans")
        .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
        .collect()
    )
      .filter((plan) => args.includePast || plan.eventDate >= cutoff)
      .sort((a, b) => a.eventDate - b.eventDate);

    // My responses for this group, keyed by plan for an O(1) join below.
    const myRows = await ctx.db
      .query("eventAvailability")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", userId),
      )
      .collect();
    const byPlan = new Map(myRows.map((r) => [r.planId as string, r]));

    return plans.map((plan) => {
      const row = byPlan.get(plan._id);
      return {
        _id: plan._id,
        title: plan.title,
        eventDate: plan.eventDate,
        times: plan.times,
        status: plan.status,
        myStatus: (row?.status as "available" | "unavailable") ?? null,
        myNote: row?.note,
      };
    });
  },
});

/**
 * Leader view: every active member of an event's group with their availability
 * for that single plan. Powers the availability column in the assign grid.
 *
 * Each member is tagged `available` / `unavailable` / `no_response`. We return
 * the full active roster (not just responders) so a leader can see who has yet
 * to reply. Sorted available-first, then no-response, then unavailable, then by
 * name — the order a leader scans when filling slots.
 *
 * Auth: an active member of the event's group (or community admin), matching
 * `getEvent`. The screen that surfaces it is leader-only, but the read gate is
 * intentionally the same as the rest of the event detail.
 */
export const availabilityForPlan = query({
  args: {
    token: v.string(),
    planId: v.id("eventPlans"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const plan = await ctx.db.get(args.planId);
    if (!plan) return null;
    await requireGroupMember(ctx, plan.groupId, userId);

    const [members, responses] = await Promise.all([
      ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", plan.groupId))
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .collect(),
      ctx.db
        .query("eventAvailability")
        .withIndex("by_plan", (q) => q.eq("planId", args.planId))
        .collect(),
    ]);

    const responseByUser = new Map(
      responses.map((r) => [r.userId as string, r]),
    );

    const activeMembers = members.filter(
      (m) => !m.requestStatus || m.requestStatus === "accepted",
    );

    const rows = await Promise.all(
      activeMembers.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        const userName =
          `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() ||
          "Someone";
        const row = responseByUser.get(m.userId);
        const status: "available" | "unavailable" | "no_response" = row
          ? (row.status as "available" | "unavailable")
          : "no_response";
        return {
          userId: m.userId,
          userName,
          isLeader: isLeaderRole(m.role),
          status,
          note: row?.note,
          respondedAt: row?.respondedAt,
        };
      }),
    );

    const rank: Record<string, number> = {
      available: 0,
      no_response: 1,
      unavailable: 2,
    };
    rows.sort(
      (a, b) =>
        rank[a.status] - rank[b.status] ||
        a.userName.localeCompare(b.userName),
    );

    const counts = {
      available: rows.filter((r) => r.status === "available").length,
      unavailable: rows.filter((r) => r.status === "unavailable").length,
      noResponse: rows.filter((r) => r.status === "no_response").length,
      total: rows.length,
    };

    return { planId: args.planId, counts, members: rows };
  },
});

/** Cap on event-plan columns in the matrix — the grid is "up to ~10 events". */
const MATRIX_MAX_EVENTS = 10;

/**
 * Leader matrix: every active group member (rows) × the group's upcoming event
 * plans (columns), with each cell the member's availability for that plan
 * (`available` / `unavailable` / `no_response`). Powers the web availability
 * grid — built to scan a large roster against up to ~10 events at once.
 *
 * Each member carries an `availableCount` (how many of the listed events they
 * can serve) so the grid can sort "most available first", and each event a
 * tally for its column header. Members are returned sorted by availableCount
 * desc then name; the client can re-sort.
 *
 * Auth: group leader or community admin — this exposes the whole roster's
 * responses, so it's gated tighter than the per-member reads.
 */
export const availabilityMatrix = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    /** Max event columns (default + hard cap MATRIX_MAX_EVENTS). */
    limit: v.optional(v.number()),
    includePast: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireGroupScheduler(ctx, args.groupId, userId);

    const cap = Math.min(args.limit ?? MATRIX_MAX_EVENTS, MATRIX_MAX_EVENTS);
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
    }));

    // Availability rows for the listed plans, indexed by `${planId}:${userId}`.
    const statusByPlanUser = new Map<string, "available" | "unavailable">();
    await Promise.all(
      plans.map(async (plan) => {
        const rows = await ctx.db
          .query("eventAvailability")
          .withIndex("by_plan", (q) => q.eq("planId", plan._id))
          .collect();
        for (const r of rows) {
          statusByPlanUser.set(
            `${plan._id}:${r.userId}`,
            r.status as "available" | "unavailable",
          );
        }
      }),
    );

    const members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();
    const activeMembers = members.filter(
      (m) => !m.requestStatus || m.requestStatus === "accepted",
    );

    // Per-event tallies for the column headers.
    const eventCounts: Record<
      string,
      { available: number; unavailable: number; noResponse: number }
    > = {};
    for (const plan of plans) {
      eventCounts[plan._id] = { available: 0, unavailable: 0, noResponse: 0 };
    }

    const rows = await Promise.all(
      activeMembers.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        const userName =
          `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() ||
          "Someone";
        const cells: Record<
          string,
          "available" | "unavailable" | "no_response"
        > = {};
        let availableCount = 0;
        for (const plan of plans) {
          const status =
            statusByPlanUser.get(`${plan._id}:${m.userId}`) ?? "no_response";
          cells[plan._id] = status;
          if (status === "available") {
            availableCount += 1;
            eventCounts[plan._id].available += 1;
          } else if (status === "unavailable") {
            eventCounts[plan._id].unavailable += 1;
          } else {
            eventCounts[plan._id].noResponse += 1;
          }
        }
        return {
          userId: m.userId,
          userName,
          isLeader: isLeaderRole(m.role),
          availableCount,
          // Whether they've responded to ANY listed event.
          hasResponded: Object.values(cells).some((s) => s !== "no_response"),
          cells,
        };
      }),
    );

    rows.sort(
      (a, b) =>
        b.availableCount - a.availableCount ||
        a.userName.localeCompare(b.userName),
    );

    return {
      events,
      members: rows,
      eventCounts,
      summary: {
        totalMembers: rows.length,
        respondedMembers: rows.filter((r) => r.hasResponded).length,
      },
    };
  },
});
