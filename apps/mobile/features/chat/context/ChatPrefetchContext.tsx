/**
 * ChatPrefetchContext - Prefetch system for chat messages and metadata
 *
 * Prefetches messages + link previews + event data when viewing inbox,
 * so chat rooms render immediately without layout jumps.
 *
 * Features:
 * - Prefetches messages, link previews, and event data in parallel
 * - Stores prefetched data per channel with LRU eviction (keeps last 10)
 * - Provides isChannelReady check and waitForPrefetch promise
 * - Components use cached data to avoid redundant fetches
 */
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useMemo,
  ReactNode,
} from 'react';
import type { Id } from '@services/api/convex';
import type { LinkPreviewData } from '../hooks/useLinkPreview';
import type { RsvpOption } from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * Event data fetched for event link cards
 */
export interface PrefetchedEventData {
  id: string;
  shortId: string;
  title: string;
  scheduledAt?: string;
  coverImage?: string | null;
  locationOverride?: string;
  meetingType?: number;
  rsvpEnabled?: boolean;
  rsvpOptions?: RsvpOption[];
  groupName?: string;
  communityName?: string;
  hasAccess?: boolean;
  accessPrompt?: { message: string } | null;
  status?: string;
}

/**
 * Tool data fetched for tool link cards
 */
export interface PrefetchedToolData {
  shortId: string;
  toolType: "runsheet" | "resource" | "task";
  groupId: string;
  groupName: string;
  resourceId?: string;
  resourceTitle?: string;
  resourceIcon?: string;
  taskId?: string;
  taskTitle?: string;
  taskStatus?: string;
}

/**
 * Message structure for prefetched messages
 */
export interface PrefetchedMessage {
  _id: Id<"chatMessages">;
  _creationTime: number;
  channelId: Id<"chatChannels">;
  senderId: Id<"users">;
  content: string;
  contentType: string;
  createdAt: number;
  updatedAt?: number;
  editedAt?: number;
  isDeleted: boolean;
  deletedAt?: number;
  parentMessageId?: Id<"chatMessages">;
  attachments?: Array<{
    type: string;
    url: string;
    name?: string;
    size?: number;
    mimeType?: string;
    thumbnailUrl?: string;
  }>;
  mentionedUserIds?: Id<"users">[];
  threadReplyCount?: number;
  senderName?: string;
  senderProfilePhoto?: string;
  hideLinkPreview?: boolean;
}

/**
 * Read receipt data for a message
 */
export interface PrefetchedReadReceipt {
  readByCount: number;
  totalMembers: number;
}

/**
 * Thread reply data for display
 */
export interface PrefetchedThreadReply {
  _id: string;
  senderId?: string;
  senderName?: string;
  senderProfilePhoto?: string;
  createdAt: number;
}

/**
 * Reaction data for a message
 */
export interface PrefetchedReaction {
  emoji: string;
  count: number;
  userIds: string[];
  hasReacted: boolean;
}

/**
 * Prefetch state for a single channel
 */
export interface ChannelPrefetchState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  messages: PrefetchedMessage[] | null;
  linkPreviews: Map<string, LinkPreviewData>;
  eventData: Map<string, PrefetchedEventData>;
  toolData: Map<string, PrefetchedToolData>;
  readReceipts: Map<string, PrefetchedReadReceipt>;
  threadReplies: Map<string, PrefetchedThreadReply[]>;
  reactions: Map<string, PrefetchedReaction[]>;
  lastPrefetchedAt: number;
  error?: string;
}

/**
 * Context value for chat prefetching
 */
export interface ChatPrefetchContextValue {
  /**
   * Get the current prefetch state for a channel
   */
  getPrefetchState: (channelId: Id<"chatChannels">) => ChannelPrefetchState | null;

  /**
   * Trigger prefetch for a channel (called when user is about to navigate)
   */
  prefetchChannel: (channelId: Id<"chatChannels">) => void;

  /**
   * Check if a channel's data is ready (prefetch complete)
   */
  isChannelReady: (channelId: Id<"chatChannels">) => boolean;

  /**
   * Wait for prefetch to complete (with timeout)
   * Resolves with prefetch state, or null if timed out
   */
  waitForPrefetch: (
    channelId: Id<"chatChannels">,
    timeoutMs?: number
  ) => Promise<ChannelPrefetchState | null>;

