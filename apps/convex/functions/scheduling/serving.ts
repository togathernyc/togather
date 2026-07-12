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
import { getDisplayName } from "../../lib/utils";
import { requireGroupMember } from "./permissions";
import { ADD_DAYS_BEFORE } from "./teamChannelSync";

/** Milliseconds in one day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Assumed run-time of the last service so we can bound the event's end. */
const LAST_SERVICE_DURATION_MS = 4 * 60 * 60 * 1000;
/** A plan is "eligible" (manual entry) anywhere in this same-day window. */
const SAME_DAY_LEAD_MS = 12 * 60 * 60 * 1000;
/**
 * How early serving auto-enters, measured before the first service. Matches the
 * same-day eligibility window so a volunteer who opens the app any time on the
 * day of their event is dropped straight into serving mode (they can still Exit
 * — a manual exit suppresses auto re-entry for the session, see the mobile
 * eventModeStore `autoEnterBlocked`).
 */
const AUTO_ENTER_LEAD_MS = SAME_DAY_LEAD_MS;

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
 *       on the plan,
 *   (b) `chatChannels` scoped (`meetingId`) to any of the plan's linked
 *       `meetingIds`, and
 *   (c) cross-team channels whose selectors reference a team on the plan.
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

  // (c) Cross-team channels that draw from any team on this plan. Their
  // membership is auto-synced (syncSource "event_plan") from the same
  // roleAssignments, so a rostered member belongs in the serving inbox too.
  // Resolved community-wide by the channel's `crossTeamSync.selectors[]`
  // `sourceTeamId` matching a team on the plan — NOT scoped to `plan.groupId`,
  // because a cross-team channel can be created in one group while sourcing a
  // team that lives in another group, so a plan-group scope would drop those
  // cross-group channels. This mirrors the sibling `getServingUpcomingChannels`
  // (cross-team channels are rare, so a filtered scan is fine). It's
  // membership-agnostic like the team-channel branch above: the serving flatten
  // in messaging/channels.ts only iterates channels already in the per-user,
  // active-membership-gated result, so widening this Set leaks nothing — only
  // users with an active chatChannelMembers row actually see the channel.
  const crossTeamChannels = await ctx.db
    .query("chatChannels")
    .filter((q) => q.eq(q.field("channelType"), "cross_team"))
    .collect();
  for (const ch of crossTeamChannels) {
    if (ch.isArchived === true) continue;
    const selectors = ch.crossTeamSync?.selectors ?? [];
    if (selectors.some((s) => teamIds.has(s.sourceTeamId as string))) {
      channelIds.add(ch._id as string);
    }
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
 * consumers). `autoEnter` is true only when exactly one plan is active (auto and
 * eligibility now share the same same-day window) — with multiple active plans
 * the choice is ambiguous, so we never auto-enter and the client offers a
 * manual chip instead.
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

/** A channel the user will belong to for a plan but isn't an active member of yet. */
type UpcomingChannel = {
  channelId: Id<"chatChannels">;
  name: string;
  kind: "team" | "cross_team";
  availableAt: number;
};

/**
 * Serving-mode "coming soon" channels: the team + cross-team channels the
 * CURRENT user WILL be added to for this plan (via the rotation engine in
 * `teamChannelSync.ts`) but is NOT yet an active member of. These exist as
 * `chatChannels` rows already, but the user is only mirrored into
 * `chatChannelMembers` inside a rotation window starting
 * `eventDate − ADD_DAYS_BEFORE days`, so before that they don't appear in the
 * (membership-filtered) serving inbox. The serving inbox renders these as
 * non-tappable "ghost" cards showing when the channel opens.
 *
 * Scope is the user's OWN teams on the plan — their `confirmed` role
 * assignments — not every team on the plan:
 *   - team channels: `teams.channelId` for each team the user is confirmed on;
 *   - cross-team channels (`channelType === "cross_team"`): any whose
 *     `crossTeamSync.selectors` match one of the user's confirmed assignments
 *     (same `sourceTeamId`, and matching `roleId` when the selector pins one).
 * Channels the user is already an active member of (`chatChannelMembers` with
 * `leftAt === undefined`) are excluded — those render as real rows.
 *
 * `availableAt = plan.eventDate − ADD_DAYS_BEFORE * MS_PER_DAY`. Returns `[]`
 * when there's nothing upcoming. Membership-gated like the rest of the plan
 * surface.
 */
