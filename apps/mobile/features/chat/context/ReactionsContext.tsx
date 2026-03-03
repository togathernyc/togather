/**
 * Context for batch loading reactions across visible messages.
 *
 * Instead of each MessageItem fetching its own reactions independently
 * (which causes N separate queries for N messages), this context fetches
 * reactions for ALL visible message IDs in a single batch query.
 *
 * Individual useReactions hooks read from this shared context,
 * while still supporting optimistic updates for toggling reactions.
 */
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import { useAuthenticatedQuery, useAuthenticatedMutation, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';
import { useChatPrefetch, type PrefetchedReaction } from './ChatPrefetchContext';

/**
 * Reaction data for a message.
 */
export interface Reaction {
  emoji: string;
  count: number;
  userIds: Id<"users">[];
  hasReacted: boolean;
}

/**
 * Optimistic update for a specific message's reactions.
 */
interface OptimisticUpdate {
  messageId: string;
  reactions: Reaction[];
}

interface ReactionsContextValue {
  /**
   * Get reactions for a specific message from the batch cache.
   * Returns undefined if the message reactions haven't been loaded yet.
   */
  getReactions: (messageId: Id<"chatMessages">) => Reaction[] | undefined;

  /**
   * Whether reactions are currently loading.
   */
  isLoading: boolean;

  /**
   * Apply an optimistic update for a message's reactions.
   * Used by useReactions for immediate UI feedback when toggling.
   */
  applyOptimisticUpdate: (messageId: Id<"chatMessages">, reactions: Reaction[]) => void;

  /**
   * Clear optimistic update for a message (when server confirms).
   */
  clearOptimisticUpdate: (messageId: Id<"chatMessages">) => void;

  /**
   * Toggle reaction mutation for individual messages.
   */
  toggleReaction: (messageId: Id<"chatMessages">, emoji: string) => Promise<void>;
}

const ReactionsContext = createContext<ReactionsContextValue | null>(null);

interface ReactionsProviderProps {
  children: ReactNode;
  /**
   * Array of message IDs to fetch reactions for.
   * This should be the visible message IDs from the list.
   */
  messageIds: Id<"chatMessages">[];
  /**
   * Optional channel ID for accessing prefetched reactions.
   * When provided, prefetched data will be used instead of a fresh query.
   */
  channelId?: Id<"chatChannels"> | null;
}

export function ReactionsProvider({ children, messageIds, channelId }: ReactionsProviderProps) {
  // Optimistic updates map: messageId -> reactions
  const [optimisticUpdates, setOptimisticUpdates] = useState<Map<string, Reaction[]>>(
    new Map()
  );

  // Check prefetch context for cached reactions
  const prefetchContext = useChatPrefetch();
  const prefetchState = channelId ? prefetchContext?.getPrefetchState(channelId) : null;
  // Trust prefetch is complete when status is 'ready' (even if no reactions exist)
  const hasPrefetchedReactions = prefetchState?.status === 'ready';

  // Batch query for all message reactions
  // Always run for real-time updates, but use prefetch data while loading
  const batchReactions = useAuthenticatedQuery(
    api.functions.messaging.reactions.getReactionsForMessages,
    messageIds.length > 0 ? { messageIds } : 'skip'
  );

  // Toggle reaction mutation
  const toggleReactionMutation = useAuthenticatedMutation(
    api.functions.messaging.reactions.toggleReaction
  );

  /**
   * Get reactions for a specific message.
   * Prioritizes: optimistic updates > live query data > prefetched data.
   * Once live query loads, it takes over for real-time updates.
   */
  const getReactions = useCallback(
    (messageId: Id<"chatMessages">): Reaction[] | undefined => {
      const messageIdStr = messageId.toString();

      // Check for optimistic update first
      const optimistic = optimisticUpdates.get(messageIdStr);
      if (optimistic) {
        return optimistic;
      }

      // Prefer live query data when available (for real-time updates)
      if (batchReactions) {
        return batchReactions[messageIdStr] ?? [];
      }

      // Fall back to prefetched data while live query loads
      if (hasPrefetchedReactions && prefetchState?.reactions) {
        const prefetched = prefetchState.reactions.get(messageIdStr);
        if (prefetched) {
          // Convert string[] userIds to Id<"users">[]
          return prefetched.map((r) => ({
            emoji: r.emoji,
            count: r.count,
            userIds: r.userIds as unknown as Id<"users">[],
            hasReacted: r.hasReacted,
          }));
        }
        // Prefetch is ready but no reactions for this message = empty array
        return [];
      }

      // Still loading
      return undefined;
    },
    [batchReactions, optimisticUpdates, hasPrefetchedReactions, prefetchState?.reactions]
  );

  /**
   * Apply an optimistic update for immediate UI feedback.
   */
  const applyOptimisticUpdate = useCallback(
    (messageId: Id<"chatMessages">, reactions: Reaction[]) => {
      setOptimisticUpdates((prev) => {
        const next = new Map(prev);
        next.set(messageId.toString(), reactions);
        return next;
      });
    },
    []
  );

  /**
   * Clear optimistic update when server confirms.
   */
  const clearOptimisticUpdate = useCallback((messageId: Id<"chatMessages">) => {
    setOptimisticUpdates((prev) => {
      const next = new Map(prev);
      next.delete(messageId.toString());
      return next;
    });
  }, []);

  /**
   * Toggle a reaction on a message.
   */
  const toggleReaction = useCallback(
    async (messageId: Id<"chatMessages">, emoji: string) => {
      await toggleReactionMutation({
        messageId,
        emoji,
      });
    },
    [toggleReactionMutation]
  );

  // Not loading if we have prefetched data OR if the batch query has returned
  const isLoading = messageIds.length > 0 && !hasPrefetchedReactions && batchReactions === undefined;

  const value = useMemo(
    () => ({
      getReactions,
      isLoading,
      applyOptimisticUpdate,
      clearOptimisticUpdate,
      toggleReaction,
    }),
    [getReactions, isLoading, applyOptimisticUpdate, clearOptimisticUpdate, toggleReaction]
  );

  return (
    <ReactionsContext.Provider value={value}>
      {children}
    </ReactionsContext.Provider>
  );
}

/**
 * Hook to access the reactions context.
 * Returns null if used outside of ReactionsProvider.
 */
export function useReactionsContext(): ReactionsContextValue | null {
  return useContext(ReactionsContext);
}
