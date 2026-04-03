/**
 * MessageList Component
 *
 * A virtualized list of messages with pagination and date separators.
 * Uses an inverted FlatList for reliable chat behavior - newest messages
 * appear at the bottom and the list naturally starts there.
 *
 * Features:
 * - Inverted FlatList (standard chat pattern)
 * - Pagination (load more messages on scroll up)
 * - Date separators (Today, Yesterday, or formatted date)
 * - Grouped messages (hide sender info for consecutive messages from same sender)
 * - Loading states (initial load, pagination)
 * - Empty states
 */

import React, { useRef, useCallback, useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  FlatList,
  ViewToken,
  InteractionManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Id } from '@services/api/convex';
import { useMessages } from '../hooks/useMessages';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useTheme } from '@hooks/useTheme';
import { MessageItem } from './MessageItem';
import { ReactionsProvider } from '../context/ReactionsContext';
import { useChatPrefetch } from '../context/ChatPrefetchContext';

// Message type from Convex (matches schema.ts chatMessages table)
interface Message {
  _id: Id<"chatMessages">;
  _creationTime: number;
  channelId: Id<"chatChannels">;
  senderId: Id<"users">;
  content: string;
  contentType: string;
  createdAt: number;
  updatedAt?: number;
  editedAt?: number;
  isDeleted: boolean;
  deletedAt?: number;
  parentMessageId?: Id<"chatMessages">;
  attachments?: Array<{
    type: string;
    url: string;
    name?: string;
    size?: number;
    mimeType?: string;
    thumbnailUrl?: string;
  }>;
  mentionedUserIds?: Id<"users">[];
  threadReplyCount?: number;
  // Denormalized sender info
  senderName?: string;
  senderProfilePhoto?: string;
  // Link preview control
  hideLinkPreview?: boolean;
  // Reach out request reference
  reachOutRequestId?: Id<"reachOutRequests">;
  // Canonical task reference for task cards
  taskId?: Id<"tasks">;
}

interface MessageListProps {
  channelId: Id<"chatChannels"> | null;
  currentUserId: Id<"users">;
  groupId?: Id<"groups">;
  channelName?: string;
  onMessageReply?: (messageId: Id<"chatMessages">) => void;
  onMessageReact?: (messageId: Id<"chatMessages">) => void;
  onMessageDelete?: (messageId: Id<"chatMessages">) => void;
  onMessageLongPress?: (message: Message, event: { nativeEvent: { pageX: number; pageY: number } }) => void;
  onMessageDoubleTap?: (message: Message, event: { nativeEvent: { pageX: number; pageY: number } }) => void;
  /** Optimistic messages to render inline */
  optimisticMessages?: Array<{
    _id: string;
    channelId: Id<"chatChannels">;
    senderId: Id<"users">;
    content: string;
    contentType: string;
    attachments?: Array<{ type: string; url: string; name?: string }>;
    parentMessageId?: Id<"chatMessages">;
    createdAt: number;
    isDeleted: false;
    senderName: string;
    senderProfilePhoto?: string;
    mentionedUserIds?: Id<"users">[];
    _optimistic: true;
    _status: 'sending' | 'sent' | 'error' | 'queued';
  }>;
  /** Retry a failed optimistic message */
  onRetryMessage?: (optimisticId: string) => Promise<void>;
  /** Dismiss a failed optimistic message */
  onDismissMessage?: (optimisticId: string) => void;
}

// Helper to format date as "Today", "Yesterday", or "Jan 15"
function formatDateSeparator(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const day = date.getDate();

  // Add year if different from current year
  if (date.getFullYear() !== today.getFullYear()) {
    return `${month} ${day}, ${date.getFullYear()}`;
  }

  return `${month} ${day}`;
}

// List item type (message or date separator)
type ListItem =
  | { type: 'message'; data: Message; showSenderInfo: boolean; isOptimistic?: boolean; optimisticStatus?: string }
  | { type: 'dateSeparator'; date: string };

