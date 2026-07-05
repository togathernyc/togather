/**
 * Grid Column Widths Store (Web)
 *
 * Web counterpart of `gridColumnWidths.ts`. The native store persists via
 * zustand's `persist` middleware, which reads a bundler-only build-mode global
 * that breaks the web bundle (see `__tests__/web-bundle-safety.test.ts`). This file provides
 * a bundle-safe reactive store with the SAME public API, backed by React's
 * `useSyncExternalStore` + a module-level state and a Set of listeners.
 *
 * Unlike the offline data caches (whose web stubs are no-ops — that data is
 * irrelevant on web), column resizing is a WEB-PRIMARY feature: desktop is the
 * main surface for these wide tables. So this web store is fully functional and
 * persists to `localStorage` (guarded, SSR-safe) so dragged widths survive a
 * refresh, exactly like the native AsyncStorage-persisted store.
 */
import { useSyncExternalStore } from 'react';

interface GridColumnWidthsState {
  /** Overrides keyed `[storageKey][columnKey] = widthPx`. */
  widths: Record<string, Record<string, number>>;
  setWidth: (storageKey: string, columnKey: string, width: number) => void;
  resetColumn: (storageKey: string, columnKey: string) => void;
  getGridWidths: (storageKey: string) => Record<string, number>;
  clearAll: () => void;
}

const STORAGE_KEY = 'grid-column-widths';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

function loadPersisted(): Record<string, Record<string, number>> {
  if (!hasStorage()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as {
      widths?: Record<string, Record<string, number>>;
    };
    return parsed.widths ?? {};
  } catch {
    return {};
  }
}

function persist(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ widths: state.widths })
    );
  } catch {
    // Ignore quota / privacy-mode failures — persistence is best-effort.
  }
}

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

const state: GridColumnWidthsState = {
  widths: loadPersisted(),
  setWidth: (storageKey, columnKey, width) => {
    state.widths = {
      ...state.widths,
      [storageKey]: { ...(state.widths[storageKey] ?? {}), [columnKey]: width },
    };
    snapshot = makeSnapshot();
    persist();
    emit();
  },
  resetColumn: (storageKey, columnKey) => {
    const grid = state.widths[storageKey];
    if (!grid || !(columnKey in grid)) return;
    const { [columnKey]: _removed, ...rest } = grid;
    state.widths = { ...state.widths, [storageKey]: rest };
    snapshot = makeSnapshot();
    persist();
    emit();
  },
  getGridWidths: (storageKey) => state.widths[storageKey] ?? {},
  clearAll: () => {
    state.widths = {};
    snapshot = makeSnapshot();
    persist();
    emit();
  },
};

function makeSnapshot(): GridColumnWidthsState {
  return {
    widths: state.widths,
    setWidth: state.setWidth,
    resetColumn: state.resetColumn,
    getGridWidths: state.getGridWidths,
    clearAll: state.clearAll,
  };
}

/** Immutable snapshot for `useSyncExternalStore`; rebuilt on every mutation. */
let snapshot: GridColumnWidthsState = makeSnapshot();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): GridColumnWidthsState {
  return snapshot;
}

function useGridColumnWidthsHook(): GridColumnWidthsState;
function useGridColumnWidthsHook<T>(selector: (s: GridColumnWidthsState) => T): T;
function useGridColumnWidthsHook<T>(
  selector?: (s: GridColumnWidthsState) => T
): T | GridColumnWidthsState {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return selector ? selector(snap) : snap;
}

export const useGridColumnWidths = Object.assign(useGridColumnWidthsHook, {
  getState: (): GridColumnWidthsState => state,
});
