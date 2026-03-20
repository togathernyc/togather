/**
 * ThreadReplies - Clickable thread reply indicator
 *
 * Shows a Slack-style indicator with:
 * - Stacked avatars of recent repliers
 * - Reply count text
 * - Last reply timestamp
 * - Chevron for navigation
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import type { Id } from '@services/api/convex';
import { AppImage } from '@components/ui';
import { useThreadReplies } from '../hooks/useThreadReplies';

interface ThreadRepliesProps {
  parentMessageId: Id<"chatMessages">;
  channelId?: Id<"chatChannels">;
  replyCount: number;
  onPress?: () => void;
}

/**
 * Format relative time for last reply (e.g., "2h ago", "Yesterday")
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 1) {
    return `${days}d ago`;
  }
  if (days === 1) {
    return 'Yesterday';
  }
  if (hours > 0) {
    return `${hours}h ago`;
  }
  if (minutes > 0) {
    return `${minutes}m ago`;
  }
  return 'Just now';
}

/**
 * Get unique repliers from replies (up to 3)
 */
function getUniqueRepliers(replies: Array<{ senderId?: Id<"users">; senderName?: string; senderProfilePhoto?: string }>) {
  const seen = new Set<string>();
  const uniqueRepliers: Array<{ senderName?: string; senderProfilePhoto?: string }> = [];

  for (const reply of replies) {
    if (reply.senderId && !seen.has(reply.senderId)) {
      seen.add(reply.senderId);
      uniqueRepliers.push({
        senderName: reply.senderName,
        senderProfilePhoto: reply.senderProfilePhoto,
      });
      if (uniqueRepliers.length >= 3) break;
    }
  }

  return uniqueRepliers;
}

export function ThreadReplies({ parentMessageId, channelId, replyCount, onPress }: ThreadRepliesProps) {
  const { colors } = useTheme();
  // Fetch just a few replies to get avatar data and last reply time
  // Pass channelId for prefetch lookup
  const { replies, isLoading } = useThreadReplies(parentMessageId, 10, channelId);

  // Don't render if no replies expected
  if (replyCount === 0) {
    return null;
  }

  // With prefetch, data should be ready immediately
  // If still loading (edge case), don't render to avoid flicker
  if (isLoading && replies.length === 0) {
    return null;
  }

  // Get unique repliers for avatars (most recent first since replies are in asc order)
  const reversedReplies = [...replies].reverse();
  const uniqueRepliers = getUniqueRepliers(reversedReplies);

  // Get last reply timestamp
  const lastReply = reversedReplies[0];
  const lastReplyTime = lastReply ? formatRelativeTime(lastReply.createdAt) : '';

  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        { backgroundColor: pressed ? colors.border : colors.surfaceSecondary },
      ]}
      onPress={onPress}
    >
      {/* Stacked Avatars */}
      <View style={styles.avatarsContainer}>
        {uniqueRepliers.map((replier, index) => (
          <View
            key={index}
            style={[
              styles.avatarWrapper,
              { marginLeft: index > 0 ? -8 : 0, zIndex: uniqueRepliers.length - index, borderColor: colors.surfaceSecondary },
            ]}
          >
            <AppImage
              source={replier.senderProfilePhoto}
              style={styles.avatar}
              optimizedWidth={24}
              placeholder={{
                type: 'initials',
                name: replier.senderName || 'User',
                backgroundColor: colors.surfaceSecondary,
              }}
            />
          </View>
        ))}
      </View>

      {/* Reply count */}
      <Text style={[styles.replyText, { color: colors.link }]}>
        {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
      </Text>

      {/* Separator dot */}
      {lastReplyTime && (
        <>
          <Text style={[styles.separator, { color: colors.textTertiary }]}>·</Text>
          <Text style={[styles.timeText, { color: colors.textSecondary }]}>{lastReplyTime}</Text>
        </>
      )}

      {/* Chevron indicator */}
      <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} style={styles.chevron} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  loadingText: {
    fontSize: 12,
  },
  avatarsContainer: {
    flexDirection: 'row',
    marginRight: 8,
  },
  avatarWrapper: {
    borderWidth: 2,
    borderRadius: 12,
  },
  avatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  replyText: {
    fontSize: 12,
    fontWeight: '600',
  },
  separator: {
    fontSize: 12,
    marginHorizontal: 6,
  },
  timeText: {
    fontSize: 12,
  },
  chevron: {
    marginLeft: 4,
  },
});
