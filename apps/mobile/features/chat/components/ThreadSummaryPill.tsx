/**
 * ThreadSummaryPill — the single "there's more in this conversation" affordance.
 *
 * A reply on its own is just a bubble in the timeline (see `ReplyQuoteBlock`).
 * Only once a real conversation accumulates under one message — two or more
 * live replies — do those replies collapse out of the timeline, and this ONE
 * pill takes their place directly under the parent bubble:
 *
 *   ((●))(●)(●)  3 replies · 5m ago  ›
 *
 * Overlapping mini-avatars of the most recent repliers (up to three), the
 * count, the last reply's relative time, a chevron. Neutral solid fill so it
 * reads as chrome on the doodle wallpaper, with the count in the accent.
 *
 * Unlike the flag-off `ThreadReplies` it replaces, this component runs NO query
 * of its own: everything comes from `getMessages`' `threadSummary` decoration,
 * which removes an N+1 (one `getThreadReplies` subscription per visible pill)
 * and fixes that component's ordering bug — it took the OLDEST ten replies and
 * so showed the wrong "last reply" time on any thread deeper than ten.
 *
 * Flag-on only.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import { AppImage } from '@components/ui';
import type { Id } from '@services/api/convex';
import { WA_CHEVRON_SIZE } from '@components/wa/metrics';
import { WA_BUBBLE_SHADOW, WA_REPLY_QUOTE_TEXT_SIZE } from '../waChatChrome';

/** `threadSummary`, as decorated by `getMessages({ waReplies: true })`. */
export interface ThreadSummary {
  replyCount: number;
  /**
   * The thread is deeper than the backend's bounded count (see
   * `WA_THREAD_COUNT_CAP`), so `replyCount` is a floor — render it as "50+"
   * rather than claiming an exact number we did not read.
   */
  replyCountCapped?: boolean;
  lastReplyAt: number;
  /** A reply landed after this viewer last read the channel (approximate). */
  hasUnread?: boolean;
  repliers: Array<{
    userId?: Id<'users'>;
    name?: string;
    profilePhoto?: string;
  }>;
}

interface ThreadSummaryPillProps {
  summary: ThreadSummary;
  onPress?: () => void;
}

/** Mini-avatar diameter, and how far each one slides under the previous. */
const AVATAR_SIZE = 20;
const AVATAR_OVERLAP = 7;

/**
 * Relative time for the last reply. Deliberately terse — the pill is chrome
 * under a bubble, not a row, so it gets "5m" rather than "5 minutes ago".
 */
export function formatLastReply(timestamp: number, now: number = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

export function ThreadSummaryPill({ summary, onPress }: ThreadSummaryPillProps) {
  const { colors, isDark } = useTheme();

  // Defensive: the pill only exists for collapsed threads, but a count that
  // somehow arrives at 0 should render nothing rather than "0 replies".
  if (summary.replyCount <= 0) return null;

  const avatars = summary.repliers.slice(0, 3);
  // "50+ replies" — always plural, since the cap is only ever hit well past 1.
  const countLabel = summary.replyCountCapped
    ? `${summary.replyCount}+ replies`
    : `${summary.replyCount} ${summary.replyCount === 1 ? 'reply' : 'replies'}`;

  return (
    <Pressable
      testID="wa-thread-summary-pill"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${countLabel}, last ${formatLastReply(
        summary.lastReplyAt,
      )}. Open thread.`}
      style={({ pressed }) => [
        styles.container,
        WA_BUBBLE_SHADOW,
        {
          backgroundColor: colors.bubbleIncoming,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      {avatars.length > 0 && (
        <View style={styles.avatars}>
          {avatars.map((replier, index) => (
            <View
              key={replier.userId ?? index}
              testID="wa-thread-summary-avatar"
              style={[
                styles.avatarRing,
                {
                  marginLeft: index > 0 ? -AVATAR_OVERLAP : 0,
                  // Newest replier reads on top of the stack.
                  zIndex: avatars.length - index,
                  borderColor: colors.bubbleIncoming,
                },
              ]}
            >
              <AppImage
                source={replier.profilePhoto}
                style={styles.avatar}
                optimizedWidth={AVATAR_SIZE * 3}
                placeholder={{
                  type: 'initials',
                  name: replier.name || 'User',
                  backgroundColor: isDark ? '#2A3942' : '#E5E5E5',
                }}
              />
            </View>
          ))}
        </View>
      )}

      <Text testID="wa-thread-summary-count" style={[styles.count, { color: colors.link }]}>
        {countLabel}
      </Text>
      <Text style={[styles.separator, { color: colors.textTertiary }]}>·</Text>
      <Text testID="wa-thread-summary-time" style={[styles.time, { color: colors.textSecondary }]}>
        {formatLastReply(summary.lastReplyAt)}
      </Text>

      {/* Unread dot — approximate (channel-level read state; see the backend's
          `hasUnread` note), so it's a quiet nudge, never a count. */}
      {summary.hasUnread && (
        <View
          testID="wa-thread-summary-unread"
          style={[styles.unreadDot, { backgroundColor: colors.link }]}
        />
      )}

      <Ionicons
        name="chevron-forward"
        size={WA_CHEVRON_SIZE}
        color={colors.textTertiary}
        style={styles.chevron}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 14,
  },
  avatars: {
    flexDirection: 'row',
    marginRight: 7,
  },
  avatarRing: {
    borderWidth: 1.5,
    borderRadius: (AVATAR_SIZE + 3) / 2,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  count: {
    fontSize: WA_REPLY_QUOTE_TEXT_SIZE,
    fontWeight: '600',
  },
  separator: {
    fontSize: WA_REPLY_QUOTE_TEXT_SIZE,
    marginHorizontal: 5,
  },
  time: {
    fontSize: WA_REPLY_QUOTE_TEXT_SIZE,
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginLeft: 6,
  },
  chevron: {
    marginLeft: 4,
  },
});
