/**
 * Typing Indicators Hook for Convex-Native Messaging
 *
 * Broadcast and subscribe to typing status.
 */
import { useCallback, useRef, useEffect } from 'react';
import { useAuthenticatedQuery, useAuthenticatedMutation, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';

/**
 * Typing indicator debounce timeout (ms).
 * Prevents spamming the server with typing updates.
 */
const TYPING_DEBOUNCE_MS = 1000;

/**
 * Get typing indicators for a channel and broadcast user's typing status.
 *
 * @param channelId - The channel ID to get typing indicators for
 * @returns Array of users currently typing and function to set typing status
 *
 * @example
 * ```tsx
 * const { typingUsers, setTyping } = useTypingIndicators(channelId);
 *
 * // When user starts typing
 * const handleTextChange = (text: string) => {
 *   setTyping(text.length > 0);
 * };
 *
 * // Display typing indicator
 * if (typingUsers.length > 0) {
 *   const names = typingUsers.map(u => u.firstName).join(', ');
 *   console.log(`${names} ${typingUsers.length === 1 ? 'is' : 'are'} typing...`);
 * }
 * ```
 */
export function useTypingIndicators(channelId: Id<"chatChannels"> | null) {
  // Query typing users
  const typingUsers = useAuthenticatedQuery(
    api.functions.messaging.typing.getTypingUsers,
    channelId ? { channelId } : 'skip'
  );

  // Mutations
  const startTypingMutation = useAuthenticatedMutation(
    api.functions.messaging.typing.startTyping
  );
  const stopTypingMutation = useAuthenticatedMutation(
    api.functions.messaging.typing.stopTyping
  );

  // Debounce timer
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);
  const stopTimer = useRef<NodeJS.Timeout | null>(null);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      if (stopTimer.current) {
        clearTimeout(stopTimer.current);
      }
    };
  }, []);

  /**
   * Set typing status for the current user.
   *
   * This function is debounced to prevent spamming the server.
   * When typing stops, it automatically stops the typing indicator after a delay.
   */
  const setTyping = useCallback(
    async (isTyping: boolean) => {
      if (!channelId) {
        return;
      }

      // Clear existing timers
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      if (stopTimer.current) {
        clearTimeout(stopTimer.current);
      }

      if (isTyping) {
        // User is typing
        isTypingRef.current = true;

        // Debounce the start typing call
        debounceTimer.current = setTimeout(async () => {
          try {
            await startTypingMutation({ channelId });
          } catch (error) {
            console.error('[useTypingIndicators] Failed to start typing:', error);
          }
        }, TYPING_DEBOUNCE_MS);
      } else {
        // User stopped typing
        isTypingRef.current = false;

        // Stop typing immediately
        try {
          await stopTypingMutation({ channelId });
        } catch (error) {
          console.error('[useTypingIndicators] Failed to stop typing:', error);
        }
      }
    },
    [channelId, startTypingMutation, stopTypingMutation]
  );

  // Auto-stop typing when user navigates away
  useEffect(() => {
    return () => {
      if (isTypingRef.current && channelId) {
        // Cleanup: stop typing when component unmounts
        stopTypingMutation({ channelId }).catch((error) => {
          console.error('[useTypingIndicators] Failed to stop typing on unmount:', error);
        });
      }
    };
  }, [channelId, stopTypingMutation]);

  return {
    typingUsers: typingUsers ?? [],
    setTyping,
    isLoading: typingUsers === undefined,
  };
}
