import React, { useCallback, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Platform,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { AppImage } from '@components/ui';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Group } from '@features/groups/types';
import { getGroupTypeLabel } from '@features/groups/utils';
import { useAuth } from '@providers/AuthProvider';
import { COLORS, getGroupTypeColor } from '../constants';
import { useCommunityTheme } from '@hooks/useCommunityTheme';

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Get user's timezone abbreviation (e.g., "EST", "PST")
const getUserTimezone = (): string => {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' });
    const parts = formatter.formatToParts(new Date());
    const tzPart = parts.find(part => part.type === 'timeZoneName');
    return tzPart?.value || '';
  } catch {
    return '';
  }
};

// Convert UTC time string (HH:MM:SS) to local time
const convertUtcTimeToLocal = (utcTimeString: string): { hours: number; minutes: number } | null => {
  if (!utcTimeString) return null;

  try {
    const parts = utcTimeString.split(':');
    if (parts.length < 2) return null;

    const utcHours = parseInt(parts[0], 10);
    const utcMinutes = parseInt(parts[1], 10);

    if (isNaN(utcHours) || isNaN(utcMinutes)) return null;

    // Create a date object for today with the UTC time
    const now = new Date();
    const utcDate = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      utcHours,
      utcMinutes,
      0
    ));

    // Get local hours and minutes
    return {
      hours: utcDate.getHours(),
      minutes: utcDate.getMinutes(),
    };
  } catch {
    return null;
  }
};

// Format time to 12-hour format with AM/PM
const formatTime12Hour = (hours: number, minutes: number): string => {
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, '0');
  return `${displayHours}:${displayMinutes} ${period}`;
};

interface FloatingGroupCardProps {
  group: Group;
  onClose: () => void;
}

const { width: screenWidth } = Dimensions.get('window');
const CARD_MARGIN = 16;
const CARD_WIDTH = screenWidth - CARD_MARGIN * 2;
const IMAGE_HEIGHT = 200;