  /**
   * Update prefetch state (used internally by prefetch hooks)
   */
  updatePrefetchState: (
    channelId: Id<"chatChannels">,
    update: Partial<ChannelPrefetchState>
  ) => void;

  /**
   * Set the prefetch executor function (set by ChatPrefetchProvider wrapper)
   */
  setPrefetchExecutor: (executor: (channelId: Id<"chatChannels">) => void) => void;
}

// ============================================================================
// Context
// ============================================================================

const ChatPrefetchContext = createContext<ChatPrefetchContextValue | null>(null);

// Maximum number of channels to keep in memory
const MAX_CACHED_CHANNELS = 10;

// ============================================================================
// Provider
// ============================================================================

interface ChatPrefetchProviderProps {
  children: ReactNode;
}

export function ChatPrefetchProvider({ children }: ChatPrefetchProviderProps) {
  // State: triggers re-renders when prefetch completes
  const [, forceUpdate] = useState(0);

  // Ref: source of truth for prefetch data (updated synchronously)
  // Using a ref ensures data is available immediately after update,
  // without waiting for React's render cycle
  const prefetchStatesRef = useRef<Map<string, ChannelPrefetchState>>(new Map());

  // Track access order for LRU eviction
  const accessOrderRef = useRef<string[]>([]);

  // Promise resolvers for waitForPrefetch
  const waitersRef = useRef<Map<string, Array<(state: ChannelPrefetchState | null) => void>>>(
    new Map()
  );

  // Prefetch executor (set by the wrapper component that has access to hooks)
  const prefetchExecutorRef = useRef<((channelId: Id<"chatChannels">) => void) | null>(null);

  /**
   * Update access order for LRU tracking
   */
  const updateAccessOrder = useCallback((channelId: string) => {
    const order = accessOrderRef.current;
    const index = order.indexOf(channelId);
    if (index !== -1) {
      order.splice(index, 1);
    }
    order.push(channelId);

    // Evict oldest if over limit
    while (order.length > MAX_CACHED_CHANNELS) {
      const oldestId = order.shift();
      if (oldestId) {
        prefetchStatesRef.current.delete(oldestId);
      }
    }
  }, []);

  /**
   * Get prefetch state for a channel
   * Reads from ref for immediate access (no render cycle delay)
   */
  const getPrefetchState = useCallback(
    (channelId: Id<"chatChannels">): ChannelPrefetchState | null => {
      const state = prefetchStatesRef.current.get(channelId);
      if (state) {
        updateAccessOrder(channelId);
      }
      return state ?? null;
    },
    [updateAccessOrder]
  );

  /**
   * Check if channel is ready
   * Reads from ref for immediate access
   */
  const isChannelReady = useCallback(
    (channelId: Id<"chatChannels">): boolean => {
      const state = prefetchStatesRef.current.get(channelId);
      return state?.status === 'ready';
    },
    []
  );

  /**
   * Trigger prefetch for a channel
   */
  const prefetchChannel = useCallback(
    (channelId: Id<"chatChannels">) => {
      const existingState = prefetchStatesRef.current.get(channelId);

      // Skip if already loading or ready (within 5 minutes)
      if (existingState) {
        if (existingState.status === 'loading') {
          return;
        }
        if (
          existingState.status === 'ready' &&
          Date.now() - existingState.lastPrefetchedAt < 5 * 60 * 1000
        ) {
          updateAccessOrder(channelId);
          return;
        }
      }

      // Initialize loading state (update ref synchronously)
      const loadingState: ChannelPrefetchState = {
        status: 'loading',
        messages: null,
        linkPreviews: new Map(),
        eventData: new Map(),
        toolData: new Map(),
        readReceipts: new Map(),
        threadReplies: new Map(),
        reactions: new Map(),
        lastPrefetchedAt: Date.now(),
      };
      prefetchStatesRef.current.set(channelId, loadingState);
      updateAccessOrder(channelId);

      // Trigger the actual prefetch
      if (prefetchExecutorRef.current) {
        prefetchExecutorRef.current(channelId);
      }
    },
    [updateAccessOrder]
  );

  /**
   * Update prefetch state for a channel
   * Updates ref SYNCHRONOUSLY so data is immediately available to consumers
   */
  const updatePrefetchState = useCallback(
    (channelId: Id<"chatChannels">, update: Partial<ChannelPrefetchState>) => {
      const existing = prefetchStatesRef.current.get(channelId) || {
        status: 'idle' as const,
        messages: null,
        linkPreviews: new Map(),
        eventData: new Map(),
        toolData: new Map(),
        readReceipts: new Map(),
        threadReplies: new Map(),
        reactions: new Map(),
        lastPrefetchedAt: Date.now(),
      };

      const updated: ChannelPrefetchState = {
        ...existing,
        ...update,
        // Merge maps if provided
        linkPreviews: update.linkPreviews
          ? new Map([...existing.linkPreviews, ...update.linkPreviews])
          : existing.linkPreviews,
        eventData: update.eventData
          ? new Map([...existing.eventData, ...update.eventData])
          : existing.eventData,
        toolData: update.toolData
          ? new Map([...existing.toolData, ...update.toolData])
          : existing.toolData,
        readReceipts: update.readReceipts
          ? new Map([...existing.readReceipts, ...update.readReceipts])
          : existing.readReceipts,
        threadReplies: update.threadReplies
          ? new Map([...existing.threadReplies, ...update.threadReplies])
          : existing.threadReplies,
        reactions: update.reactions
          ? new Map([...existing.reactions, ...update.reactions])
          : existing.reactions,
      };

      // Update ref synchronously - data is now immediately available!
      prefetchStatesRef.current.set(channelId, updated);

      // Resolve waiters if ready (they can now read from ref immediately)
      if (updated.status === 'ready' || updated.status === 'error') {
        const waiters = waitersRef.current.get(channelId) || [];
        waiters.forEach((resolve) => resolve(updated));
        waitersRef.current.delete(channelId);
      }

      // Trigger re-render for components that depend on state (optional for real-time updates)
      forceUpdate((n) => n + 1);
    },
    []
  );

  /**
   * Wait for prefetch to complete
   * Reads from ref for immediate access
   */
  const waitForPrefetch = useCallback(
    (channelId: Id<"chatChannels">, timeoutMs = 3000): Promise<ChannelPrefetchState | null> => {
      return new Promise((resolve) => {
        const state = prefetchStatesRef.current.get(channelId);

        // Already ready or error
        if (state && (state.status === 'ready' || state.status === 'error')) {
          resolve(state);
          return;
        }

        // Add to waiters
        const waiters = waitersRef.current.get(channelId) || [];
        waiters.push(resolve);
        waitersRef.current.set(channelId, waiters);

        // Timeout
        setTimeout(() => {
          const currentWaiters = waitersRef.current.get(channelId);
          if (currentWaiters) {
            const index = currentWaiters.indexOf(resolve);
            if (index !== -1) {
              currentWaiters.splice(index, 1);
              resolve(null); // Timed out
            }
          }
        }, timeoutMs);
      });
    },
    []
  );

  /**
   * Set the prefetch executor
   */
  const setPrefetchExecutor = useCallback(
    (executor: (channelId: Id<"chatChannels">) => void) => {
      prefetchExecutorRef.current = executor;
    },
    []
  );

  const value = useMemo(
    () => ({
      getPrefetchState,
      prefetchChannel,
      isChannelReady,
      waitForPrefetch,
      updatePrefetchState,
      setPrefetchExecutor,
    }),
    [
      getPrefetchState,
      prefetchChannel,
      isChannelReady,
      waitForPrefetch,
      updatePrefetchState,
      setPrefetchExecutor,
    ]
  );

  return (
    <ChatPrefetchContext.Provider value={value}>
      {children}
    </ChatPrefetchContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to access the chat prefetch context
 * Returns null if used outside of ChatPrefetchProvider
 */
export function useChatPrefetch(): ChatPrefetchContextValue | null {
  return useContext(ChatPrefetchContext);
}

/**
 * Hook to access the chat prefetch context, throwing if not available
 */
export function useChatPrefetchRequired(): ChatPrefetchContextValue {
  const context = useContext(ChatPrefetchContext);
  if (!context) {
    throw new Error('useChatPrefetchRequired must be used within ChatPrefetchProvider');
  }
  return context;
}
