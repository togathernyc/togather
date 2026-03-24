/**
 * MessageItem - Individual chat message component
 *
 * Displays messages with all features:
 * - Own vs others' messages (different layout/colors)
 * - @Mentions (highlighted and tappable)
 * - Read receipts (checkmarks + count)
 * - Reactions (emoji badges)
 * - Deleted/edited states
 * - Images from attachments
 * - Long press action menu
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  GestureResponderEvent,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { Id } from '@services/api/convex';
import { AppImage, ImageViewer } from '@components/ui';
import { useReadReceipts } from '@features/chat/hooks/useReadReceipts';
import { useReactions, type Reaction } from '@features/chat/hooks/useReactions';
import { EventLinkCard } from './EventLinkCard';
import { ToolLinkCard } from './ToolLinkCard';
import { ChannelInviteLinkCard } from './ChannelInviteLinkCard';
import { LinkPreviewCard } from './LinkPreviewCard';
import { FileAttachment } from './FileAttachment';
import { AudioPlayer } from './AudioPlayer';
import { VideoPlayer } from './VideoPlayer';
import { ImageAttachmentsGrid } from './ImageAttachmentsGrid';
import { ThreadReplies } from './ThreadReplies';
import { ReactionDetailsModal } from './ReactionDetailsModal';
import { ReachOutRequestCardFromMessage } from './ReachOutRequestCardFromMessage';
import { TaskCardFromMessage } from './TaskCardFromMessage';
import { extractEventShortIds, extractToolShortIds, extractChannelInviteShortIds, stripEventLinksFromText, stripToolLinksFromText, stripChannelInviteLinksFromText, extractFirstExternalUrl } from '../utils/eventLinkUtils';
import { useLinkPreview } from '../hooks/useLinkPreview';
import { getMediaUrl } from '@/utils/media';
import { colors } from '@utils/styles';
import { useTheme } from '@hooks/useTheme';
import type { ChannelPrefetchState } from '../context/ChatPrefetchContext';

interface MessageItemProps {
  message: {
    _id: Id<"chatMessages">;
    channelId: Id<"chatChannels">;
    senderId: Id<"users">;
    content: string;
    contentType: string;
    attachments?: Array<{
      type: string;
      url: string;
      name?: string;
      waveform?: number[];
      duration?: number;
    }>;
    createdAt: number;
    editedAt?: number;
    isDeleted: boolean;
    senderName?: string;
    senderProfilePhoto?: string;
    mentionedUserIds?: Id<"users">[];
    threadReplyCount?: number;
    hideLinkPreview?: boolean;
    reachOutRequestId?: Id<"reachOutRequests">;
    taskId?: Id<"tasks">;
  };
  currentUserId: Id<"users">;
  groupId?: Id<"groups">;
  channelName?: string;
  /** Prefetched data for link previews and events (optional) */
  prefetchState?: ChannelPrefetchState | null;
  onReply?: (messageId: Id<"chatMessages">) => void;
  onReact?: (messageId: Id<"chatMessages">) => void;
  onDelete?: (messageId: Id<"chatMessages">) => void;
  onLongPress?: (
    message: {
      _id: Id<"chatMessages">;
      senderId: Id<"users">;
      content: string;
      senderName?: string;
      senderProfilePhoto?: string;
      attachments?: Array<{ type: string; url: string; name?: string; waveform?: number[]; duration?: number }>;
    },
    event: { nativeEvent: { pageX: number; pageY: number } }
  ) => void;
  /** Whether this is an optimistic (unsent) message */
  isOptimistic?: boolean;
  /** Status of optimistic message */
  optimisticStatus?: 'sending' | 'sent' | 'error' | 'queued';
  /** Callback when user taps retry on a failed message */
  onRetry?: () => void;
}

/**
 * Format timestamp as "10:30 AM", "Yesterday", etc.
 */
function formatMessageTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  // Today - show time
  if (days === 0) {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const displayMinutes = minutes.toString().padStart(2, '0');
    return `${displayHours}:${displayMinutes} ${ampm}`;
  }

  // Yesterday
  if (days === 1) {
    return 'Yesterday';
  }

  // This week - show day name
  if (days < 7) {
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return weekdays[date.getDay()];
  }

  // Older - show date
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const day = date.getDate();

  if (date.getFullYear() !== now.getFullYear()) {
    return `${month} ${day}, ${date.getFullYear()}`;
  }

  return `${month} ${day}`;
}

/**
 * Parse message content and detect @mentions and URLs
 * Mentions use bracketed format: @[Display Name] to support names with spaces
 */
type ContentPart = { type: 'text' | 'mention' | 'url'; value: string; displayValue?: string };

function parseMessageContent(content: string): ContentPart[] {
  const parts: ContentPart[] = [];

  // Bracketed mentions: @[Display Name] - supports names with spaces
  const mentionRegex = /@\[([^\]]+)\]/g;
  const urlRegex = /(https?:\/\/[^\s]+)/g;

  // Find all matches with their positions
  const allMatches: Array<{ type: 'mention' | 'url'; value: string; displayValue?: string; index: number }> = [];

  let match: RegExpExecArray | null;

  // Find mentions - capture the display name without brackets
  while ((match = mentionRegex.exec(content)) !== null) {
    allMatches.push({
      type: 'mention',
      value: match[0], // Full match: @[John Smith]
      displayValue: `@${match[1]}`, // Display as: @John Smith (without brackets)
      index: match.index,
    });
  }

  // Find URLs
  while ((match = urlRegex.exec(content)) !== null) {
    allMatches.push({ type: 'url', value: match[0], index: match.index });
  }

  // Sort by position
  allMatches.sort((a, b) => a.index - b.index);

  // Build parts array
  let lastIndex = 0;
  for (const m of allMatches) {
    // Add text before this match
    if (m.index > lastIndex) {
      parts.push({
        type: 'text',
        value: content.substring(lastIndex, m.index),
      });
    }

    // Add the match
    parts.push({
      type: m.type,
      value: m.value,
      displayValue: m.displayValue,
    });

    lastIndex = m.index + m.value.length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    parts.push({
      type: 'text',
      value: content.substring(lastIndex),
    });
  }

  // If nothing found, return whole content as text
  if (parts.length === 0) {
    parts.push({ type: 'text', value: content });
  }

  return parts;
}

