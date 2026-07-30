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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  GestureResponderEvent,
  Linking,
  ActivityIndicator,
  Animated,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { Id } from '@services/api/convex';
import { AppImage, ImageViewer } from '@components/ui';
import { NotificationsDisabledBadge } from '@components/ui/NotificationsDisabledBadge';
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
import { TaskCardFromMessage } from './TaskCardFromMessage';
import { BugCardFromMessage } from './BugCardFromMessage';
import { PollCardFromMessage } from './PollCardFromMessage';
import { AvailabilityRequestCardFromMessage } from './AvailabilityRequestCardFromMessage';
import { AvailabilityLinkCard } from './AvailabilityLinkCard';
import { extractEventShortIds, extractToolShortIds, extractChannelInviteShortIds, extractAvailabilityTokens, stripEventLinksFromText, stripToolLinksFromText, stripChannelInviteLinksFromText, stripAvailabilityLinksFromText, extractFirstExternalUrl } from '../utils/eventLinkUtils';
import { useLinkPreview } from '../hooks/useLinkPreview';
import { parseMessageContent } from '@features/shared/utils/linkify';
import { getMediaUrl } from '@/utils/media';
import { colors } from '@utils/styles';
import { useTheme } from '@hooks/useTheme';
import { useWhatsappShell } from '@hooks/useWhatsappShell';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { waAccentPalette } from '@utils/waPalette';
import {
  WA_BUBBLE_RADIUS,
  WA_BUBBLE_TAIL_CORNER_RADIUS,
  WA_BUBBLE_MAX_WIDTH_PCT,
  WA_BUBBLE_PADDING_V,
  WA_BUBBLE_PADDING_H,
  WA_BUBBLE_RUN_GAP,
  WA_BUBBLE_GROUPED_GAP,
} from '@components/wa/metrics';
import {
  WA_BUBBLE_SHADOW,
  WA_BUBBLE_BODY_SIZE,
  WA_BUBBLE_BODY_LINE_HEIGHT,
  WA_BUBBLE_SENDER_SIZE,
  WA_BUBBLE_TIMESTAMP_SIZE,
  waSenderColor,
} from '../waChatChrome';
import { ReplyQuoteBlock, type ReplyQuote } from './ReplyQuoteBlock';
import { ThreadSummaryPill, type ThreadSummary } from './ThreadSummaryPill';
import type { ChannelPrefetchState } from '../context/ChatPrefetchContext';

// §5 "Bubble timestamp + ticks placement": on outgoing bubbles the timestamp
// renders on top of the tinted bubble fill, not a themed surface, so it uses
// a fixed black/white-alpha overlay rather than a theme token.
const WA_TIMESTAMP_ON_TINT_LIGHT = 'rgba(0,0,0,0.45)';
const WA_TIMESTAMP_ON_TINT_DARK = 'rgba(255,255,255,0.6)';

/**
 * Incoming-message avatar diameter, flag-on. The one chat-surface measurement
 * that came in SMALLER than the reference (ours 24 vs WA's 30) in the
 * calibrated pixel pass, 2026-07-29 — 28 closes most of the gap without
 * pushing the bubble column inward.
 */
const WA_INCOMING_AVATAR = 28;

/**
 * The Togather brand mark, shown as the avatar for automated bot messages
 * (contentType "bot" with no human sender) so the bot reads as first-party
 * rather than an initials placeholder.
 */
