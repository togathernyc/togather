/**
 * useCachedServingPlans
 *
 * Serving mode fans every tab out over ALL the plans the user is serving today
 * (from `getServingEligibility().plans`). This hook wraps that live list with the
 * offline plan cache (`servingPlansCache`) so the serving tabs keep rendering
 * their per-plan sections at a venue with no signal — the plan list is what the
 * per-plan run-sheet/tasks caches are keyed by.
 *
 * Stale-while-revalidate (ADR-028): whenever the live list resolves, persist it;
 * when it's still loading AND the device is offline, fall back to the last-saved
 * list. Online (and always on web) it returns the live list verbatim.
 */
import { useEffect } from "react";
import { useConnectionStatus } from "@providers/ConnectionProvider";
import {
  useServingPlansCache,
  type CachedServingPlan,
} from "@/stores/servingPlansCache";

export function useCachedServingPlans(
  livePlans: CachedServingPlan[] | undefined,
): CachedServingPlan[] {
  const { isNetworkAvailable } = useConnectionStatus();
  // Subscribe so AsyncStorage rehydration re-renders us on a cold offline launch.
  const cache = useServingPlansCache();

  useEffect(() => {
    if (livePlans !== undefined) {
      useServingPlansCache.getState().setPlans(livePlans);
    }
  }, [livePlans]);

  if (livePlans !== undefined) return livePlans;
  if (!isNetworkAvailable) {
    return (cache.getPlansStale() as CachedServingPlan[] | null) ?? [];
  }
  return [];
}
