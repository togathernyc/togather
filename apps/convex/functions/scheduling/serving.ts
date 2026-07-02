/**
 * Scheduling — Serving Mode
 *
 * Serving Mode is the focused, day-of view a volunteer drops into around their
 * event. `getServingEligibility` decides whether the current user has an active
 * plan to serve on (and whether the client should auto-enter). The channel
 * resolver `resolveServingChannelIds` gathers the chat channels relevant to a
 * plan (team channels + linked meeting channels) — Agent D imports it into the
 * messaging layer, so it is exported.
 *
 * Auth note: like the rest of the backend this uses token-based auth (there is
 * no ambient `ctx.auth` identity — see `lib/auth.ts`).
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import type { QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { requireGroupMember } from "./permissions";

/** Two hours before the first service time is when serving auto-enters. */
const AUTO_ENTER_LEAD_MS = 2 * 60 * 60 * 1000;
/** Assumed run-time of the last service so we can bound the event's end. */
const LAST_SERVICE_DURATION_MS = 4 * 60 * 60 * 1000;
/** A plan is "eligible" (manual entry) anywhere in this same-day window. */
const SAME_DAY_LEAD_MS = 12 * 60 * 60 * 1000;

/** Earliest service `startsAt` on a plan, or its `eventDate` if it has none. */
function planStartsAt(plan: Doc<"eventPlans">): number {
  if (plan.times.length === 0) return plan.eventDate;
  return Math.min(...plan.times.map((t) => t.startsAt));
}

/** End of the event: last service `startsAt` + an assumed service duration. */
function planEndsAt(plan: Doc<"eventPlans">): number {
  if (plan.times.length === 0) {
    return plan.eventDate + LAST_SERVICE_DURATION_MS;
  }
  const lastStart = Math.max(...plan.times.map((t) => t.startsAt));
  return lastStart + LAST_SERVICE_DURATION_MS;
}

/**
 * Resolve the set of chat channel ids relevant to a plan's serving context:
 *   (a) `teams.channelId` for every team that has needed roles or assignments
 *       on the plan, and
 *   (b) `chatChannels` scoped (`meetingId`) to any of the plan's linked
 *       `meetingIds`.
 *
 * Returned as a `Set` of channel id strings. Agent D imports this into
 * `messaging/channels.ts`.
 */
export async function resolveServingChannelIds(
  ctx: QueryCtx,
  planId: Id<"eventPlans">,
): Promise<Set<string>> {
  const channelIds = new Set<string>();

  const plan = await ctx.db.get(planId);
  if (!plan) return channelIds;

  // (a) Team channels — teams that own a needed role or an assignment here.
  const [neededRoles, assignments] = await Promise.all([
    ctx.db
      .query("neededRoles")
      .withIndex("by_plan", (q) => q.eq("planId", planId))
      .collect(),
    ctx.db
      .query("roleAssignments")
      .withIndex("by_plan", (q) => q.eq("planId", planId))
      .collect(),
  ]);
  const teamIds = new Set<string>();
  for (const r of neededRoles) teamIds.add(r.teamId as string);
  for (const a of assignments) teamIds.add(a.teamId as string);
  for (const teamId of teamIds) {
    const team = await ctx.db.get(teamId as Id<"teams">);
    if (team?.channelId) channelIds.add(team.channelId as string);
  }

  // (b) Linked meeting channels.
  for (const meetingId of plan.meetingIds ?? []) {
    const meetingChannels = await ctx.db
      .query("chatChannels")
      .withIndex("by_meetingId", (q) => q.eq("meetingId", meetingId))
      .collect();
    for (const ch of meetingChannels) channelIds.add(ch._id as string);
  }

  return channelIds;
}

/**
 * Split a plan's resolved serving channels into team-channel vs
 * meeting-channel id arrays (the shape the client needs). Recomputed here
 * rather than folded into `resolveServingChannelIds` because that helper is
 * shared with the messaging layer, which only needs the flat set.
 */
async function servingChannelArrays(
  ctx: QueryCtx,
  plan: Doc<"eventPlans">,
): Promise<{ teamChannelIds: string[]; meetingChannelIds: string[] }> {
  const all = await resolveServingChannelIds(ctx, plan._id);

  const meetingChannelIds = new Set<string>();
  for (const meetingId of plan.meetingIds ?? []) {
    const meetingChannels = await ctx.db
      .query("chatChannels")
      .withIndex("by_meetingId", (q) => q.eq("meetingId", meetingId))
      .collect();
    for (const ch of meetingChannels) meetingChannelIds.add(ch._id as string);
  }

  const teamChannelIds = [...all].filter((id) => !meetingChannelIds.has(id));
  return {
    teamChannelIds,
    meetingChannelIds: [...meetingChannelIds],
  };
}

