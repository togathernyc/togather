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
 * - It is aligned like a real message row, keyed off the ORIGINAL message's
 *   author: right (your side, no avatar) when you wrote the original message,
 *   left (with the original author's avatar + name) when someone else did. The
 *   side follows who started the thread, not who replied last — so the echo
 *   sits on the same side the real message does.
 * - The bubble uses the same own/other bubble colors as real messages, so it
 *   reads as a lightweight echo, not a brand-new message.
 *
 * (This component was originally built content-free and centered — "reads as a
 * pointer, not a real message." That was deliberately reversed: it now echoes
 * the original message and aligns by its author, as the approved spec asks.)
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

/**
 * How dim the echo reads versus a real message. The reporter's words: "smaller
 * and more transparent to signify it's an old message." Kept within the
 * spec's ≈55–65% band so it's clearly secondary chrome without dimming the
 * (already muted) deleted/attachment placeholder text into illegibility. Theme
 * colors underneath stay intact — this is opacity only, so it degrades
 * correctly across all four themes rather than hard-coding a light-theme tint.
 */
const DIM_OPACITY = 0.6;

interface GhostThreadPointerProps {
  parentMessageId: Id<"chatMessages">;
  channelId?: Id<"chatChannels">;
  replyCount: number;
  /** The original message's text — shown truncated as the preview. */
  originalContent: string;
  /**
   * Author of the ORIGINAL message. Drives the alignment (right when it's the
   * current user, left otherwise) and the avatar/name shown on the left side.
   */
  originalSenderId: Id<"users">;
  /** Current viewer — the preview aligns right when they authored the original. */
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

  // Aligned like a real message row: right when the current user wrote the
  // original message, left (with the author's avatar + name) otherwise. Keyed
  // off the ORIGINAL message's author, mirroring MessageItem's own-vs-other
  // rule — so the echo sits on the same side the real message does.
  const alignRight = originalSenderId === currentUserId;

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
          real row. Shows the ORIGINAL author (this is an echo of their message).
          Dimmed + shrunk so it reads as secondary chrome, not a new post. */}
      {!alignRight && (
        <View style={[styles.avatarContainer, { opacity: DIM_OPACITY }]}>
          <AppImage
            source={senderProfilePhoto}
            style={styles.avatar}
            optimizedWidth={40}
            placeholder={{
              type: 'initials',
              name: senderName || 'User',
              backgroundColor: '#E5E5E5',
            }}
          />
        </View>
      )}

      <View style={[styles.content, alignRight ? styles.contentOwn : styles.contentOther]}>
        {/* Muted "Original message" label — makes the echo's purpose explicit
            (it's a reference back to the earlier message, not a new post)
            rather than leaving it implied by styling alone. */}
        <Text style={[styles.originalLabel, { color: colors.textTertiary }]} numberOfLines={1}>
          ↪ Original message
        </Text>

        {/* Original author's name — only on the left (other-side) preview.
            Smaller/muted to match the echo's reduced weight. */}
        {!alignRight && (
          <Text style={[styles.senderName, { color: colors.textSecondary }]} numberOfLines={1}>
            {senderName || 'Unknown'}
          </Text>
        )}

        {/* The echoed original message. Tapping it scrolls up to the real one.
            Dimmed and physically smaller than a real bubble so it never reads
            as a duplicate post. */}
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
              opacity: pressed ? DIM_OPACITY * 0.8 : DIM_OPACITY,
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
    width: 20,
    height: 20,
    marginRight: 6,
    marginTop: 2, // sit level with the "Original message" label line
    flexShrink: 0,
  },
  avatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
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
  originalLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 2,
    marginHorizontal: 4,
  },
  senderName: {
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 2,
    marginLeft: 12,
  },
  bubble: {
    borderRadius: 12,
    paddingVertical: 5,
    paddingHorizontal: 9,
  },
  bubbleOwn: {
    borderBottomRightRadius: 3,
  },
  bubbleOther: {
    borderBottomLeftRadius: 3,
  },
  bubbleText: {
    fontSize: 12.5,
    lineHeight: 16,
  },
  placeholderText: {
    fontStyle: 'italic',
  },
  pillWrapper: {
    // A plain wrapper so the column's alignItems (own → flex-end, other →
    // flex-start) positions the pill on the correct side.
  },
});
