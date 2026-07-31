/**
 * Inbox Group Collapse Store
 *
 * Zustand + AsyncStorage store for whether a group's channel cluster is
 * collapsed in the Chats list (`ChatInboxScreen` / `GroupedInboxItem`).
 * Default is expanded — a group with no entry here shows its channel
 * sub-rows; collapsing hides them while the group's own row stays visible
 * and tappable. Persists across app launches (the whole point: "I will make
 * sure it remembers").
 *
 * This is a pure UI preference, not offline data, so it's modeled on
 * `gridColumnWidths.ts` rather than the `*Cache.ts` offline stores. Like that
 * store, it DOES need a `.web.ts` counterpart (`inboxGroupCollapse.web.ts`) —
 * not because the preference is web-irrelevant (the Chats list renders on
 * web too, and collapse state should persist there as well), but because
 * zustand v5's `persist` middleware reads a bundler-only build-mode global
 * that crashes the web bundle (see `__tests__/web-bundle-safety.test.ts`).
 * The web counterpart re-implements the same API over
 * `useSyncExternalStore` + `localStorage` instead.
 *
 * Deliberately kept separate from `features/chat/hooks/useExpandedGroups.ts`:
 * that hook decides, for a group whose channel rows ARE showing, how many
 * sub-rows are visible (capped at `MAX_SECONDARY_CHANNELS` vs. all channels,
 * toggled by a long-press). This store instead decides whether the channel
 * rows show AT ALL, via the collapse chevron on the group row. The two
 * compose: when a group is collapsed here, no sub-rows render regardless of
 * `useExpandedGroups`' cap state.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface InboxGroupCollapseState {
  /** Group IDs the user has explicitly collapsed. Absence = expanded (default). */
  collapsedGroupIds: Record<string, true>;
  /**
   * Whether the persisted state has finished rehydrating from AsyncStorage.
   * Rehydration is async, so on first render this store still holds its
   * default `collapsedGroupIds: {}` — a previously-collapsed group would
   * briefly render expanded, then snap shut once the saved copy lands.
   * Mirrors `eventModeStore.ts`'s `hasHydrated`. Not persisted — it describes
   * this session's hydration, not user state.
   */
  hasHydrated: boolean;
  /** Flip one group's collapsed state. */
  toggleCollapsed: (groupId: string) => void;
  /** Whether a group is currently collapsed (`false` when never toggled). */
  isCollapsed: (groupId: string) => boolean;
  /** Mark rehydration complete (called once from `onRehydrateStorage`). */
  setHasHydrated: (value: boolean) => void;
  /** Wipe everything (logout / community-switch cleanup). */
  clearAll: () => void;
}

export const useInboxGroupCollapse = create<InboxGroupCollapseState>()(
  persist(
    (set, get) => ({
      collapsedGroupIds: {},
      hasHydrated: false,

      toggleCollapsed: (groupId) => {
        set((state) => {
          const next = { ...state.collapsedGroupIds };
          if (next[groupId]) {
            delete next[groupId];
          } else {
            next[groupId] = true;
          }
          return { collapsedGroupIds: next };
        });
      },

      isCollapsed: (groupId) => Boolean(get().collapsedGroupIds[groupId]),

      setHasHydrated: (value: boolean) => {
        set({ hasHydrated: value });
      },

      clearAll: () => set({ collapsedGroupIds: {} }),
    }),
    {
      name: "inbox-group-collapse",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ collapsedGroupIds: state.collapsedGroupIds }),
      // Runs after every rehydration attempt — the normal path, the empty
      // first-launch case, AND the error path (a failed AsyncStorage read /
      // deserialize passes `state === undefined`). Flip the flag
      // unconditionally via the store handle so a failed read degrades to
      // the default (expanded) rather than leaving consumers gated forever.
      onRehydrateStorage: () => () => {
        useInboxGroupCollapse.setState({ hasHydrated: true });
      },
    },
  ),
);
