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

      enter: (planId: string) => {
        set({ isServingMode: true, activePlanId: planId });
      },

      exit: () => {
        set({ isServingMode: false, activePlanId: null });
      },
    }),
    {
      name: 'event-mode',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        isServingMode: state.isServingMode,
        activePlanId: state.activePlanId,
      }),
    }
  )
);
