/**
 * Event Mode Store (Web)
 *
 * Web counterpart of `eventModeStore.ts`. The native store persists to
 * AsyncStorage (a native-only module that breaks the web bundle), so this file
 * provides a bundle-safe reactive store with the same public API.
 *
 * It's backed by React's `useSyncExternalStore` (a module-level state + a Set of
 * listeners) rather than zustand, so it stays dependency-free and re-renders any
 * subscriber when `isServingMode`/`activePlanId` change — which is what makes
 * serving mode actually work on desktop web. Consumers call it with selectors
 * (e.g. `useEventModeStore((s) => s.isServingMode)`); `getState()` is kept for
 * non-hook callers.
 *
 * Serving state is persisted to `localStorage` (guarded, SSR-safe) so it
 * survives a refresh like the native AsyncStorage-persisted store.
 */
import { useSyncExternalStore } from 'react';

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

const STORAGE_KEY = 'event-mode';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

function loadPersisted(): { isServingMode: boolean; activePlanId: string | null } {
  if (!hasStorage()) return { isServingMode: false, activePlanId: null };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { isServingMode: false, activePlanId: null };
    const parsed = JSON.parse(raw) as {
      isServingMode?: boolean;
      activePlanId?: string | null;
    };
    return {
      isServingMode: !!parsed.isServingMode,
      activePlanId: parsed.activePlanId ?? null,
    };
  } catch {
    return { isServingMode: false, activePlanId: null };
  }
}

function persist(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        isServingMode: state.isServingMode,
        activePlanId: state.activePlanId,
      })
    );
  } catch {
    // Ignore quota / privacy-mode failures — persistence is best-effort.
  }
}

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

const persisted = loadPersisted();

/**
 * Module-level snapshot. Mutators replace the reactive fields and re-emit so
 * `useSyncExternalStore` subscribers re-render. The identity of `state` stays
 * stable, but `getSnapshot` returns a versioned snapshot below so React detects
 * changes.
 */
const state: EventModeState = {
  isServingMode: persisted.isServingMode,
  activePlanId: persisted.activePlanId,
  enter: (planId: string) => {
    state.isServingMode = true;
    state.activePlanId = planId;
    snapshot = makeSnapshot();
    persist();
    emit();
  },
  exit: () => {
    state.isServingMode = false;
    state.activePlanId = null;
    snapshot = makeSnapshot();
    persist();
    emit();
  },
};

function makeSnapshot(): EventModeState {
  return {
    isServingMode: state.isServingMode,
    activePlanId: state.activePlanId,
    enter: state.enter,
    exit: state.exit,
  };
}

/**
 * Immutable snapshot handed to `useSyncExternalStore`. Rebuilt on every mutation
 * so React sees a new reference and re-renders subscribers.
 */
let snapshot: EventModeState = makeSnapshot();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): EventModeState {
  return snapshot;
}

function useEventModeStoreHook(): EventModeState;
function useEventModeStoreHook<T>(selector: (s: EventModeState) => T): T;
function useEventModeStoreHook<T>(
  selector?: (s: EventModeState) => T
): T | EventModeState {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return selector ? selector(snap) : snap;
}

export const useEventModeStore = Object.assign(useEventModeStoreHook, {
  getState: (): EventModeState => state,
});