/**
 * MessageList renders a virtualized list of messages with pagination.
 * Uses an inverted FlatList so newest messages appear at the bottom.
 */
export function MessageList({
  channelId,
  currentUserId,
  groupId,
  channelName,
  onMessageReply,
  onMessageReact,
  onMessageDelete,
  onMessageLongPress,
  onMessageDoubleTap,
  optimisticMessages,
  onRetryMessage,
  onDismissMessage,
}: MessageListProps) {
  const { primaryColor } = useCommunityTheme();
  const { colors: themeColors } = useTheme();
  const listRef = useRef<FlatList<ListItem>>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  // Wait for navigation animation to complete before loading messages
  // This prevents choppy animations when entering the chat
  const [isAnimationComplete, setIsAnimationComplete] = useState(false);

  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      setIsAnimationComplete(true);
    });

    return () => handle.cancel();
  }, []);

  // Get prefetch context for cached link previews and event data
  const prefetchContext = useChatPrefetch();
  const prefetchState = channelId ? prefetchContext?.getPrefetchState(channelId) : null;

  // Check if we have prefetched messages ready
  const hasPrefetchedMessages = prefetchState?.status === 'ready' && prefetchState.messages && prefetchState.messages.length > 0;

  // Fetch messages with pagination (live query for updates)
  // Start immediately if we have prefetched data, otherwise wait for animation
  const shouldStartQuery = hasPrefetchedMessages || isAnimationComplete;
  const { messages: liveMessages, loadMore, hasMore, isLoading: liveIsLoading, isStale } = useMessages(
    shouldStartQuery ? channelId : null,
    20,
    groupId ?? null
  );

  // Use prefetched messages while live query is loading
  // This eliminates the "Loading messages..." flash
  const messages = (liveIsLoading && hasPrefetchedMessages)
    ? prefetchState.messages!
    : liveMessages;

  // Only show loading if we have NO data (neither prefetched nor live)
  const isLoading = liveIsLoading && !hasPrefetchedMessages;

  // Extract message IDs for batch reactions loading
  const messageIds = useMemo<Id<"chatMessages">[]>(() => {
    return messages.map((msg) => msg._id);
  }, [messages]);

  // Transform messages into list items (with date separators and grouping info)
  // For inverted list, we reverse the order so newest messages come first
  const listItems = useMemo<ListItem[]>(() => {
    const items: ListItem[] = [];

    // Process messages in chronological order first to determine grouping
    messages.forEach((msg, index) => {
      const previousMsg = index > 0 ? messages[index - 1] : undefined;

      // Date separator goes BEFORE the first message of each date
      const isFirstOfDate = !previousMsg ||
        new Date(msg.createdAt).toDateString() !== new Date(previousMsg.createdAt).toDateString();

      // Show sender info if previous message is from different sender
      const showSenderInfo = !previousMsg || msg.senderId !== previousMsg.senderId;

      // Add date separator before the first message of each date
      if (isFirstOfDate) {
        items.push({
          type: 'dateSeparator',
          date: formatDateSeparator(msg.createdAt),
        });
      }

      items.push({
        type: 'message',
        data: msg,
        showSenderInfo,
      });
    });

    // Append optimistic messages at the end (newest, after all server messages)
    // Skip optimistic messages that already have a matching real message (dedup)
    if (optimisticMessages && optimisticMessages.length > 0) {
      const lastServerMsg = messages.length > 0 ? messages[messages.length - 1] : undefined;

      // For deduplication, check recent server messages (last 5 is plenty).
      // Track which server messages have already been matched so that
      // identical content sent twice within the time window is handled
      // correctly (each server message only "consumes" one optimistic).
      const recentServerMessages = messages.slice(-5);
      const matchedServerIds = new Set<string>();

      const pendingOptimistic = optimisticMessages.filter((optMsg) => {
        // Only dedup messages that the server has confirmed ('sent')
        if (optMsg._status !== 'sent') return true;
        // Check if a matching real message exists (that hasn't already been matched)
        const match = recentServerMessages.find(
          (serverMsg) =>
            !matchedServerIds.has(serverMsg._id) &&
            serverMsg.senderId === optMsg.senderId &&
            serverMsg.content === optMsg.content &&
            Math.abs(serverMsg.createdAt - optMsg.createdAt) < 5000
        );
        if (match) {
          matchedServerIds.add(match._id);
          return false; // This optimistic message is a duplicate, hide it
        }
        return true;
      });

      pendingOptimistic.forEach((optMsg, index) => {
        const prevMsg = index === 0 ? lastServerMsg : pendingOptimistic[index - 1];
        const showSenderInfo = !prevMsg || optMsg.senderId !== prevMsg.senderId;

        items.push({
          type: 'message',
          data: optMsg as any,
          showSenderInfo,
          isOptimistic: true,
          optimisticStatus: optMsg._status,
        });
      });
    }

    // Reverse for inverted list (newest first)
    return items.reverse();
  }, [messages, optimisticMessages]);

  // Handle scroll to detect if user is near bottom (for scroll-to-bottom button)
  // In inverted list, "near bottom" means near index 0
  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length === 0) return;

      // Check if index 0 (newest message) is visible
      const hasIndex0Visible = viewableItems.some(item => item.index === 0);
      const smallestVisibleIndex = Math.min(...viewableItems.map(item => item.index ?? Infinity));
      const nearBottom = hasIndex0Visible || smallestVisibleIndex <= 2;

      setShowScrollToBottom(!nearBottom);
    },
    []
  );

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 20,
  }).current;

  // Handle load more (when scrolling up to older messages)
  // In inverted list, this is onEndReached (reaching the visual top)
  const handleLoadMore = useCallback(() => {
    if (hasMore && !isLoading) {
      loadMore();
    }
  }, [hasMore, isLoading, loadMore]);

  // Handle scroll to bottom button press
  // In inverted list, scroll to index 0 to go to newest messages
  const handleScrollToBottom = useCallback(() => {
    listRef.current?.scrollToIndex({ index: 0, animated: true });
  }, []);

  // Render a single list item
  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === 'dateSeparator') {
        return (
          <View style={styles.dateSeparatorContainer}>
            <View style={[styles.dateSeparatorLine, { backgroundColor: themeColors.border }]} />
            <Text style={[styles.dateSeparatorText, { color: themeColors.textTertiary }]}>{item.date}</Text>
            <View style={[styles.dateSeparatorLine, { backgroundColor: themeColors.border }]} />
          </View>
        );
      }

      // Render message item using MessageItem component
      const message = item.data;

      return (
        <MessageItem
          message={{
            _id: message._id,
            channelId: message.channelId,
            senderId: message.senderId,
            content: message.content || '',
            contentType: message.contentType || 'text',
            attachments: message.attachments,
            createdAt: message.createdAt,
            editedAt: message.editedAt,
            isDeleted: message.isDeleted,
            senderName: message.senderName,
            senderProfilePhoto: message.senderProfilePhoto,
            mentionedUserIds: message.mentionedUserIds,
            threadReplyCount: message.threadReplyCount,
            hideLinkPreview: message.hideLinkPreview,
            reachOutRequestId: message.reachOutRequestId,
            taskId: message.taskId,
          }}
          currentUserId={currentUserId}
          groupId={groupId}
          channelName={channelName}
          prefetchState={prefetchState}
          onReply={onMessageReply}
          onReact={onMessageReact}
          onDelete={onMessageDelete}
          onLongPress={(msg, event) => {
            if (onMessageLongPress) {
              onMessageLongPress(message, event);
            }
          }}
          onDoubleTap={(msg, event) => {
            if (onMessageDoubleTap) {
              onMessageDoubleTap(message, event);
            }
          }}
          isOptimistic={item.isOptimistic}
          optimisticStatus={item.optimisticStatus as any}
          onRetry={item.isOptimistic && onRetryMessage ? () => onRetryMessage(String(message._id)) : undefined}
        />
      );
    },
    [currentUserId, groupId, channelName, prefetchState, onMessageReply, onMessageReact, onMessageDelete, onMessageLongPress, onMessageDoubleTap, onRetryMessage]
  );

  // Key extractor
  const keyExtractor = useCallback(
    (item: ListItem, index: number) =>
      item.type === 'dateSeparator' ? `date-${item.date}-${index}` : `msg-${item.data._id}`,
    []
  );

  // Delay showing "No messages yet" to avoid flashing it during notification
  // deep links where the subscription needs a moment to deliver messages.
  const [showEmptyState, setShowEmptyState] = useState(false);
  const emptyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isLoading && messages.length === 0) {
      // Wait before showing empty state so subscription has time to deliver
      emptyTimerRef.current = setTimeout(() => setShowEmptyState(true), 500);
    } else {
      setShowEmptyState(false);
      if (emptyTimerRef.current) {
        clearTimeout(emptyTimerRef.current);
        emptyTimerRef.current = null;
      }
    }
    return () => {
      if (emptyTimerRef.current) clearTimeout(emptyTimerRef.current);
    };
  }, [isLoading, messages.length]);

  // Loading state or waiting for messages — show empty container
  if (messages.length === 0 && !showEmptyState) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.surface }]} />
    );
  }

  // Empty state — only shown after delay confirms no messages
  if (showEmptyState && messages.length === 0) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: themeColors.surface }]}>
        <Ionicons name="chatbubbles-outline" size={64} color={themeColors.iconSecondary} style={{ marginBottom: 16 }} />
        <Text style={[styles.emptyTitle, { color: themeColors.text }]}>No messages yet</Text>
        <Text style={[styles.emptySubtext, { color: themeColors.textSecondary }]}>Start the conversation!</Text>
      </View>
    );
  }

  return (
    <ReactionsProvider messageIds={messageIds} channelId={channelId}>
      <View style={[styles.container, { backgroundColor: themeColors.surface }]}>
        <FlatList
          ref={listRef}
          data={listItems}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          // INVERTED - This is the key! List is flipped so newest messages appear at bottom
          inverted={true}
          // Load more when reaching the top (older messages)
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          // Viewability tracking for scroll-to-bottom button
          onViewableItemsChanged={handleViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          contentContainerStyle={styles.listContent}
          keyboardDismissMode="on-drag"
          // Performance optimizations
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          windowSize={10}
          // Footer shows loading indicator when fetching more
          ListFooterComponent={
            <>
              {isStale && (
                <View style={styles.staleBanner}>
                  <Ionicons name="cloud-offline-outline" size={14} color="#FF9500" />
                  <Text style={[styles.staleText, { color: themeColors.warning }]}>Showing cached messages</Text>
                </View>
              )}
              {hasMore ? (
                <View style={styles.loadMoreContainer}>
                  <ActivityIndicator size="small" color={primaryColor} />
                  <Text style={[styles.loadMoreText, { color: themeColors.textSecondary }]}>Loading more messages...</Text>
                </View>
              ) : null}
            </>
          }
        />

        {/* Scroll to bottom button */}
        {showScrollToBottom && (
          <Pressable
            style={[styles.scrollToBottomButton, { backgroundColor: primaryColor }]}
            onPress={handleScrollToBottom}
          >
            <Ionicons name="arrow-down" size={24} color="#fff" />
          </Pressable>
        )}
      </View>
    </ReactionsProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 16,
    textAlign: 'center',
  },
  loadMoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  loadMoreText: {
    fontSize: 14,
  },
  dateSeparatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
    paddingHorizontal: 16,
  },
  dateSeparatorLine: {
    flex: 1,
    height: 1,
  },
  dateSeparatorText: {
    fontSize: 12,
    fontWeight: '600',
    marginHorizontal: 12,
    textTransform: 'uppercase',
  },
  scrollToBottomButton: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  staleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 6,
  },
  staleText: {
    fontSize: 12,
    fontWeight: '500',
  },
});
