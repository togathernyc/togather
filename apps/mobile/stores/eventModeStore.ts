/**
 * Event Mode Store (Serving Mode)
 *
 * Zustand store — persisted to AsyncStorage — tracking whether the user is
 * currently in "serving mode".
 *
 * Serving mode is a focused experience: the tab bar collapses to Inbox,
 * Runsheet, Tasks, Profile, and Exit (see `app/(tabs)/_layout.tsx`), and every
 * serving tab shows ALL the plans the user is serving today (one section per
 * plan/group), so the store no longer pins a single "active plan" — the eligible
 * plans come from `getServingEligibility`. Only the on/off state is persisted so
 * it survives app restarts.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface EventModeState {
  /** Whether the user is currently in serving mode. */
  isServingMode: boolean;
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
  /** Enter serving mode. */
  enter: () => void;
  /** Exit serving mode. */
  exit: () => void;
}

export const useEventModeStore = create<EventModeState>()(
  persist(
    (set) => ({
      isServingMode: false,
      autoEnterBlocked: false,
      hasHydrated: false,

      setHasHydrated: (value: boolean) => {
        set({ hasHydrated: value });
      },

      enter: () => {
        set({ isServingMode: true });
      },

      exit: () => {
        set({ isServingMode: false, autoEnterBlocked: true });
      },
    }),
    {
      name: 'event-mode',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        isServingMode: state.isServingMode,
      }),
      // Runs after every rehydration attempt — the normal path, the empty
      // first-launch case, AND the error path, where Zustand invokes this with
      // `state === undefined` (a failed AsyncStorage read / deserialize). Flip
      // the flag unconditionally via the store handle so a failed read degrades
      // to defaults (regular inbox) instead of leaving serving-mode-aware screens
      // stuck on their loading gate forever.
      onRehydrateStorage: () => () => {
        useEventModeStore.setState({ hasHydrated: true });
      },
    }
  )
);
