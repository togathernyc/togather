/**
 * EventCardRow Component
 *
 * Compact Partiful-style row for the Events tab list view. Left-side square
 * thumbnail (~72px), two-line text column (title + date/host subtitle), and
 * a right-side chevron (or RSVP pill if we add status later).
 *
 * Height capped at ~88px so the list stays dense and scannable.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AppImage } from '@components/ui';
import { useAuth } from '@providers/AuthProvider';
import { formatTimeWithTimezone } from '@togather/shared';
import { format, toZonedTime } from 'date-fns-tz';
import { COLORS } from '@features/explore/constants';
import type { CommunityEvent } from '../hooks/useCommunityEvents';

interface EventCardRowProps {
  event: CommunityEvent;
  onPress?: () => void;
}

export function EventCardRow({ event, onPress }: EventCardRowProps) {
  const router = useRouter();
  const { user } = useAuth();

  const userTimezone = user?.timezone || 'America/New_York';

  const eventDate = new Date(event.scheduledAt);
  const zonedDate = toZonedTime(eventDate, userTimezone);
  // "Wed, 4/22" — compact numeric date
  const formattedDate = format(zonedDate, 'EEE, M/d', { timeZone: userTimezone });
  const formattedTime = formatTimeWithTimezone(eventDate, userTimezone);

  const eventTitle = event.title || 'Untitled Event';

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else if (event.shortId) {
      router.push(`/e/${event.shortId}?source=app`);
    }
  };

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <View style={styles.thumb}>
        <AppImage
          source={event.coverImage || event.group.image}
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
        <Text style={styles.title} numberOfLines={2}>
          {eventTitle}
        </Text>
        <Text style={styles.subtitle} numberOfLines={2}>
          {event.communityWideEventId ? 'Community-wide · ' : ''}
          {formattedDate} at {formattedTime} · {event.group.name}
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
    paddingVertical: 10,
    paddingHorizontal: 10,
    gap: 12,
  },
  thumb: {
    width: 64,
    height: 64,
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
    gap: 2,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: 22,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '400',
    color: COLORS.textMuted,
    lineHeight: 18,
  },
  trailing: {
    paddingLeft: 4,
  },
});
