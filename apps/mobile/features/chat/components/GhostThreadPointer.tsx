/**
 * GhostThreadPointer - a lightweight echo of a bumped thread's original message.
 *
 * When a message gets a reply we deliberately keep the real message in its
 * original chronological position (see `getMessages` ordering by `createdAt`).
 * To avoid losing recent thread activity off-screen, this preview is floated at
 * the thread's latest-activity slot (its `lastActivityAt`) at the bottom of the
 * chat.
 *
 * It echoes the ORIGINAL message so you can tell what the thread is about, and
 * tapping it jumps to the real message:
 *
 * - It shows the original message's text (truncated to a couple of lines; an
 *   image-/attachment-only or deleted original falls back to a sensible
 *   placeholder rather than a blank bubble).
 * - It is aligned by the thread's LAST reply — the side that most recent thread
 *   activity came from: right (your side, no avatar) when you sent the last
 *   reply, left (with the original author's avatar + name) when someone else
 *   did. This is a deliberate change from the earlier "align by the original
 *   author" behavior: contributors asked for the preview to follow whoever
 *   replied last (see the staging feedback on this component), so a thread you
 *   were last active in sits on your side even if someone else started it.
 *   Before the replies have loaded we fall back to the original author's side
 *   to avoid a wrong-side flash.
 * - A short connector line links the echoed bubble down to the "N replies" pill
 *   on the aligned side, so the two read as one threaded unit.
 * - The bubble uses the same own/other bubble colors as real messages, so it
 *   reads as a lightweight echo, not a brand-new message.
 *
 * Two tap targets, unchanged from before:
 * - Tapping the "N replies" pill opens the thread screen (same as the inline
 *   indicator under the real message).
 * - Tapping the bubble body scrolls the chat up to the real original message
 *   and briefly highlights it.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useTheme } from '@hooks/useTheme';
import { AppImage } from '@components/ui';
import type { Id } from '@services/api/convex';
import { ThreadReplies } from './ThreadReplies';
import { useThreadReplies } from '../hooks/useThreadReplies';

interface GhostThreadPointerProps {
  parentMessageId: Id<"chatMessages">;
  channelId?: Id<"chatChannels">;
  replyCount: number;
  /** The original message's text — shown truncated as the preview. */
  originalContent: string;
  /**
   * Author of the ORIGINAL message. Drives the fallback alignment (and the
   * avatar/name shown) before the thread's replies have loaded.
   */
  originalSenderId: Id<"users">;
  /** Current viewer — the preview aligns right when they sent the last reply. */
  currentUserId: Id<"users">;
  /** Denormalized author info, shown on the left-aligned (other-side) preview. */
  senderName?: string;
  senderProfilePhoto?: string;
  /** Deleted original → show the deleted-message treatment instead of blank text. */
  isDeleted?: boolean;
  /** Attachments on the original — used to label an image-/attachment-only preview. */
  attachments?: Array<{ type: string; name?: string }>;
  /** Tap the "N replies" pill → open the thread screen. */
  onOpenThread: () => void;
  /** Tap the bubble body → scroll up to the real original message. */
  onScrollToOriginal: () => void;
}

/**
 * Derive the preview text for the echo. Prefers the message text; falls back to
 * a placeholder for attachment-only or deleted originals so the bubble is never
 * blank. Returns `isPlaceholder` so callers can style deleted/attachment
 * fallbacks (muted/italic) differently from real text.
 */
function getPreview(
  content: string,
  isDeleted: boolean,
  attachments?: Array<{ type: string; name?: string }>,
): { text: string; isPlaceholder: boolean } {
  if (isDeleted) {
    return { text: 'This message was deleted', isPlaceholder: true };
  }
  const trimmed = content.trim();
  if (trimmed.length > 0) {
    return { text: trimmed, isPlaceholder: false };
  }
  const first = attachments?.[0];
  if (first) {
    switch (first.type) {
      case 'image':
        return { text: '📷 Photo', isPlaceholder: true };
      case 'video':
        return { text: '🎥 Video', isPlaceholder: true };
      case 'audio':
        return { text: '🎤 Voice message', isPlaceholder: true };
      case 'document':
        return { text: first.name ? `📄 ${first.name}` : '📄 Document', isPlaceholder: true };
      default:
        return { text: '📎 Attachment', isPlaceholder: true };
    }
  }
  return { text: 'Message', isPlaceholder: true };
}