function MessageItemInner({
  message,
  currentUserId,
  groupId,
  channelName,
  prefetchState,
  onReply,
  onReact,
  onDelete,
  onLongPress,
  isOptimistic,
  optimisticStatus,
  onRetry,
}: MessageItemProps) {
  const router = useRouter();
  const { colors: themeColors } = useTheme();

  const isOwnMessage = message.senderId === currentUserId;

  // Get read receipts (only for own messages, skip for optimistic)
  const { readByCount, totalMembers, isLoading: readReceiptsLoading } = useReadReceipts(
    isOwnMessage && !isOptimistic ? message._id : null,
    isOwnMessage && !isOptimistic ? message.channelId : null
  );

  // Get reactions (skip for optimistic messages)
  const { reactions, toggleReaction, isLoading: reactionsLoading } = useReactions(
    isOptimistic ? (null as any) : message._id
  );

  // Image viewer state
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [imageViewerInitialIndex, setImageViewerInitialIndex] = useState(0);

  // Reaction details modal state
  const [reactionModalVisible, setReactionModalVisible] = useState(false);
  const [selectedReactionEmoji, setSelectedReactionEmoji] = useState<string | null>(null);

  // Detect event links in message content
  const eventShortIds = useMemo(() => {
    if (message.isDeleted) return [];
    return extractEventShortIds(message.content);
  }, [message.content, message.isDeleted]);

  // Detect tool links in message content
  const toolShortIds = useMemo(() => {
    if (message.isDeleted) return [];
    return extractToolShortIds(message.content);
  }, [message.content, message.isDeleted]);

  // Detect channel invite links in message content
  const channelInviteShortIds = useMemo(() => {
    if (message.isDeleted) return [];
    return extractChannelInviteShortIds(message.content);
  }, [message.content, message.isDeleted]);

  // Get display text (with event, tool, and channel invite links stripped if we're showing cards)
  const displayText = useMemo(() => {
    let text = message.content;
    if (eventShortIds.length > 0) {
      text = stripEventLinksFromText(text);
    }
    if (toolShortIds.length > 0) {
      text = stripToolLinksFromText(text);
    }
    if (channelInviteShortIds.length > 0) {
      text = stripChannelInviteLinksFromText(text);
    }
    return text;
  }, [message.content, eventShortIds, toolShortIds, channelInviteShortIds]);

  // Detect external URLs for link preview (only if no event/tool/channel invite cards)
  const externalUrl = useMemo(() => {
    if (message.isDeleted || eventShortIds.length > 0 || toolShortIds.length > 0 || channelInviteShortIds.length > 0) return null;
    return extractFirstExternalUrl(message.content);
  }, [message.content, message.isDeleted, eventShortIds, toolShortIds, channelInviteShortIds]);

  // Check for prefetched link preview first
  const prefetchedLinkPreview = useMemo(() => {
    if (!externalUrl || !prefetchState?.linkPreviews) return null;
    return prefetchState.linkPreviews.get(externalUrl) ?? null;
  }, [externalUrl, prefetchState?.linkPreviews]);

  // Fetch link preview for external URL (skip if prefetched)
  const { preview: fetchedLinkPreview, loading: linkPreviewLoading } = useLinkPreview(
    prefetchedLinkPreview ? null : externalUrl
  );

  // Use prefetched preview if available, otherwise use fetched
  const linkPreview = prefetchedLinkPreview ?? fetchedLinkPreview;

  // Determine if we're still loading the link preview
  // If prefetched, we're not loading; otherwise check the hook's loading state
  const isLinkPreviewLoading = !prefetchedLinkPreview && linkPreviewLoading;

  // Handle mention tap
  const handleMentionTap = useCallback(
    (mention: string) => {
      // Navigate to user profile
      // TODO: Need to resolve username to userId for navigation
      console.log('[MessageItem] Tapped mention:', mention);
      // router.push(`/profile/${userId}`);
    },
    [router]
  );

  // Handle reaction tap
  const handleReactionTap = useCallback(
    async (emoji: string) => {
      try {
        await toggleReaction(emoji);
      } catch (err) {
        console.error('[MessageItem] Failed to toggle reaction:', err);
      }
    },
    [toggleReaction]
  );

  // Handle reaction long press - show details modal
  const handleReactionLongPress = useCallback((emoji: string) => {
    setSelectedReactionEmoji(emoji);
    setReactionModalVisible(true);
  }, []);

  // Close reaction details modal
  const handleReactionModalClose = useCallback(() => {
    setReactionModalVisible(false);
    setSelectedReactionEmoji(null);
  }, []);

  // Handle long press - call parent's callback with message data and position
  const handleLongPress = useCallback(
    (event: GestureResponderEvent) => {
      if (onLongPress) {
        onLongPress(
          {
            _id: message._id,
            senderId: message.senderId,
            content: message.content,
            senderName: message.senderName,
            senderProfilePhoto: message.senderProfilePhoto,
            attachments: message.attachments,
          },
          {
            nativeEvent: {
              pageX: event.nativeEvent.pageX,
              pageY: event.nativeEvent.pageY,
            },
          }
        );
      }
    },
    [message._id, message.senderId, message.content, onLongPress]
  );

  // Handle reactions area tap - open reaction picker
  const handleReactionsAreaTap = useCallback(() => {
    onReact?.(message._id);
  }, [message._id, onReact]);

  // Handle URL tap - open in browser
  const handleUrlTap = useCallback((url: string) => {
    Linking.openURL(url).catch((err) => {
      console.error('[MessageItem] Failed to open URL:', err);
    });
  }, []);

  // Render message content with @mentions and clickable URLs
  const renderMessageContent = () => {
    if (message.isDeleted) {
      return (
        <Text style={[styles.messageText, styles.deletedText, { color: themeColors.textTertiary }]}>
          This message was deleted
        </Text>
      );
    }

    // Use displayText which has event links stripped if we're showing cards
    const parts = parseMessageContent(displayText);

    // Don't render if only whitespace left after stripping
    if (displayText.trim().length === 0) {
      return null;
    }

    return (
      <Text style={[styles.messageText, { color: themeColors.text }, isOwnMessage && { color: themeColors.chatBubbleOwnText }]}>
        {parts.map((part, index) => {
          if (part.type === 'mention') {
            return (
              <Text
                key={index}
                style={isOwnMessage ? styles.ownMessageMention : styles.mention}
                onPress={() => handleMentionTap(part.value)}
              >
                {part.displayValue || part.value}
              </Text>
            );
          }
          if (part.type === 'url') {
            return (
              <Text
                key={index}
                style={[styles.urlLink, { color: themeColors.link }]}
                onPress={() => handleUrlTap(part.value)}
              >
                {part.value}
              </Text>
            );
          }
          return <Text key={index}>{part.value}</Text>;
        })}
      </Text>
    );
  };

  // Render event cards for detected togather.nyc/e/ links
  const renderEventCards = () => {
    if (eventShortIds.length === 0) {
      return null;
    }

    return (
      <View style={styles.eventCardsContainer}>
        {eventShortIds.map((shortId) => {
          // Get prefetched event data if available
          const prefetchedEvent = prefetchState?.eventData?.get(shortId);
          return (
            <EventLinkCard
              key={shortId}
              shortId={shortId}
              isMyMessage={isOwnMessage}
              embedded
              prefetchedData={prefetchedEvent}
            />
          );
        })}
      </View>
    );
  };

  // Render tool cards for detected togather.nyc/t/ links
  const renderToolCards = () => {
    if (toolShortIds.length === 0) return null;

    return (
      <View style={styles.eventCardsContainer}>
        {toolShortIds.map((shortId) => {
          const prefetchedTool = prefetchState?.toolData?.get(shortId);
          return (
            <ToolLinkCard
              key={shortId}
              shortId={shortId}
              isMyMessage={isOwnMessage}
              embedded
              prefetchedData={prefetchedTool}
            />
          );
        })}
      </View>
    );
  };

  // Render channel invite cards for detected togather.nyc/ch/ links
  const renderChannelInviteCards = () => {
    if (channelInviteShortIds.length === 0) return null;

    return (
      <View style={styles.eventCardsContainer}>
        {channelInviteShortIds.map((shortId) => (
          <ChannelInviteLinkCard
            key={`ch-${shortId}`}
            shortId={shortId}
            groupId={groupId}
          />
        ))}
      </View>
    );
  };

  // Render link preview for external URLs
  const renderLinkPreview = () => {
    // Don't show if we have event or tool cards (they take priority)
    if (eventShortIds.length > 0 || toolShortIds.length > 0) return null;
    // Don't show if user explicitly dismissed the preview before sending
    if (message.hideLinkPreview) return null;
    // Don't show if no external URL detected
    if (!externalUrl) return null;

    // Show skeleton placeholder while loading to reserve space and prevent layout jumps
    if (isLinkPreviewLoading && !linkPreview) {
      return (
        <View style={styles.linkPreviewContainer}>
          <LinkPreviewCard
            preview={{ url: externalUrl }}
            isMyMessage={isOwnMessage}
            embedded
            loading
          />
        </View>
      );
    }

    // Don't render if failed to load (no preview data)
    if (!linkPreview) return null;

    return (
      <View style={styles.linkPreviewContainer}>
        <LinkPreviewCard
          preview={linkPreview}
          isMyMessage={isOwnMessage}
          embedded
        />
      </View>
    );
  };

  // Define attachment type
  type Attachment = { type: string; url: string; name?: string; waveform?: number[]; duration?: number };

  // Categorize attachments by type
  const { validImageAttachments, imageUrls, documentAttachments, audioAttachments, videoAttachments } = useMemo(() => {
    const emptyResult = {
      validImageAttachments: [] as Attachment[],
      imageUrls: [] as string[],
      documentAttachments: [] as Attachment[],
      audioAttachments: [] as Attachment[],
      videoAttachments: [] as Attachment[],
    };

    if (!message.attachments) {
      return emptyResult;
    }

    const images = message.attachments.filter((a) => a.type === 'image');
    const validImages: Attachment[] = [];
    const urls: string[] = [];

    for (const attachment of images) {
      const url = getMediaUrl(attachment.url);
      if (url) {
        validImages.push(attachment);
        urls.push(url);
      }
    }

    // Filter other attachment types
    const documents = message.attachments.filter((a) => a.type === 'document');
    const audio = message.attachments.filter((a) => a.type === 'audio');
    const video = message.attachments.filter((a) => a.type === 'video');

    return {
      validImageAttachments: validImages,
      imageUrls: urls,
      documentAttachments: documents,
      audioAttachments: audio,
      videoAttachments: video,
    };
  }, [message.attachments]);

  // Handle image tap - open gallery viewer
  const handleImagePress = useCallback((index: number) => {
    setImageViewerInitialIndex(index);
    setImageViewerVisible(true);
  }, []);

  // Render image attachments
  const renderImageAttachments = () => {
    if (validImageAttachments.length === 0) {
      return null;
    }

    return (
      <View style={styles.attachmentsContainer}>
        <ImageAttachmentsGrid
          images={validImageAttachments}
          onImagePress={handleImagePress}
          onLongPress={() => handleLongPress({ nativeEvent: { pageX: 0, pageY: 0 } } as GestureResponderEvent)}
        />
      </View>
    );
  };

  // Render document attachments
  const renderDocumentAttachments = () => {
    if (documentAttachments.length === 0) {
      return null;
    }

    return (
      <View style={styles.attachmentsContainer}>
        {documentAttachments.map((attachment, index) => (
          <FileAttachment
            key={`doc-${index}`}
            url={attachment.url}
            name={attachment.name}
            isOwnMessage={isOwnMessage}
          />
        ))}
      </View>
    );
  };

  // Render audio attachments
  const renderAudioAttachments = () => {
    if (audioAttachments.length === 0) {
      return null;
    }

    return (
      <View style={styles.attachmentsContainer}>
        {audioAttachments.map((attachment, index) => (
          <AudioPlayer
            key={`audio-${index}`}
            url={attachment.url}
            name={attachment.name}
            isOwnMessage={isOwnMessage}
            waveform={attachment.waveform}
            duration={attachment.duration}
          />
        ))}
      </View>
    );
  };

  // Render video attachments
  const renderVideoAttachments = () => {
    if (videoAttachments.length === 0) {
      return null;
    }

    return (
      <View style={styles.attachmentsContainer}>
        {videoAttachments.map((attachment, index) => (
          <VideoPlayer
            key={`video-${index}`}
            url={attachment.url}
            name={attachment.name}
            isOwnMessage={isOwnMessage}
            onLongPress={handleLongPress}
          />
        ))}
      </View>
    );
  };

  // Render reactions
  const renderReactions = () => {
    // Don't render while loading - prevents flicker
    // Reactions are loaded via ReactionsProvider batch query, should be fast
    if (reactionsLoading && reactions.length === 0) {
      return null;
    }

    if (reactions.length === 0) {
      return null;
    }

    return (
      <Pressable onPress={handleReactionsAreaTap}>
        <View style={styles.reactionsContainer}>
          {reactions.map((reaction: Reaction) => (
            <Pressable
              key={reaction.emoji}
              style={[
                styles.reactionBadge,
                { backgroundColor: themeColors.surfaceSecondary, borderColor: themeColors.border },
                reaction.hasReacted && { backgroundColor: '#E3F2FD', borderColor: '#1976D2' },
              ]}
              onPress={() => handleReactionTap(reaction.emoji)}
              onLongPress={() => handleReactionLongPress(reaction.emoji)}
              delayLongPress={300}
            >
              <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
              {reaction.count > 1 && (
                <Text style={[styles.reactionCount, { color: themeColors.textSecondary }]}>{reaction.count}</Text>
              )}
            </Pressable>
          ))}
        </View>
      </Pressable>
    );
  };

  // Handle thread press - navigate to thread page
  const handleThreadPress = useCallback(() => {
    if (groupId) {
      router.push({
        pathname: `/inbox/${groupId}/thread/${message._id}` as any,
        params: {
          channelName: channelName || 'general',
        },
      });
    }
  }, [router, groupId, message._id, channelName]);

  // Render reach-out request card (embedded in normal message layout)
  const renderReachOutCard = () => {
    if (message.contentType !== "reach_out_request" || !message.reachOutRequestId) {
      return null;
    }
    return (
      <View style={styles.eventCardsContainer}>
        <ReachOutRequestCardFromMessage
          requestId={message.reachOutRequestId}
          groupId={groupId}
        />
      </View>
    );
  };

  // Render thread replies indicator
  const renderThreadReplies = () => {
    const replyCount = message.threadReplyCount;
    if (!replyCount || replyCount === 0) {
      return null;
    }

    return (
      <ThreadReplies
        parentMessageId={message._id}
        channelId={message.channelId}
        replyCount={replyCount}
        onPress={groupId ? handleThreadPress : undefined}
      />
    );
  };

  const renderTaskCard = () => {
    if (message.contentType !== "task_card" || !message.taskId) {
      return null;
    }
    return (
      <View style={styles.eventCardsContainer}>
        <TaskCardFromMessage taskId={message.taskId} />
      </View>
    );
  };

  // Render optimistic message status indicator
  const renderOptimisticStatus = () => {
    if (!isOptimistic || !optimisticStatus) return null;

    if (optimisticStatus === 'sending') {
      return (
        <View testID="optimistic-sending" style={styles.optimisticStatusContainer}>
          <ActivityIndicator size={10} color={themeColors.textTertiary} />
        </View>
      );
    }

    if (optimisticStatus === 'queued') {
      return (
        <View testID="optimistic-queued" style={styles.optimisticStatusContainer}>
          <Ionicons name="time-outline" size={12} color={colors.warning} />
          <Text style={[styles.optimisticStatusText, { color: themeColors.textTertiary }]}>Queued</Text>
        </View>
      );
    }

    if (optimisticStatus === 'error') {
      return (
        <Pressable testID="optimistic-error" style={styles.optimisticStatusContainer} onPress={onRetry}>
          <Ionicons name="alert-circle" size={14} color={colors.error} />
          <Text style={[styles.optimisticStatusText, { color: colors.error }]}>Tap to retry</Text>
        </Pressable>
      );
    }

    return null;
  };

  // Render read receipts (only for own messages)
  const renderReadReceipts = () => {
    if (!isOwnMessage) {
      return null;
    }

    // With prefetch, data should be ready immediately
    // If still loading (edge case), don't render to avoid flicker
    if (readReceiptsLoading) {
      return null;
    }

    // Show checkmarks based on read state
    // ✓ = sent (always shown)
    // ✓✓ = delivered (shown when totalMembers > 0)
    // ✓✓ + count = read (shown when readByCount > 0)

    if (readByCount > 0) {
      // Read by some people
      return (
        <View style={styles.readReceiptsContainer}>
          <Text style={[styles.readCheck, { color: themeColors.chatBubbleOwn }]}>✓✓</Text>
          <Text style={[styles.readCount, { color: themeColors.chatBubbleOwn }]}>
            {readByCount}
          </Text>
        </View>
      );
    } else if (totalMembers > 0) {
      // Delivered but not read
      return (
        <View style={styles.readReceiptsContainer}>
          <Text style={[styles.deliveredCheck, { color: themeColors.textTertiary }]}>✓✓</Text>
        </View>
      );
    } else {
      // Just sent
      return (
        <View style={styles.readReceiptsContainer}>
          <Text style={[styles.sentCheck, { color: themeColors.textTertiary }]}>✓</Text>
        </View>
      );
    }
  };

  return (
    <Pressable onLongPress={handleLongPress} delayLongPress={300}>
      <View
        style={[
          styles.container,
          isOwnMessage ? styles.ownMessageContainer : styles.otherMessageContainer,
          isOptimistic && optimisticStatus !== 'error' && { opacity: 0.7 },
        ]}
      >
        {/* Avatar (only for others' messages) */}
        {!isOwnMessage && (
          <View style={styles.avatarContainer}>
            <AppImage
              source={message.senderProfilePhoto}
              style={styles.avatar}
              optimizedWidth={50}
              placeholder={{
                type: 'initials',
                name: message.senderName || 'User',
                backgroundColor: '#E5E5E5',
              }}
            />
          </View>
        )}

        <View style={[
          styles.messageContent,
          isOwnMessage && styles.ownMessageContent,
        ]}>
          {/* Sender name (only for others' messages) */}
          {!isOwnMessage && (
            <Text style={[styles.senderName, { color: themeColors.textSecondary }]}>{message.senderName || 'Unknown'}</Text>
          )}

          {/* Message bubble (hidden for special card messages) */}
          {message.contentType !== "reach_out_request" && message.contentType !== "task_card" && (
            <View style={styles.bubbleWrapper}>
              <View
                style={[
                  styles.messageBubble,
                  isOwnMessage
                    ? [styles.ownMessageBubble, { backgroundColor: themeColors.chatBubbleOwn }]
                    : [styles.otherMessageBubble, { backgroundColor: themeColors.chatBubbleOther }],
                ]}
              >
                <View style={styles.bubbleTextContent}>
                  {renderMessageContent()}
                </View>
                {renderImageAttachments()}
                {renderDocumentAttachments()}
                {renderAudioAttachments()}
                {renderVideoAttachments()}

                {/* Timestamp and edited badge */}
                <View style={[styles.messageFooter, styles.bubbleFooter]}>
                  <Text
                    style={[
                      styles.timestamp,
                      { color: themeColors.textTertiary },
                      isOwnMessage && { color: themeColors.textSecondary },
                    ]}
                  >
                    {formatMessageTime(message.createdAt)}
                  </Text>
                  {message.editedAt && !message.isDeleted && (
                    <Text
                      style={[
                        styles.editedBadge,
                        { color: themeColors.textTertiary },
                        isOwnMessage && { color: themeColors.textSecondary },
                      ]}
                    >
                      (edited)
                    </Text>
                  )}
                </View>
              </View>
              {/* Bubble tail */}
              <View
                style={
                  isOwnMessage
                    ? [styles.ownMessageTail, { borderLeftColor: themeColors.chatBubbleOwn }]
                    : [styles.otherMessageTail, { borderRightColor: themeColors.chatBubbleOther }]
                }
              />
            </View>
          )}

          {/* Reach-out request card */}
          {renderReachOutCard()}

          {/* Task card */}
          {renderTaskCard()}

          {/* Event cards for meeting links */}
          {renderEventCards()}

          {/* Tool cards for run sheet/resource links */}
          {renderToolCards()}

          {/* Channel invite link cards */}
          {renderChannelInviteCards()}

          {/* Link preview for external URLs */}
          {renderLinkPreview()}

          {/* Reactions */}
          {renderReactions()}

          {/* Thread replies indicator */}
          {renderThreadReplies()}

          {/* Read receipts or optimistic status */}
          {isOptimistic ? renderOptimisticStatus() : renderReadReceipts()}
        </View>
      </View>

      {/* Image Gallery Viewer */}
      <ImageViewer
        visible={imageViewerVisible}
        images={imageUrls}
        initialIndex={imageViewerInitialIndex}
        onClose={() => setImageViewerVisible(false)}
      />

      {/* Reaction Details Modal */}
      <ReactionDetailsModal
        visible={reactionModalVisible}
        emoji={selectedReactionEmoji}
        messageId={message._id}
        onClose={handleReactionModalClose}
      />
    </Pressable>
  );
}

