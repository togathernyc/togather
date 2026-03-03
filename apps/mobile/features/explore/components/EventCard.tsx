/**
 * EventCard Component
 *
 * Displays an event card in the events list view.
 * Shows event title, date/time, hosting group, and RSVP summary.
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
import { Ionicons } from '@expo/vector-icons';
import { Avatar, AppImage, CommunityWideBadge } from '@components/ui';
import { useAuth } from '@providers/AuthProvider';
import { formatTimeWithTimezone } from '@togather/shared';
import { format, toZonedTime } from 'date-fns-tz';
import { COLORS } from '../constants';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import type { CommunityEvent } from '../hooks/useCommunityEvents';

interface EventCardProps {
  event: CommunityEvent;
  onPress?: () => void;
}

export function EventCard({ event, onPress }: EventCardProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { primaryColor } = useCommunityTheme();

  // Get user's timezone (default to America/New_York if not set)
  const userTimezone = user?.timezone || 'America/New_York';

  // Format date in user's timezone
  const eventDate = new Date(event.scheduledAt);
  const zonedDate = toZonedTime(eventDate, userTimezone);
  const formattedDate = format(zonedDate, 'EEE, MMM d', { timeZone: userTimezone });
  const formattedTime = formatTimeWithTimezone(eventDate, userTimezone);

  // Get event title or fallback
  const eventTitle = event.title || 'Untitled Event';

  // Handle navigation to event details
  const handlePress = () => {
    if (onPress) {
      onPress();
    } else {
      router.push(`/e/${event.shortId}?source=app`);
    }
  };

  const { topGoingGuests, totalGoing } = event.rsvpSummary;
  const maxVisibleAvatars = 3;
  const visibleGuests = topGoingGuests.slice(0, maxVisibleAvatars);
  const remainingCount = totalGoing > maxVisibleAvatars ? totalGoing - maxVisibleAvatars : 0;

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={handlePress}
      activeOpacity={0.8}
    >
      {/* Event Image - falls back to group image if no event cover */}
      <View style={styles.imageContainer}>
        <AppImage
          source={event.coverImage || event.group.image}
          style={styles.eventImage}
          resizeMode="cover"
          optimizedWidth={400}
          placeholder={{
            type: 'initials',
            name: eventTitle,
          }}
        />
        {/* Date badge overlay */}
        <View style={styles.dateBadge}>
          <Text style={[styles.dateBadgeMonth, { color: primaryColor }]}>
            {format(zonedDate, 'MMM', { timeZone: userTimezone }).toUpperCase()}
          </Text>
          <Text style={styles.dateBadgeDay}>{format(zonedDate, 'd', { timeZone: userTimezone })}</Text>
        </View>
      </View>

      {/* Event Info */}
      <View style={styles.infoSection}>
        {/* Hosting Group */}
        <View style={styles.groupBadge}>
          {event.group.image && (
            <AppImage
              source={event.group.image}
              style={styles.groupImage}
              optimizedWidth={50}
            />
          )}
          <Text style={styles.groupName} numberOfLines={1}>
            {event.group.name}
          </Text>
        </View>

        {/* Community-Wide Event Badge */}
        {event.communityWideEventId && (
          <View style={styles.communityWideBadgeContainer}>
            <CommunityWideBadge size="small" />
          </View>
        )}

        {/* Event Title */}
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

        {/* Location */}
        {event.locationOverride && (
          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={14} color={COLORS.textMuted} />
            <Text style={styles.locationText} numberOfLines={1}>
              {event.locationOverride}
            </Text>
          </View>
        )}

        {/* RSVP Summary */}
        {totalGoing > 0 && (
          <View style={styles.rsvpSection}>
            <View style={styles.avatarsRow}>
              {visibleGuests.map((guest, index) => (
                <View
                  key={guest.id}
                  style={[
                    styles.avatarWrapper,
                    index > 0 && styles.avatarWrapperOverlap,
                  ]}
                >
                  <Avatar
                    name={guest.firstName}
                    imageUrl={guest.profileImage}
                    size={24}
                  />
                </View>
              ))}
              {remainingCount > 0 && (
                <View style={[styles.avatarWrapper, styles.avatarWrapperOverlap, styles.countBadge]}>
                  <Text style={styles.countText}>+{remainingCount}</Text>
                </View>
              )}
            </View>
            <Text style={styles.rsvpText}>
              {totalGoing} {totalGoing === 1 ? 'person' : 'people'} going
            </Text>
          </View>
        )}
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
  groupBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  groupImage: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginRight: 6,
  },
  groupName: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textMuted,
    flex: 1,
  },
  communityWideBadgeContainer: {
    marginBottom: 6,
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
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  locationText: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginLeft: 6,
    flex: 1,
  },
  rsvpSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  avatarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  avatarWrapper: {
    marginRight: -6,
    zIndex: 1,
  },
  avatarWrapperOverlap: {
    marginLeft: 0,
  },
  countBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  countText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#666',
  },
  rsvpText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
});
