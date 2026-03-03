/**
 * Inbox Cache Store
 *
 * Zustand store with AsyncStorage persistence for offline inbox access.
 * Provides stale-while-revalidate pattern for the chat inbox channel list.
 *
 * - 24 hour expiry
 * - Keyed by communityId for multi-community support
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedInbox {
  channels: any[]; // InboxGroup[] from getInboxChannels query
  timestamp: number;
}

interface InboxCacheState {
  communities: Record<string, CachedInbox>;
  setInboxChannels: (communityId: string, channels: any[]) => void;
  getInboxChannels: (communityId: string) => any[] | null;
  clear: () => void;
}

export const useInboxCache = create<InboxCacheState>()(
  persist(
    (set, get) => ({
      communities: {},

      setInboxChannels: (communityId: string, channels: any[]) => {
        set((state) => ({
          communities: {
            ...state.communities,
            [communityId]: {
              channels,
              timestamp: Date.now(),
            },
          },
        }));
      },

      getInboxChannels: (communityId: string) => {
        const cached = get().communities[communityId];
        if (!cached) return null;

        // Check expiry
        if (Date.now() - cached.timestamp > CACHE_EXPIRY_MS) {
          return null;
        }

        return cached.channels;
      },

      clear: () => {
        set({ communities: {} });
      },
    }),
    {
      name: 'inbox-cache',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ communities: state.communities }),
    }
  )
);
