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
import { mutation, query, internalMutation } from "../../_generated/server";
import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import { requireAuth } from "../../lib/auth";
import { isLeaderRole } from "../../lib/helpers";
import { requireGroupMember, requireGroupScheduler } from "./permissions";

/** Valid availability states a member can report. */
const AVAILABILITY_STATUSES = new Set(["available", "unavailable"]);
const MAX_NOTE_LENGTH = 280;

/**
 * Rolling debounce window for the "member updated availability" leader
 * notification. Each availability write reschedules the notify job to fire
 * this long after the *last* change, so a member clicking through several
 * events produces one notification instead of one per tap.
 */
const AVAILABILITY_NOTIFY_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Schedule (or reschedule) the debounced leader notification for one member's
 * availability changes in a group. Cancels any pending job for the
 * (group, member) pair and queues a fresh one — a trailing debounce that
 * collapses a burst of edits into a single notification.
 */
export async function queueAvailabilityLeaderNotice(
  ctx: MutationCtx,
  args: {
    groupId: Id<"groups">;
    userId: Id<"users">;
    communityId: Id<"communities">;
  },
): Promise<void> {
  const existing = await ctx.db
    .query("availabilityNotifyDebounce")
    .withIndex("by_group_user", (q) =>
      q.eq("groupId", args.groupId).eq("userId", args.userId),
    )
    .first();

  if (existing) {
    try {
      await ctx.scheduler.cancel(existing.jobId);
    } catch {
      // Job may have already fired or been cancelled — ignore.
    }
  }

  // A fresh nonce ties this row to exactly the job we're about to schedule, so
  // a stale job (one whose cancel didn't take) can't clear a newer row or send.
  const nonce = crypto.randomUUID();
  const jobId = await ctx.scheduler.runAfter(
    AVAILABILITY_NOTIFY_DEBOUNCE_MS,
    internal.functions.notifications.senders.notifyAvailabilityUpdated,
    { groupId: args.groupId, userId: args.userId, nonce },
  );

  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, { jobId, nonce, scheduledAt: now });
  } else {
    await ctx.db.insert("availabilityNotifyDebounce", {
      groupId: args.groupId,
      userId: args.userId,
      communityId: args.communityId,
      jobId,
      nonce,
      scheduledAt: now,
    });
  }
}

/**
 * Atomically claim the debounce row for a (group, member) pair on behalf of the
 * firing notify job, identified by `nonce`. Returns true and deletes the row
 * only when the row still belongs to this job; returns false if the row is
 * missing or was already rescheduled (a newer job owns it now), so a stale job
 * neither sends nor removes the replacement row.
 */
export const claimAvailabilityDebounce = internalMutation({
  args: { groupId: v.id("groups"), userId: v.id("users"), nonce: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const existing = await ctx.db
      .query("availabilityNotifyDebounce")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.groupId).eq("userId", args.userId),
      )
      .first();
    if (!existing || existing.nonce !== args.nonce) {
      return false;
    }
    await ctx.db.delete(existing._id);
    return true;
  },
});

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
      // Only notify leaders when the response actually changes — a redundant
      // re-tap of the current state shouldn't (re)start the debounce window.
      const changed =
        existing.status !== args.status ||
        (existing.note || undefined) !== (note || undefined);
      await ctx.db.patch(existing._id, {
        status: args.status,
        note: note || undefined,
        updatedAt: now,
      });
      if (changed) {
        await queueAvailabilityLeaderNotice(ctx, {
          groupId: plan.groupId,
          userId,
          communityId: plan.communityId,
        });
      }
      return existing._id;
    }

    const newId = await ctx.db.insert("eventAvailability", {
      planId: args.planId,
      groupId: plan.groupId,
      communityId: plan.communityId,
      userId,
      status: args.status,
      note: note || undefined,
      respondedAt: now,
      updatedAt: now,
    });
    await queueAvailabilityLeaderNotice(ctx, {
      groupId: plan.groupId,
      userId,
      communityId: plan.communityId,
    });
    return newId;
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