export const MessageItem = React.memo(MessageItemInner);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginVertical: 2,
    paddingHorizontal: 12,
  },
  ownMessageContainer: {
    justifyContent: 'flex-end',
  },
  otherMessageContainer: {
    justifyContent: 'flex-start',
  },
  avatarContainer: {
    width: 24,
    height: 24,
    marginRight: 6,
    marginTop: 4,
    flexShrink: 0,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  messageContent: {
    maxWidth: '75%',
    flexShrink: 1,
  },
  ownMessageContent: {
    alignItems: 'flex-end',
  },
  senderName: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
    marginLeft: 12,
  },
  bubbleWrapper: {
    position: 'relative',
  },
  messageBubble: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  ownMessageBubble: {
    borderBottomRightRadius: 3,
    alignSelf: 'flex-end',
  },
  otherMessageBubble: {
    borderBottomLeftRadius: 3,
    alignSelf: 'flex-start',
  },
  // Bubble tail for own messages (right side)
  ownMessageTail: {
    position: 'absolute',
    right: -5,
    bottom: 0,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderTopWidth: 5,
    borderTopColor: 'transparent',
    borderBottomWidth: 5,
    borderBottomColor: 'transparent',
  },
  // Bubble tail for others' messages (left side)
  otherMessageTail: {
    position: 'absolute',
    left: -5,
    bottom: 0,
    width: 0,
    height: 0,
    borderRightWidth: 6,
    borderTopWidth: 5,
    borderTopColor: 'transparent',
    borderBottomWidth: 5,
    borderBottomColor: 'transparent',
  },
  messageText: {
    fontSize: 14,
    lineHeight: 18,
  },
  ownMessageText: {
  },
  deletedText: {
    fontStyle: 'italic',
  },
  mention: {
    backgroundColor: '#E3F2FD',
    color: '#1976D2',
    fontWeight: '600',
    paddingHorizontal: 2,
    borderRadius: 2,
  },
  ownMessageMention: {
    backgroundColor: 'rgba(0, 100, 200, 0.15)',
    color: '#1976D2',
    fontWeight: '600',
    paddingHorizontal: 2,
    borderRadius: 2,
  },
  urlLink: {
    textDecorationLine: 'underline',
  },
  eventCardsContainer: {
    marginTop: 8,
  },
  linkPreviewContainer: {
    marginTop: 8,
  },
  ownMessageTimestamp: {
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  timestamp: {
    fontSize: 10,
  },
  editedBadge: {
    fontSize: 10,
    marginLeft: 4,
    fontStyle: 'italic',
  },
  attachmentsContainer: {
    marginTop: 4,
  },
  bubbleTextContent: {
    paddingHorizontal: 10,
    paddingTop: 6,
  },
  bubbleFooter: {
    paddingHorizontal: 10,
    paddingBottom: 6,
  },
  reactionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  reactionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 4,
    marginBottom: 4,
    borderWidth: 1,
  },
  reactionEmoji: {
    fontSize: 14,
  },
  reactionCount: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  readReceiptsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 1,
  },
  sentCheck: {
    fontSize: 10,
    letterSpacing: -1,
  },
  deliveredCheck: {
    fontSize: 10,
    letterSpacing: -1,
  },
  readCheck: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: -1,
    // color set dynamically via style prop
  },
  readCount: {
    fontSize: 9,
    fontWeight: '600',
    marginLeft: 1,
    // color set dynamically via style prop
  },
  optimisticStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 4,
  },
  optimisticStatusText: {
    fontSize: 11,
  },
});