export function GhostThreadPointer({
  parentMessageId,
  channelId,
  replyCount,
  originalContent,
  originalSenderId,
  currentUserId,
  senderName,
  senderProfilePhoto,
  isDeleted = false,
  attachments,
  onOpenThread,
  onScrollToOriginal,
}: GhostThreadPointerProps) {
  const { colors } = useTheme();

  // Alignment follows the thread's LAST reply (right = you sent it). Reuse the
  // same replies query the nested pill already subscribes to (Convex dedupes
  // it, and prefetch usually makes it instant). Pick the newest reply by
  // createdAt rather than trusting list order. Until it loads (or if the last
  // reply came from a bot with no senderId), fall back to the original author.
  const { replies } = useThreadReplies(parentMessageId, 10, channelId ?? null);
  const lastReply = replies.length > 0
    ? replies.reduce((latest, r) => (r.createdAt > latest.createdAt ? r : latest))
    : undefined;
  const lastReplySenderId = lastReply?.senderId;
  const alignRight = lastReplySenderId
    ? lastReplySenderId === currentUserId
    : originalSenderId === currentUserId;

  const { text: previewText, isPlaceholder } = getPreview(originalContent, isDeleted, attachments);

  const bubbleTextColor = isPlaceholder
    ? colors.textTertiary
    : alignRight
      ? colors.chatBubbleOwnText
      : colors.chatBubbleOtherText;

  return (
    <View
      style={[
        styles.row,
        { justifyContent: alignRight ? 'flex-end' : 'flex-start' },
      ]}
    >
      {/* Author avatar — only on the left (other-side) preview, mirroring a
          real row. Shows the ORIGINAL author (this is an echo of their message). */}
      {!alignRight && (
        <View style={styles.avatarContainer}>
          <AppImage
            source={senderProfilePhoto}
            style={styles.avatar}
            optimizedWidth={50}
            placeholder={{
              type: 'initials',
              name: senderName || 'User',
              backgroundColor: '#E5E5E5',
            }}
          />
        </View>
      )}

      <View style={[styles.content, alignRight ? styles.contentOwn : styles.contentOther]}>
        {/* Original author's name — only on the left (other-side) preview. */}
        {!alignRight && (
          <Text style={[styles.senderName, { color: colors.textSecondary }]} numberOfLines={1}>
            {senderName || 'Unknown'}
          </Text>
        )}

        {/* The echoed original message. Tapping it scrolls up to the real one. */}
        <Pressable
          onPress={onScrollToOriginal}
          accessibilityRole="button"
          accessibilityLabel="Jump to the original message"
          testID={`ghost-thread-${parentMessageId}`}
          style={({ pressed }) => [
            styles.bubble,
            alignRight ? styles.bubbleOwn : styles.bubbleOther,
            {
              backgroundColor: alignRight ? colors.chatBubbleOwn : colors.chatBubbleOther,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text
            style={[styles.bubbleText, { color: bubbleTextColor }, isPlaceholder && styles.placeholderText]}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {previewText}
          </Text>
        </Pressable>

        {/* Connector line: links the echoed bubble to its replies pill on the
            aligned side, so they read as one threaded unit. */}
        <View
          testID={`ghost-thread-connector-${parentMessageId}`}
          style={[styles.connector, { backgroundColor: colors.border }]}
        />

        {/* The "N replies · Just now" pill — still opens the thread on tap.
            Wrapped so the column's alignItems positions it under the bubble on
            the correct side (ThreadReplies aligns itself flex-start internally). */}
        <View style={styles.pillWrapper}>
          <ThreadReplies
            parentMessageId={parentMessageId}
            channelId={channelId}
            replyCount={replyCount}
            onPress={onOpenThread}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 6,
    paddingHorizontal: 12,
  },
  avatarContainer: {
    width: 24,
    height: 24,
    marginRight: 6,
    marginTop: 18, // drop below the sender-name line so it aligns with the bubble
    flexShrink: 0,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  content: {
    maxWidth: '75%',
    flexShrink: 1,
  },
  contentOwn: {
    alignItems: 'flex-end',
  },
  contentOther: {
    alignItems: 'flex-start',
  },
  senderName: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
    marginLeft: 12,
  },
  bubble: {
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  bubbleOwn: {
    borderBottomRightRadius: 3,
  },
  bubbleOther: {
    borderBottomLeftRadius: 3,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 18,
  },
  placeholderText: {
    fontStyle: 'italic',
  },
  connector: {
    width: 2,
    height: 10,
    borderRadius: 1,
    marginHorizontal: 18, // indent so the line sits under the bubble, not at the edge
    marginVertical: 1,
  },
  pillWrapper: {
    // A plain wrapper so the column's alignItems (own → flex-end, other →
    // flex-start) positions the pill on the correct side.
  },
});