export const getServingUpcomingChannels = query({
  args: { token: v.string(), planId: v.id("eventPlans") },
  handler: async (ctx, args): Promise<UpcomingChannel[]> => {
    const userId = await requireAuth(ctx, args.token);
    const plan = await ctx.db.get(args.planId);
    if (!plan) return [];
    await requireGroupMember(ctx, plan.groupId, userId);

    // The user's confirmed assignments on this plan → the teams they'll be in.
    const planAssignments = await ctx.db
      .query("roleAssignments")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();
    const confirmed = planAssignments.filter((a) => a.status === "confirmed");
    if (confirmed.length === 0) return [];

    const availableAt = plan.eventDate - ADD_DAYS_BEFORE * MS_PER_DAY;

    // Candidate channels (may include channels the user is already in — those
    // are filtered out below).
    const candidates: Array<Omit<UpcomingChannel, "availableAt">> = [];

    // (a) Team channels — one per team the user is confirmed on.
    const teamIds = new Set<string>(confirmed.map((a) => a.teamId as string));
    for (const teamId of teamIds) {
      const team = await ctx.db.get(teamId as Id<"teams">);
      if (team?.channelId && team.isArchived !== true) {
        candidates.push({
          channelId: team.channelId,
          name: team.name,
          kind: "team",
        });
      }
    }

    // (b) Cross-team channels whose selectors match one of the user's confirmed
    // assignments. Cross-team channels are rare, so a filtered scan is fine
    // (mirrors `reconcileCrossTeamChannelsForSource`).
    const crossChannels = await ctx.db
      .query("chatChannels")
      .filter((q) => q.eq(q.field("channelType"), "cross_team"))
      .collect();
    for (const ch of crossChannels) {
      if (ch.isArchived === true) continue;
      const selectors = ch.crossTeamSync?.selectors ?? [];
      const willBeMember = confirmed.some((a) =>
        selectors.some(
          (s) =>
            (s.sourceTeamId as string) === (a.teamId as string) &&
            (s.roleId === undefined ||
              (s.roleId as string) === (a.roleId as string)),
        ),
      );
      if (willBeMember) {
        candidates.push({ channelId: ch._id, name: ch.name, kind: "cross_team" });
      }
    }

    // Exclude channels the user is already an active member of, and dedupe.
    const result: UpcomingChannel[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const key = candidate.channelId as string;
      if (seen.has(key)) continue;
      seen.add(key);

      const memberRows = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", candidate.channelId).eq("userId", userId),
        )
        .collect();
      const isActiveMember = memberRows.some((r) => r.leftAt === undefined);
      if (isActiveMember) continue;

      result.push({ ...candidate, availableAt });
    }

    return result;
  },
});

/** One serving teammate card in the Team roster grid. */
type ServingTeamPerson = {
  userId: string;
  displayName: string;
  firstName: string | null;
  /** The role they fill on this team for this plan, e.g. "Vocals". */
  roleName: string;
  roleColor: string | null;
  profilePhoto: string | null;
  /** Their phone number, if on file — powers the "Text" action. Null otherwise. */
  phone: string | null;
  /** True for the current user's own card (no message/text actions on self). */
  isSelf: boolean;
};

/** One team column in a plan's Team roster grid. */
type ServingTeamColumn = {
  teamId: string;
  name: string;
  people: ServingTeamPerson[];
};

/** One plan section in the Team roster grid. */
type ServingTeamPlan = {
  planId: string;
  title: string;
  eventDate: number;
  teams: ServingTeamColumn[];
};

/**
 * Serving-mode "Team" grid: who is serving alongside the current user, grouped
 * by plan then by team. For EVERY plan the user can currently serve (same
 * eligibility window as `getServingEligibility` — a `confirmed` assignment plus
 * "now" inside the plan's same-day window), returns each team that has at least
 * one confirmed volunteer as a column, and each volunteer as a card (name, the
 * role they fill, avatar, and phone for the day-of "Text" action).
 *
 * One card per (user, role) confirmed assignment — a person filling two roles on
 * the same team shows two cards. `isSelf` flags the current user's own cards so
 * the client can suppress the message/text actions on them.
 *
 * Membership is already implied by the confirmed assignment, so there is no
 * extra group-member gate here. Phone numbers are surfaced only among people
 * confirmed to serve the same event — the day-of coordination context the grid
 * exists for.
 *
 * Auth: any authenticated user.
 */
