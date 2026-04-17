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
import { AppImage } from '@components/ui';
import { useAuth } from '@providers/AuthProvider';
import { useTheme } from '@hooks/useTheme';
import { formatTimeWithTimezone } from '@togather/shared';
import { format, toZonedTime } from 'date-fns-tz';
import type { CommunityWideCard } from './CommunityWideEventCard';

interface EventRowCommunityWideProps {
  event: CommunityWideCard;
  onPress: () => void;
}

export function EventRowCommunityWide({ event, onPress }: EventRowCommunityWideProps) {
  const { user } = useAuth();
  const { colors } = useTheme();

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
      style={[styles.container, { backgroundColor: colors.surface }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.thumb, { backgroundColor: colors.backgroundSecondary }]}>
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
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
          {eventTitle}
        </Text>
        <Text
          style={[styles.subtitle, { color: colors.textSecondary }]}
          numberOfLines={2}
        >
          Community-wide · {formattedDate} at {formattedTime} · {locationsLabel} · {goingLabel}
        </Text>
      </View>

      <View style={styles.trailing}>
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    gap: 12,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
    overflow: 'hidden',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
  },
  trailing: {
    paddingLeft: 4,
  },
});
