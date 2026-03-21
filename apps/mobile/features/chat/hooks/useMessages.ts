/**
 * useMessages Hook
 *
 * Paginated message list with real-time updates.
 * Automatically subscribes to new messages and provides pagination support.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useQuery, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';
import { useAuth } from '@providers/AuthProvider';
import { useMessageCache } from '../../../stores/messageCache';

interface UseMessagesResult {
  messages: any[];
  loadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
  isStale: boolean;
  cursor: string | undefined;
}

/**
 * Subscribe to messages for a channel with pagination
 *
 * @param channelId - The channel ID to fetch messages from, or null to skip
 * @param limit - Number of messages to fetch per page (default: 20)
 * @returns Messages array, pagination functions, and loading state
 */
export function useMessages(
  channelId: Id<"chatChannels"> | null,
  limit: number = 20,
  viewingGroupId?: Id<"groups"> | null
): UseMessagesResult {
  const { token } = useAuth();
  const { getChannelMessages, setChannelMessages } = useMessageCache();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [messagesState, setMessagesState] = useState<{
    channelId: Id<"chatChannels"> | null;
    messages: any[];
  }>({ channelId: null, messages: [] });
  const [hasMore, setHasMore] = useState(false);

  // Track if we're currently loading more (to prevent duplicate loads)
  const isLoadingMoreRef = useRef(false);

  // Reset cursor when channelId changes
  const prevChannelIdRef = useRef<Id<"chatChannels"> | null>(null);
  if (channelId !== prevChannelIdRef.current) {
    // Synchronous reset - happens during render, not in effect
    if (prevChannelIdRef.current !== null) {
      // Only reset cursor if we had a previous channel (not initial mount)
      setCursor(undefined);
    }
    prevChannelIdRef.current = channelId;
    isLoadingMoreRef.current = false;
  }

  // Skip query if no channelId or no token
  const shouldSkip = !channelId || !token;

  // Fetch messages from Convex
  const result = useQuery(
    api.functions.messaging.messages.getMessages,
    shouldSkip
      ? "skip"
      : {
          token: token as string,
          channelId,
          limit,
          cursor,
          ...(viewingGroupId ? { viewingGroupId } : {}),
        }
  );

  // Update state when query result changes
  useEffect(() => {
    if (result && channelId) {
      if (cursor === undefined) {
        // Initial load - replace all messages for this channel
        setMessagesState({ channelId, messages: result.messages || [] });
      } else if (messagesState.channelId === channelId) {
        // Pagination for same channel - prepend older messages
        setMessagesState((prev) => {
          if (prev.channelId !== channelId) {
            // Channel changed mid-pagination, ignore
            return prev;
          }
          // Deduplicate messages by ID
          const existingIds = new Set(prev.messages.map((m) => m._id));
          const newMessages = (result.messages || []).filter(
            (m) => !existingIds.has(m._id)
          );
          // Prepend older messages
          return { channelId, messages: [...newMessages, ...prev.messages] };
        });
      }
      setHasMore(result.hasMore || false);
      isLoadingMoreRef.current = false;
    }
  }, [result, cursor, channelId]);

  // Cache messages for offline use
  useEffect(() => {
    if (result && channelId && result.messages && result.messages.length > 0 && cursor === undefined) {
      // Only cache the initial page (not paginated results)
      setChannelMessages(channelId, result.messages);
    }
  }, [result, channelId, cursor, setChannelMessages]);

  // Load more messages (pagination)
  const loadMore = useCallback(() => {
    if (!result || !result.hasMore || isLoadingMoreRef.current) {
      return;
    }

    isLoadingMoreRef.current = true;
    setCursor(result.cursor);
  }, [result]);

  // Determine if we're loading:
  // 1. No result yet for current query
  // 2. OR we have messages for a DIFFERENT channel (stale data)
  const hasStaleData = messagesState.channelId !== channelId;
  const isQueryLoading = result === undefined || hasStaleData;

  // Stale-while-revalidate: show cached messages immediately whenever
  // the live query hasn't resolved yet. This prevents empty flashes
  // on re-navigation and provides offline support.
  // Stale-while-revalidate is driven by query loading state (result === undefined),
  // not by connection status. This correctly handles both offline and re-navigation cases.
  let messages: any[];
  let isStale = false;

  if (isQueryLoading && channelId) {
    const cached = getChannelMessages(channelId);
    if (cached && cached.length > 0) {
      messages = cached;
      isStale = true;
    } else {
      messages = [];
    }
  } else {
    messages = hasStaleData ? [] : messagesState.messages;
  }

  const isLoading = isQueryLoading && !isStale;

  return {
    messages,
    loadMore,
    hasMore,
    isLoading,
    isStale,
    cursor: result?.cursor,
  };
}
