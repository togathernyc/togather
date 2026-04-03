/**
 * useMessages Hook
 *
 * Paginated message list with real-time updates.
 * Automatically subscribes to new messages and provides pagination support.
 *
 * Architecture:
 * - A live subscription (cursor=undefined) always watches the latest messages.
 * - When the user scrolls up, a pagination query fetches older messages.
 * - Once the pagination response arrives, older messages are merged into an
 *   accumulator and the cursor is reset so the live subscription resumes.
 * - The final message list merges the live result with the accumulated older
 *   messages, deduplicating by ID.
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

  // Pagination cursor — set temporarily during pagination, then reset to undefined
  // so the live subscription always watches the latest messages.
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  // Accumulated older messages from pagination (not covered by the live query)
  const olderMessagesRef = useRef<{ channelId: Id<"chatChannels"> | null; messages: any[] }>({
    channelId: null,
    messages: [],
  });

  // Last live page while cursor is undefined — used when pagination sets cursor and
  // useQuery briefly returns undefined so the list does not flash empty.
  const liveMessagesSnapshotRef = useRef<any[]>([]);

  const [hasMore, setHasMore] = useState(false);

  // Track if we're currently loading more (to prevent duplicate loads)
  const isLoadingMoreRef = useRef(false);

  // Store the last known cursor for loadMore
  const lastCursorRef = useRef<string | undefined>(undefined);

  // Reset when channelId changes
  const prevChannelIdRef = useRef<Id<"chatChannels"> | null>(null);
  if (channelId !== prevChannelIdRef.current) {
    if (prevChannelIdRef.current !== null) {
      setCursor(undefined);
    }
    prevChannelIdRef.current = channelId;
    isLoadingMoreRef.current = false;
    olderMessagesRef.current = { channelId: null, messages: [] };
    lastCursorRef.current = undefined;
    liveMessagesSnapshotRef.current = [];
  }

  // Skip query if no channelId or no token
  const shouldSkip = !channelId || !token;

  // Fetch messages from Convex — this is the single subscription.
  // When cursor is undefined, it returns the latest N messages (reactive).
  // When cursor is set (pagination), it returns older messages (one-shot).
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

  // Handle query results
  useEffect(() => {
    if (result && channelId) {
      if (cursor !== undefined) {
        // Pagination result — merge older messages into the accumulator,
        // then reset cursor so the live subscription resumes.
        const existingIds = new Set(olderMessagesRef.current.messages.map((m) => m._id));
        const newOlderMessages = (result.messages || []).filter(
          (m: any) => !existingIds.has(m._id)
        );
        olderMessagesRef.current = {
          channelId,
          messages: [...olderMessagesRef.current.messages, ...newOlderMessages],
        };
        setHasMore(result.hasMore || false);
        lastCursorRef.current = result.cursor;
        // Keep isLoadingMoreRef true until the live subscription resumes —
        // it gets cleared below when cursor is undefined and result arrives.
        // Reset cursor so useQuery goes back to watching latest messages
        setCursor(undefined);
      } else {
        // Live subscription result — clear pagination loading state
        isLoadingMoreRef.current = false;
        // Only update these from the live query if we haven't paginated yet
        if (olderMessagesRef.current.messages.length === 0) {
          setHasMore(result.hasMore || false);
          lastCursorRef.current = result.cursor;
        }
      }
    }
  }, [result, cursor, channelId]);

  // Cache messages for offline use (only the live page)
  useEffect(() => {
    if (result && channelId && result.messages && result.messages.length > 0 && cursor === undefined) {
      setChannelMessages(channelId, result.messages);
    }
  }, [result, channelId, cursor, setChannelMessages]);

  useEffect(() => {
    if (channelId && result?.messages && cursor === undefined) {
      liveMessagesSnapshotRef.current = result.messages;
    }
  }, [result?.messages, cursor, channelId]);

  // Merge live messages with accumulated older messages
  const mergedMessages = useMemo(() => {
    const liveMessages =
      cursor === undefined
        ? (result?.messages ??
          (liveMessagesSnapshotRef.current.length > 0
            ? liveMessagesSnapshotRef.current
            : []))
        : liveMessagesSnapshotRef.current.length > 0
          ? liveMessagesSnapshotRef.current
          : [];

    if (liveMessages.length === 0 && olderMessagesRef.current.channelId !== channelId) {
      return [];
    }
    const olderMessages = olderMessagesRef.current.channelId === channelId
      ? olderMessagesRef.current.messages
      : [];

    if (olderMessages.length === 0) return liveMessages;
    if (liveMessages.length === 0) return olderMessages;

    // Merge: live messages (newest) + older messages, deduplicating by ID
    const seenIds = new Set<string>();
    const merged: any[] = [];

    // Live messages first (they're the latest)
    for (const msg of liveMessages) {
      if (!seenIds.has(msg._id)) {
        seenIds.add(msg._id);
        merged.push(msg);
      }
    }

    // Then older messages
    for (const msg of olderMessages) {
      if (!seenIds.has(msg._id)) {
        seenIds.add(msg._id);
        merged.push(msg);
      }
    }

    // Sort by createdAt ascending (oldest first, MessageList reverses for inverted FlatList)
    merged.sort((a, b) => a.createdAt - b.createdAt);
    return merged;
  }, [result?.messages, channelId, cursor]);

  // Load more messages (pagination)
  const loadMore = useCallback(() => {
    if (isLoadingMoreRef.current) return;
    if (!lastCursorRef.current) return;

    isLoadingMoreRef.current = true;
    setCursor(lastCursorRef.current);
  }, []);

  // Determine loading state
  const isQueryLoading = result === undefined && !shouldSkip;
  const isPaginating = isLoadingMoreRef.current;

  let messages: any[];
  let isStale = false;

  if (isPaginating) {
    // During pagination, keep showing current merged messages
    messages = mergedMessages.length > 0 ? mergedMessages : [];
  } else if (isQueryLoading && channelId) {
    // Query is loading — prefer existing merged messages over cache to avoid
    // flickering during cursor reset transitions after pagination.
    if (mergedMessages.length > 0) {
      messages = mergedMessages;
    } else {
      // True initial load — try cache
      const cached = getChannelMessages(channelId);
      if (cached && cached.length > 0) {
        messages = cached;
        isStale = true;
      } else {
        messages = [];
      }
    }
  } else {
    messages = mergedMessages;
  }

  const isLoading = isQueryLoading && !isStale && !isPaginating;

  return {
    messages,
    loadMore,
    hasMore,
    isLoading,
    isStale,
    cursor: lastCursorRef.current,
  };
}
