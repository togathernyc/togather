/**
 * Event Mode Store (Serving Mode)
 *
 * Zustand store — persisted to AsyncStorage — tracking whether the user is
 * currently in "serving mode" and, if so, which event plan they're serving on.
 *
 * Serving mode is a focused experience: the tab bar collapses to Inbox,
 * Runsheet, Tasks, Profile, and Exit (see `app/(tabs)/_layout.tsx`), and the
 * inbox is filtered to the plan's serving channels. The active plan id drives
 * every serving-scoped query, so it must survive app restarts — hence
 * persistence.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface EventModeState {
  /** Whether the user is currently in serving mode. */
  isServingMode: boolean;
  /** The plan the user is serving on, or null when not in serving mode. */
  activePlanId: string | null;
  /**
   * Session-only guard: set when the user manually exits, to suppress backend
   * auto-enter for the rest of the app session. Deliberately NOT persisted (see
   * `partialize`), so a fresh launch is allowed to auto-enter again. Lives in
   * the store rather than a component ref because exiting remounts the tab
   * navigator (`app/(tabs)/_layout.tsx` keys on serving mode) — a ref would
   * reset on that remount and immediately re-enter, making Exit appear broken.
   */
  autoEnterBlocked: boolean;
  /**
   * Whether the persisted state has finished rehydrating from AsyncStorage.
   * Rehydration is async, so on first render the store still holds its default
   * `isServingMode: false`. Screens that branch on serving mode (the inbox
   * filters itself to the active plan) must wait for this before rendering, or
   * they briefly show the full regular inbox before stripping down to serving
   * mode. Not persisted — it describes this session's hydration, not user state.
   */
  hasHydrated: boolean;
  /** Mark rehydration complete (called once from `onRehydrateStorage`). */
  setHasHydrated: (value: boolean) => void;
  /** Enter serving mode for a plan. */
  enter: (planId: string) => void;
  /** Exit serving mode and clear the active plan. */
  exit: () => void;
}

export const useEventModeStore = create<EventModeState>()(
  persist(
    (set) => ({
      isServingMode: false,
      activePlanId: null,
      autoEnterBlocked: false,
      hasHydrated: false,

      setHasHydrated: (value: boolean) => {
        set({ hasHydrated: value });
      },

      enter: (planId: string) => {
        set({ isServingMode: true, activePlanId: planId });
      },

      exit: () => {
        set({ isServingMode: false, activePlanId: null, autoEnterBlocked: true });
      },
    }),
    {
      name: 'event-mode',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        isServingMode: state.isServingMode,
        activePlanId: state.activePlanId,
      }),
      // Runs once rehydration from AsyncStorage completes (including the empty
      // first-launch case). Flip the flag so serving-mode-aware screens know the
      // real state is now in place.
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
