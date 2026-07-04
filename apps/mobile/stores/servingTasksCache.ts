/**
 * Serving Tasks Cache Store
 *
 * Zustand + AsyncStorage stale-while-revalidate cache for the serving-mode
 * Tasks tab. Caches the result of each task-section query per plan so a
 * volunteer can view their tasks offline:
 *   - `mine`     → `getMyServingTasks`   (grouped { before, during, after })
 *   - `shared`   → `getSharedTeamTasks`  (flat array)
 *   - `crew`     → `getCrewTasks`        (flat array, read-only rollup)
 *   - `allTeams` → `getAllTeamsTasks`    (flat array, read-only rollup)
 *
 * TTL is 12h (a service day). Stale getters ignore age for the offline
 * fallback. Completion writes made offline live in `servingTaskQueue`, not
 * here — this store is read-only display data. See ADR-028.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ServingTaskSection = "mine" | "shared" | "crew" | "allTeams";

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

interface ServingTasksCacheState {
  /** Cached sections, keyed `${section}:${planId}`. */
  entries: Record<string, CachedEntry>;
  setSection: (section: ServingTaskSection, planId: string, data: any) => void;
  /** Non-expired entry only (preferred while online). */
  getSection: (section: ServingTaskSection, planId: string) => any | null;
  /** Cached entry regardless of age (offline fallback). */
  getSectionStale: (section: ServingTaskSection, planId: string) => any | null;
  clearAll: () => void;
}

export const useServingTasksCache = create<ServingTasksCacheState>()(
  persist(
    (set, get) => ({
      entries: {},

      setSection: (section, planId, data) => {
        const key = `${section}:${planId}`;
        set((state) => ({
          entries: evictOldest({
            ...state.entries,
            [key]: { data, timestamp: Date.now() },
          }),
        }));
      },

      getSection: (section, planId) => {
        const cached = get().entries[`${section}:${planId}`];
        if (!cached) return null;
        if (Date.now() - cached.timestamp > CACHE_EXPIRY_MS) return null;
        return cached.data;
      },

      getSectionStale: (section, planId) =>
        get().entries[`${section}:${planId}`]?.data ?? null,

      clearAll: () => set({ entries: {} }),
    }),
    {
      name: "serving-tasks-cache",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ entries: state.entries }),
    },
  ),
);
