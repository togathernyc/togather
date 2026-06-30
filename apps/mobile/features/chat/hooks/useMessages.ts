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
import { useQuery, api, useStoredAuthToken } from '@services/api/convex';
import type { Id } from '@services/api/convex';
import { useMessageCache } from '../../../stores/messageCache';

interface UseMessagesResult {
  messages: any[];
  loadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
  isStale: boolean;
  cursor: string | undefined;
  /**
   * True once the requested `anchorMessageId` is present in the loaded
   * messages. When no anchor is requested this is always false.
   */
  anchorFound: boolean;
}

/**
 * Maximum number of older-message pages the anchor catch-up will auto-load
 * before giving up. With a bumped page size while jumping, this covers a deep
 * slice of history; very old anchors stop here and the list simply shows as far
 * back as it got.
 */
const ANCHOR_MAX_PAGES = 25;

/**
 * Subscribe to messages for a channel with pagination
 *
 * @param channelId - The channel ID to fetch messages from, or null to skip
 * @param limit - Number of messages to fetch per page (default: 20)
 * @param viewingGroupId - Group context for access checks (shared channels)
 * @param anchorMessageId - When set, older pages are auto-loaded (using the
 *   existing backward pagination) until this message is in the list, so the
 *   caller can scroll to it. Used for "jump to message" from inbox search.
 * @returns Messages array, pagination functions, and loading state
 */
export function useMessages(
  channelId: Id<"chatChannels"> | null,
  limit: number = 20,
  viewingGroupId?: Id<"groups"> | null,
  anchorMessageId?: Id<"chatMessages"> | null
): UseMessagesResult {
  const token = useStoredAuthToken();
  const { getChannelMessages, setChannelMessages, clearChannel } = useMessageCache();

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

  // Anchor catch-up: how many pages we've auto-loaded chasing the current
  // anchorMessageId. Reset whenever the anchor (or channel) changes.
  const anchorAttemptsRef = useRef<{ id: Id<"chatMessages"> | null; count: number }>({
    id: null,
    count: 0,
  });

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
    anchorAttemptsRef.current = { id: null, count: 0 };
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
        if (result.messages.length === 0) {
          // Live query returned 0 messages — buffered older pages and the
          // persisted cache are stale (viewer lost channel access, all
          // messages deleted, etc.). Drop both so the UI doesn't keep
          // showing pre-revocation history, including on remount where the
          // cache would otherwise hydrate the loading-state list before
          // the next reactive empty page arrives.
          if (olderMessagesRef.current.messages.length > 0) {
            olderMessagesRef.current = { channelId: null, messages: [] };
          }
          clearChannel(channelId);
          setHasMore(false);
          lastCursorRef.current = result.cursor;
        } else if (olderMessagesRef.current.messages.length === 0) {
          // Only update these from the live query if we haven't paginated yet
          setHasMore(result.hasMore || false);
          lastCursorRef.current = result.cursor;
        }
      }
    }
  }, [result, cursor, channelId, clearChannel]);

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
    if (liveMessages.length === 0) {
      // Live says 0 messages — trust it. Buffered older pages are stale
      // (the live useEffect clears the ref on the next tick); returning
      // them here would leak pre-revocation history for one render.
      return [];
    }

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

  // Whether the requested anchor message is loaded yet.
  const anchorFound = useMemo(
    () => (anchorMessageId ? mergedMessages.some((m) => m._id === anchorMessageId) : false),
    [anchorMessageId, mergedMessages]
  );

  // Anchor catch-up driver: when a jump target is requested but not yet loaded,
  // page backward (reusing the existing pagination) one page at a time until it
  // appears. Each loaded page changes `mergedMessages`, re-running this effect
  // to load the next — a self-chaining loop bounded by ANCHOR_MAX_PAGES.
  useEffect(() => {
    if (!anchorMessageId) return;
    if (anchorAttemptsRef.current.id !== anchorMessageId) {
      anchorAttemptsRef.current = { id: anchorMessageId, count: 0 };
    }
    if (anchorFound) return;
    if (!hasMore) return;
    if (isLoadingMoreRef.current) return;
    if (anchorAttemptsRef.current.count >= ANCHOR_MAX_PAGES) return;
    anchorAttemptsRef.current.count += 1;
    loadMore();
  }, [anchorMessageId, anchorFound, hasMore, mergedMessages, loadMore]);

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
    anchorFound,
  };
}
