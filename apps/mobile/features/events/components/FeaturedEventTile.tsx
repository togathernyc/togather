/**
 * FeaturedEventTile Component
 *
 * Partiful-style featured tile for the "Next Up" row at the top of the Events
 * tab. The cover image fills the tile; a small pill-style date chip is
 * overlaid near the top of the image; the event title sits BELOW the tile
 * image (not overlaid), truncated to 2 lines.
 *
 * Designed to be rendered two-across in a horizontal row.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { AppImage } from '@components/ui';
import { useAuth } from '@providers/AuthProvider';
import { useTheme } from '@hooks/useTheme';
import { format, toZonedTime } from 'date-fns-tz';
import type { CommunityEvent } from '../hooks/useCommunityEvents';

interface FeaturedEventTileProps {
  event: CommunityEvent;
}

export function FeaturedEventTile({ event }: FeaturedEventTileProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();

  const userTimezone = user?.timezone || 'America/New_York';
  const eventDate = new Date(event.scheduledAt);
  const zonedDate = toZonedTime(eventDate, userTimezone);

  // Compact date pill: "Fri, Apr 19 · 7pm". Uses lower-case am/pm, drops ":00".
  const weekday = format(zonedDate, 'EEE', { timeZone: userTimezone });
  const monthDay = format(zonedDate, 'MMM d', { timeZone: userTimezone });
  const minutes = format(zonedDate, 'mm', { timeZone: userTimezone });
  const hour12 = format(zonedDate, 'h', { timeZone: userTimezone });
  const ampm = format(zonedDate, 'a', { timeZone: userTimezone }).toLowerCase();
  const timeLabel = minutes === '00' ? `${hour12}${ampm}` : `${hour12}:${minutes}${ampm}`;
  const datePill = `${weekday}, ${monthDay} · ${timeLabel}`;

  const eventTitle = event.title || 'Untitled Event';

  const handlePress = () => {
    if (event.shortId) {
      router.push(`/e/${event.shortId}?source=app`);
    }
  };

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={handlePress}
      activeOpacity={0.85}
    >
      <View style={styles.imageWrap}>
        <AppImage
          source={event.coverImage || event.group.image}
          style={styles.image}
          resizeMode="cover"
          optimizedWidth={400}
          placeholder={{
            type: 'initials',
            name: eventTitle,
          }}
        />
        <View style={styles.datePill}>
          <Text style={styles.datePillText} numberOfLines={1}>
            {datePill}
          </Text>
        </View>
      </View>
      <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
        {eventTitle}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 164,
    // gap between image and title handled with marginTop on title
  },
  imageWrap: {
    width: '100%',
    aspectRatio: 1 / 1.15,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#f5f5f5',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  datePill: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    maxWidth: '90%',
    ...Platform.select({
      web: {
        boxShadow: '0px 1px 3px rgba(0, 0, 0, 0.12)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.12,
        shadowRadius: 2,
        elevation: 2,
      },
    }),
  },
  datePillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1a1a1a', // date pill bg is white-ish regardless of theme
  },
  title: {
    marginTop: 8,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 19,
  },
});
