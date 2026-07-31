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
 * When the previewed plan's event day arrives the backend moves it OUT of
 * `upcomingPlans` and INTO `plans` (`now >= startsAt - 12h`). Nothing else
 * clears `previewPlanId` on that transition — the inbox's auto-enter effect
 * short-circuits because the user is already in serving mode — so we converge
 * here: the plan is served as the normal same-day plan and the preview is
 * cleared. Without this, a volunteer who opened Sunday's event on Saturday and
 * never exited would find every serving surface empty on the morning they are
 * actually serving.
 *
 * A preview plan that appears in NEITHER list (unassigned since, plan deleted)
 * resolves to no plans, and the screens fall back to their existing empty state.
 */
import { useEffect, useMemo } from "react";
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
  const enterServingMode = useEventModeStore((s) => s.enter);
  const cachedPlans = useCachedServingPlans(eligibility?.plans);
  const upcomingPlans = eligibility?.upcomingPlans;

  // The previewed event's day has arrived: it's in today's plans now, so this
  // is plain serving mode.
  const previewIsNowSameDay =
    !!previewPlanId && cachedPlans.some((p) => p.planId === previewPlanId);

  // `enter()` drops `previewPlanId`, so the state converges instead of leaving
  // a stale preview id that would blank the surfaces again after a relaunch.
  useEffect(() => {
    if (previewIsNowSameDay) enterServingMode();
  }, [previewIsNowSameDay, enterServingMode]);

  return useMemo(() => {
    // Widen immediately rather than waiting for the effect — otherwise the
    // surfaces render empty for a frame on the transition.
    if (!previewPlanId || previewIsNowSameDay) return cachedPlans;
    const preview = upcomingPlans?.find((p) => p.planId === previewPlanId);
    return preview ? [preview] : NO_PLANS;
  }, [previewPlanId, previewIsNowSameDay, cachedPlans, upcomingPlans]);
}
