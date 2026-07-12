/**
 * Event Mode Store (Web)
 *
 * Web counterpart of `eventModeStore.ts`. The native store persists to
 * AsyncStorage (a native-only module that breaks the web bundle), so this file
 * provides a bundle-safe reactive store with the same public API.
 *
 * It's backed by React's `useSyncExternalStore` (a module-level state + a Set of
 * listeners) rather than zustand, so it stays dependency-free and re-renders any
 * subscriber when `isServingMode` changes — which is what makes
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
  /**
   * Session-only guard: set when the user manually exits, to suppress backend
   * auto-enter for the rest of the session. NOT persisted, so a refresh is
   * allowed to auto-enter again. Mirrors the native store.
   */
  autoEnterBlocked: boolean;
  /**
   * Always `true` on web — persisted state loads synchronously from
   * localStorage (no async rehydration), so there's nothing to wait for.
   * Mirrors the native flag so serving-mode-aware screens don't gate forever.
   */
  hasHydrated: boolean;
  /** No-op on web (state is already hydrated); present for API parity. */
  setHasHydrated: (value: boolean) => void;
  /** Enter serving mode. */
  enter: () => void;
  /** Exit serving mode. */
  exit: () => void;
}

const STORAGE_KEY = 'event-mode';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

function loadPersisted(): { isServingMode: boolean } {
  if (!hasStorage()) return { isServingMode: false };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { isServingMode: false };
    const parsed = JSON.parse(raw) as {
      isServingMode?: boolean;
    };
    return {
      isServingMode: !!parsed.isServingMode,
    };
  } catch {
    return { isServingMode: false };
  }
}

function persist(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        isServingMode: state.isServingMode,
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
  autoEnterBlocked: false,
  hasHydrated: true,
  setHasHydrated: () => {
    // No-op: web hydrates synchronously in loadPersisted().
  },
  enter: () => {
    state.isServingMode = true;
    snapshot = makeSnapshot();
    persist();
    emit();
  },
  exit: () => {
    state.isServingMode = false;
    state.autoEnterBlocked = true;
    snapshot = makeSnapshot();
    persist();
    emit();
  },
};

function makeSnapshot(): EventModeState {
  return {
    isServingMode: state.isServingMode,
    autoEnterBlocked: state.autoEnterBlocked,
    hasHydrated: state.hasHydrated,
    setHasHydrated: state.setHasHydrated,
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