const TOGATHER_BOT_AVATAR = require('@/assets/gatherful-logo.png');

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
    /**
     * True when the sender has push notifications disabled (no token in
     * the current environment). Drives the slashed-bell badge over the
     * sender's avatar so readers know not to expect immediate read/response.
     */
    senderNotificationsDisabled?: boolean;
    mentionedUserIds?: Id<"users">[];
    threadReplyCount?: number;
    hideLinkPreview?: boolean;
    taskId?: Id<"tasks">;
    bugId?: Id<"devBugs">;
    pollId?: Id<"polls">;
    availabilityRequestId?: Id<"availabilityRequests">;
    /** Present only on messages that mirror an event text blast (SMS + push). */
    blastId?: Id<"eventBlasts">;
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
  /** Callback when user double-taps a message (reactions only) */
  onDoubleTap?: (
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
  /**
   * Callback when the user taps another user's avatar in the message list.
   * Used to open the user profile page. Not invoked for own avatars (none
   * are rendered) or for bot/system messages (senderId will be missing).
   */
  onAvatarPress?: (userId: Id<"users">) => void;
  /**
   * When true, the row briefly flashes a highlight background. Used when the
   * user jumps to this message from inbox search so it stands out on arrival.
   */
  isHighlighted?: boolean;
  /**
   * WHATSAPP-DESIGN-SYSTEM.md §5 consecutive-message grouping — whether this
   * message starts/ends a same-sender run (computed by MessageList: sender
   * change, or a date separator/ghost boundary on that side). Read ONLY when
   * `whatsappShellEnabled`; flag-off rendering never looks at these props.
   * Undefined (no grouping info supplied) is treated as a standalone run —
   * both first and last — which reproduces the pre-grouping flag-on look
   * (sender name always shown, tail corner always squared).
   */
  isFirstInGroup?: boolean;
  /** Mirrors `isFirstInGroup`, but for whether a same-sender message follows. */
  isLastInGroup?: boolean;
  /**
   * WHATSAPP-DESIGN-SYSTEM.md §5 reply-quote bar. Present (flag-on only) when
   * this message is a reply that the timeline admitted — i.e. it is its
   * parent's ONLY live reply. Renders the quoted parent INSIDE this bubble,
   * above its own text. Supplied by `getMessages`' `replyQuote` decoration.
   */
  replyQuote?: ReplyQuote;
  /** Tap the quote → scroll the list to the quoted message and flash it. */
  onQuotePress?: (parentMessageId: Id<"chatMessages">) => void;
  /**
   * The collapsed-thread pill's data (flag-on only). Present when this message
   * has TWO OR MORE live replies, which is exactly when its replies stop
   * rendering inline and become a thread. `getMessages` decides that — a bare
   * `threadReplyCount` is not enough, since it counts deleted replies too.
   */
  threadSummary?: ThreadSummary;
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
  onDoubleTap,
  isOptimistic,
  optimisticStatus,
  onRetry,
  onAvatarPress,
  isHighlighted,
  isFirstInGroup,
  isLastInGroup,
  replyQuote,
  onQuotePress,
  threadSummary,
}: MessageItemProps) {
  const router = useRouter();
  const { colors: themeColors, isDark } = useTheme();
  // WhatsApp-shell bubble anatomy (WHATSAPP-DESIGN-SYSTEM.md §5) — flag-gated;
  // flag-off rendering below is untouched.
  const whatsappShellEnabled = useWhatsappShell();
  const { primaryColor } = useCommunityTheme();
  const waPalette = useMemo(
    () => waAccentPalette(primaryColor, isDark),
    [primaryColor, isDark]
  );

  // Flash a highlight background when this message is the jump target from
  // inbox search. Animates in quickly, holds, then fades out.
  const highlightAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isHighlighted) return;
    highlightAnim.setValue(0);
    const animation = Animated.sequence([
      Animated.timing(highlightAnim, { toValue: 1, duration: 300, useNativeDriver: false }),
      Animated.delay(1400),
      Animated.timing(highlightAnim, { toValue: 0, duration: 700, useNativeDriver: false }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [isHighlighted, highlightAnim]);
  const highlightBackground = highlightAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['transparent', 'rgba(255, 204, 0, 0.28)'],
  });

  // Slide-up from keyboard + bounce animation for new messages
  const isNewMessage = isOptimistic && optimisticStatus === 'sending';
  const hasMedia = !!(message.attachments && message.attachments.length > 0);
  // Media messages slide further since they're taller, and skip scale to avoid shrinking images/videos
  const slideAnim = useRef(new Animated.Value(isNewMessage ? (hasMedia ? 60 : 40) : 0)).current;
  const scaleAnim = useRef(new Animated.Value(isNewMessage && !hasMedia ? 0.85 : 1)).current;

  useEffect(() => {
    if (isNewMessage) {
      const animations = [
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: hasMedia ? 50 : 65,
          friction: hasMedia ? 9 : 8,
          useNativeDriver: true,
        }),
      ];
      // Only scale text messages — media looks better with just a slide
      if (!hasMedia) {
        animations.push(
          Animated.spring(scaleAnim, {
            toValue: 1,
            tension: 65,
            friction: 7,
            useNativeDriver: true,
          }),
        );
      }
      Animated.parallel(animations).start();
    }
  }, []); // Only on mount

  const isOwnMessage = message.senderId === currentUserId;

  // Card-style content renders outside the chat bubble (see the bubble gate
  // below) — which also means it can't carry the flag-on in-bubble sender
  // name, so these keep the above-content name line under the shell.
  const isSpecialCardMessage =
    message.contentType === 'task_card' ||
    message.contentType === 'bug_card' ||
    message.contentType === 'poll' ||
    message.contentType === 'availability_request';

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

  // Double-tap to open reaction picker
  const lastTapRef = useRef<number>(0);
  const bubbleRef = useRef<View>(null);
  const containerRef = useRef<View>(null);

  // Web: right-click opens the actions overlay (same as long press on mobile)
  useEffect(() => {
    if (Platform.OS !== 'web' || !containerRef.current) return;
    const node = containerRef.current as unknown as HTMLElement;
    if (typeof node.addEventListener !== 'function') return;
    const handler = (e: MouseEvent) => {
      e.preventDefault();
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
          { nativeEvent: { pageX: e.pageX, pageY: e.pageY } }
        );
      }
    };
    node.addEventListener('contextmenu', handler);
    return () => node.removeEventListener('contextmenu', handler);
  }, [message._id, message.senderId, message.content, message.senderName, message.senderProfilePhoto, message.attachments, onLongPress]);

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

  // Detect availability links (/a/<token>) in message content
  const availabilityTokens = useMemo(() => {
    if (message.isDeleted) return [];
    return extractAvailabilityTokens(message.content);
  }, [message.content, message.isDeleted]);

  // Get display text (with event, tool, channel invite, and availability links stripped if we're showing cards)
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
    if (availabilityTokens.length > 0) {
      text = stripAvailabilityLinksFromText(text);
    }
    return text;
  }, [message.content, eventShortIds, toolShortIds, channelInviteShortIds, availabilityTokens]);

  // Whether this message has visible text content (used to avoid empty padding wrapper)
  const hasTextContent = message.isDeleted || displayText.trim().length > 0;

  // Detect external URLs for link preview (only if no event/tool/channel invite/availability cards)
  const externalUrl = useMemo(() => {
    if (message.isDeleted || eventShortIds.length > 0 || toolShortIds.length > 0 || channelInviteShortIds.length > 0 || availabilityTokens.length > 0) return null;
    return extractFirstExternalUrl(message.content);
  }, [message.content, message.isDeleted, eventShortIds, toolShortIds, channelInviteShortIds, availabilityTokens]);

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

  // Handle mention tap — resolve the tapped display name to a user id via
  // the denormalized `mentionedUserIds` array on the message, then route to
  // that user's profile page. Older messages predating mention tracking
  // won't have the array; in that case we silently no-op.
  const handleMentionTap = useCallback(
    (mention: string) => {
      // `mention` arrives as "@[Display Name]" — strip the wrapper chars.
      const displayName = mention.replace(/^@\[/, '').replace(/\]$/, '').trim();
      const ids = message.mentionedUserIds;
      if (!ids || ids.length === 0 || !displayName) return;

      // The server doesn't persist a map of name → id, so we approximate:
      // if there's exactly one mention, use it. Otherwise we bail out.
      // This matches the common case (single @mention per tap) without
      // guessing when multiple mentions collide.
      const targetId = ids.length === 1 ? ids[0] : null;
      if (!targetId) return;
      if (targetId === currentUserId) return; // don't open self profile

      router.push(`/profile/${targetId}` as any);
    },
    [router, message.mentionedUserIds, currentUserId]
  );

  // Avatar tap — open the sender's profile. Skip bot/system messages
  // (they surface as a SystemMessage component, not here) and skip self
  // (own messages don't render an avatar anyway).
  const handleAvatarPress = useCallback(() => {
    if (!onAvatarPress) return;
    if (!message.senderId) return;
    if (message.senderId === currentUserId) return;
    onAvatarPress(message.senderId);
  }, [onAvatarPress, message.senderId, currentUserId]);

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

  // Handle double-tap to open reactions-only overlay
  const handlePress = useCallback((event: GestureResponderEvent) => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      // Double-tap detected — measure bubble position and open reactions overlay
      lastTapRef.current = 0;
      if (onDoubleTap && bubbleRef.current) {
        bubbleRef.current.measureInWindow((x, y, width, height) => {
          onDoubleTap(
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
                pageY: y, // top of the bubble
              },
            }
          );
        });
      } else if (onDoubleTap) {
        onDoubleTap(
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
    } else {
      lastTapRef.current = now;
    }
  }, [message._id, message.senderId, message.content, message.senderName, message.senderProfilePhoto, message.attachments, onDoubleTap]);

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
        <Text
          style={[
            styles.messageText,
            whatsappShellEnabled && styles.waMessageText,
            styles.deletedText,
            { color: themeColors.textTertiary },
          ]}
        >
          This message was deleted
          {inlineTimestampReservation}
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
      <Text
        style={[
          styles.messageText,
          // §S4.2 "16px body" — flag-off keeps the 14pt baseline.
          whatsappShellEnabled && styles.waMessageText,
          { color: themeColors.text },
          isOwnMessage && { color: themeColors.chatBubbleOwnText },
        ]}
      >
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
        {/* LAST inline child, after every mention/URL/plain run — see
            `timestampReservation`. */}
        {inlineTimestampReservation}
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
              // §7: flag-on the card dresses as *this* message's bubble —
              // same fill as the text bubble beside it — so it reads as a
              // rich link preview rather than a separate attachment panel.
              // Passed only when the flag is on; absent === legacy card.
              wa={
                whatsappShellEnabled
                  ? {
                      accent: waPalette.accent,
                      bubbleFill: isOwnMessage
                        ? waPalette.bubbleOutgoing
                        : themeColors.bubbleIncoming,
                    }
                  : undefined
              }
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

  // Render availability cards for detected togather.nyc/a/ links
  const renderAvailabilityLinkCards = () => {
    if (availabilityTokens.length === 0) return null;

    return (
      <View style={styles.eventCardsContainer}>
        {availabilityTokens.map((token) => (
          <AvailabilityLinkCard key={`a-${token}`} token={token} />
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

  // §5 reply-quote bar: only ever rendered flag-on, and only when the timeline
  // admitted this reply as its parent's sole live reply.
  const showReplyQuote = whatsappShellEnabled && !!replyQuote;

  // An image-only message (images, no text or other attachments) renders edge-to-edge
  // like iMessage: no bubble background, padding, footer, or tail around the image, so
  // the blue/gray bubble color never shows as a border. Reply/reactions are unaffected —
  // their handlers live on the outer Pressable and the reactions row outside the bubble.
  // Blast messages keep their bubble so the "Also sent via SMS" badge stays readable.
  //
  // A photo REPLY keeps its bubble: the quote bar needs the bubble fill behind
  // it, and WhatsApp draws exactly that — a small framed photo under a quote,
  // not an edge-to-edge one.
  const isImageOnlyMessage =
    validImageAttachments.length > 0 &&
    !hasTextContent &&
    !showReplyQuote &&
    !message.blastId &&
    documentAttachments.length === 0 &&
    audioAttachments.length === 0 &&
    videoAttachments.length === 0;

  // Bubbles wrapping media rely on the base `overflow: 'hidden'` to round the
  // photo/video corners, which on iOS also suppresses the bubble shadow — see
  // `styles.waMessageBubbleShadow`.
  const bubbleClipsMedia = validImageAttachments.length > 0 || videoAttachments.length > 0;

  // §S4.2: flag-on, an incoming message's sender name renders *inside* the
  // bubble's top padding rather than on a line above it — but never on an
  // edge-to-edge image-only bubble, whose fill is transparent (the label
  // would float on the wallpaper with nothing behind it).
  const showInBubbleSenderName =
    whatsappShellEnabled &&
    !isOwnMessage &&
    (isFirstInGroup ?? true) &&
    !isImageOnlyMessage;

  /**
   * §7: flag-on, a message whose *entire* content is a single event link has
   * nothing left to put in a bubble — `displayText` is empty once the link is
   * stripped — yet the bubble still rendered, so the thread showed a stub
   * metadata-only bubble (sender name, timestamp, tail, no body) stacked
   * above the card's own bubble. The card IS the bubble here, exactly like
   * the poll/task/bug cards `isSpecialCardMessage` already suppresses it for.
   *
   * Deliberately a *separate* value rather than another clause on
   * `isSpecialCardMessage`: that one also gates flag-off rendering, which
   * must stay byte-identical. `whatsappShellEnabled` leads the conjunction so
   * this is always false flag-off.
   *
   * Narrow on purpose — anything else in the message still needs a real
   * bubble to live in: text beside the link, a reply quote, attachments, the
   * SMS-blast badge, another card type, or a second event card (two card
   * bubbles with one name line above them would be ambiguous about which
   * bubble the name belongs to).
   */
  const isEventCardOnlyMessage =
    whatsappShellEnabled &&
    !isSpecialCardMessage &&
    !hasTextContent &&
    eventShortIds.length === 1 &&
    toolShortIds.length === 0 &&
    channelInviteShortIds.length === 0 &&
    availabilityTokens.length === 0 &&
    !showReplyQuote &&
    !message.blastId &&
    validImageAttachments.length === 0 &&
    documentAttachments.length === 0 &&
    audioAttachments.length === 0 &&
    videoAttachments.length === 0;

  /**
   * Card content skips the bubble, and with it the §S4.2 in-bubble sender
   * name, so the name goes back on a line above the card. The event card
   * follows §5 grouping the way real bubbles do (name only on the first of a
   * run); the older special cards keep their pre-existing always-on line.
   */
  const showAboveContentSenderName =
    !isOwnMessage &&
    (!whatsappShellEnabled ||
      isSpecialCardMessage ||
      (isEventCardOnlyMessage && (isFirstInGroup ?? true)));

  // --- §5 "Bubble timestamp + ticks placement": WhatsApp's inline timestamp --
  //
  // WhatsApp does not give the timestamp a row of its own. It reserves an
  // INVISIBLE slug at the very end of the message's text flow and paints the
  // real timestamp absolutely in the bubble's bottom-right corner. A short
  // message therefore gets the time beside its last line instead of under it
  // (~15pt of bubble height back, per message); wrapped text just flows around
  // the reservation, and if the last line is already full the slug wraps to a
  // line of its own — which is what WhatsApp does too.
  //
  // Only correct when the text run is the bubble's LAST content: with media, a
  // document/audio player, or the SMS-blast badge below it, an absolutely
  // positioned bottom-right timestamp would land on top of that content. Those
  // bubbles keep the flag-on footer row.
  const useInlineTimestamp =
    whatsappShellEnabled &&
    hasTextContent &&
    !isImageOnlyMessage &&
    !bubbleClipsMedia &&
    documentAttachments.length === 0 &&
    audioAttachments.length === 0 &&
    !message.blastId;

  // Paragraph direction decides which corner the inline stamp anchors to:
  // under RTL bidi layout the end-of-flow reservation lands at the visual
  // LEFT, so the visible stamp must follow it there (WhatsApp does the same —
  // Arabic/Hebrew bubbles carry their timestamp bottom-left). Direction comes
  // from the first strong-directional character, like the text engine's own
  // first-strong heuristic.
  const firstStrongDirectionalChar = (message.content ?? '').match(
    // First strong-directional character: LTR letters (Latin/Greek/Cyrillic)
    // or the RTL blocks (Hebrew/Arabic/Syriac + presentation forms).
    /[A-Za-z\u00C0-\u024F\u0370-\u04FF]|[\u0590-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFF]/u
  )?.[0];
  const isRtlMessage =
    useInlineTimestamp &&
    firstStrongDirectionalChar !== undefined &&
    /[\u0590-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFF]/u.test(firstStrongDirectionalChar);

  /**
   * The reservation's text. Every space is a NBSP so the slug wraps as one unit
   * but never breaks mid-way (a broken slug would leave the absolute timestamp
   * sitting on top of body copy). "(edited)" joins it, and the whole thing
   * renders at the timestamp's own 11pt, so the reservation is always at least
   * as wide as the visible cluster it stands in for.
   */
  const timestampReservation = `\u00A0\u00A0${formatMessageTime(message.createdAt)}${
    message.editedAt && !message.isDeleted ? '\u00A0(edited)' : ''
  }`.replace(/ /g, '\u00A0');

  const inlineTimestampReservation = useInlineTimestamp ? (
    <Text testID="wa-timestamp-reservation" style={styles.waInlineTimestampReservation}>
      {timestampReservation}
    </Text>
  ) : null;

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
      <View style={isImageOnlyMessage ? styles.imageOnlyAttachments : styles.attachmentsContainer}>
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
        <View
          style={[
            styles.reactionsContainer,
            // §5 "Reaction chips: anchored to the bottom-outer corner of a
            // bubble, overlapping it by ~40%" — pulled up over the bubble's
            // bottom edge with a negative margin rather than repositioning
            // this into the bubble's own (unmoved) render tree, and aligned
            // to the same side the bubble/tail renders on.
            whatsappShellEnabled && styles.waReactionsContainer,
            whatsappShellEnabled && { justifyContent: isOwnMessage ? 'flex-end' : 'flex-start' },
          ]}
        >
          {reactions.map((reaction: Reaction) => (
            <Pressable
              key={reaction.emoji}
              style={[
                styles.reactionBadge,
                { backgroundColor: themeColors.surfaceSecondary, borderColor: themeColors.border },
                whatsappShellEnabled && {
                  backgroundColor: themeColors.surface,
                  borderColor: themeColors.separator,
                },
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


  // Handle thread press — navigate to thread page. Group channels and DMs
  // have parallel routes (`/inbox/[groupId]/thread/...` vs
  // `/inbox/dm/[channelId]/thread/...`); pick by which context we're in.
  const handleThreadPress = useCallback(() => {
    if (groupId) {
      router.push({
        pathname: `/inbox/${groupId}/thread/${message._id}` as any,
        params: {
          channelName: channelName || 'general',
        },
      });
    } else {
      router.push({
        pathname: `/inbox/dm/${message.channelId}/thread/${message._id}` as any,
      });
    }
  }, [router, groupId, message._id, message.channelId, channelName]);

  // Render the thread affordance under the bubble.
  //
  // Flag-on this is the ONE "more in the conversation" pill, and it appears
  // only for a genuinely collapsed thread — `threadSummary` is present exactly
  // when the message has two or more live replies. A single reply gets no pill
  // at all: it's already a bubble in the timeline, quoting this message.
  //
  // Flag-off keeps the old Slack-style indicator, driven straight off
  // `threadReplyCount` and its own per-pill query.
  const renderThreadReplies = () => {
    if (whatsappShellEnabled) {
      if (!threadSummary) return null;
      return <ThreadSummaryPill summary={threadSummary} onPress={handleThreadPress} />;
    }

    const replyCount = message.threadReplyCount;
    if (!replyCount || replyCount === 0) {
      return null;
    }

    return (
      <ThreadReplies
        parentMessageId={message._id}
        channelId={message.channelId}
        replyCount={replyCount}
        onPress={handleThreadPress}
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

  const renderBugCard = () => {
    if (message.contentType !== "bug_card" || !message.bugId) {
      return null;
    }
    return (
      <View style={styles.eventCardsContainer}>
        <BugCardFromMessage bugId={message.bugId} />
      </View>
    );
  };

  const renderPollCard = () => {
    if (message.contentType !== "poll" || !message.pollId) {
      return null;
    }
    return (
      <View style={styles.eventCardsContainer}>
        <PollCardFromMessage pollId={message.pollId} />
      </View>
    );
  };

  const renderAvailabilityRequestCard = () => {
    if (message.contentType !== "availability_request" || !message.availabilityRequestId) {
      return null;
    }
    return (
      <View style={styles.eventCardsContainer}>
        <AvailabilityRequestCardFromMessage requestId={message.availabilityRequestId} />
      </View>
    );
  };

  // Render optimistic message status indicator
  const renderOptimisticStatus = () => {
    if (!isOptimistic || !optimisticStatus) return null;

    // For sending/sent, don't show any special indicator — render like a real message
    // to avoid jitter when the optimistic message is replaced by the real one.
    if (optimisticStatus === 'sending' || optimisticStatus === 'sent') {
      return null;
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

    // Show checkmarks based on read state — all states render the same height
    // container to prevent vertical jitter during transitions:
    // ✓  = sent / loading receipts
    // ✓✓ = delivered (dimmed)
    // ✓✓ + count = read (colored)

    if (readByCount > 0) {
      // Read by some people. §5/§1.3: read ticks are WhatsApp-blue, never
      // the brand accent — themeColors.mentionBlue on flag-on; flag-off
      // keeps its existing (bubble-color) tick.
      return (
        <View style={styles.readReceiptsContainer}>
          <Text
            style={[
              styles.readCheck,
              { color: whatsappShellEnabled ? themeColors.mentionBlue : themeColors.chatBubbleOwn },
            ]}
          >
            ✓✓
          </Text>
          <Text
            style={[
              styles.readCount,
              { color: whatsappShellEnabled ? themeColors.mentionBlue : themeColors.chatBubbleOwn },
            ]}
          >
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
      // Sent / receipts still loading
      return (
        <View style={styles.readReceiptsContainer}>
          <Text style={[styles.sentCheck, { color: themeColors.textTertiary }]}>✓</Text>
        </View>
      );
    }
  };

  return (
    <Animated.View style={{ transform: [{ translateY: slideAnim }, { scale: scaleAnim }] }}>
    <Pressable ref={containerRef} onPress={handlePress} onLongPress={handleLongPress} delayLongPress={300}>
      <Animated.View
        style={[
          styles.container,
          isOwnMessage ? styles.ownMessageContainer : styles.otherMessageContainer,
          whatsappShellEnabled && styles.waContainer,
          // §5 consecutive-message grouping: tighten the vertical gap within a
          // run (~2pt) vs. between different senders/runs (~9pt). Overrides
          // the flag-off `marginVertical: 2` baseline in `styles.container`
          // above — undefined props default to a standalone run (first in
          // group), landing on the wider run-boundary gap. RN does not
          // collapse vertical margins, so the whole gap lives on marginTop
          // (owned by the lower bubble) and marginBottom is zeroed —
          // otherwise adjacent rows' margins would sum to 4pt/18pt.
          whatsappShellEnabled && {
            marginTop: (isFirstInGroup ?? true) ? WA_BUBBLE_RUN_GAP : WA_BUBBLE_GROUPED_GAP,
            marginBottom: 0,
          },
          isOptimistic && (optimisticStatus === 'error' || optimisticStatus === 'queued') && { opacity: 0.7 },
          isHighlighted && styles.highlightedContainer,
          { backgroundColor: highlightBackground },
        ]}
      >
        {/* Avatar (only for others' messages).
            Wrapped in a Pressable so the chat can route to the sender's
            profile. `onAvatarPress` is plumbed down from ConvexChatRoomScreen
            and is undefined for bot/system surfaces — in that case the
            Pressable still renders but its press is a no-op. */}
        {!isOwnMessage && (
          <Pressable
            style={[
              styles.avatarContainer,
              whatsappShellEnabled && styles.waAvatarContainer,
            ]}
            onPress={handleAvatarPress}
            disabled={!onAvatarPress}
            accessibilityRole={onAvatarPress ? 'button' : undefined}
            accessibilityLabel={
              onAvatarPress ? `View ${message.senderName || 'user'}'s profile` : undefined
            }
          >
            {!message.senderId && message.contentType === 'bot' && !message.senderProfilePhoto ? (
              <Image
                source={TOGATHER_BOT_AVATAR}
                style={[styles.avatar, whatsappShellEnabled && styles.waAvatar]}
                resizeMode="cover"
              />
            ) : (
              <AppImage
                source={message.senderProfilePhoto}
                style={[styles.avatar, whatsappShellEnabled && styles.waAvatar]}
                optimizedWidth={50}
                placeholder={{
                  type: 'initials',
                  name: message.senderName || 'User',
                  backgroundColor: '#E5E5E5',
                }}
              />
            )}
            {message.senderNotificationsDisabled ? (
              <NotificationsDisabledBadge
                avatarSize={whatsappShellEnabled ? WA_INCOMING_AVATAR : 24}
                ringColor={themeColors.background}
              />
            ) : null}
          </Pressable>
        )}

        <View style={[
          styles.messageContent,
          isOwnMessage && styles.ownMessageContent,
          // §S4.2 bubble geometry: max width from WA_BUBBLE_MAX_WIDTH_PCT.
          // Also governs the content-type cards below (poll/event/task/etc.)
          // since they share this same column.
          whatsappShellEnabled && styles.waMessageContent,
        ]}>
          {/* Sender name above the content: flag-off always; flag-on only for
              card-style messages, whose content skips the bubble (and with it
              the in-bubble name from §S4.2). */}
          {showAboveContentSenderName && (
            <Text style={[styles.senderName, { color: themeColors.textSecondary }]}>
              {message.senderName || 'Unknown'}
            </Text>
          )}

          {/* Message bubble (hidden for special card messages, and flag-on for
              an event-link-only message whose card is already the bubble) */}
          {!isSpecialCardMessage && !isEventCardOnlyMessage && (
            <View ref={bubbleRef} style={styles.bubbleWrapper}>
              <View
                style={[
                  styles.messageBubble,
                  isOwnMessage ? styles.ownMessageBubble : styles.otherMessageBubble,
                  // §5 bubble geometry: 18pt radius, 4pt "tail corner" nearest
                  // the sender's origin, squared only on the first bubble of a
                  // run — continuation bubbles get the full 18pt there (no
                  // tail). Undefined `isFirstInGroup` defaults to true
                  // (standalone run), reproducing the previous uniform
                  // tail-corner rendering before MessageList wired grouping.
                  whatsappShellEnabled && styles.waMessageBubble,
                  whatsappShellEnabled && !bubbleClipsMedia && styles.waMessageBubbleShadow,
                  whatsappShellEnabled &&
                    (isOwnMessage
                      ? ((isFirstInGroup ?? true) ? styles.waOwnMessageBubble : styles.waOwnMessageBubbleContinuation)
                      : ((isFirstInGroup ?? true) ? styles.waOtherMessageBubble : styles.waOtherMessageBubbleContinuation)),
                  isImageOnlyMessage
                    ? styles.imageOnlyBubble
                    : {
                        backgroundColor: isOwnMessage
                          ? (whatsappShellEnabled ? waPalette.bubbleOutgoing : themeColors.chatBubbleOwn)
                          : (whatsappShellEnabled ? themeColors.bubbleIncoming : themeColors.chatBubbleOther),
                      },
                ]}
              >
                {/* §S4.2 "sender name 15 semibold per-sender color INSIDE
                    bubble". §5 grouping: only on the first bubble of a run
                    (undefined defaults to a standalone run). The per-sender
                    color is a deterministic hash of `senderId` (never the
                    brand accent); bots/system messages carry no senderId and
                    fall back to the neutral secondary. */}
                {showInBubbleSenderName && (
                  <Text
                    style={[
                      styles.waSenderNameInBubble,
                      {
                        color: message.senderId
                          ? waSenderColor(message.senderId, isDark)
                          : themeColors.textSecondary,
                      },
                    ]}
                  >
                    {message.senderName || 'Unknown'}
                  </Text>
                )}
                {/* §5 reply-quote bar — above the reply's own content, below
                    the sender name (WhatsApp's order: who is speaking, then
                    what they're answering, then what they said). It sits in
                    normal flow, so the inline-timestamp reservation at the end
                    of the body text is unaffected. */}
                {showReplyQuote && (
                  <View
                    style={[
                      styles.waReplyQuoteWrapper,
                      showInBubbleSenderName && styles.waReplyQuoteUnderName,
                    ]}
                  >
                    <ReplyQuoteBlock
                      quote={replyQuote!}
                      isOwnBubble={isOwnMessage}
                      onPress={onQuotePress}
                    />
                  </View>
                )}
                {hasTextContent && (
                  <View
                    style={[
                      styles.bubbleTextContent,
                      whatsappShellEnabled && styles.waBubbleTextContent,
                      // Whatever sits above the body inside the bubble (sender
                      // name, reply quote, or both) has already spent the
                      // bubble's top padding.
                      (showInBubbleSenderName || showReplyQuote) &&
                        styles.waBubbleTextContentUnderName,
                      // With the footer lifted out of layout, the text block
                      // owns the bubble's bottom padding.
                      useInlineTimestamp && styles.waBubbleTextContentInline,
                    ]}
                  >
                    {renderMessageContent()}
                  </View>
                )}
                {renderImageAttachments()}
                {renderDocumentAttachments()}
                {renderAudioAttachments()}
                {renderVideoAttachments()}

                {/* SMS blast badge — shown on messages mirrored from an event text blast */}
                {message.blastId && !message.isDeleted && (
                  <View
                    style={styles.blastBadge}
                    accessibilityLabel="This message was also sent as an SMS and push notification"
                  >
                    <Ionicons
                      name="megaphone-outline"
                      size={11}
                      color={themeColors.textSecondary}
                      style={styles.blastBadgeIcon}
                    />
                    <Text style={[styles.blastBadgeText, { color: themeColors.textSecondary }]}>
                      Also sent via SMS
                    </Text>
                  </View>
                )}

                {/* Timestamp and edited badge — hidden on edge-to-edge image-only bubbles
                    (iMessage shows no inline timestamp on photos; date separators and the
                    read-receipt row below the bubble still convey timing). */}
                {!isImageOnlyMessage && (
                  <View
                    testID="wa-bubble-footer"
                    style={[
                      styles.messageFooter,
                      styles.bubbleFooter,
                      whatsappShellEnabled && styles.waBubbleFooter,
                      // The visible cluster the reservation stands in for: same
                      // nodes, same colors, just lifted out of flow into the
                      // bubble's bottom trailing corner — bottom-right for LTR
                      // text, bottom-LEFT for RTL, where bidi layout puts the
                      // end-of-flow reservation (WhatsApp does the same).
                      useInlineTimestamp && styles.waInlineTimestampAnchor,
                      useInlineTimestamp &&
                        isRtlMessage && {
                          right: undefined,
                          left: WA_BUBBLE_PADDING_H,
                        },
                    ]}
                    // The reservation is part of the body Text, so the time is
                    // already in that element's accessibility label — voicing
                    // this copy too would just stutter it.
                    accessibilityElementsHidden={useInlineTimestamp}
                    importantForAccessibility={
                      useInlineTimestamp ? 'no-hide-descendants' : undefined
                    }
                  >
                    <Text
                      style={[
                        styles.timestamp,
                        // §S4.2 "timestamp 11px gray inside bottom-right".
                        whatsappShellEnabled && styles.waTimestamp,
                        { color: themeColors.textTertiary },
                        isOwnMessage && { color: themeColors.textSecondary },
                        // §5 "on outgoing, rgba-on-tint" — overrides the
                        // textSecondary fallback above, which assumes an
                        // opaque themed surface rather than the tinted bubble.
                        whatsappShellEnabled &&
                          isOwnMessage && {
                            color: isDark ? WA_TIMESTAMP_ON_TINT_DARK : WA_TIMESTAMP_ON_TINT_LIGHT,
                          },
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
                          whatsappShellEnabled &&
                            isOwnMessage && {
                              color: isDark ? WA_TIMESTAMP_ON_TINT_DARK : WA_TIMESTAMP_ON_TINT_LIGHT,
                            },
                        ]}
                      >
                        (edited)
                      </Text>
                    )}
                  </View>
                )}
              </View>
              {/* Bubble tail — omitted for edge-to-edge image-only bubbles so no
                  blue/gray tail floats beside the photo. */}
              {!isImageOnlyMessage && (
                <View
                  style={
                    isOwnMessage
                      ? [
                          styles.ownMessageTail,
                          {
                            borderLeftColor: whatsappShellEnabled
                              ? waPalette.bubbleOutgoing
                              : themeColors.chatBubbleOwn,
                          },
                        ]
                      : [
                          styles.otherMessageTail,
                          {
                            borderRightColor: whatsappShellEnabled
                              ? themeColors.bubbleIncoming
                              : themeColors.chatBubbleOther,
                          },
                        ]
                  }
                />
              )}
            </View>
          )}

          {/* Task card */}
          {renderTaskCard()}

          {/* Dev-assistant bug card */}
          {renderBugCard()}

          {/* Poll card */}
          {renderPollCard()}

          {/* Availability request card */}
          {renderAvailabilityRequestCard()}

          {/* Event cards for meeting links */}
          {renderEventCards()}

          {/* The §5 out-of-flow inline stamp needs a text run to sit beside,
              and the suppressed bubble took the footer row with it — so the
              card-as-bubble case falls back to a timestamp row *under* the
              card, the same fallback media bubbles use. It sits over the
              wallpaper rather than a bubble tint, so it takes the theme's
              tertiary ink both ways instead of the on-tint rgba. */}
          {isEventCardOnlyMessage && (
            <View testID="wa-card-footer" style={styles.messageFooter}>
              <Text
                style={[
                  styles.timestamp,
                  styles.waTimestamp,
                  { color: themeColors.textTertiary },
                ]}
              >
                {formatMessageTime(message.createdAt)}
              </Text>
              {message.editedAt && !message.isDeleted && (
                <Text style={[styles.editedBadge, { color: themeColors.textTertiary }]}>
                  (edited)
                </Text>
              )}
            </View>
          )}

          {/* Tool cards for run sheet/resource links */}
          {renderToolCards()}

          {/* Channel invite link cards */}
          {renderChannelInviteCards()}

          {/* Availability cards for /a/ links */}
          {renderAvailabilityLinkCards()}

          {/* Link preview for external URLs */}
          {renderLinkPreview()}

          {/* Reactions */}
          {renderReactions()}

          {/* Thread replies indicator */}
          {renderThreadReplies()}

          {/* Read receipts or optimistic status */}
          {isOptimistic
            ? (optimisticStatus === 'sending' || optimisticStatus === 'sent'
                ? (isOwnMessage ? <View style={styles.readReceiptsContainer}><Text style={[styles.sentCheck, { color: themeColors.textTertiary }]}>✓</Text></View> : null)
                : renderOptimisticStatus())
            : renderReadReceipts()}
        </View>
      </Animated.View>

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
    </Animated.View>
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
  highlightedContainer: {
    borderRadius: 12,
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
  blastBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginHorizontal: 10,
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  blastBadgeIcon: {
    marginRight: 3,
  },
  blastBadgeText: {
    fontSize: 10,
    fontWeight: '500',
  },
  attachmentsContainer: {
    marginTop: 4,
    paddingHorizontal: 10,
  },
  // Edge-to-edge image-only bubble: image fills the bubble with no surrounding color.
  // Restore the full corner radius — own/otherMessageBubble flatten the tail-side bottom
  // corner to 3 to seat the tail, but image-only bubbles render no tail, so all four
  // corners should match (otherwise the photo looks asymmetric under overflow: 'hidden').
  imageOnlyBubble: {
    backgroundColor: 'transparent',
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
  },
  imageOnlyAttachments: {
    marginTop: 0,
    paddingHorizontal: 0,
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

  // --- WhatsApp-shell bubble anatomy (flag-gated) ---------------------------
  // Additive-only: applied via extra entries in a style array alongside the
  // flag-off styles above, which are never edited. See WHATSAPP-DESIGN-
  // SYSTEM.md §5.
  /**
   * §S4 gutter. This padding STACKS with `MessageList`'s `waListContent`, so
   * the pair has to be read together: 4 + 4 = 8pt from each screen edge, vs
   * the 24 the two 12s used to add up to (WA measures 7.5 — calibrated pixel
   * pass, 2026-07-29).
   */
  waContainer: {
    paddingHorizontal: 4,
  },
  waMessageContent: {
    maxWidth: `${WA_BUBBLE_MAX_WIDTH_PCT * 100}%`,
  },
  /** See `WA_INCOMING_AVATAR`. */
  waAvatarContainer: {
    width: WA_INCOMING_AVATAR,
    height: WA_INCOMING_AVATAR,
  },
  waAvatar: {
    width: WA_INCOMING_AVATAR,
    height: WA_INCOMING_AVATAR,
    borderRadius: WA_INCOMING_AVATAR / 2,
  },
  // §S4.2 "sender name 15 semibold per-sender color INSIDE bubble" — flag-on
  // the name moves from a line above the bubble into the bubble's own top
  // padding, which is why it owns the padding rather than a margin.
  waSenderNameInBubble: {
    fontSize: WA_BUBBLE_SENDER_SIZE,
    fontWeight: '600',
    paddingHorizontal: WA_BUBBLE_PADDING_H,
    paddingTop: WA_BUBBLE_PADDING_V,
    marginBottom: 1,
  },
  /** Text block directly under an in-bubble sender name — the name already
   *  paid the bubble's top padding. */
  waBubbleTextContentUnderName: {
    paddingTop: 0,
  },
  // §5 reply-quote bar: flush inside the bubble's own horizontal padding, and
  // it owns the bubble's top padding when it's the bubble's first child.
  waReplyQuoteWrapper: {
    paddingHorizontal: WA_BUBBLE_PADDING_H,
    paddingTop: WA_BUBBLE_PADDING_V,
  },
  waReplyQuoteUnderName: {
    paddingTop: 0,
  },
  // §S4.2 "16px body".
  waMessageText: {
    fontSize: WA_BUBBLE_BODY_SIZE,
    lineHeight: WA_BUBBLE_BODY_LINE_HEIGHT,
  },
  // §S4.2 "timestamp 11px gray inside bottom-right".
  waTimestamp: {
    fontSize: WA_BUBBLE_TIMESTAMP_SIZE,
  },
  waMessageBubble: {
    borderRadius: WA_BUBBLE_RADIUS,
  },
  /**
   * §S4.2 "subtle shadow (WA bubbles have a ~1px soft drop shadow)" — what
   * separates a white incoming bubble from the cream wallpaper behind it.
   *
   * `overflow: 'visible'` is load-bearing: iOS sets `clipsToBounds` for
   * `overflow: 'hidden'` (the base `messageBubble` style), and a clipped
   * layer renders no shadow at all. Bubbles that actually need the clip —
   * the ones wrapping a photo/video, where it rounds the media's corners —
   * therefore opt out of the shadow instead; their media already gives them
   * a hard edge against the wallpaper.
   */
  waMessageBubbleShadow: {
    overflow: 'visible',
    ...WA_BUBBLE_SHADOW,
  },
  waOwnMessageBubble: {
    borderBottomRightRadius: WA_BUBBLE_TAIL_CORNER_RADIUS,
  },
  waOtherMessageBubble: {
    borderBottomLeftRadius: WA_BUBBLE_TAIL_CORNER_RADIUS,
  },
  // §5 grouping: continuation bubbles (not first in their run) drop the tail
  // and get the full radius on that corner instead of the squared one above.
  waOwnMessageBubbleContinuation: {
    borderBottomRightRadius: WA_BUBBLE_RADIUS,
  },
  waOtherMessageBubbleContinuation: {
    borderBottomLeftRadius: WA_BUBBLE_RADIUS,
  },
  waBubbleTextContent: {
    paddingHorizontal: WA_BUBBLE_PADDING_H,
    paddingTop: WA_BUBBLE_PADDING_V,
  },
  waBubbleFooter: {
    paddingHorizontal: WA_BUBBLE_PADDING_H,
    paddingBottom: WA_BUBBLE_PADDING_V,
    // §S4.2 "timestamp … inside bottom-RIGHT" — the flag-off footer is a
    // left-packed row; WhatsApp right-aligns the timestamp cluster.
    justifyContent: 'flex-end',
  },
  /** Bottom padding the (now out-of-flow) footer used to provide. */
  waBubbleTextContentInline: {
    paddingBottom: WA_BUBBLE_PADDING_V,
  },
  /**
   * The invisible slug appended to the end of the text flow. `opacity: 0` is
   * the spec'd treatment; `color: 'transparent'` is belt-and-braces because
   * nested `<Text>` runs only honor a subset of styles on Android, and a
   * visibly duplicated timestamp would be a loud bug.
   */
  waInlineTimestampReservation: {
    opacity: 0,
    color: 'transparent',
    fontSize: WA_BUBBLE_TIMESTAMP_SIZE,
  },
  /**
   * The real timestamp cluster, pinned to the bubble's bottom-right corner so
   * it sits beside the last line of text rather than under it. The row's own
   * flow paddings/margins are zeroed — they'd otherwise offset the anchor.
   */
  waInlineTimestampAnchor: {
    position: 'absolute',
    right: WA_BUBBLE_PADDING_H,
    bottom: WA_BUBBLE_PADDING_V - 1,
    paddingHorizontal: 0,
    paddingBottom: 0,
    marginTop: 0,
  },
  // §5 "Reaction chips ... overlapping it by ~40%" — negative top margin
  // pulls the (unmoved-in-the-tree) reactions row up over the bubble's
  // bottom edge instead of restructuring the render tree.
  waReactionsContainer: {
    marginTop: -14,
  },
});
