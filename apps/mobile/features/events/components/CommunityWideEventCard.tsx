/**
 * CommunityWideEventCard Component
 *
 * Renders a collapsed community-wide event card for the Events tab.
 * Shows the parent title, date, total group count, and combined RSVP count.
 * Tapping the card opens the CommunityWideEventSheet with per-group children.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { AppImage, CommunityWideBadge } from '@components/ui';
import { useAuth } from '@providers/AuthProvider';
import { formatTimeWithTimezone } from '@togather/shared';
import { format, toZonedTime } from 'date-fns-tz';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@features/explore/constants';
import { useCommunityTheme } from '@hooks/useCommunityTheme';

export interface CommunityWideCard {
  kind: 'community_wide';
  parentId: string;
  title: string;
  scheduledAt: string; // ISO
  status: string;
  meetingType: number;
  groupCount: number;
  totalGoing: number;
  coverImage: string | null;
  representativeShortId: string | null;
}

interface CommunityWideEventCardProps {
  event: CommunityWideCard;
  onPress?: () => void;
}

export function CommunityWideEventCard({ event, onPress }: CommunityWideEventCardProps) {
  const { user } = useAuth();
  const { primaryColor } = useCommunityTheme();

  const userTimezone = user?.timezone || 'America/New_York';
  const eventDate = new Date(event.scheduledAt);
  const zonedDate = toZonedTime(eventDate, userTimezone);
  const formattedDate = format(zonedDate, 'EEE, MMM d', { timeZone: userTimezone });
  const formattedTime = formatTimeWithTimezone(eventDate, userTimezone);

  const eventTitle = event.title || 'Untitled Event';

  // Subtitle: "{groupCount} locations · {totalGoing} going" (pluralize singular cases)
  const locationsLabel = event.groupCount === 1 ? '1 location' : `${event.groupCount} locations`;
  const goingLabel = event.totalGoing === 1 ? '1 going' : `${event.totalGoing} going`;
  const subtitle = `${locationsLabel} · ${goingLabel}`;

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {/* Cover image (or placeholder derived from title) */}
      <View style={styles.imageContainer}>
        <AppImage
          source={event.coverImage}
          style={styles.eventImage}
          resizeMode="cover"
          optimizedWidth={400}
          placeholder={{
            type: 'initials',
            name: eventTitle,
          }}
        />
        {/* Date badge overlay (same format as EventCard) */}
        <View style={styles.dateBadge}>
          <Text style={[styles.dateBadgeMonth, { color: primaryColor }]}>
            {format(zonedDate, 'MMM', { timeZone: userTimezone }).toUpperCase()}
          </Text>
          <Text style={styles.dateBadgeDay}>{format(zonedDate, 'd', { timeZone: userTimezone })}</Text>
        </View>
      </View>

      {/* Info section */}
      <View style={styles.infoSection}>
        {/* Community-wide badge */}
        <View style={styles.badgeContainer}>
          <CommunityWideBadge size="small" />
        </View>

        {/* Title */}
        <Text style={styles.eventTitle} numberOfLines={2}>
          {eventTitle}
        </Text>

        {/* Date & Time */}
        <View style={styles.dateTimeRow}>
          <Ionicons name="calendar-outline" size={14} color={COLORS.textMuted} />
          <Text style={styles.dateTimeText}>
            {formattedDate} · {formattedTime}
          </Text>
        </View>

        {/* Locations + going count */}
        <View style={styles.subtitleRow}>
          <Ionicons name="people-outline" size={14} color={COLORS.textMuted} />
          <Text style={styles.subtitleText} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.08)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
        elevation: 2,
      },
    }),
  },
  imageContainer: {
    width: '100%',
    height: 140,
    backgroundColor: '#f5f5f5',
    position: 'relative',
  },
  eventImage: {
    width: '100%',
    height: '100%',
  },
  dateBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.1)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
      },
    }),
  },
  dateBadgeMonth: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  dateBadgeDay: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: 20,
  },
  infoSection: {
    padding: 14,
  },
  badgeContainer: {
    marginBottom: 8,
  },
  eventTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
    lineHeight: 22,
  },
  dateTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  dateTimeText: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginLeft: 6,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  subtitleText: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginLeft: 6,
    flex: 1,
  },
});
