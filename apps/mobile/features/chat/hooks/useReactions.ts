/**
 * Reactions Hook for Convex-Native Messaging
 *
 * Add and remove reactions on messages.
 * Includes optimistic updates for immediate UI feedback.
 *
 * This hook supports two modes:
 * 1. Batch mode: When used within a ReactionsProvider, reads from shared context
 *    (much more efficient for lists of messages)
 * 2. Individual mode: Falls back to individual query when outside ReactionsProvider
 *    (backwards compatible)
 */
import { useCallback, useState, useEffect } from 'react';
import { useAuthenticatedQuery, useAuthenticatedMutation, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';
import { useReactionsContext } from '../context/ReactionsContext';

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
 * Get reactions for a message and provide functions to add/remove reactions.
 *
 * @param messageId - The message ID to get reactions for
 * @returns Reactions array and functions to toggle reactions
 *
 * @example
 * ```tsx
 * const { reactions, addReaction, removeReaction, isLoading } = useReactions(messageId);
 *
 * // Add a reaction
 * await addReaction('👍');
 *
 * // Remove a reaction
 * await removeReaction('👍');
 *
 * // Display reactions
 * reactions.forEach(reaction => {
 *   console.log(`${reaction.emoji} ${reaction.count} ${reaction.hasReacted ? '(you)' : ''}`);
 * });
 * ```
 */
export function useReactions(messageId: Id<"chatMessages"> | null) {
  // Try to use batch context if available (more efficient)
  const reactionsContext = useReactionsContext();

  // Query reactions from server (only used when outside ReactionsProvider)
  // Skip this query if we have a context - the context handles batch loading
  const serverReactions = useAuthenticatedQuery(
    api.functions.messaging.reactions.getReactions,
    messageId && !reactionsContext ? { messageId } : 'skip'
  );

  // Local optimistic state - used for immediate UI updates when NOT using context
  // When using context, optimistic updates are stored in the context
  const [localOptimisticReactions, setLocalOptimisticReactions] = useState<Reaction[] | null>(null);

  // Get reactions from either context or individual query
  const contextReactions = messageId && reactionsContext
    ? reactionsContext.getReactions(messageId)
    : undefined;

  // Use optimistic state if available, otherwise server/context state
  const reactions = localOptimisticReactions ?? contextReactions ?? serverReactions ?? [];

  // Clear local optimistic state when server updates (server is source of truth)
  // Only relevant when NOT using context
  useEffect(() => {
    if (serverReactions !== undefined && !reactionsContext) {
      setLocalOptimisticReactions(null);
    }
  }, [serverReactions, reactionsContext]);

  // Toggle reaction mutation (fallback for when not using context)
  const toggleReactionMutation = useAuthenticatedMutation(
    api.functions.messaging.reactions.toggleReaction
  );

  // Helper to set optimistic reactions (either local or via context)
  const setOptimisticReactions = useCallback(
    (updater: (prev: Reaction[] | null) => Reaction[] | null) => {
      if (reactionsContext && messageId) {
        // When using context, apply optimistic update through context
        const newReactions = updater(contextReactions ?? null);
        if (newReactions) {
          reactionsContext.applyOptimisticUpdate(messageId, newReactions);
        } else {
          reactionsContext.clearOptimisticUpdate(messageId);
        }
      } else {
        // Fall back to local state
        setLocalOptimisticReactions(updater);
      }
    },
    [reactionsContext, messageId, contextReactions]
  );

  // Helper to clear optimistic state (reverts to server state)
  const clearOptimisticState = useCallback(() => {
    if (reactionsContext && messageId) {
      reactionsContext.clearOptimisticUpdate(messageId);
    } else {
      setLocalOptimisticReactions(null);
    }
  }, [reactionsContext, messageId]);

  // The base reactions to use for optimistic updates (from context or server)
  const baseReactions = contextReactions ?? serverReactions ?? [];

  /**
   * Apply optimistic update for adding a reaction.
   */
  const applyOptimisticAdd = useCallback(
    (emoji: string) => {
      setOptimisticReactions((prev) => {
        const current = prev ?? baseReactions;
        const existing = current.find((r) => r.emoji === emoji);

        if (existing) {
          if (existing.hasReacted) {
            // User already has this reaction, no change
            return current;
          }
          // Add to existing reaction count
          return current.map((r) =>
            r.emoji === emoji
              ? { ...r, count: r.count + 1, hasReacted: true }
              : r
          );
        }
        // New reaction
        return [...current, { emoji, count: 1, userIds: [], hasReacted: true }];
      });
    },
    [baseReactions, setOptimisticReactions]
  );

  /**
   * Apply optimistic update for removing a reaction.
   */
  const applyOptimisticRemove = useCallback(
    (emoji: string) => {
      setOptimisticReactions((prev) => {
        const current = prev ?? baseReactions;
        const existing = current.find((r) => r.emoji === emoji);

        if (!existing || !existing.hasReacted) {
          // User doesn't have this reaction, no change
          return current;
        }

        if (existing.count === 1) {
          // Remove the reaction entirely
          return current.filter((r) => r.emoji !== emoji);
        }
        // Decrement count
        return current.map((r) =>
          r.emoji === emoji
            ? { ...r, count: r.count - 1, hasReacted: false }
            : r
        );
      });
    },
    [baseReactions, setOptimisticReactions]
  );

  /**
   * Add a reaction to the message.
   *
   * If the user has already reacted with this emoji, this is a no-op.
   * Use toggleReaction for true toggle behavior.
   */
  const addReaction = useCallback(
    async (emoji: string) => {
      if (!messageId) {
        throw new Error('No message ID provided');
      }

      // Check if user already has this reaction
      const existingReaction = reactions?.find(
        (r) => r.emoji === emoji && r.hasReacted
      );

      if (existingReaction) {
        // User already has this reaction, no-op
        return;
      }

      // Apply optimistic update immediately
      applyOptimisticAdd(emoji);

      try {
        await toggleReactionMutation({
          messageId,
          emoji,
        });
      } catch (error) {
        // Revert optimistic update on error
        clearOptimisticState();
        throw error;
      }
    },
    [messageId, reactions, toggleReactionMutation, applyOptimisticAdd, clearOptimisticState]
  );

  /**
   * Remove a reaction from the message.
   *
   * If the user hasn't reacted with this emoji, this is a no-op.
   * Use toggleReaction for true toggle behavior.
   */
  const removeReaction = useCallback(
    async (emoji: string) => {
      if (!messageId) {
        throw new Error('No message ID provided');
      }

      // Check if user has this reaction
      const existingReaction = reactions?.find(
        (r) => r.emoji === emoji && r.hasReacted
      );

      if (!existingReaction) {
        // User doesn't have this reaction, no-op
        return;
      }

      // Apply optimistic update immediately
      applyOptimisticRemove(emoji);

      try {
        await toggleReactionMutation({
          messageId,
          emoji,
        });
      } catch (error) {
        // Revert optimistic update on error
        clearOptimisticState();
        throw error;
      }
    },
    [messageId, reactions, toggleReactionMutation, applyOptimisticRemove, clearOptimisticState]
  );

  /**
   * Toggle a reaction on the message.
   *
   * If the user has already reacted with this emoji, it removes the reaction.
   * Otherwise, it adds the reaction.
   */
  const toggleReaction = useCallback(
    async (emoji: string) => {
      if (!messageId) {
        throw new Error('No message ID provided');
      }

      // Determine if we're adding or removing
      const existingReaction = reactions?.find(
        (r) => r.emoji === emoji && r.hasReacted
      );

      // Apply optimistic update immediately
      if (existingReaction) {
        applyOptimisticRemove(emoji);
      } else {
        applyOptimisticAdd(emoji);
      }

      try {
        await toggleReactionMutation({
          messageId,
          emoji,
        });
      } catch (error) {
        // Revert optimistic update on error
        clearOptimisticState();
        throw error;
      }
    },
    [messageId, reactions, toggleReactionMutation, applyOptimisticAdd, applyOptimisticRemove, clearOptimisticState]
  );

  // Determine loading state based on whether we're using context or individual query
  const isLoading = messageId !== null && (
    reactionsContext
      ? reactionsContext.isLoading
      : serverReactions === undefined
  );

  return {
    reactions,
    addReaction,
    removeReaction,
    toggleReaction,
    isLoading,
  };
}
