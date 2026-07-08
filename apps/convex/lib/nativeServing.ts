/**
 * Serving helpers — combined PCO + native rostering, counted BY DAY.
 *
 * The profile "Serving" score counts BOTH sources — the cached Planning Center
 * (PCO) snapshot on `groups.pcoServingCounts` AND native rostering
 * (`roleAssignments`) — but de-duplicates by calendar day: a day on which the
 * person is scheduled on ANY plan (PCO or native, one team or several) counts
 * as exactly one serve. So two plans on the same day, or a PCO plan and a native
 * plan on the same day, are a single serve.
 *
 * Because de-dup is by day, PCO-imported native plans (`eventPlans.pcoPlanId`)
 * need no special handling — a migrated plan lands on the same day as its PCO
 * record and collapses to one automatically.
 *
 * The serving-history CARD is a separate view (`nativeServingHistory` +
 * `mergeServingHistory`) that still lists individual serves, not days.
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

/** Calendar day (UTC, `YYYY-MM-DD`) for a timestamp — the serving dedup key. */
function dayOf(ts: number): string {
  return new Date(ts).toISOString().split("T")[0];
}

/**
 * The set of calendar days a user served natively in the past ~60 days, scoped
 * to `communityId`. One entry per distinct day, regardless of how many plans /
 * teams the person was on that day.
 *
 * Scoping matters because `roleAssignments` (and its `by_user_eventDate` index)
 * is not community-scoped — serving in another community must not inflate this
 * community's score (the PCO snapshot this combines with is per-community).
 *
 * Takes a pre-fetched, newest-first assignment list (e.g. the archive-activity
 * lookup) so the caller avoids a second assignment read; only the small set of
 * in-window candidate plans is fetched to resolve community + canonical date.
 */
export async function nativeServingDays(
  ctx: ReadCtx,
  assignments: AssignmentLike[],
  nowTs: number,
  communityId: Id<"communities">,
): Promise<Set<string>> {
  const cutoff = nowTs - SERVING_WINDOW_MS;
  const candidatePlanIds = new Set<string>();
  for (const a of assignments) {
    if (a.status === "declined") continue;
    // Past ~60 days only. Volunteers are rostered onto *upcoming* plans, so
    // roleAssignments routinely carry future eventDates; counting those would
    // inflate the score. The PCO snapshot this combines with is past-only.
    if (a.eventDate < cutoff || a.eventDate > nowTs) continue;
    candidatePlanIds.add(a.planId.toString());
  }
  const days = new Set<string>();
  if (candidatePlanIds.size === 0) return days;
  const plans = await Promise.all(
    [...candidatePlanIds].map((id) => ctx.db.get(id as Id<"eventPlans">)),
  );
  for (const plan of plans) {
    if (plan && plan.communityId === communityId) {
      days.add(dayOf(plan.eventDate));
    }
  }
  return days;
}

/** PCO serving dates (`YYYY-MM-DD`) for one user from the cached servingDetails. */
export function pcoServingDatesForUser(
  servingDetails:
    | Array<{ userId: Id<"users">; date: string }>
    | undefined,
  userId: Id<"users">,
): string[] {
  if (!servingDetails) return [];
  const key = userId.toString();
  return servingDetails
    .filter((d) => d.userId.toString() === key)
    .map((d) => d.date)
    .filter(Boolean);
}

/**
 * Combined serving count for a user = number of DISTINCT calendar days served
 * across native rostering and PCO in the past ~60 days. Any day appearing in
 * either source counts once; a day in both counts once.
 */
export function combineServingDayCount(
  nativeDays: Set<string>,
  pcoDates: string[],
  nowTs: number,
): number {
  const cutoffDay = dayOf(nowTs - SERVING_WINDOW_MS);
  const todayDay = dayOf(nowTs);
  const days = new Set(nativeDays);
  for (const d of pcoDates) {
    // PCO dates are already `YYYY-MM-DD`; keep only in-window (past) days.
    if (d && d >= cutoffDay && d <= todayDay) days.add(d);
  }
  return days.size;
}

export interface ServingHistoryRow {
  date: string;
  serviceTypeName: string;
  teamName: string;
  position: string | null;
}

/**
 * Build the native-origin serving-history rows for one user, scoped to
 * `communityId` and excluding PCO-imported plans (the caller merges these with
 * the cached PCO rows via `mergeServingHistory`). Past events only, newest event
 * first, capped at `cap`. Plan/team/role lookups are deduped to stay under
 * Convex read limits.
 *
 * `date` is formatted `YYYY-MM-DD` to match the shape the PCO card produces
 * (and stays lexicographically sortable).
 */
export async function nativeServingHistory(
  ctx: ReadCtx,
  userId: Id<"users">,
  communityId: Id<"communities">,
  cap: number = SERVING_HISTORY_CAP,
  nowTs: number = Date.now(),
): Promise<ServingHistoryRow[]> {
  // Past events only, newest-first. The index range excludes future-dated
  // assignments (volunteers rostered onto upcoming plans) so the card shows
  // serving history, not upcoming commitments — matching the past-only PCO
  // card it augments. take(200) leaves headroom to skip declined,
  // other-community, and PCO-imported rows and still fill the cap.
  const assignments = await ctx.db
    .query("roleAssignments")
    .withIndex("by_user_eventDate", (q: any) =>
      q.eq("userId", userId).lte("eventDate", nowTs),
    )
    .order("desc")
    .take(200);

  const nonDeclined = assignments.filter((a: any) => a.status !== "declined");
  if (nonDeclined.length === 0) return [];

  // Resolve plans first so rows can be scoped to this community + origin
  // before capping.
  const allPlanIds = [
    ...new Set(nonDeclined.map((a: any) => a.planId.toString())),
  ];
  const allPlans = await Promise.all(
    allPlanIds.map((id) => ctx.db.get(id as Id<"eventPlans">)),
  );
  const planMap = new Map(
    allPlans.filter(Boolean).map((p: any) => [p._id.toString(), p]),
  );

  // Keep only this community's native-origin assignments (newest-first order
  // preserved), cap. PCO-imported plans come from the PCO rows instead.
  const scoped = nonDeclined
    .filter((a: any) => {
      const plan = planMap.get(a.planId.toString());
      return (
        plan && plan.communityId === communityId && plan.pcoPlanId == null
      );
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

/**
 * Merge native-origin + PCO serving-history rows into one card. Both sources are
 * shown so a community mid-migration sees its full history. Sorted newest-first,
 * deduped on (date, team, service, position) as a defensive guard against any
 * overlap, capped at `cap`.
 */
export function mergeServingHistory(
  nativeRows: ServingHistoryRow[],
  pcoRows: ServingHistoryRow[],
  cap: number = SERVING_HISTORY_CAP,
): ServingHistoryRow[] {
  const all = [...nativeRows, ...pcoRows].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  const seen = new Set<string>();
  const merged: ServingHistoryRow[] = [];
  for (const r of all) {
    const key = `${r.date}|${r.teamName.toLowerCase()}|${r.serviceTypeName.toLowerCase()}|${(r.position ?? "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
    if (merged.length >= cap) break;
  }
  return merged;
}
