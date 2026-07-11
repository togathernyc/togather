/**
 * GhostThreadPointer - content-free "ghost" bubble for a bumped thread.
 *
 * When a message gets a reply we deliberately keep the real message in its
 * original chronological position (see `getMessages` ordering by `createdAt`).
 * To avoid losing recent thread activity off-screen, this lightweight ghost is
 * floated at the thread's latest-activity slot (its `lastActivityAt`) at the
 * bottom of the chat. It shows NO original message text — only the existing
 * "N replies" pill — and offers two tap targets:
 *
 * - Tapping the "N replies" pill opens the thread screen (same as the inline
 *   indicator under the real message).
 * - Tapping the ghost body scrolls the chat up to the real original message and
 *   briefly highlights it.
 *
 * The bubble is content-free: it shows NO caption or original text, only a
 * small "jump up" icon (a non-text affordance for the body tap) and the
 * existing "N replies" pill. Styling is intentionally neutral (dashed, greyed,
 * centered — not left/right aligned) so it reads as a pointer, not a real
 * message bubble.
 */

import React from 'react';
import { StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import type { Id } from '@services/api/convex';
import { ThreadReplies } from './ThreadReplies';

interface GhostThreadPointerProps {
  parentMessageId: Id<"chatMessages">;
  channelId?: Id<"chatChannels">;
  replyCount: number;
  /** Tap the "N replies" pill → open the thread screen. */
  onOpenThread: () => void;
  /** Tap the ghost body → scroll up to the real original message. */
  onScrollToOriginal: () => void;
}

export function GhostThreadPointer({
  parentMessageId,
  channelId,
  replyCount,
  onOpenThread,
  onScrollToOriginal,
}: GhostThreadPointerProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onScrollToOriginal}
      accessibilityRole="button"
      accessibilityLabel="Jump to the original message"
      testID={`ghost-thread-${parentMessageId}`}
      style={({ pressed }) => [
        styles.ghost,
        {
          borderColor: colors.border,
          backgroundColor: pressed ? colors.surfaceSecondary : 'transparent',
        },
      ]}
    >
      {/* Icon-only affordance for the body tap (scroll up to the original).
          No caption/text — the ghost stays content-free, showing only the
          "N replies" pill below. */}
      <Ionicons name="arrow-up-circle-outline" size={16} color={colors.textTertiary} />

      <ThreadReplies
        parentMessageId={parentMessageId}
        channelId={channelId}
        replyCount={replyCount}
        onPress={onOpenThread}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ghost: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'center',
    maxWidth: '85%',
    marginVertical: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    gap: 12,
  },
});
