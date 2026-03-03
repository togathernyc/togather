/**
 * Read Receipts Hook for Convex-Native Messaging
 *
 * Get who has read each message.
 * Checks prefetch context first for instant render.
 */
import { useAuthenticatedQuery, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';
import { useChatPrefetch } from '../context/ChatPrefetchContext';

/**
 * Get read receipt information for a message.
 *
 * Returns the count of users who have read this message (excluding the sender)
 * and the total number of members in the channel (excluding the sender).
 *
 * @param messageId - The message ID to get read receipts for
 * @param channelId - The channel ID (required for membership verification)
 * @returns Read receipt data including read count and total members
 *
 * @example
 * ```tsx
 * const { readByCount, totalMembers, isLoading } = useReadReceipts(messageId, channelId);
 *
 * // Show "Read by 5 of 10"
 * if (!isLoading) {
 *   console.log(`Read by ${readByCount} of ${totalMembers}`);
 * }
 * ```
 */
export function useReadReceipts(
  messageId: Id<"chatMessages"> | null,
  channelId: Id<"chatChannels"> | null
) {
  // Check prefetch context first for instant render
  const prefetchContext = useChatPrefetch();
  const prefetchState = channelId ? prefetchContext?.getPrefetchState(channelId) : null;
  const prefetchedReceipt = messageId && prefetchState?.readReceipts?.get(messageId.toString());

  // Always run query for real-time updates, use prefetch data while loading
  const readReceipts = useAuthenticatedQuery(
    api.functions.messaging.readState.getMessageReadBy,
    messageId && channelId ? { messageId, channelId } : 'skip'
  );

  // Prefer live query data when available (for real-time updates)
  if (readReceipts) {
    return {
      readByCount: readReceipts.readByCount ?? 0,
      totalMembers: readReceipts.totalMembers ?? 0,
      isLoading: false,
    };
  }

  // Fall back to prefetched data while live query loads
  if (prefetchedReceipt) {
    return {
      readByCount: prefetchedReceipt.readByCount,
      totalMembers: prefetchedReceipt.totalMembers,
      isLoading: false,
    };
  }

  return {
    readByCount: 0,
    totalMembers: 0,
    isLoading: messageId !== null && channelId !== null,
  };
}
