/**
 * Serving Plans Cache Store
 *
 * Zustand + AsyncStorage cache for the list of plans the user is serving today
 * (`getServingEligibility().plans`). Serving mode no longer pins a single
 * persisted `activePlanId` — every serving tab fans out over ALL eligible plans
 * — so the plan LIST itself must survive offline, otherwise a volunteer with no
 * signal at the venue would have no plan ids to key the per-plan run-sheet/tasks
 * caches by and every serving tab would render empty.
 *
 * Stale-while-revalidate: online, screens read the live `getServingEligibility`
 * query; offline they fall back to `getPlansStale` (any age — a day-old roster
 * is better than nothing). Single slot; no TTL. See ADR-028.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** Minimal plan shape the serving tabs need to render their per-plan sections. */
export interface CachedServingPlan {
  planId: string;
  groupId: string;
  title: string;
  startsAt: number;
  endsAt: number;
}

interface ServingPlansCacheState {
  plans: CachedServingPlan[] | null;
  timestamp: number | null;
  setPlans: (plans: CachedServingPlan[]) => void;
  /** The last-saved plans regardless of age (offline fallback), or null. */
  getPlansStale: () => CachedServingPlan[] | null;
  clearAll: () => void;
}

export const useServingPlansCache = create<ServingPlansCacheState>()(
  persist(
    (set, get) => ({
      plans: null,
      timestamp: null,

      setPlans: (plans) => set({ plans, timestamp: Date.now() }),

      getPlansStale: () => get().plans,

      clearAll: () => set({ plans: null, timestamp: null }),
    }),
    {
      name: "serving-plans-cache",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        plans: state.plans,
        timestamp: state.timestamp,
      }),
    },
  ),
);
