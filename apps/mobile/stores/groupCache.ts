/**
 * Group Cache Store
 *
 * Zustand store with AsyncStorage persistence for offline group data access.
 * Provides stale-while-revalidate pattern for group details, members, and leaders.
 *
 * Shared by both group detail page and chat room screen:
 * - Chat room uses `setGroupDetails` / `getGroupDetails` for toolbar data
 * - Group detail page uses `setFullGroupData` / `getFullGroupData` for complete data
 *
 * - 24 hour expiry
 * - Max 50 groups, evict oldest
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_GROUPS = 50;

interface CachedGroup {
  details: any; // Raw getById response (name, toolbar config, userRole, etc.)
  members?: any[]; // From groupMembers.list (group detail page only)
  leaders?: any[]; // From getLeaders (group detail page only)
  memberPreview?: any; // From getMemberPreview (group detail page only)
  leaderPreview?: any; // From getLeaderPreview (public — used by non-members)
  timestamp: number;
}

interface GroupCacheState {
  groups: Record<string, CachedGroup>;
  setGroupDetails: (groupId: string, details: any) => void;
  setFullGroupData: (
    groupId: string,
    data: {
      details: any;
      members?: any[];
      leaders?: any[];
      memberPreview?: any;
      leaderPreview?: any;
    }
  ) => void;
  getGroupDetails: (groupId: string) => any | null;
  getFullGroupData: (groupId: string) => CachedGroup | null;
  clearAll: () => void;
}

function evictOldest(groups: Record<string, CachedGroup>): Record<string, CachedGroup> {
  const entries = Object.entries(groups);
  if (entries.length <= MAX_GROUPS) return groups;

  const sorted = entries.sort(
    ([, a], [, b]) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
  );
  const toRemove = sorted.slice(0, entries.length - MAX_GROUPS);
  const result = { ...groups };
  toRemove.forEach(([key]) => delete result[key]);
  return result;
}

export const useGroupCache = create<GroupCacheState>()(
  persist(
    (set, get) => ({
      groups: {},

      setGroupDetails: (groupId: string, details: any) => {
        set((state) => {
          const existing = state.groups[groupId];
          const groups = evictOldest({
            ...state.groups,
            [groupId]: {
              ...existing,
              details,
              timestamp: Date.now(),
            },
          });
          return { groups };
        });
      },

      setFullGroupData: (groupId, data) => {
        set((state) => {
          const groups = evictOldest({
            ...state.groups,
            [groupId]: {
              details: data.details,
              members: data.members,
              leaders: data.leaders,
              memberPreview: data.memberPreview,
              leaderPreview: data.leaderPreview,
              timestamp: Date.now(),
            },
          });
          return { groups };
        });
      },

      getGroupDetails: (groupId: string) => {
        const cached = get().groups[groupId];
        if (!cached) return null;
        if (Date.now() - cached.timestamp > CACHE_EXPIRY_MS) return null;
        return cached.details;
      },

      getFullGroupData: (groupId: string) => {
        const cached = get().groups[groupId];
        if (!cached) return null;
        if (Date.now() - cached.timestamp > CACHE_EXPIRY_MS) return null;
        return cached;
      },

      clearAll: () => {
        set({ groups: {} });
      },
    }),
    {
      name: "group-cache",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ groups: state.groups }),
    }
  )
);
