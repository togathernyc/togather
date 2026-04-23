/**
 * EventComment - Partiful-style comment card for the event page's Activity
 * section.
 *
 * Unlike `MessageItem` (which renders iMessage-style bubbles with owner-based
 * alignment), this component renders a flat, left-aligned card:
 *
 *   [avatar] [Name]  [13d]              <- header row
 *            Body content with @mentions / links
 *            [image thumbnail(s)]
 *            [Also sent via SMS]         <- blast badge (when applicable)
 *            [👍 2] [🎉 1]               <- reaction pills
 *            Reply                       <- opens thread page
 *
 * Consumed by `EventActivity` inside a `ReactionsProvider`, so `useReactions`
 * transparently reads from the batched context.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { Id } from '@services/api/convex';
import { AppImage, ImageViewer } from '@components/ui';
import { useReactions, type Reaction } from '@features/chat/hooks/useReactions';
import { parseMessageContent } from '@features/shared/utils/linkify';
import { getMediaUrl } from '@/utils/media';
import { useTheme } from '@hooks/useTheme';

export interface EventCommentProps {
  message: {
    _id: Id<'chatMessages'>;
    channelId: Id<'chatChannels'>;
    senderId?: Id<'users'>;
    content: string;
    contentType: string;
    attachments?: Array<{
      type: string;
      url: string;
      name?: string;
      mimeType?: string;
      thumbnailUrl?: string;
    }>;
    createdAt: number;
    editedAt?: number;
    isDeleted: boolean;
    senderName?: string;
    senderProfilePhoto?: string;
    mentionedUserIds?: Id<'users'>[];
    threadReplyCount?: number;
    blastId?: Id<'eventBlasts'>;
  };
  currentUserId: Id<'users'>;
  groupId: Id<'groups'>;
}

/**
 * Format timestamp as a compact relative string:
 *   <1m  -> "Just now"
 *   <1h  -> "5m"
 *   <1d  -> "3h"
 *   <7d  -> "4d"
 *   else -> "Jan 15" or "Jan 15, 2024" (if different year)
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;

  if (diff < minute) return 'Just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  if (diff < week) return `${Math.floor(diff / day)}d`;

  const date = new Date(timestamp);
  const nowDate = new Date(now);
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const month = months[date.getMonth()];
  const day_ = date.getDate();
  if (date.getFullYear() !== nowDate.getFullYear()) {
    return `${month} ${day_}, ${date.getFullYear()}`;
  }
  return `${month} ${day_}`;
}

function EventCommentInner({ message, currentUserId, groupId }: EventCommentProps) {
  const router = useRouter();
  const { colors: themeColors } = useTheme();

  // Reactions — reads from ReactionsProvider batch when wrapped, otherwise
  // falls back to a per-message query. Matches MessageItem.
  const { reactions, toggleReaction, isLoading: reactionsLoading } = useReactions(
    message._id,
  );

  // Image viewer for tap-to-expand on attachments.
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [imageViewerInitialIndex, setImageViewerInitialIndex] = useState(0);

  // Categorize attachments — v1 only renders images.
  const { validImageAttachments, imageUrls } = useMemo(() => {
    const emptyResult = {
      validImageAttachments: [] as NonNullable<EventCommentProps['message']['attachments']>,
      imageUrls: [] as string[],
    };
    if (!message.attachments) return emptyResult;

    const validImages: NonNullable<EventCommentProps['message']['attachments']> = [];
    const urls: string[] = [];
    for (const attachment of message.attachments) {
      if (attachment.type !== 'image') continue;
      const url = getMediaUrl(attachment.url);
      if (url) {
        validImages.push(attachment);
        urls.push(url);
      }
    }
    return { validImageAttachments: validImages, imageUrls: urls };
  }, [message.attachments]);

  // Mention tap — mirror MessageItem's approach. When the message has
  // exactly one mentioned user id we can resolve a tap to a profile; with
  // multiple mentions we bail out because the server doesn't persist a
  // name→id map.
  const handleMentionTap = useCallback(
    (mention: string) => {
      const displayName = mention.replace(/^@\[/, '').replace(/\]$/, '').trim();
      const ids = message.mentionedUserIds;
      if (!ids || ids.length === 0 || !displayName) return;
      const targetId = ids.length === 1 ? ids[0] : null;
      if (!targetId) return;
      if (targetId === currentUserId) return;
      router.push(`/profile/${targetId}` as any);
    },
    [router, message.mentionedUserIds, currentUserId],
  );

  const handleUrlTap = useCallback((url: string) => {
    Linking.openURL(url).catch((err) => {
      console.error('[EventComment] Failed to open URL:', err);
    });
  }, []);

  const handleReactionTap = useCallback(
    async (emoji: string) => {
      try {
        await toggleReaction(emoji);
      } catch (err) {
        console.error('[EventComment] Failed to toggle reaction:', err);
      }
    },
    [toggleReaction],
  );

  const handleImagePress = useCallback((index: number) => {
    setImageViewerInitialIndex(index);
    setImageViewerVisible(true);
  }, []);

  // Reply — route to the shared thread page used by group chat. Plain
  // string form (not the `pathname` object form) because on native the
  // event page (/e/[shortId]) and the inbox stack are separate, and the
  // object form doesn't always cross-stack navigate reliably.
  const handleReplyPress = useCallback(() => {
    router.push(
      `/inbox/${groupId}/thread/${message._id}?channelName=event` as any,
    );
  }, [router, groupId, message._id]);

  // ---- Rendering ----

  const renderContent = () => {
    if (message.isDeleted) {
      return (
        <Text style={[styles.deletedText, { color: themeColors.textTertiary }]}>
          Deleted.
        </Text>
      );
    }

    if (message.content.trim().length === 0) return null;

    const parts = parseMessageContent(message.content);
    return (
      <Text style={[styles.bodyText, { color: themeColors.text }]}>
        {parts.map((part, index) => {
          if (part.type === 'mention') {
            return (
              <Text
                key={index}
                style={styles.mention}
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

  const renderAttachments = () => {
    if (message.isDeleted || validImageAttachments.length === 0) return null;

    // Single image: larger thumbnail. Multiple: simple 2-column grid.
    if (validImageAttachments.length === 1) {
      return (
        <Pressable
          style={styles.singleImageWrapper}
          onPress={() => handleImagePress(0)}
        >
          <AppImage
            source={validImageAttachments[0].url}
            style={styles.singleImage}
            optimizedWidth={600}
          />
        </Pressable>
      );
    }

    return (
      <View style={styles.imageGrid}>
        {validImageAttachments.map((attachment, index) => (
          <Pressable
            key={`${attachment.url}-${index}`}
            style={styles.gridImageWrapper}
            onPress={() => handleImagePress(index)}
          >
            <AppImage
              source={attachment.url}
              style={styles.gridImage}
              optimizedWidth={400}
            />
          </Pressable>
        ))}
      </View>
    );
  };

  const renderBlastBadge = () => {
    if (!message.blastId || message.isDeleted) return null;
    return (
      <View
        style={[
          styles.blastBadge,
          { backgroundColor: themeColors.surfaceSecondary },
        ]}
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
    );
  };

  const renderReactions = () => {
    if (message.isDeleted) return null;
    // Skip while loading to avoid flicker (matches MessageItem behavior).
    if (reactionsLoading && reactions.length === 0) return null;
    if (reactions.length === 0) return null;

    return (
      <View style={styles.reactionsRow}>
        {reactions.map((reaction: Reaction) => (
          <Pressable
            key={reaction.emoji}
            style={[
              styles.reactionPill,
              {
                backgroundColor: themeColors.surfaceSecondary,
                borderColor: themeColors.border,
              },
              reaction.hasReacted && {
                backgroundColor: '#E3F2FD',
                borderColor: '#1976D2',
              },
            ]}
            onPress={() => handleReactionTap(reaction.emoji)}
          >
            <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
            {reaction.count > 1 && (
              <Text
                style={[styles.reactionCount, { color: themeColors.textSecondary }]}
              >
                {reaction.count}
              </Text>
            )}
          </Pressable>
        ))}
      </View>
    );
  };

  const isEdited =
    message.editedAt != null && message.editedAt !== message.createdAt;

  return (
    <View style={styles.container}>
      {/* Avatar */}
      <View style={styles.avatarContainer}>
        <AppImage
          source={message.senderProfilePhoto}
          style={styles.avatar}
          optimizedWidth={72}
          placeholder={{
            type: 'initials',
            name: message.senderName || 'User',
            backgroundColor: '#E5E5E5',
          }}
        />
      </View>

      {/* Body column */}
      <View style={styles.body}>
        {/* Header: name + relative time (+ edited) */}
        <View style={styles.headerRow}>
          <Text
            style={[styles.senderName, { color: themeColors.text }]}
            numberOfLines={1}
          >
            {message.senderName || 'Unknown'}
          </Text>
          <Text style={[styles.timestamp, { color: themeColors.textTertiary }]}>
            {formatRelativeTime(message.createdAt)}
            {isEdited && !message.isDeleted ? ' · edited' : ''}
          </Text>
        </View>

        {/* Text content (or "Deleted." stub) */}
        {renderContent()}

        {/* Image attachments */}
        {renderAttachments()}

        {/* SMS blast badge */}
        {renderBlastBadge()}

        {/* Reactions */}
        {renderReactions()}

        {/* Reply button — hidden on deleted messages so there's no affordance
            to thread off a removed comment. */}
        {!message.isDeleted && (
          <Pressable
            onPress={handleReplyPress}
            hitSlop={8}
            style={styles.replyButton}
            accessibilityRole="button"
            accessibilityLabel="Reply to this comment"
          >
            <Text style={[styles.replyText, { color: themeColors.textSecondary }]}>
              {message.threadReplyCount && message.threadReplyCount > 0
                ? `Reply · ${message.threadReplyCount}`
                : 'Reply'}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Fullscreen image gallery */}
      <ImageViewer
        visible={imageViewerVisible}
        images={imageUrls}
        initialIndex={imageViewerInitialIndex}
        onClose={() => setImageViewerVisible(false)}
      />
    </View>
  );
}

