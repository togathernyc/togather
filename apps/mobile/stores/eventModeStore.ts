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
 * plans come from `getServingEligibility`. Only the on/off state (and the
 * preview plan, below) is persisted so it survives app restarts.
 *
 * A volunteer can also open an UPCOMING event early to prepare. That sets
 * `previewPlanId`, and every serving surface then scopes to that ONE plan
 * instead of today's eligible plans — see `useServingPlans`.
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
  /**
   * The upcoming plan the user opened EARLY (from My Schedule), or null when
   * serving normally. While set, the serving tabs and the serving inbox scope
   * to this single plan rather than today's eligible plans — a preview of one
   * event, never a union across every future event.
   */
  previewPlanId: string | null;
  /** Mark rehydration complete (called once from `onRehydrateStorage`). */
  setHasHydrated: (value: boolean) => void;
  /** Enter serving mode for today's eligible plans (clears any preview). */
  enter: () => void;
  /** Enter serving mode scoped to a single upcoming plan, opened early. */
  enterPreview: (planId: string) => void;
  /** Exit serving mode. */
  exit: () => void;
}

export const useEventModeStore = create<EventModeState>()(
  persist(
    (set) => ({
      isServingMode: false,
      autoEnterBlocked: false,
      hasHydrated: false,
      previewPlanId: null,

      setHasHydrated: (value: boolean) => {
        set({ hasHydrated: value });
      },

      enter: () => {
        set({ isServingMode: true, previewPlanId: null });
      },

      enterPreview: (planId: string) => {
        set({ isServingMode: true, previewPlanId: planId });
      },

      exit: () => {
        set({
          isServingMode: false,
          autoEnterBlocked: true,
          previewPlanId: null,
        });
      },
    }),
    {
      name: 'event-mode',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        isServingMode: state.isServingMode,
        // Persisted alongside the flag: relaunching into serving mode without
        // it would silently widen a preview back to today's plans (usually
        // none), leaving every serving tab empty.
        previewPlanId: state.previewPlanId,
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
