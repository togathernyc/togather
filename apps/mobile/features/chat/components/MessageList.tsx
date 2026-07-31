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
import { useRouter } from 'expo-router';
import type { Id } from '@services/api/convex';
import { useMessages } from '../hooks/useMessages';
import { useChannelSwitchBuffer } from '../hooks/useChannelSwitchBuffer';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useTheme } from '@hooks/useTheme';
import { useWhatsappShell } from '@hooks/useWhatsappShell';
import { MessageItem } from './MessageItem';
import { GhostThreadPointer } from './GhostThreadPointer';
import type { ReplyQuote } from './ReplyQuoteBlock';
import type { ThreadSummary } from './ThreadSummaryPill';
import { buildThreadAwareTimeline } from '../utils/threadTimeline';
import { ReactionsProvider } from '../context/ReactionsContext';
import { useChatPrefetch } from '../context/ChatPrefetchContext';
import { WaDayPill } from '@components/wa/WaDayPill';

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
  // Thread bump timestamp — later than createdAt once the message has been
  // replied to. Positions the floating "ghost" thread pointer (see below).
  lastActivityAt?: number;
  // Denormalized sender info
  senderName?: string;
  senderProfilePhoto?: string;
  // Decorated by getMessages (attachSenderNotifsDisabled) — used to badge the row.
  senderNotificationsDisabled?: boolean;
  // Link preview control
  hideLinkPreview?: boolean;
  // Canonical task reference for task cards
  taskId?: Id<"tasks">;
  // Dev-assistant bug reference for contentType === "bug_card"
  bugId?: Id<"devBugs">;
  // Poll reference for contentType === "poll"
  pollId?: Id<"polls">;
  // Availability-request reference for contentType === "availability_request"
  availabilityRequestId?: Id<"availabilityRequests">;
  // Present only on messages mirrored from an event text blast (SMS + push).
  blastId?: Id<"eventBlasts">;
  // --- WhatsApp-shell reply/thread decoration (flag-on `getMessages` only) ---
  // The quoted-parent context for a reply the timeline admitted (its parent's
  // only live reply), rendered as the §5 quote bar inside its own bubble.
  replyQuote?: ReplyQuote;
  // The collapsed-thread pill's data — present iff this message has two or more
  // live replies, which is exactly when its replies leave the timeline.
  threadSummary?: ThreadSummary;
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
  /** Tap a user's avatar in the list → open their profile. */
  onAvatarPress?: (userId: Id<"users">) => void;
  /**
   * When set (e.g. from an inbox search result), the list auto-loads older
   * pages until this message is in view, scrolls to center it, and flashes a
   * highlight on it.
   */
  highlightMessageId?: Id<"chatMessages"> | null;
  /**
   * Flag-on only. Every message a reply to which would collapse a thread that
   * currently shows exactly one reply inline.
   *
   * The server admits a reply only while it is its parent's sole visible reply,
   * so every admitted reply's parent is by definition such a thread; that also
   * makes this correct for blocked/cross-channel siblings for free, since those
   * were never admitted. The inline reply ITSELF is reported alongside its
   * parent, because replying to it roots to the same thread — that is the whole
   * point of rooting, and it is the tap the owner actually makes. The chat room
   * uses this to follow the sender into the thread on the send that causes the
   * collapse, instead of letting their message appear to vanish into a pill on
   * a parent that may be scrolled away — so each entry maps the message that
   * can be replied to onto the ROOT whose thread the reply lands in.
   */
  onCollapsibleThreadsChange?: (rootByReplyTarget: Map<string, string>) => void;
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

