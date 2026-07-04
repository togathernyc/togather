/**
 * Serving Tasks Cache Store
 *
 * Zustand + AsyncStorage cache for the serving-mode Tasks tab. Caches the result
 * of each task-section query per plan so a volunteer can view their tasks
 * offline:
 *   - `mine`     → `getMyServingTasks`   (grouped { before, during, after })
 *   - `shared`   → `getSharedTeamTasks`  (flat array)
 *   - `crew`     → `getCrewTasks`        (flat array, read-only rollup)
 *   - `allTeams` → `getAllTeamsTasks`    (flat array, read-only rollup)
 *
 * Stale-while-revalidate: online, screens read the live Convex query; offline
 * they fall back to `getSectionStale` (any age — a day-old serving list is
 * better than nothing). Entries LRU-evict at MAX_ENTRIES; there is no TTL,
 * since the offline fallback should surface whatever was last saved for the
 * plan being served. Completion writes made offline live in `servingTaskQueue`,
 * not here. See ADR-028.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { evictOldestByTimestamp } from "./cacheUtils";

export type ServingTaskSection = "mine" | "shared" | "crew" | "allTeams";

const MAX_ENTRIES = 40;

interface CachedEntry {
  data: any;
  timestamp: number;
}

interface ServingTasksCacheState {
  /** Cached sections, keyed `${section}:${planId}`. */
  entries: Record<string, CachedEntry>;
  setSection: (section: ServingTaskSection, planId: string, data: any) => void;
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
          entries: evictOldestByTimestamp(
            { ...state.entries, [key]: { data, timestamp: Date.now() } },
            MAX_ENTRIES,
          ),
        }));
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
