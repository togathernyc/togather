/**
 * useThreadReplies Hook
 *
 * Fetches thread replies for a parent message.
 * Checks prefetch context first for instant render.
 * Automatically subscribes to real-time updates.
 */

import { useQuery, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';
import { useAuth } from '@providers/AuthProvider';
import { useChatPrefetch } from '../context/ChatPrefetchContext';

interface ThreadReply {
  _id: Id<"chatMessages">;
  _creationTime: number;
  channelId: Id<"chatChannels">;
  senderId?: Id<"users">;
  content: string;
  contentType: string;
  createdAt: number;
  editedAt?: number;
  isDeleted: boolean;
  senderName?: string;
  senderProfilePhoto?: string;
  attachments?: Array<{
    type: string;
    url: string;
    name?: string;
  }>;
}

interface UseThreadRepliesResult {
  replies: ThreadReply[];
  isLoading: boolean;
  hasMore: boolean;
}

/**
 * Subscribe to thread replies for a parent message
 *
 * @param parentMessageId - The parent message ID to fetch replies for, or null to skip
 * @param channelId - The channel ID (for prefetch lookup)
 * @param limit - Maximum number of replies to fetch (default: 50)
 * @returns Thread replies array and loading state
 */
export function useThreadReplies(
  parentMessageId: Id<"chatMessages"> | null,
  limit: number = 50,
  channelId?: Id<"chatChannels"> | null
): UseThreadRepliesResult {
  const { token } = useAuth();

  // Check prefetch context first for instant render
  const prefetchContext = useChatPrefetch();
  const prefetchState = channelId ? prefetchContext?.getPrefetchState(channelId) : null;
  const prefetchedReplies = parentMessageId && prefetchState?.threadReplies?.get(parentMessageId.toString());

  // Always run query for real-time updates, use prefetch data while loading
  const shouldSkip = !parentMessageId || !token;

  const result = useQuery(
    api.functions.messaging.messages.getThreadReplies,
    shouldSkip ? "skip" : {
      token: token as string,
      parentMessageId,
      limit,
    }
  );

  // Prefer live query data when available (for real-time updates)
  if (result?.messages) {
    return {
      replies: result.messages,
      isLoading: false,
      hasMore: result.hasMore ?? false,
    };
  }

  // Fall back to prefetched data while live query loads
  if (prefetchedReplies && prefetchedReplies.length > 0) {
    // Convert prefetched data to full ThreadReply format (partial data is fine for display)
    const prefetchedAsReplies = prefetchedReplies.map((r) => ({
      _id: r._id as unknown as Id<"chatMessages">,
      _creationTime: r.createdAt,
      channelId: channelId as Id<"chatChannels">,
      senderId: r.senderId as unknown as Id<"users"> | undefined,
      content: '',
      contentType: 'text',
      createdAt: r.createdAt,
      isDeleted: false,
      senderName: r.senderName,
      senderProfilePhoto: r.senderProfilePhoto,
    }));

    return {
      replies: prefetchedAsReplies,
      isLoading: false,
      hasMore: false,
    };
  }

  return {
    replies: [],
    isLoading: !shouldSkip && result === undefined,
    hasMore: false,
  };
}