export const EventComment = React.memo(EventCommentInner);

const AVATAR_SIZE = 36;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 4,
    alignItems: 'flex-start',
  },
  avatarContainer: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    marginRight: 10,
    flexShrink: 0,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 2,
  },
  senderName: {
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
  timestamp: {
    fontSize: 12,
    flexShrink: 0,
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
  },
  deletedText: {
    fontSize: 14,
    fontStyle: 'italic',
    marginTop: 2,
  },
  mention: {
    backgroundColor: '#E3F2FD',
    color: '#1976D2',
    fontWeight: '600',
    paddingHorizontal: 2,
    borderRadius: 2,
  },
  urlLink: {
    textDecorationLine: 'underline',
  },
  singleImageWrapper: {
    marginTop: 8,
    borderRadius: 10,
    overflow: 'hidden',
    maxWidth: 320,
  },
  singleImage: {
    width: '100%',
    aspectRatio: 4 / 3,
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 8,
  },
  gridImageWrapper: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  gridImage: {
    width: 140,
    height: 140,
  },
  blastBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  blastBadgeIcon: {
    marginRight: 3,
  },
  blastBadgeText: {
    fontSize: 10,
    fontWeight: '500',
  },
  reactionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 4,
    marginBottom: 4,
    borderWidth: 1,
  },
  reactionEmoji: {
    fontSize: 13,
  },
  reactionCount: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  replyButton: {
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  replyText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
