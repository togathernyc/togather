/**
 * Read State Hooks for Convex-Native Messaging
 *
 * Track unread counts and mark messages as read.
 */
import { useCallback } from 'react';
import { useAuthenticatedQuery, useAuthenticatedMutation, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';

/**
 * Get unread count for a specific channel.
 *
 * @param channelId - The channel ID to get unread count for
 * @returns Unread count and function to mark channel as read
 *
 * @example
 * ```tsx
 * const { unreadCount, markAsRead, isLoading } = useReadState(channelId);
 *
 * // Mark channel as read when user views it
 * await markAsRead();
 *
 * // Mark up to a specific message
 * await markAsRead(messageId);
 * ```
 */
export function useReadState(channelId: Id<"chatChannels"> | null) {
  // Query unread count
  const unreadCount = useAuthenticatedQuery(
    api.functions.messaging.readState.getUnreadCount,
    channelId ? { channelId } : 'skip'
  );

  // Mark as read mutation
  const markAsReadMutation = useAuthenticatedMutation(
    api.functions.messaging.readState.markAsRead
  );

  const markAsRead = useCallback(
    async (messageId?: Id<"chatMessages">) => {
      if (!channelId) {
        throw new Error('No channel ID provided');
      }

      await markAsReadMutation({
        channelId,
        messageId,
      });
    },
    [channelId, markAsReadMutation]
  );

  return {
    unreadCount: unreadCount ?? 0,
    markAsRead,
    isLoading: unreadCount === undefined,
  };
}

/**
 * Get unread counts for all channels the user is a member of.
 *
 * Returns a map of channel ID to unread count. Only channels with unread
 * messages are included in the result.
 *
 * @returns Record of channel ID to unread count
 *
 * @example
 * ```tsx
 * const { unreadCounts, isLoading } = useAllUnreadCounts();
 *
 * // Check unread count for a specific channel
 * const count = unreadCounts[channelId] ?? 0;
 *
 * // Get total unread count across all channels
 * const total = Object.values(unreadCounts).reduce((sum, count) => sum + count, 0);
 * ```
 */
export function useAllUnreadCounts() {
  const unreadCounts = useAuthenticatedQuery(
    api.functions.messaging.readState.getUnreadCounts,
    {}
  );

  return {
    unreadCounts: unreadCounts ?? {},
    isLoading: unreadCounts === undefined,
  };
}
