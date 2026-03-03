/**
 * Reaction Details Hook for Convex-Native Messaging
 *
 * Fetch user details for users who reacted with a specific emoji.
 */
import { useAuthenticatedQuery, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';

/**
 * User who reacted with an emoji.
 */
export interface ReactorUser {
  userId: Id<"users">;
  displayName: string;
  profilePhoto: string | null;
}

/**
 * Get details for all users who reacted with a specific emoji.
 *
 * @param messageId - The message ID to get reaction details for (null to skip)
 * @param emoji - The emoji to filter by (null to skip)
 * @returns Array of user details and loading state
 *
 * @example
 * ```tsx
 * const { users, isLoading } = useReactionDetails(messageId, selectedEmoji);
 *
 * // Display users who reacted
 * users.forEach(user => {
 *   console.log(`${user.displayName} reacted with ${selectedEmoji}`);
 * });
 * ```
 */
export function useReactionDetails(
  messageId: Id<"chatMessages"> | null,
  emoji: string | null
) {
  // Query reaction details from server
  // Skip if either messageId or emoji is null
  const users = useAuthenticatedQuery(
    api.functions.messaging.reactions.getReactionDetails,
    messageId && emoji ? { messageId, emoji } : 'skip'
  );

  return {
    users: users ?? [],
    isLoading: messageId !== null && emoji !== null && users === undefined,
  };
}