/** The client-facing shape of one plan the user can serve on. */
type ServingPlan = {
  planId: string;
  groupId: string;
  title: string;
  startsAt: number;
  endsAt: number;
  teamIds: string[];
  teamChannelIds: string[];
  meetingChannelIds: string[];
};

/**
 * Every plan the current user can currently enter Serving Mode for. A plan is a
 * candidate when the user has a `confirmed` role assignment on it and "now"
 * falls inside the plan's serving window; multiple plans can be active at once
 * (e.g. two campuses on the same morning), so the client can render one entry
 * per event and the volunteer picks which one they're serving. `plans` is sorted
 * soonest-first; `activePlan` is the soonest (kept for the inbox chip / runsheet
 * consumers). `autoEnter` is true only when exactly one plan is active and it's
 * inside the tighter (2h before → end) window — with multiple active plans the
 * choice is ambiguous, so we never auto-enter.
 *
 * Auth: any authenticated user.
 */
export const getServingEligibility = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const now = Date.now();

    // All plans the user is confirmed for (may hold multiple roles per plan).
    const confirmed = await ctx.db
      .query("roleAssignments")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "confirmed"),
      )
      .collect();
    const planIds = [...new Set(confirmed.map((a) => a.planId as string))];

    const entries: (ServingPlan & { autoEnter: boolean })[] = [];

    for (const planIdStr of planIds) {
      const plan = await ctx.db.get(planIdStr as Id<"eventPlans">);
      if (!plan) continue;

      const startsAt = planStartsAt(plan);
      const endsAt = planEndsAt(plan);
      const sameDayStart = startsAt - SAME_DAY_LEAD_MS;

      // Must be within the broader same-day window to be eligible at all.
      if (now < sameDayStart || now > endsAt) continue;

      const autoEnter = now >= startsAt - AUTO_ENTER_LEAD_MS && now <= endsAt;

      // Team ids the user is confirmed for on this plan.
      const planAssignments = await ctx.db
        .query("roleAssignments")
        .withIndex("by_plan", (q) => q.eq("planId", plan._id))
        .filter((q) => q.eq(q.field("userId"), userId))
        .collect();
      const teamIds = [
        ...new Set(
          planAssignments
            .filter((a) => a.status === "confirmed")
            .map((a) => a.teamId as string),
        ),
      ];

      const { teamChannelIds, meetingChannelIds } = await servingChannelArrays(
        ctx,
        plan,
      );

      entries.push({
        planId: plan._id as string,
        groupId: plan.groupId as string,
        title: plan.title,
        startsAt,
        endsAt,
        teamIds,
        teamChannelIds,
        meetingChannelIds,
        autoEnter,
      });
    }

    // Soonest-first so the first entry is the natural default.
    entries.sort((a, b) => a.startsAt - b.startsAt);

    const plans: ServingPlan[] = entries.map(
      ({ autoEnter: _autoEnter, ...plan }) => plan,
    );
    const activePlan: ServingPlan | null = plans[0] ?? null;
    const autoEnter = entries.length === 1 && entries[0].autoEnter;

    return {
      eligible: plans.length > 0,
      autoEnter,
      activePlan,
      plans,
    };
  },
});

/**
 * Lightweight serving-inbox metadata for one plan: just its `eventDate`. The
 * mobile inbox (serving mode) uses this to derive the event's local-day window
 * and filter direct messages down to those created on the day of the event.
 *
 * Unlike `getServingEligibility`, this resolves straight from the plan id, so
 * it works even outside the ~12h serving window (e.g. a volunteer previewing
 * their focused inbox early) — mirroring how the runsheet loads the plan via
 * `getEvent`. Membership-gated like the rest of the plan surface.
 */
export const getServingInboxMeta = query({
  args: { token: v.string(), planId: v.id("eventPlans") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const plan = await ctx.db.get(args.planId);
    if (!plan) return null;
    await requireGroupMember(ctx, plan.groupId, userId);
    return { eventDate: plan.eventDate };
  },
});
