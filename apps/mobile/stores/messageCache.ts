/**
 * Message Cache Store
 *
 * Zustand store with AsyncStorage persistence for offline message access.
 * Provides stale-while-revalidate pattern for chat messages.
 *
 * Limits:
 * - 50 messages per channel
 * - 20 channels total
 * - 24 hour expiry
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

const MAX_MESSAGES_PER_CHANNEL = 50;
const MAX_CHANNELS = 20;
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedChannel {
  messages: any[];
  timestamp: number;
}

interface MessageCacheState {
  channels: Record<string, CachedChannel>;
  setChannelMessages: (channelId: string, messages: any[]) => void;
  getChannelMessages: (channelId: string) => any[] | null;
  clearChannel: (channelId: string) => void;
  clearAll: () => void;
}

export const useMessageCache = create<MessageCacheState>()(
  persist(
    (set, get) => ({
      channels: {},

      setChannelMessages: (channelId: string, messages: any[]) => {
        set((state) => {
          const channels = { ...state.channels };

          // Limit messages per channel (keep most recent)
          const limitedMessages =
            messages.length > MAX_MESSAGES_PER_CHANNEL
              ? messages.slice(-MAX_MESSAGES_PER_CHANNEL)
              : messages;

          channels[channelId] = {
            messages: limitedMessages,
            timestamp: Date.now(),
          };

          // Limit total channels (evict oldest)
          const channelIds = Object.keys(channels);
          if (channelIds.length > MAX_CHANNELS) {
            // Sort by timestamp, remove oldest
            const sorted = channelIds.sort(
              (a, b) =>
                (channels[a]?.timestamp ?? 0) - (channels[b]?.timestamp ?? 0)
            );
            const toRemove = sorted.slice(
              0,
              channelIds.length - MAX_CHANNELS
            );
            toRemove.forEach((id) => delete channels[id]);
          }

          return { channels };
        });
      },

      getChannelMessages: (channelId: string) => {
        const cached = get().channels[channelId];
        if (!cached) return null;

        // Check expiry
        if (Date.now() - cached.timestamp > CACHE_EXPIRY_MS) {
          return null;
        }

        return cached.messages;
      },

      clearChannel: (channelId: string) => {
        set((state) => {
          const channels = { ...state.channels };
          delete channels[channelId];
          return { channels };
        });
      },

      clearAll: () => {
        set({ channels: {} });
      },
    }),
    {
      name: 'message-cache',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ channels: state.channels }),
    }
  )
);
