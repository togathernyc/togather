/**
 * Event Mode Store (Web)
 *
 * Web counterpart of `eventModeStore.ts`. The native store persists to
 * AsyncStorage (a native-only module that breaks the web bundle), and the
 * web-bundle-safety convention forbids importing zustand in `.web.ts` files, so
 * this is a lightweight zustand-free store. Consumers call it with selectors
 * (e.g. `useEventModeStore((s) => s.isServingMode)`), so the callable applies
 * the selector when given one. Serving mode is a native experience; on web this
 * is effectively a non-reactive no-op that keeps the API surface intact.
 */

interface EventModeState {
  /** Whether the user is currently in serving mode. */
  isServingMode: boolean;
  /** The plan the user is serving on, or null when not in serving mode. */
  activePlanId: string | null;
  /** Enter serving mode for a plan. */
  enter: (planId: string) => void;
  /** Exit serving mode and clear the active plan. */
  exit: () => void;
}

const state: EventModeState = {
  isServingMode: false,
  activePlanId: null,
  enter: (planId: string) => {
    state.isServingMode = true;
    state.activePlanId = planId;
  },
  exit: () => {
    state.isServingMode = false;
    state.activePlanId = null;
  },
};

function selectState(): EventModeState;
function selectState<T>(selector: (s: EventModeState) => T): T;
function selectState<T>(selector?: (s: EventModeState) => T): T | EventModeState {
  return selector ? selector(state) : state;
}

export const useEventModeStore = Object.assign(selectState, {
  getState: () => state,
});
