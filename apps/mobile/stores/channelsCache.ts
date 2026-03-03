/**
 * Channels Cache Store
 *
 * Zustand store with AsyncStorage persistence for offline channel list access.
 * Provides stale-while-revalidate pattern for group channel lists.
 *
 * Shared by both group detail page (ChannelsSection) and chat room (tab bar).
 * Zeros `unreadCount` on each channel before storing to avoid stale badge counts.
 *
 * - 24 hour expiry
 * - Max 50 groups, evict oldest
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_GROUPS = 50;

interface CachedChannels {
  channels: any[]; // Channel[] from listGroupChannels
  timestamp: number;
}

interface ChannelsCacheState {
  groups: Record<string, CachedChannels>;
  setGroupChannels: (groupId: string, channels: any[]) => void;
  getGroupChannels: (groupId: string) => any[] | null;
  clearAll: () => void;
}

function evictOldest(groups: Record<string, CachedChannels>): Record<string, CachedChannels> {
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

export const useChannelsCache = create<ChannelsCacheState>()(
  persist(
    (set, get) => ({
      groups: {},

      setGroupChannels: (groupId: string, channels: any[]) => {
        // Zero out unread counts before caching to avoid stale badges
        const sanitized = channels.map((ch) => ({
          ...ch,
          unreadCount: 0,
        }));

        set((state) => {
          const groups = evictOldest({
            ...state.groups,
            [groupId]: {
              channels: sanitized,
              timestamp: Date.now(),
            },
          });
          return { groups };
        });
      },

      getGroupChannels: (groupId: string) => {
        const cached = get().groups[groupId];
        if (!cached) return null;
        if (Date.now() - cached.timestamp > CACHE_EXPIRY_MS) return null;
        return cached.channels;
      },

      clearAll: () => {
        set({ groups: {} });
      },
    }),
    {
      name: "channels-cache",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ groups: state.groups }),
    }
  )
);