export function FloatingGroupCard({ group, onClose }: FloatingGroupCardProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);

  // Prefer group_type_name from API, fallback to ID lookup
  const typeLabel = getGroupTypeLabel(group.group_type_name ?? group.group_type ?? group.type ?? 1, user);
  const typeColor = getGroupTypeColor(group.group_type ?? group.type);
  const groupName = group.title || group.name || 'Untitled Group';

  // Collect all available images
  const images: string[] = [];
  if (group.preview) images.push(group.preview);
  if (group.image_url && group.image_url !== group.preview) images.push(group.image_url);
  if (group.highlights) {
    group.highlights.forEach((h) => {
      if (h.image_url && !images.includes(h.image_url)) {
        images.push(h.image_url);
      }
    });
  }

  const hasImages = images.length > 0;

  // Get location string
  const getLocationString = () => {
    if (group.city && group.state) {
      return `${group.city}, ${group.state}`;
    }
    if (group.location) {
      return group.location;
    }
    if (group.full_address) {
      return group.full_address;
    }
    return null;
  };

  // Get schedule string with UTC to local timezone conversion
  const getScheduleString = () => {
    const parts: string[] = [];

    // Day of week (0=Monday, 6=Sunday in backend)
    if (group.day !== undefined && group.day !== null && group.day >= 0 && group.day <= 6) {
      parts.push(DAYS_OF_WEEK[group.day] + 's');
    }

    // Time - convert from UTC to local timezone
    if (group.start_time) {
      const localTime = convertUtcTimeToLocal(group.start_time);
      if (localTime) {
        const formattedTime = formatTime12Hour(localTime.hours, localTime.minutes);
        const timezone = getUserTimezone();
        parts.push(formattedTime + (timezone ? ` ${timezone}` : ''));
      }
    }

    return parts.length > 0 ? parts.join(' · ') : null;
  };

  const scheduleString = getScheduleString();

  // Get meeting type string (groups schema: 1=In-Person, 2=Online)
  const getMeetingTypeString = () => {
    if (group.meeting_type === 1) return 'In-person';
    if (group.meeting_type === 2) return 'Online';
    return null;
  };

  const locationString = getLocationString();
  const meetingTypeString = getMeetingTypeString();

  // Get initials for placeholder
  const getInitials = () => {
    const name = groupName.trim();
    if (!name) return 'G';
    const parts = name.split(' ').filter((p) => p.length > 0);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name[0]?.toUpperCase() || 'G';
  };

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / CARD_WIDTH);
    setCurrentImageIndex(index);
  }, []);

  const handleViewGroup = useCallback(() => {
    // Use Convex _id for navigation, fallback to legacy id
    const groupId = group._id || group.id;
    router.push(`/groups/${groupId}`);
    onClose();
  }, [router, group._id, group.id, onClose]);

  return (
    <View style={styles.overlay}>
      <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />
      <View style={styles.card}>
        {/* Close button */}
        <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.8}>
          <Ionicons name="close" size={20} color="#333" />
        </TouchableOpacity>

        {/* Image carousel */}
        <View style={styles.imageContainer}>
          {hasImages ? (
            <>
              <ScrollView
                ref={scrollViewRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                style={styles.imageScroll}
              >
                {images.map((imageUrl, index) => (
                  <AppImage
                    key={index}
                    source={imageUrl}
                    style={styles.image}
                    optimizedWidth={Math.round(CARD_WIDTH * 2)}
                    resizeMode="cover"
                  />
                ))}
              </ScrollView>

              {/* Pagination dots */}
              {images.length > 1 && (
                <View style={styles.pagination}>
                  {images.map((_, index) => (
                    <View
                      key={index}
                      style={[
                        styles.paginationDot,
                        index === currentImageIndex && styles.paginationDotActive,
                      ]}
                    />
                  ))}
                </View>
              )}
            </>
          ) : (
            <View style={[styles.placeholder, { backgroundColor: typeColor }]}>
              <Text style={styles.placeholderText}>{getInitials()}</Text>
            </View>
          )}

          {/* Type badge */}
          {typeLabel && (
            <View style={[styles.typeBadge, { backgroundColor: typeColor }]}>
              <Text style={styles.typeText}>{typeLabel}</Text>
            </View>
          )}
        </View>

        {/* Info section */}
        <View style={styles.infoSection}>
          <Text style={styles.groupName} numberOfLines={2}>
            {groupName}
          </Text>

          {/* Location row */}
          {locationString && (
            <View style={styles.infoRow}>
              <Ionicons name="location-outline" size={16} color={COLORS.textMuted} />
              <Text style={styles.infoText} numberOfLines={1}>
                {locationString}
              </Text>
            </View>
          )}

          {/* Schedule row */}
          {scheduleString && (
            <View style={styles.infoRow}>
              <Ionicons name="calendar-outline" size={16} color={COLORS.textMuted} />
              <Text style={styles.infoText} numberOfLines={1}>
                {scheduleString}
              </Text>
            </View>
          )}

          {/* Meeting type */}
          {meetingTypeString && (
            <View style={styles.infoRow}>
              <Ionicons
                name={group.meeting_type === 2 ? 'videocam-outline' : 'people-outline'}
                size={16}
                color={COLORS.textMuted}
              />
              <Text style={styles.infoText}>{meetingTypeString}</Text>
            </View>
          )}

          {/* Members count */}
          {group.members_count !== undefined && group.members_count !== null && group.members_count > 0 && (
            <View style={styles.infoRow}>
              <Ionicons name="person-outline" size={16} color={COLORS.textMuted} />
              <Text style={styles.infoText}>
                {group.members_count} {group.members_count === 1 ? 'member' : 'members'}
              </Text>
            </View>
          )}

          {/* View button */}
          <TouchableOpacity style={[styles.viewButton, { backgroundColor: primaryColor }]} onPress={handleViewGroup} activeOpacity={0.8}>
            <Text style={styles.viewButtonText}>View Group</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    paddingBottom: 120, // Above the tab bar
    zIndex: 1000,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  card: {
    marginHorizontal: CARD_MARGIN,
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      web: {
        boxShadow: '0px 4px 20px rgba(0, 0, 0, 0.15)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 10,
        elevation: 8,
      },
    }),
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.15)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 4,
      },
    }),
  },
  imageContainer: {
    width: '100%',
    height: IMAGE_HEIGHT,
    backgroundColor: '#f0f0f0',
    position: 'relative',
  },
  imageScroll: {
    flex: 1,
  },
  image: {
    width: CARD_WIDTH,
    height: IMAGE_HEIGHT,
  },
  placeholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 48,
    fontWeight: '600',
    color: '#fff',
  },
  pagination: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  paginationDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  paginationDotActive: {
    backgroundColor: '#fff',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  typeBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  typeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoSection: {
    padding: 16,
  },
  groupName: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  infoText: {
    fontSize: 14,
    color: COLORS.textMuted,
    flex: 1,
  },
  viewButton: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  viewButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
