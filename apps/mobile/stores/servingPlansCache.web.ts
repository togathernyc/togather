/**
 * Serving Plans Cache Store (Web) - No-op
 *
 * Offline caching is a native-only concern. On web, all methods are no-ops and
 * the live query is always used.
 */
import type { CachedServingPlan } from "./servingPlansCache";

const noop = () => {};
const noopNull = () => null;

const state = {
  plans: null as CachedServingPlan[] | null,
  timestamp: null as number | null,
  setPlans: noop,
  getPlansStale: noopNull as () => CachedServingPlan[] | null,
  clearAll: noop,
};

const noopStore = {
  getState: () => state,
};

export const useServingPlansCache = Object.assign(() => state, noopStore);
export type { CachedServingPlan } from "./servingPlansCache";
