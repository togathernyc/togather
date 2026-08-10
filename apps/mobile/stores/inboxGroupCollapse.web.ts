/**
 * Inbox Group Collapse Store (Web)
 *
 * Web counterpart of `inboxGroupCollapse.ts`. The native store persists via
 * zustand's `persist` middleware, which reads a bundler-only build-mode global
 * that breaks the web bundle (see `__tests__/web-bundle-safety.test.ts`). This
 * file provides a bundle-safe reactive store with the SAME public API, backed
 * by React's `useSyncExternalStore` + a module-level state and a Set of
 * listeners — same approach as `gridColumnWidths.web.ts`.
 *
 * The Chats list renders on web too (desktop sidebar mode), so this is fully
 * functional and persists to `localStorage` (guarded, SSR-safe) rather than a
 * no-op stub — collapsed groups should stay collapsed across a refresh here
 * exactly like on native.
 */
import { useSyncExternalStore } from 'react';

interface InboxGroupCollapseState {
  collapsedGroupIds: Record<string, true>;
  /**
   * Always `true` on web — persisted state loads synchronously from
   * localStorage (no async rehydration), so there's nothing to wait for.
   * Mirrors the native store's flag for API parity.
   */
  hasHydrated: boolean;
  toggleCollapsed: (groupId: string) => void;
  isCollapsed: (groupId: string) => boolean;
  /** No-op on web (state is already hydrated); present for API parity. */
  setHasHydrated: (value: boolean) => void;
  clearAll: () => void;
}

const STORAGE_KEY = 'inbox-group-collapse';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

function loadPersisted(): Record<string, true> {
  if (!hasStorage()) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as {
      collapsedGroupIds?: Record<string, true>;
    };
    return parsed.collapsedGroupIds ?? {};
  } catch {
    return {};
  }
}

function persist(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ collapsedGroupIds: state.collapsedGroupIds })
    );
  } catch {
    // Ignore quota / privacy-mode failures — persistence is best-effort.
  }
}

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

const state: InboxGroupCollapseState = {
  collapsedGroupIds: loadPersisted(),
  hasHydrated: true,
  toggleCollapsed: (groupId) => {
    const next = { ...state.collapsedGroupIds };
    if (next[groupId]) {
      delete next[groupId];
    } else {
      next[groupId] = true;
    }
    state.collapsedGroupIds = next;
    snapshot = makeSnapshot();
    persist();
    emit();
  },
  isCollapsed: (groupId) => Boolean(state.collapsedGroupIds[groupId]),
  setHasHydrated: () => {
    // No-op: web hydrates synchronously in loadPersisted().
  },
  clearAll: () => {
    state.collapsedGroupIds = {};
    snapshot = makeSnapshot();
    persist();
    emit();
  },
};

function makeSnapshot(): InboxGroupCollapseState {
  return {
    collapsedGroupIds: state.collapsedGroupIds,
    hasHydrated: state.hasHydrated,
    toggleCollapsed: state.toggleCollapsed,
    isCollapsed: state.isCollapsed,
    setHasHydrated: state.setHasHydrated,
    clearAll: state.clearAll,
  };
}

/** Immutable snapshot for `useSyncExternalStore`; rebuilt on every mutation. */
let snapshot: InboxGroupCollapseState = makeSnapshot();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): InboxGroupCollapseState {
  return snapshot;
}

function useInboxGroupCollapseHook(): InboxGroupCollapseState;
function useInboxGroupCollapseHook<T>(selector: (s: InboxGroupCollapseState) => T): T;
function useInboxGroupCollapseHook<T>(
  selector?: (s: InboxGroupCollapseState) => T
): T | InboxGroupCollapseState {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return selector ? selector(snap) : snap;
}

export const useInboxGroupCollapse = Object.assign(useInboxGroupCollapseHook, {
  getState: (): InboxGroupCollapseState => state,
});
