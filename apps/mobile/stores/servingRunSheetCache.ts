/**
 * Serving Run Sheet Cache Store
 *
 * Zustand + AsyncStorage stale-while-revalidate cache for the NATIVE run sheet
 * (ADR-026) shown in serving mode. Distinct from `runSheetCache`, which caches
 * the PCO run sheet fetched via actions; this one caches the reactive Convex
 * queries the native serving run sheet is built from:
 *   - `listEvents(groupId)`   → the group's upcoming plans          (key: groupId)
 *   - `getEvent(planId)`      → a plan's header + roles + items     (key: planId)
 *   - `eventItems.listItems(planId)` → the plan's run-sheet items   (key: planId)
 *
 * Serving happens on the event day, often with poor venue connectivity, so a
 * volunteer must be able to open their run sheet offline. TTL is 12h (a service
 * day); stale getters ignore age for the offline fallback. See ADR-028.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

const CACHE_EXPIRY_MS = 12 * 60 * 60 * 1000; // 12 hours (a service day)
const MAX_ENTRIES = 40;

interface CachedEntry {
  data: any;
  timestamp: number;
}

function evictOldest(
  entries: Record<string, CachedEntry>,
): Record<string, CachedEntry> {
  const all = Object.entries(entries);
  if (all.length <= MAX_ENTRIES) return entries;
  const sorted = all.sort(
    ([, a], [, b]) => (a.timestamp ?? 0) - (b.timestamp ?? 0),
  );
  const result = { ...entries };
  sorted
    .slice(0, all.length - MAX_ENTRIES)
    .forEach(([key]) => delete result[key]);
  return result;
}

interface ServingRunSheetCacheState {
  /** All cached blobs, keyed `plans:${groupId}` / `event:${planId}` / `items:${planId}`. */
  entries: Record<string, CachedEntry>;

  setPlans: (groupId: string, data: any) => void;
  getPlans: (groupId: string) => any | null;
  getPlansStale: (groupId: string) => any | null;

  setEvent: (planId: string, data: any) => void;
  getEvent: (planId: string) => any | null;
  getEventStale: (planId: string) => any | null;

  setItems: (planId: string, data: any) => void;
  getItems: (planId: string) => any | null;
  getItemsStale: (planId: string) => any | null;

  clearAll: () => void;
}

export const useServingRunSheetCache = create<ServingRunSheetCacheState>()(
  persist(
    (set, get) => {
      const setEntry = (key: string, data: any) =>
        set((state) => ({
          entries: evictOldest({
            ...state.entries,
            [key]: { data, timestamp: Date.now() },
          }),
        }));
      const getFresh = (key: string) => {
        const cached = get().entries[key];
        if (!cached) return null;
        if (Date.now() - cached.timestamp > CACHE_EXPIRY_MS) return null;
        return cached.data;
      };
      const getStale = (key: string) => get().entries[key]?.data ?? null;

      return {
        entries: {},

        setPlans: (groupId, data) => setEntry(`plans:${groupId}`, data),
        getPlans: (groupId) => getFresh(`plans:${groupId}`),
        getPlansStale: (groupId) => getStale(`plans:${groupId}`),

        setEvent: (planId, data) => setEntry(`event:${planId}`, data),
        getEvent: (planId) => getFresh(`event:${planId}`),
        getEventStale: (planId) => getStale(`event:${planId}`),

        setItems: (planId, data) => setEntry(`items:${planId}`, data),
        getItems: (planId) => getFresh(`items:${planId}`),
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