export const getServingTeamRoster = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{ plans: ServingTeamPlan[] }> => {
    const userId = await requireAuth(ctx, args.token);
    const now = Date.now();

    // Plans the user is confirmed for (mirrors getServingEligibility's window).
    const confirmed = await ctx.db
      .query("roleAssignments")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "confirmed"),
      )
      .collect();
    const planIds = [...new Set(confirmed.map((a) => a.planId as string))];

    const eligiblePlans: Doc<"eventPlans">[] = [];
    for (const planIdStr of planIds) {
      const plan = await ctx.db.get(planIdStr as Id<"eventPlans">);
      if (!plan) continue;
      const startsAt = planStartsAt(plan);
      const endsAt = planEndsAt(plan);
      if (now < startsAt - SAME_DAY_LEAD_MS || now > endsAt) continue;
      eligiblePlans.push(plan);
    }
    // Soonest-first so the grid's plan sections read in event order.
    eligiblePlans.sort((a, b) => planStartsAt(a) - planStartsAt(b));

    // Resolve every team/role/user referenced across the eligible plans once.
    const teamCache = new Map<string, Doc<"teams"> | null>();
    const roleCache = new Map<string, Doc<"teamRoles"> | null>();
    const userCache = new Map<string, Doc<"users"> | null>();
    const getTeam = async (id: string) => {
      if (!teamCache.has(id))
        teamCache.set(id, await ctx.db.get(id as Id<"teams">));
      return teamCache.get(id) ?? null;
    };
    const getRole = async (id: string) => {
      if (!roleCache.has(id))
        roleCache.set(id, await ctx.db.get(id as Id<"teamRoles">));
      return roleCache.get(id) ?? null;
    };
    const getUser = async (id: string) => {
      if (!userCache.has(id))
        userCache.set(id, await ctx.db.get(id as Id<"users">));
      return userCache.get(id) ?? null;
    };

    const plans: ServingTeamPlan[] = [];
    for (const plan of eligiblePlans) {
      const assignments = (
        await ctx.db
          .query("roleAssignments")
          .withIndex("by_plan", (q) => q.eq("planId", plan._id))
          .collect()
      ).filter((a) => a.status === "confirmed");

      // Group confirmed assignments by team, de-duping identical (user, role)
      // rows so a double-written assignment can't produce a duplicate card.
      const byTeam = new Map<string, typeof assignments>();
      const seen = new Set<string>();
      for (const a of assignments) {
        const dedupeKey = `${a.userId}:${a.roleId}:${a.teamId}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        const teamId = a.teamId as string;
        (byTeam.get(teamId) ?? byTeam.set(teamId, []).get(teamId)!).push(a);
      }

      const teams: ServingTeamColumn[] = [];
      for (const [teamId, teamAssignments] of byTeam) {
        const team = await getTeam(teamId);
        if (!team || team.isArchived === true) continue;

        const people: ServingTeamPerson[] = [];
        for (const a of teamAssignments) {
          const [role, user] = await Promise.all([
            getRole(a.roleId as string),
            getUser(a.userId as string),
          ]);
          people.push({
            userId: a.userId as string,
            displayName: getDisplayName(user?.firstName, user?.lastName),
            firstName: user?.firstName ?? null,
            roleName: role?.name ?? "Role",
            roleColor: role?.color ?? null,
            profilePhoto: user?.profilePhoto ?? null,
            phone: user?.phone ?? null,
            isSelf: (a.userId as string) === (userId as string),
          });
        }
        people.sort((x, y) => x.displayName.localeCompare(y.displayName));
        teams.push({
          teamId,
          name: team.name,
          people,
        });
      }
      teams.sort((x, y) => x.name.localeCompare(y.name));

      plans.push({
        planId: plan._id as string,
        title: plan.title,
        eventDate: plan.eventDate,
        teams,
      });
    }

    return { plans };
  },
});
