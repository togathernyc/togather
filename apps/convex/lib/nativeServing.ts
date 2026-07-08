/**
 * Native serving helpers.
 *
 * The profile "Serving" score and the serving-history card are native-first:
 * when a community uses native rostering (it has at least one `eventPlans`
 * row), serving is computed from `roleAssignments`. Only communities with no
 * native rostering fall back to the cached Planning Center (PCO) counts on
 * `groups.pcoServingCounts`.
 *
 * "Native serving count" for a user = number of DISTINCT event plans in the
 * past ~60 days where the user has a non-declined role assignment. This mirrors
 * how PCO counts distinct plans served (see pcoServices/servingHistory.ts).
 */

import type { Id } from "../_generated/dataModel";

/** Serving window: past ~60 days (matches TWO_MONTHS_MS in pcoServices/servingHistory.ts). */
export const SERVING_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

/** Default number of serving-history rows shown on the profile card. */
export const SERVING_HISTORY_CAP = 15;

// A non-declined role assignment means the person is/was rostered to serve.
type AssignmentLike = {
  planId: Id<"eventPlans">;
  eventDate: number;
  status: string;
};

// Minimal shape of the ctx we need — a db with query/get. Kept structural so
// the helpers work from both query handlers and `t.run` in tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReadCtx = { db: any };

/**
 * A community "uses native rostering" if it has at least one event plan.
 * When true, serving score + history are computed from native
 * `roleAssignments`; when false, callers fall back to cached PCO counts.
 *
 * O(1): a single indexed `first()` on `by_community_date`.
 */
export async function communityUsesNativeRostering(
  ctx: ReadCtx,
  communityId: Id<"communities">,
): Promise<boolean> {
  const plan = await ctx.db
    .query("eventPlans")
    .withIndex("by_community_date", (q: any) => q.eq("communityId", communityId))
    .first();
  return plan !== null;
}

/**
 * Native serving count for a user, scoped to one community: number of DISTINCT
 * event plans in the past ~60 days where the user has a non-declined role
 * assignment AND the plan belongs to `communityId`.
 *
 * Scoping matters because `roleAssignments` (and its `by_user_eventDate` index)
 * is not community-scoped — a user who serves in two native-rostering
 * communities must not have one community's serving inflate the other's score
 * (the PCO counts this replaces were always per-community).
 *
 * Takes a pre-fetched, newest-first assignment list (e.g. the archive-activity
 * lookup) so the caller avoids a second assignment read; only the small set of
 * in-window candidate plans is fetched to resolve their community.
 */
export async function countNativeServing(
  ctx: ReadCtx,
  assignments: AssignmentLike[],
  nowTs: number,
  communityId: Id<"communities">,
): Promise<number> {
  const cutoff = nowTs - SERVING_WINDOW_MS;
  const candidatePlanIds = new Set<string>();
  for (const a of assignments) {
    if (a.status === "declined") continue;
    if (a.eventDate < cutoff) continue;
    candidatePlanIds.add(a.planId.toString());
  }
  if (candidatePlanIds.size === 0) return 0;
  const plans = await Promise.all(
    [...candidatePlanIds].map((id) => ctx.db.get(id as Id<"eventPlans">)),
  );
  let count = 0;
  for (const plan of plans) {
    if (plan && plan.communityId === communityId) count++;
  }
  return count;
}

export interface ServingHistoryRow {
  date: string;
  serviceTypeName: string;
  teamName: string;
  position: string | null;
}

/**
 * Build the serving-history card from native `roleAssignments` for one user,
 * scoped to `communityId` (assignments in other communities are excluded — see
 * countNativeServing for why). Newest event first, capped at `cap`. Plan/team/
 * role lookups are deduped to stay under Convex read limits.
 *
 * `date` is formatted `YYYY-MM-DD` to match the shape the PCO card produces
 * (and stays lexicographically sortable).
 */
export async function nativeServingHistory(
  ctx: ReadCtx,
  userId: Id<"users">,
  communityId: Id<"communities">,
  cap: number = SERVING_HISTORY_CAP,
): Promise<ServingHistoryRow[]> {
  // Newest-first by event date. take(200) leaves generous headroom to skip
  // declined + other-community rows and still fill the cap.
  const assignments = await ctx.db
    .query("roleAssignments")
    .withIndex("by_user_eventDate", (q: any) => q.eq("userId", userId))
    .order("desc")
    .take(200);

  const nonDeclined = assignments.filter((a: any) => a.status !== "declined");
  if (nonDeclined.length === 0) return [];

  // Resolve plans first so rows can be scoped to this community before capping.
  const allPlanIds = [
    ...new Set(nonDeclined.map((a: any) => a.planId.toString())),
  ];
  const allPlans = await Promise.all(
    allPlanIds.map((id) => ctx.db.get(id as Id<"eventPlans">)),
  );
  const planMap = new Map(
    allPlans.filter(Boolean).map((p: any) => [p._id.toString(), p]),
  );

  // Keep only this community's assignments (newest-first order preserved), cap.
  const scoped = nonDeclined
    .filter((a: any) => {
      const plan = planMap.get(a.planId.toString());
      return plan && plan.communityId === communityId;
    })
    .slice(0, cap);
  if (scoped.length === 0) return [];

  // Dedupe the remaining team/role lookups.
  const teamIds = [...new Set(scoped.map((a: any) => a.teamId.toString()))];
  const roleIds = [...new Set(scoped.map((a: any) => a.roleId.toString()))];

  const [teams, roles] = await Promise.all([
    Promise.all(teamIds.map((id) => ctx.db.get(id as Id<"teams">))),
    Promise.all(roleIds.map((id) => ctx.db.get(id as Id<"teamRoles">))),
  ]);
  const teamMap = new Map(
    teams.filter(Boolean).map((t: any) => [t._id.toString(), t]),
  );
  const roleMap = new Map(
    roles.filter(Boolean).map((r: any) => [r._id.toString(), r]),
  );

  const rows: ServingHistoryRow[] = [];
  for (const a of scoped) {
    const plan = planMap.get(a.planId.toString());
    const team = teamMap.get(a.teamId.toString());
    const role = roleMap.get(a.roleId.toString());
    // Prefer the plan's canonical date; fall back to the denormalized one.
    const eventDate = plan?.eventDate ?? a.eventDate;
    rows.push({
      date: new Date(eventDate).toISOString().split("T")[0],
      serviceTypeName: plan?.title ?? "",
      teamName: team?.name ?? "",
      position: role?.name ?? null,
    });
  }
  return rows;
}
