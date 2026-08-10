/**
 * Serving Run Sheet Cache Store
 *
 * Zustand + AsyncStorage cache for the NATIVE run sheet (ADR-026) shown in
 * serving mode. Distinct from `runSheetCache`, which caches the PCO run sheet
 * fetched via actions; this one caches the reactive Convex queries the native
 * serving run sheet is built from:
 *   - `listEvents(groupId)`   → the group's upcoming plans          (key: groupId)
 *   - `getEvent(planId)`      → a plan's header + roles + items     (key: planId)
 *   - `eventItems.listItems(planId)` → the plan's run-sheet items   (key: planId)
 *
 * Stale-while-revalidate: online, screens read the live Convex query; offline
 * they fall back to the `*Stale` getters (any age). Entries LRU-evict at
 * MAX_ENTRIES; there is no TTL — the offline fallback should surface whatever
 * was last saved for the plan being served. See ADR-028.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { evictOldestByTimestamp } from "./cacheUtils";

const MAX_ENTRIES = 40;

interface CachedEntry {
  data: any;
  timestamp: number;
}

interface ServingRunSheetCacheState {
  /** All cached blobs, keyed `plans:${groupId}` / `event:${planId}` / `items:${planId}`. */
  entries: Record<string, CachedEntry>;

  setPlans: (groupId: string, data: any) => void;
  getPlansStale: (groupId: string) => any | null;

  setEvent: (planId: string, data: any) => void;
  getEventStale: (planId: string) => any | null;

  setItems: (planId: string, data: any) => void;
  getItemsStale: (planId: string) => any | null;

  clearAll: () => void;
}

export const useServingRunSheetCache = create<ServingRunSheetCacheState>()(
  persist(
    (set, get) => {
      const setEntry = (key: string, data: any) =>
        set((state) => ({
          entries: evictOldestByTimestamp(
            { ...state.entries, [key]: { data, timestamp: Date.now() } },
            MAX_ENTRIES,
          ),
        }));
      const getStale = (key: string) => get().entries[key]?.data ?? null;

      return {
        entries: {},

        setPlans: (groupId, data) => setEntry(`plans:${groupId}`, data),
        getPlansStale: (groupId) => getStale(`plans:${groupId}`),

        setEvent: (planId, data) => setEntry(`event:${planId}`, data),
        getEventStale: (planId) => getStale(`event:${planId}`),

        setItems: (planId, data) => setEntry(`items:${planId}`, data),
        getItemsStale: (planId) => getStale(`items:${planId}`),

        clearAll: () => set({ entries: {} }),
      };
    },
    {
      name: "serving-runsheet-cache",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ entries: state.entries }),
    },
  ),
);
