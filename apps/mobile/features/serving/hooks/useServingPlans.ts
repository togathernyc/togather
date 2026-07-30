/**
 * useServingPlans
 *
 * The plans every serving surface (Inbox, Runsheet, Tasks) should render.
 *
 * Two modes:
 *  - Normal serving — all the plans the user is serving today
 *    (`getServingEligibility().plans`), wrapped in the offline cache by
 *    `useCachedServingPlans` so the tabs still render at a venue with no signal.
 *  - Preview — the user opened an UPCOMING plan early from My Schedule
 *    (`eventModeStore.previewPlanId`). Serving then scopes to THAT ONE plan,
 *    taken from `upcomingPlans`. Never the union of upcoming plans: the serving
 *    inbox is filtered server-side by these plan ids, so a union would drag
 *    every future event's channels into it.
 *
 * A preview plan that no longer appears in `upcomingPlans` (unassigned since, or
 * the event day has arrived and it moved into `plans`) resolves to no plans, and
 * the screens fall back to their existing empty state.
 */
import { useMemo } from "react";
import { useEventModeStore } from "@/stores/eventModeStore";
import type { CachedServingPlan } from "@/stores/servingPlansCache";
import { useCachedServingPlans } from "./useCachedServingPlans";

/** Shape of the parts of `getServingEligibility` this hook reads. */
export type ServingEligibility = {
  plans: CachedServingPlan[];
  upcomingPlans?: CachedServingPlan[];
};

/** Stable identity so a preview miss doesn't re-render consumers forever. */
const NO_PLANS: CachedServingPlan[] = [];

export function useServingPlans(
  eligibility: ServingEligibility | null | undefined,
): CachedServingPlan[] {
  const previewPlanId = useEventModeStore((s) => s.previewPlanId);
  const cachedPlans = useCachedServingPlans(eligibility?.plans);
  const upcomingPlans = eligibility?.upcomingPlans;

  return useMemo(() => {
    if (!previewPlanId) return cachedPlans;
    const preview = upcomingPlans?.find((p) => p.planId === previewPlanId);
    return preview ? [preview] : NO_PLANS;
  }, [previewPlanId, cachedPlans, upcomingPlans]);
}
