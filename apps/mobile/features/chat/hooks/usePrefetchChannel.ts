/**
 * usePrefetchChannel - Orchestrates prefetching of channel data
 *
 * This hook handles the actual prefetch logic:
 * 1. Fetches messages via Convex query
 * 2. Extracts URLs and event shortIds from messages
 * 3. Batch fetches link previews in parallel
 * 4. Batch fetches event data in parallel
 * 5. Updates the prefetch context with all data
 */

import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@providers/AuthProvider';
import { useConvex, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';
import {
  useChatPrefetch,
  type PrefetchedMessage,
  type PrefetchedEventData,
  type PrefetchedToolData,
  type PrefetchedReadReceipt,
  type PrefetchedThreadReply,
  type PrefetchedReaction,
} from '../context/ChatPrefetchContext';
import type { RsvpOption } from '../types';
import { fetchLinkPreviewBatch, type LinkPreviewData } from './useLinkPreview';
import { extractEventShortIds, extractToolShortIds, extractFirstExternalUrl } from '../utils/eventLinkUtils';

/**
 * Hook that registers the prefetch executor with the context.
 * Should be used in a component that wraps the inbox.
 */
export function usePrefetchExecutor(): void {
  const { token, user } = useAuth();
  const convex = useConvex();
  const prefetchContext = useChatPrefetch();
  const pendingPrefetchesRef = useRef<Set<string>>(new Set());
  const currentUserId = user?.id as Id<"users"> | undefined;

  /**
   * Execute prefetch for a channel
   */
  const executePrefetch = useCallback(
    async (channelId: Id<"chatChannels">) => {
      if (!token || !prefetchContext) return;

      const channelIdStr = channelId.toString();

      // Prevent duplicate fetches
      if (pendingPrefetchesRef.current.has(channelIdStr)) {
        return;
      }
      pendingPrefetchesRef.current.add(channelIdStr);

      try {
        // 1. Fetch messages
        const messagesResult = await convex.query(
          api.functions.messaging.messages.getMessages,
          {
            token,
            channelId,
            limit: 20,
          }
        );

        const messages = (messagesResult?.messages || []) as PrefetchedMessage[];

        // 2. Extract URLs, event shortIds, tool shortIds, and identify messages needing extra data
        const urlsToFetch: string[] = [];
        const eventShortIds: string[] = [];
        const toolShortIds: string[] = [];
        const ownMessageIds: Id<"chatMessages">[] = [];
        const threadMessageIds: Id<"chatMessages">[] = [];

        for (const message of messages) {
          // Track own messages for read receipts
          if (currentUserId && message.senderId === currentUserId) {
            ownMessageIds.push(message._id);
          }

          // Track messages with thread replies
          if (message.threadReplyCount && message.threadReplyCount > 0) {
            threadMessageIds.push(message._id);
          }

          if (message.isDeleted || !message.content) continue;

          // Extract event links
          const shortIds = extractEventShortIds(message.content);
          eventShortIds.push(...shortIds);

          // Extract tool links
          const tShortIds = extractToolShortIds(message.content);
          toolShortIds.push(...tShortIds);

          // Only fetch link preview if no event/tool cards (they take priority)
          if (shortIds.length === 0 && tShortIds.length === 0 && !message.hideLinkPreview) {
            const externalUrl = extractFirstExternalUrl(message.content);
            if (externalUrl) {
              urlsToFetch.push(externalUrl);
            }
          }
        }

        // Get all message IDs for reactions (all messages, not just own)
        const allMessageIds = messages.map((m) => m._id);

        // 3. Batch fetch ALL data in parallel
        const [rawLinkPreviewsMap, eventDataMap, toolDataMap, readReceiptsMap, threadRepliesMap, reactionsMap] = await Promise.all([
          fetchLinkPreviewBatch(urlsToFetch),
          fetchEventDataBatch(convex, token, eventShortIds),
          fetchToolDataBatch(convex, toolShortIds),
          fetchReadReceiptsBatch(convex, token, ownMessageIds, channelId),
          fetchThreadRepliesBatch(convex, token, threadMessageIds),
          fetchReactionsBatch(convex, token, allMessageIds),
        ]);

        // Filter out null previews for the typed Map
        const linkPreviewsMap = new Map<string, LinkPreviewData>();
        for (const [url, preview] of rawLinkPreviewsMap) {
          if (preview) {
            linkPreviewsMap.set(url, preview);
          }
        }

        // 4. Update context with ALL prefetched data
        prefetchContext.updatePrefetchState(channelId, {
          status: 'ready',
          messages,
          linkPreviews: linkPreviewsMap,
          eventData: eventDataMap,
          toolData: toolDataMap,
          readReceipts: readReceiptsMap,
          threadReplies: threadRepliesMap,
          reactions: reactionsMap,
          lastPrefetchedAt: Date.now(),
        });
      } catch (error) {
        console.error('[usePrefetchChannel] Prefetch failed:', error);
        prefetchContext.updatePrefetchState(channelId, {
          status: 'error',
          error: error instanceof Error ? error.message : 'Prefetch failed',
        });
      } finally {
        pendingPrefetchesRef.current.delete(channelIdStr);
      }
    },
    [token, convex, prefetchContext, currentUserId]
  );

  // Register the executor with the context
  useEffect(() => {
    if (prefetchContext) {
      prefetchContext.setPrefetchExecutor(executePrefetch);
    }
  }, [prefetchContext, executePrefetch]);
}

/**
 * Batch fetch event data for multiple shortIds
 */
async function fetchEventDataBatch(
  convex: ReturnType<typeof useConvex>,
  token: string,
  shortIds: string[]
): Promise<Map<string, PrefetchedEventData>> {
  const results = new Map<string, PrefetchedEventData>();

  if (shortIds.length === 0) {
    return results;
  }

  // Deduplicate shortIds
  const uniqueShortIds = [...new Set(shortIds)];

  // Fetch each event in parallel
  const fetchPromises = uniqueShortIds.map(async (shortId) => {
    try {
      const eventData = await convex.query(
        api.functions.meetings.index.getByShortId,
        { shortId, token }
      );

      if (eventData) {
        // Type assertion since we know the structure from EventLinkCard
        const data = eventData as Record<string, unknown>;
        const prefetchedEvent: PrefetchedEventData = {
          id: data.id as string,
          shortId: data.shortId as string,
          title: data.title as string,
          scheduledAt: data.scheduledAt as string | undefined,
          coverImage: data.coverImage as string | null | undefined,
          locationOverride: data.locationOverride as string | undefined,
          meetingType: data.meetingType as number | undefined,
          rsvpEnabled: data.rsvpEnabled as boolean | undefined,
          rsvpOptions: data.rsvpOptions as RsvpOption[] | undefined,
          groupName: data.groupName as string | undefined,
          communityName: data.communityName as string | undefined,
          hasAccess: data.hasAccess as boolean | undefined,
          accessPrompt: data.accessPrompt as { message: string } | null | undefined,
          status: data.status as string | undefined,
        };
        return { shortId, event: prefetchedEvent };
      }
      return { shortId, event: null };
    } catch (err) {
      console.warn('[fetchEventDataBatch] Failed to fetch:', shortId, err);
      return { shortId, event: null };
    }
  });

  const fetchResults = await Promise.all(fetchPromises);

  for (const { shortId, event } of fetchResults) {
    if (event) {
      results.set(shortId, event);
    }
  }

  return results;
}

/**
 * Batch fetch tool data for multiple shortIds
 */
async function fetchToolDataBatch(
  convex: ReturnType<typeof useConvex>,
  shortIds: string[]
): Promise<Map<string, PrefetchedToolData>> {
  const results = new Map<string, PrefetchedToolData>();

  if (shortIds.length === 0) {
    return results;
  }

  // Deduplicate shortIds
  const uniqueShortIds = [...new Set(shortIds)];

  // Fetch each tool link in parallel
  const fetchPromises = uniqueShortIds.map(async (shortId) => {
    try {
      const data = await convex.query(
        api.functions.toolShortLinks.index.getByShortId,
        { shortId }
      );

      if (data) {
        const toolData: PrefetchedToolData = {
          shortId: data.shortId as string,
          toolType: data.toolType as "runsheet" | "resource",
          groupId: data.groupId as string,
          groupName: data.groupName as string,
          resourceId: data.resourceId as string | undefined,
          resourceTitle: data.resourceTitle as string | undefined,
          resourceIcon: data.resourceIcon as string | undefined,
        };
        return { shortId, tool: toolData };
      }
      return { shortId, tool: null };
    } catch (err) {
      console.warn('[fetchToolDataBatch] Failed to fetch:', shortId, err);
      return { shortId, tool: null };
    }
  });

  const fetchResults = await Promise.all(fetchPromises);

  for (const { shortId, tool } of fetchResults) {
    if (tool) {
      results.set(shortId, tool);
    }
  }

  return results;
}

/**
 * Batch fetch read receipts for multiple messages
 */
async function fetchReadReceiptsBatch(
  convex: ReturnType<typeof useConvex>,
  token: string,
  messageIds: Id<"chatMessages">[],
  channelId: Id<"chatChannels">
): Promise<Map<string, PrefetchedReadReceipt>> {
  const results = new Map<string, PrefetchedReadReceipt>();

  if (messageIds.length === 0) {
    return results;
  }

  // Fetch each message's read receipts in parallel
  const fetchPromises = messageIds.map(async (messageId) => {
    try {
      const data = await convex.query(
        api.functions.messaging.readState.getMessageReadBy,
        { messageId, channelId, token }
      );

      if (data) {
        return {
          messageId: messageId.toString(),
          receipt: {
            readByCount: data.readByCount ?? 0,
            totalMembers: data.totalMembers ?? 0,
          } as PrefetchedReadReceipt,
        };
      }
      return { messageId: messageId.toString(), receipt: null };
    } catch (err) {
      console.warn('[fetchReadReceiptsBatch] Failed to fetch:', messageId, err);
      return { messageId: messageId.toString(), receipt: null };
    }
  });

  const fetchResults = await Promise.all(fetchPromises);

  for (const { messageId, receipt } of fetchResults) {
    if (receipt) {
      results.set(messageId, receipt);
    }
  }

  return results;
}

/**
 * Batch fetch thread replies for multiple messages
 */
async function fetchThreadRepliesBatch(
  convex: ReturnType<typeof useConvex>,
  token: string,
  messageIds: Id<"chatMessages">[]
): Promise<Map<string, PrefetchedThreadReply[]>> {
  const results = new Map<string, PrefetchedThreadReply[]>();

  if (messageIds.length === 0) {
    return results;
  }

  // Fetch each message's thread replies in parallel
  const fetchPromises = messageIds.map(async (messageId) => {
    try {
      const data = await convex.query(
        api.functions.messaging.messages.getThreadReplies,
        { parentMessageId: messageId, token, limit: 10 }
      );

      if (data?.messages) {
        const replies: PrefetchedThreadReply[] = data.messages.map((msg: any) => ({
          _id: msg._id,
          senderId: msg.senderId,
          senderName: msg.senderName,
          senderProfilePhoto: msg.senderProfilePhoto,
          createdAt: msg.createdAt,
        }));
        return { messageId: messageId.toString(), replies };
      }
      return { messageId: messageId.toString(), replies: [] };
    } catch (err) {
      console.warn('[fetchThreadRepliesBatch] Failed to fetch:', messageId, err);
      return { messageId: messageId.toString(), replies: [] };
    }
  });

  const fetchResults = await Promise.all(fetchPromises);

  for (const { messageId, replies } of fetchResults) {
    results.set(messageId, replies);
  }

  return results;
}

/**
 * Batch fetch reactions for multiple messages
 */
async function fetchReactionsBatch(
  convex: ReturnType<typeof useConvex>,
  token: string,
  messageIds: Id<"chatMessages">[]
): Promise<Map<string, PrefetchedReaction[]>> {
  const results = new Map<string, PrefetchedReaction[]>();

  if (messageIds.length === 0) {
    return results;
  }

  try {
    // Use the batch query that fetches all reactions at once
    const data = await convex.query(
      api.functions.messaging.reactions.getReactionsForMessages,
      { messageIds, token }
    );

    if (data) {
      // Convert the result object to a Map
      for (const [messageId, reactions] of Object.entries(data)) {
        results.set(messageId, reactions as PrefetchedReaction[]);
      }
    }
  } catch (err) {
    console.warn('[fetchReactionsBatch] Failed to fetch:', err);
  }

  return results;
}

/**
 * Hook to trigger prefetch when a channel is about to be viewed.
 * Use this in inbox items before navigating to a channel.
 *
 * @returns Function to call before navigation
 */
export function useTriggerPrefetch(): (channelId: Id<"chatChannels">) => void {
  const prefetchContext = useChatPrefetch();

  return useCallback(
    (channelId: Id<"chatChannels">) => {
      prefetchContext?.prefetchChannel(channelId);
    },
    [prefetchContext]
  );
}

/**
 * Hook to prefetch and wait for completion before navigation.
 * This delays navigation until data is ready, preventing layout jumps.
 *
 * @returns Function that prefetches and waits, returning true when ready
 */
export function useAwaitPrefetch(): (
  channelId: Id<"chatChannels">,
  timeoutMs?: number
) => Promise<boolean> {
  const prefetchContext = useChatPrefetch();

  return useCallback(
    async (channelId: Id<"chatChannels">, timeoutMs = 500) => {
      if (!prefetchContext) {
        return true; // No context, proceed anyway
      }

      // Check if already ready
      if (prefetchContext.isChannelReady(channelId)) {
        return true;
      }

      // Trigger prefetch
      prefetchContext.prefetchChannel(channelId);

      // Wait for completion (with timeout)
      const result = await prefetchContext.waitForPrefetch(channelId, timeoutMs);

      // Return true if ready, false if timed out (still navigate anyway)
      return result?.status === 'ready';
    },
    [prefetchContext]
  );
}

/**
 * Hook to prefetch all channels in a group.
 * Call this when entering a group chat to preload sibling channels.
 *
 * @returns Function to call with an array of channel IDs
 */
export function usePrefetchGroupChannels(): (channelIds: Id<"chatChannels">[]) => void {
  const prefetchContext = useChatPrefetch();

  return useCallback(
    (channelIds: Id<"chatChannels">[]) => {
      if (!prefetchContext) return;

      // Prefetch each channel that isn't already ready
      for (const channelId of channelIds) {
        if (!prefetchContext.isChannelReady(channelId)) {
          prefetchContext.prefetchChannel(channelId);
        }
      }
    },
    [prefetchContext]
  );
}
