/**
 * EventRowCommunityWide Component
 *
 * Compact Partiful-style row for community-wide events in the Events tab list.
 * Mirrors EventCardRow's layout but:
 *   - Title: parent community-wide event title
 *   - Subtitle: "{groupCount} locations · {totalGoing} going"
 *   - onPress opens the CommunityWideEventSheet (controlled by the parent)
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppImage, CommunityWideBadge } from '@components/ui';
import { useAuth } from '@providers/AuthProvider';
import { formatTimeWithTimezone } from '@togather/shared';
import { format, toZonedTime } from 'date-fns-tz';
import { COLORS } from '@features/explore/constants';
import type { CommunityWideCard } from './CommunityWideEventCard';

interface EventRowCommunityWideProps {
  event: CommunityWideCard;
  onPress: () => void;
}

export function EventRowCommunityWide({ event, onPress }: EventRowCommunityWideProps) {
  const { user } = useAuth();

  const userTimezone = user?.timezone || 'America/New_York';
  const eventDate = new Date(event.scheduledAt);
  const zonedDate = toZonedTime(eventDate, userTimezone);
  const formattedDate = format(zonedDate, 'EEE, M/d', { timeZone: userTimezone });
  const formattedTime = formatTimeWithTimezone(eventDate, userTimezone);

  const eventTitle = event.title || 'Untitled Event';

  const locationsLabel =
    event.groupCount === 1 ? '1 location' : `${event.groupCount} locations`;
  const goingLabel =
    event.totalGoing === 1 ? '1 going' : `${event.totalGoing} going`;

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.thumb}>
        <AppImage
          source={event.coverImage}
          style={styles.thumbImage}
          resizeMode="cover"
          optimizedWidth={160}
          placeholder={{
            type: 'initials',
            name: eventTitle,
          }}
        />
      </View>

      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {eventTitle}
          </Text>
          <View style={styles.badgeInline}>
            <CommunityWideBadge size="small" />
          </View>
        </View>
        <Text style={styles.subtitle} numberOfLines={1}>
          {formattedDate} at {formattedTime} · {locationsLabel} · {goingLabel}
        </Text>
      </View>

      <View style={styles.trailing}>
        <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 12,
    minHeight: 84,
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#f5f5f5',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  badgeInline: {
    flexShrink: 0,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  trailing: {
    paddingLeft: 4,
  },
});