// List item type (message, date separator, or floating "ghost" thread pointer)
type ListItem =
  | {
      type: 'message';
      data: Message;
      // WHATSAPP-DESIGN-SYSTEM.md §5 consecutive-message grouping: whether
      // this message starts/ends a same-sender run (sender changes, or a
      // date separator/ghost sits on that side — "keep it simple" per the
      // spec, no time-gap heuristic). Computed below and threaded down to
      // MessageItem so flag-on rendering can collapse repeated sender names
      // and tighten bubble geometry within a run.
      isFirstInGroup: boolean;
      isLastInGroup: boolean;
      isOptimistic?: boolean;
      optimisticStatus?: string;
    }
  | { type: 'dateSeparator'; date: string }
  | {
      type: 'ghost';
      parentId: Id<"chatMessages">;
      channelId: Id<"chatChannels">;
      replyCount: number;
      // Original message details, so the ghost can echo it and align by author
      // (right when senderId is the current user, left otherwise).
      content: string;
      senderId: Id<"users">;
      senderName?: string;
      senderProfilePhoto?: string;
      isDeleted: boolean;
      attachments?: Message['attachments'];
    };

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
  onAvatarPress,
  highlightMessageId,
  onCollapsibleThreadsChange,
}: MessageListProps) {
  const { primaryColor } = useCommunityTheme();
  const { colors: themeColors } = useTheme();
  // WHATSAPP-DESIGN-SYSTEM.md §5 "Day pills" — flag-gated swap of the date
  // separator to the WaDayPill capsule; flag-off keeps today's line+label
  // separator byte-identical.
  const whatsappShellEnabled = useWhatsappShell();
  const router = useRouter();
  const listRef = useRef<FlatList<ListItem>>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  // Internal "jump to this message" target: flag-off, set by tapping a ghost
  // thread pointer's body; flag-on, by tapping a bubble's §5 reply-quote bar.
  // Kept separate from the `highlightMessageId` prop (inbox search) but funneled
  // through the same anchor/scroll/highlight machinery. The nonce lets tapping
  // the same target re-scroll. The prop always wins when both are set.
  const [jumpTarget, setJumpTarget] = useState<{ id: Id<"chatMessages">; nonce: number } | null>(null);
  const effectiveHighlightId = highlightMessageId ?? jumpTarget?.id ?? null;

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
  // Larger page size while jumping to a message (inbox search OR a quote/ghost
  // tap) so the anchor catch-up reaches older messages in fewer round-trips.
  const pageSize = effectiveHighlightId ? 40 : 20;
  const { messages: liveMessages, loadMore, hasMore, isLoading: liveIsLoading, isStale } = useMessages(
    shouldStartQuery ? channelId : null,
    pageSize,
    groupId ?? null,
    effectiveHighlightId,
    // Flag-on, the timeline admits a message's lone reply as a real bubble and
    // decorates collapsed threads. Flag-off omits the arg entirely, so the
    // query behaves exactly as before.
    whatsappShellEnabled
  );

  // Use prefetched messages while live query is loading
  // This eliminates the "Loading messages..." flash
  const messages = (liveIsLoading && hasPrefetchedMessages)
    ? prefetchState.messages!
    : liveMessages;

  // Only show loading if we have NO data (neither prefetched nor live)
  const isLoading = liveIsLoading && !hasPrefetchedMessages;

  // Flag-on stale-while-switch: keep something painted while the new
  // channel's subscription warms up, instead of tearing the FlatList down to
  // a bare surface (the channel-tab-strip flicker). Flag-off this is a
  // pass-through, so everything below sees exactly today's values.
  const {
    messages: displayMessages,
    channelId: displayChannelId,
    isSwitching,
  } = useChannelSwitchBuffer({
    enabled: whatsappShellEnabled,
    channelId,
    messages,
    isLoading,
  });

  // While `isSwitching`, the painted list belongs to the *previous* channel
  // but the composer already targets the new one — so the new channel's
  // optimistic sends must not be appended onto it.
  const displayOptimisticMessages = isSwitching ? undefined : optimisticMessages;

  // Extract message IDs for batch reactions loading
  const messageIds = useMemo<Id<"chatMessages">[]>(() => {
    return displayMessages.map((msg) => msg._id);
  }, [displayMessages]);

  // Transform messages into list items (with date separators and grouping info)
  // For inverted list, we reverse the order so newest messages come first
  const listItems = useMemo<ListItem[]>(() => {
    const items: ListItem[] = [];

    // Flag-OFF: build a thread-aware timeline — every real message stays at its
    // createdAt slot, and each replied-to message additionally floats a "ghost"
    // pointer (a bubble-less echo of the original) at its lastActivityAt slot.
    // The ghost exists because flag-off `getMessages` hides EVERY reply, so
    // without it a reply produced no visible trace at all.
    //
    // Flag-ON there are no ghosts. A lone reply is a real bubble in the
    // timeline quoting its parent (§5 reply-quote bar), and a parent with a
    // genuine conversation under it carries one collapsed summary pill — so
    // nothing is missing that a floating echo needs to stand in for. See
    // `renderThreadReplies` in MessageItem and `docs/plans/church-migration-ui-
    // redesign/WHATSAPP-DESIGN-SYSTEM.md` §5.
    //
    // Both branches read `displayMessages` (the channel-switch buffer's
    // output) — flag-off the buffer is a literal pass-through of `messages`.
    const timeline = whatsappShellEnabled
      ? displayMessages.map((message) => ({ kind: 'message' as const, message }))
      : buildThreadAwareTimeline(displayMessages);
    let previousMsg: Message | undefined;
    let previousDateKey: string | undefined;

    timeline.forEach((entry) => {
      const msg = entry.message;
      // A ghost is positioned by the thread's latest activity; a message by its
      // own createdAt.
      const ts = entry.kind === 'ghost' ? msg.lastActivityAt ?? msg.createdAt : msg.createdAt;

      // Date separator goes BEFORE the first entry of each date.
      const dateKey = new Date(ts).toDateString();
      if (dateKey !== previousDateKey) {
        items.push({ type: 'dateSeparator', date: formatDateSeparator(ts) });
        previousDateKey = dateKey;
        // A date separator visually breaks the sender-grouping run too —
        // §5's grouping boundary is "sender changes OR separator boundary".
        previousMsg = undefined;
      }

      if (entry.kind === 'ghost') {
        items.push({
          type: 'ghost',
          parentId: msg._id,
          channelId: msg.channelId,
          replyCount: msg.threadReplyCount ?? 0,
          content: msg.content ?? '',
          senderId: msg.senderId,
          senderName: msg.senderName,
          senderProfilePhoto: msg.senderProfilePhoto,
          isDeleted: msg.isDeleted,
          attachments: msg.attachments,
        });
        // A ghost visually breaks the sender-grouping run.
        previousMsg = undefined;
        return;
      }

      // First in its run if the previous message is from a different sender
      // (or there's no previous message — sender-change/boundary rule).
      // A missing senderId (bot/system message, schema marks it optional)
      // always starts its own run: two different bots would otherwise
      // compare undefined === undefined and merge into one run.
      // isLastInGroup is filled in by the backward pass below, once the
      // full timeline (including any optimistic messages) is known.
      const isFirstInGroup =
        !previousMsg || !msg.senderId || msg.senderId !== previousMsg.senderId;
      items.push({ type: 'message', data: msg, isFirstInGroup, isLastInGroup: false });
      previousMsg = msg;
    });

    // Append optimistic messages at the end (newest, after all server messages)
    // Skip optimistic messages that already have a matching real message (dedup)
    if (displayOptimisticMessages && displayOptimisticMessages.length > 0) {
      // Predecessor for grouping is the forward pass's final `previousMsg`,
      // not raw `messages[length-1]`: the constructed timeline may end with a
      // ghost or date separator (both reset `previousMsg` to undefined), and
      // an optimistic message must not merge into a run across that boundary.
      const lastTimelineMsg = previousMsg;

      // For deduplication, check recent server messages (last 5 is plenty).
      // Track which server messages have already been matched so that
      // identical content sent twice within the time window is handled
      // correctly (each server message only "consumes" one optimistic).
      const recentServerMessages = displayMessages.slice(-5);
      const matchedServerIds = new Set<string>();

      const pendingOptimistic = displayOptimisticMessages.filter((optMsg) => {
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
        const prevMsg = index === 0 ? lastTimelineMsg : pendingOptimistic[index - 1];
        const isFirstInGroup = !prevMsg || optMsg.senderId !== prevMsg.senderId;

        // Flag-on: an in-flight reply gets its quote NOW, synthesized from the
        // parent already in the loaded page, instead of rendering quote-less
        // for a round-trip and then popping one in. You had to see a message to
        // tap reply on it, so the parent is essentially always loaded; when it
        // genuinely isn't, the quote just arrives with the server echo.
        let optimisticQuote: ReplyQuote | undefined;
        if (whatsappShellEnabled && optMsg.parentMessageId) {
          // "The loaded page" is displayMessages: on a buffered revisit the
          // live query may still be empty while the buffer paints the page
          // the user is actually replying from.
          const parent = displayMessages.find((m) => m._id === optMsg.parentMessageId);
          if (parent) {
            optimisticQuote = {
              parentMessageId: parent._id,
              parentDeleted: parent.isDeleted,
              parentSenderId: parent.senderId,
              parentSenderName: parent.senderName,
              parentContent: parent.content ?? '',
              parentAttachmentType: parent.attachments?.[0]?.type,
            };
          }
        }

        items.push({
          type: 'message',
          data: (optimisticQuote
            ? { ...optMsg, replyQuote: optimisticQuote }
            : optMsg) as any,
          isFirstInGroup,
          isLastInGroup: false,
          isOptimistic: true,
          optimisticStatus: optMsg._status,
        });
      });
    }

    // Fill in isLastInGroup with a backward pass mirroring the forward
    // isFirstInGroup pass above: a message is last in its run when no
    // message from the same sender immediately follows it in time, or a
    // non-message boundary (date separator/ghost) follows. Runs over the
    // full chronological `items` array — real timeline messages and any
    // optimistic messages just appended above — so the server/optimistic
    // seam is handled by the same single pass.
    let nextMsg: Message | undefined;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.type !== 'message') {
        nextMsg = undefined;
        continue;
      }
      // Mirror the forward pass's undefined-senderId rule: a bot/system
      // message is always the last of its own run.
      item.isLastInGroup =
        !nextMsg || !item.data.senderId || item.data.senderId !== nextMsg.senderId;
      nextMsg = item.data;
    }

    // Reverse for inverted list (newest first)
    return items.reverse();
  }, [displayMessages, displayOptimisticMessages, whatsappShellEnabled]);

  // Report the threads a next reply would collapse (see the prop's JSDoc), as
  // `replyTarget>threadRoot` pairs. Both the inline reply's parent (the root)
  // and the reply itself are targets: the server roots a reply-to-a-reply at
  // the same thread, so either tap collapses the same conversation.
  // Flag-off this is always empty — there are no inline replies to begin with.
  const collapsibleThreadKey = useMemo(() => {
    if (!whatsappShellEnabled) return '';
    const pairs = new Set<string>();
    for (const m of messages) {
      if (!m.parentMessageId) continue;
      const root = String(m.parentMessageId);
      pairs.add(`${root}>${root}`);
      pairs.add(`${String(m._id)}>${root}`);
    }
    return [...pairs].sort().join(',');
  }, [messages, whatsappShellEnabled]);

  useEffect(() => {
    if (!onCollapsibleThreadsChange) return;
    onCollapsibleThreadsChange(
      new Map(
        collapsibleThreadKey
          ? collapsibleThreadKey
              .split(',')
              .map((pair) => pair.split('>') as [string, string])
          : [],
      ),
    );
    // Keyed on the joined pair string so an unchanged mapping doesn't re-notify
    // on every unrelated message arriving.
  }, [collapsibleThreadKey, onCollapsibleThreadsChange]);

  // Scroll to and highlight a target message — from inbox search
  // (`highlightMessageId` prop), from tapping a bubble's reply quote, or from
  // tapping a ghost thread pointer (`jumpTarget`). The hook auto-loads older
  // pages until the message is present; this runs once it appears in listItems.
  // Tracked per-anchor (the nonce makes re-tapping the same target re-scroll)
  // so it fires once.
  const scrolledAnchorRef = useRef<string | null>(null);
  useEffect(() => {
    const anchorId = highlightMessageId ?? jumpTarget?.id ?? null;
    if (!anchorId) {
      scrolledAnchorRef.current = null;
      return;
    }
    const anchorKey = highlightMessageId
      ? `hl:${highlightMessageId}`
      : `jump:${jumpTarget!.id}:${jumpTarget!.nonce}`;
    if (scrolledAnchorRef.current === anchorKey) return;
    const targetIndex = listItems.findIndex(
      (it) => it.type === 'message' && it.data._id === anchorId
    );
    if (targetIndex < 0) return; // not loaded yet — catch-up loop will fetch more

    scrolledAnchorRef.current = anchorKey;
    const handle = InteractionManager.runAfterInteractions(() => {
      try {
        listRef.current?.scrollToIndex({
          index: targetIndex,
          viewPosition: 0.5,
          animated: true,
        });
      } catch {
        // onScrollToIndexFailed handles measurement gaps
      }
    });
    return () => handle.cancel();
  }, [highlightMessageId, jumpTarget, listItems]);

  // Tap a ghost's "N replies" pill → open the thread screen. Group channels and
  // DMs have parallel routes (mirrors MessageItem.handleThreadPress).
  const handleGhostOpenThread = useCallback(
    (parentId: Id<"chatMessages">, ghostChannelId: Id<"chatChannels">) => {
      if (groupId) {
        router.push({
          pathname: `/inbox/${groupId}/thread/${parentId}` as any,
          params: { channelName: channelName || 'general' },
        });
      } else {
        router.push({
          pathname: `/inbox/dm/${ghostChannelId}/thread/${parentId}` as any,
        });
      }
    },
    [router, groupId, channelName]
  );

  // Tap a ghost's body (flag-off) or a bubble's reply quote (flag-on) → scroll
  // up to the quoted message and highlight it. Funnels through the shared
  // anchor machinery, which auto-loads older pages first if the target is above
  // the currently loaded window.
  const handleJumpToMessage = useCallback((parentId: Id<"chatMessages">) => {
    setJumpTarget((prev) => ({ id: parentId, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

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
    // While the painted list belongs to the previous channel, `loadMore`
    // would page the *new* channel's history behind the user's back.
    if (isSwitching) return;
    if (hasMore && !isLoading) {
      loadMore();
    }
  }, [hasMore, isLoading, isSwitching, loadMore]);

  // A newly-opened channel starts at the bottom (newest), matching today's
  // behavior — which only happened as a side effect of the list unmounting
  // during the blank flash. Now that the FlatList survives the switch it
  // keeps its scroll offset, so reset it explicitly once the new channel's
  // own content is on screen. Inverted list ⇒ offset 0 is the bottom.
  // Skipped on first settle (mount, already at 0) and while an anchor jump
  // owns the scroll (inbox search / ghost thread pointer).
  const settledChannelRef = useRef<Id<"chatChannels"> | null | undefined>(undefined);
  useEffect(() => {
    if (!whatsappShellEnabled) return;
    if (isSwitching || !displayChannelId) return;
    const previousSettled = settledChannelRef.current;
    settledChannelRef.current = displayChannelId;
    if (previousSettled === undefined || previousSettled === displayChannelId) return;
    if (effectiveHighlightId) return;
    try {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    } catch {
      // List not measured yet — it mounts at offset 0 anyway.
    }
  }, [whatsappShellEnabled, displayChannelId, isSwitching, effectiveHighlightId]);

  // Handle scroll to bottom button press
  // In inverted list, scroll to index 0 to go to newest messages
  const handleScrollToBottom = useCallback(() => {
    listRef.current?.scrollToIndex({ index: 0, animated: true });
  }, []);

  // Render a single list item
  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === 'dateSeparator') {
        // §5 "Day pills: centered, floating capsule ... `bg.card`-ish
        // translucent fill". Flag-off keeps the original line+label
        // separator; stickiness/positioning is out of scope here (§5 notes
        // it's the chat-room screen's responsibility, and it's unchanged by
        // this pass regardless).
        if (whatsappShellEnabled) {
          return (
            <View style={styles.waDateSeparatorContainer}>
              <WaDayPill label={item.date} />
            </View>
          );
        }
        return (
          <View style={styles.dateSeparatorContainer}>
            <View style={[styles.dateSeparatorLine, { backgroundColor: themeColors.border }]} />
            <Text style={[styles.dateSeparatorText, { color: themeColors.textTertiary }]}>{item.date}</Text>
            <View style={[styles.dateSeparatorLine, { backgroundColor: themeColors.border }]} />
          </View>
        );
      }

      if (item.type === 'ghost') {
        return (
          <GhostThreadPointer
            parentMessageId={item.parentId}
            channelId={item.channelId}
            replyCount={item.replyCount}
            originalContent={item.content}
            originalSenderId={item.senderId}
            currentUserId={currentUserId}
            senderName={item.senderName}
            senderProfilePhoto={item.senderProfilePhoto}
            isDeleted={item.isDeleted}
            attachments={item.attachments}
            onOpenThread={() => handleGhostOpenThread(item.parentId, item.channelId)}
            onScrollToOriginal={() => handleJumpToMessage(item.parentId)}
          />
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
            senderNotificationsDisabled: message.senderNotificationsDisabled,
            mentionedUserIds: message.mentionedUserIds,
            threadReplyCount: message.threadReplyCount,
            hideLinkPreview: message.hideLinkPreview,
            taskId: message.taskId,
            bugId: message.bugId,
            pollId: message.pollId,
            availabilityRequestId: message.availabilityRequestId,
            blastId: message.blastId,
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
          isFirstInGroup={item.isFirstInGroup}
          isLastInGroup={item.isLastInGroup}
          isOptimistic={item.isOptimistic}
          optimisticStatus={item.optimisticStatus as any}
          onRetry={item.isOptimistic && onRetryMessage ? () => onRetryMessage(String(message._id)) : undefined}
          onAvatarPress={onAvatarPress}
          isHighlighted={effectiveHighlightId != null && message._id === effectiveHighlightId}
          // §5 reply/thread rendering. Both are only ever populated by the
          // flag-on query, and MessageItem only reads them flag-on — so the
          // flag-off tree here is unchanged even if a stale cached page were to
          // still carry the fields.
          replyQuote={message.replyQuote}
          onQuotePress={handleJumpToMessage}
          threadSummary={message.threadSummary}
        />
      );
    },
    [currentUserId, groupId, channelName, prefetchState, onMessageReply, onMessageReact, onMessageDelete, onMessageLongPress, onMessageDoubleTap, onRetryMessage, onAvatarPress, effectiveHighlightId, handleGhostOpenThread, handleJumpToMessage, whatsappShellEnabled, themeColors]
  );

  // Key extractor
  const keyExtractor = useCallback(
    (item: ListItem, index: number) => {
      if (item.type === 'dateSeparator') return `date-${item.date}-${index}`;
      if (item.type === 'ghost') return `ghost-${item.parentId}`;
      return `msg-${item.data._id}`;
    },
    []
  );

  // Delay showing "No messages yet" to avoid flashing it during notification
  // deep links where the subscription needs a moment to deliver messages.
  const [showEmptyState, setShowEmptyState] = useState(false);
  const emptyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isLoading && displayMessages.length === 0) {
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
  }, [isLoading, displayMessages.length]);

  // §S4.1: flag-on, the chat room paints a doodle wallpaper behind the whole
  // screen. Painting `surface` here covered it with white-on-white, which is
  // why the flag-on bubbles/day pills rendered but were invisible — the list
  // must be transparent so the wallpaper shows through (all three branches:
  // loading, empty, and the real list below). Flag-off is unchanged.
  const listBackground = whatsappShellEnabled ? 'transparent' : themeColors.surface;

  // Loading state or waiting for messages — show empty container
  if (displayMessages.length === 0 && !showEmptyState) {
    return (
      <View testID="message-list-container" style={[styles.container, { backgroundColor: listBackground }]} />
    );
  }

  // Empty state — only shown after delay confirms no messages
  if (showEmptyState && displayMessages.length === 0) {
    return (
      <View testID="message-list-empty" style={[styles.centerContainer, { backgroundColor: listBackground }]}>
        <Ionicons name="chatbubbles-outline" size={64} color={themeColors.iconSecondary} style={{ marginBottom: 16 }} />
        <Text style={[styles.emptyTitle, { color: themeColors.text }]}>No messages yet</Text>
        <Text style={[styles.emptySubtext, { color: themeColors.textSecondary }]}>Start the conversation!</Text>
      </View>
    );
  }

  return (
    // Reactions are subscribed for the channel the painted messages actually
    // belong to, which lags `channelId` for the length of a switch.
    <ReactionsProvider messageIds={messageIds} channelId={displayChannelId}>
      <View
        testID="message-list-container"
        style={[styles.container, { backgroundColor: listBackground }]}
        // Scenery from the outgoing channel must not take taps — a reply or
        // reaction would target a message the composer is no longer pointed
        // at. Sub-second window; `undefined` keeps flag-off byte-identical.
        pointerEvents={isSwitching ? 'none' : undefined}
      >
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
          // When jumping to a not-yet-measured message, approximate the offset
          // then retry the precise scroll once layout settles.
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({
              offset: info.averageItemLength * info.index,
              animated: false,
            });
            setTimeout(() => {
              try {
                listRef.current?.scrollToIndex({
                  index: info.index,
                  viewPosition: 0.5,
                  animated: true,
                });
              } catch {
                // Give up silently — the message is at least loaded in the list
              }
            }, 300);
          }}
          contentContainerStyle={[
            styles.listContent,
            whatsappShellEnabled && styles.waListContent,
          ]}
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
        {showScrollToBottom && !isSwitching && (
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
  /**
   * §S4 gutter (flag-gated). This list's 12pt and `MessageItem`'s own 12pt
   * container padding STACK, so flag-on bubbles were inset 24pt from each
   * screen edge where WhatsApp insets them 7.5. 4 here + 4 there = 8, as close
   * as two integer paddings get (calibrated pixel pass, 2026-07-29).
   */
  waListContent: {
    paddingHorizontal: 4,
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
  // §5 day pill: centered, floating capsule — no divider lines (wallpaper
  // shows through around it).
  waDateSeparatorContainer: {
    alignItems: 'center',
    marginVertical: 16,
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
