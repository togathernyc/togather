/**
 * EventLinkCard - Event card for chat messages
 *
 * Displays event details with RSVP functionality.
 * Fetches live event data using the shortId.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet, ActivityIndicator, Platform, Dimensions, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO, isPast } from 'date-fns';
import { useAuth } from '@providers/AuthProvider';
import { Avatar } from '@components/ui/Avatar';
import { AppImage } from '@components/ui/AppImage';
import { useQuery, useMutation, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';
import { useRouter } from 'expo-router';
import { ImageViewerManager } from '@/providers/ImageViewerProvider';
import type { RsvpOption } from '../types';
import { handleImageLongPress, handleEventLongPress } from '../utils/imageActions';
import { getRsvpStatsForOption, hasPrefetchedRsvpOptions } from '../utils/rsvpStats';
import { DEFAULT_PRIMARY_COLOR } from '@utils/styles';
import type { PrefetchedEventData } from '../context/ChatPrefetchContext';

interface EventLinkCardProps {
  shortId: string;
  isMyMessage?: boolean;
  /** When true, removes self-alignment and margins (for use inside MessageItem) */
  embedded?: boolean;
  /** Prefetched event data (optional) - skips network fetch if provided */
  prefetchedData?: PrefetchedEventData | null;
}

interface RsvpUser {
  id: string;
  firstName: string;
  lastName: string;
  profileImage?: string | null;
}

const EMOJI_MAP: Record<string, string> = {
  'Going': '👍',
  'Maybe': '🤔',
  "Can't Go": '😢',
  'Not Going': '😢',
};

export function EventLinkCard({ shortId, isMyMessage = true, embedded = false, prefetchedData }: EventLinkCardProps) {
  const router = useRouter();
  const [loadingOptionId, setLoadingOptionId] = useState<number | null>(null);
  const { token } = useAuth();

  // Skip network fetch only when prefetched data includes RSVP options.
  // This protects against partial prefetched payloads that would hide RSVP rows.
  const shouldSkipQuery = hasPrefetchedRsvpOptions(prefetchedData);

  // Fetch event by short ID using Convex (skip if prefetched)
  const fetchedEventData = useQuery(
    api.functions.meetings.index.getByShortId,
    shouldSkipQuery ? "skip" : (token ? { shortId, token } : { shortId })
  );

  // Prefer prefetched data only when it's complete enough for card rendering.
  const eventData = shouldSkipQuery ? prefetchedData : fetchedEventData;
  const isLoading = !shouldSkipQuery && fetchedEventData === undefined;
  const error = eventData === null;

  // Normalize the event data to a common structure
  const event = React.useMemo(() => {
    if (!eventData) return null;

    // Cast to access the full properties (they exist when hasAccess is true)
    const data = eventData as any;
    return {
      id: data.id,
      shortId: data.shortId,
      title: data.title,
      scheduledAt: data.scheduledAt,
      coverImage: data.coverImage as string | null,
      displayCoverImage: data.coverImage as string | null,
      locationOverride: data.locationOverride as string | undefined,
      meetingLink: data.meetingLink as string | undefined,
      meetingType: data.meetingType as number | undefined,
      rsvpEnabled: data.rsvpEnabled as boolean | undefined,
      rsvpOptions: data.rsvpOptions as RsvpOption[] | undefined,
      groupId: data.groupId as string | undefined,
      groupName: data.groupName,
      communityName: data.communityName,
      hasAccess: data.hasAccess,
      accessPrompt: data.accessPrompt,
      status: data.status as string | undefined,
      cancellationReason: data.cancellationReason as string | undefined,
    };
  }, [eventData]);

  const isCancelled = event?.status === 'cancelled';
  const isPastEvent = event?.scheduledAt ? isPast(parseISO(event.scheduledAt)) : false;

  // Fetch RSVPs if user has access using Convex
  // Pass token if available to get full access (if user has RSVPed)
  const rsvpData = useQuery(
    api.functions.meetingRsvps.list,
    event?.id && event?.hasAccess === true ? { meetingId: event.id, token: token ?? undefined } : "skip"
  );
  const rsvpsLoading = rsvpData === undefined && event?.id && event?.hasAccess === true;

  // Fetch current user's RSVP if user has access using Convex
  const myRsvp = useQuery(
    api.functions.meetingRsvps.myRsvp,
    event?.id && event?.hasAccess === true && token ? { meetingId: event.id, token } : "skip"
  );

  // Submit RSVP mutation using Convex
  const submitRsvpMutation = useMutation(api.functions.meetingRsvps.submit);

  // Note: We use a fixed 16:9 aspect ratio for the cover image to prevent layout shifts.
  // Previously we calculated the actual image ratio, but this caused content to jump
  // when the image loaded. Using a consistent aspect ratio is better UX.

  const handleRsvp = async (optionId: number) => {
    if (event?.id && token) {
      setLoadingOptionId(optionId);
      try {
        await submitRsvpMutation({ token, meetingId: event.id as Id<"meetings">, optionId });
      } finally {
        setLoadingOptionId(null);
      }
    }
  };

  const handleViewDetails = () => {
    const eventShortId = event?.shortId || shortId;
    if (!eventShortId) {
      Alert.alert('Error', 'This event is missing a share link.');
      return;
    }
    router.push(`/e/${eventShortId}?source=app`);
  };

  const handleCardLongPress = () => {
    const eventShortId = event?.shortId || shortId;
    if (eventShortId) {
      handleEventLongPress(eventShortId, event?.title || 'Event');
    }
  };

  // Format date
  const formatEventDate = (dateString: string | undefined): string => {
    if (!dateString) return '';
    try {
      const date = parseISO(dateString);
      return format(date, "EEE, MMM d 'at' h:mm a");
    } catch {
      return dateString;
    }
  };

  // Get location display
  const getLocationDisplay = (): { icon: string; text: string } | null => {
    if (!event) return null;

    if (event.meetingType === 2) {
      return { icon: '🔗', text: 'Online' };
    }
    if (event.locationOverride) {
      return { icon: '📍', text: event.locationOverride };
    }
    return null;
  };

  const location = getLocationDisplay();

  // Calculate RSVP counts and percentages
  const getRsvpStats = (optionId: number): { users: RsvpUser[]; count: number; percentage: number } => {
    const stats = getRsvpStatsForOption(rsvpData, optionId);
    return {
      users: stats.users as RsvpUser[],
      count: stats.count,
      percentage: stats.percentage,
    };
  };

  // Avatar stack component
  const AvatarStack = ({ users }: { users: RsvpUser[] }) => {
    if (users.length === 0) return null;

    const displayUsers = users.slice(0, 3);
    const remainingCount = users.length - 3;

    return (
      <View style={styles.avatarStack}>
        {displayUsers.map((user, i) => (
          <Avatar
            key={user.id}
            name={`${user.firstName} ${user.lastName}`}
            imageUrl={user.profileImage ?? null}
            size={24}
            style={{ marginLeft: i > 0 ? -8 : 0 }}
          />
        ))}
        {remainingCount > 0 && (
          <Text style={styles.remainingCount}>+{remainingCount}</Text>
        )}
      </View>
    );
  };

  // Progress bar component
  const ProgressBar = ({ percentage }: { percentage: number }) => (
    <View style={styles.progressBarContainer}>
      <View style={[styles.progressBar, { width: `${percentage}%` }]} />
    </View>
  );

  // RSVP option row
  const RsvpOptionRow = ({ option }: { option: RsvpOption }) => {
    if (!option.enabled) return null;

    const stats = getRsvpStats(option.id);
    const isSelected = myRsvp?.optionId === option.id;
    const isLoading = loadingOptionId === option.id;
    const emoji = EMOJI_MAP[option.label] || '';

    return (
      <TouchableOpacity
        style={styles.rsvpRow}
        onPress={() => handleRsvp(option.id)}
        disabled={false}
      >
        <View style={styles.rsvpHeader}>
          <View style={styles.rsvpLabelContainer}>
            {isLoading ? (
              <ActivityIndicator size="small" color={DEFAULT_PRIMARY_COLOR} style={{ width: 20, height: 20 }} />
            ) : (
              <View style={[
                styles.radioButton,
                isSelected && styles.radioButtonSelected
              ]}>
                {isSelected && <View style={styles.radioButtonInner} />}
              </View>
            )}
            <Text style={styles.rsvpLabel}>
              {option.label} {emoji}
            </Text>
          </View>
          <View style={styles.rsvpStats}>
            <AvatarStack users={stats.users} />
            <Text style={styles.rsvpCount}>{stats.count}</Text>
          </View>
        </View>
        <ProgressBar percentage={stats.percentage} />
      </TouchableOpacity>
    );
  };

  // Loading state - show skeleton with fixed dimensions to prevent layout jumps
  if (isLoading) {
    return (
      <View style={[styles.bubbleContainer, !isMyMessage && styles.bubbleContainerLeft, embedded && styles.bubbleContainerEmbedded]}>
        <View style={styles.container}>
          {/* Skeleton cover image */}
          <View style={styles.skeletonCoverImage} />
          {/* Skeleton event info */}
          <View style={styles.skeletonEventInfo}>
            <View style={styles.skeletonTitle} />
            <View style={styles.skeletonDate} />
          </View>
          {/* Skeleton button */}
          <View style={styles.skeletonButton}>
            <View style={styles.skeletonButtonText} />
          </View>
        </View>
      </View>
    );
  }

  // Error state - hide the card
  if (error || !event) {
    return null;
  }

  // Access denied state - show limited preview
  if (!event.hasAccess && event.accessPrompt) {
    return (
      <Pressable
        style={[styles.bubbleContainer, !isMyMessage && styles.bubbleContainerLeft, embedded && styles.bubbleContainerEmbedded]}
        onLongPress={handleCardLongPress}
        delayLongPress={300}
      >
        <View style={styles.container}>
          {/* Cover Image */}
          {event.displayCoverImage ? (
            <TouchableOpacity
              onPress={() => ImageViewerManager.show([event.displayCoverImage!], 0)}
              onLongPress={() => handleImageLongPress(event.displayCoverImage!)}
              activeOpacity={0.9}
            >
              <AppImage
                source={event.coverImage}
                style={styles.coverImage}
                resizeMode="cover"
                placeholder={{ type: 'icon', icon: 'calendar-outline', iconSize: 48, iconColor: '#ccc' }}
              />
            </TouchableOpacity>
          ) : (
            <View style={styles.coverImagePlaceholder}>
              <Ionicons name="calendar" size={48} color="#ccc" />
            </View>
          )}

          {/* Limited Event Info */}
          <View style={styles.eventInfo}>
            <Text style={styles.eventTitle} numberOfLines={2}>
              {event.title || 'Event'}
            </Text>
            <Text style={styles.eventDate}>
              {formatEventDate(event.scheduledAt)}
            </Text>
            <Text style={styles.eventGroup}>
              {event.groupName}{event.communityName ? ` · ${event.communityName}` : ''}
            </Text>
          </View>

          {/* Access Prompt */}
          <View style={styles.accessPromptSection}>
            <Ionicons name="lock-closed" size={20} color={DEFAULT_PRIMARY_COLOR} />
            <Text style={styles.accessPromptText}>{event.accessPrompt.message}</Text>
          </View>

          {/* View Details Button */}
          <TouchableOpacity
            style={styles.viewDetailsButton}
            onPress={handleViewDetails}
          >
            <Text style={styles.viewDetailsText}>View Details</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    );
  }

  // Full access - show complete event card
  const rsvpOptions = event.rsvpOptions || [];

  // Cancelled Overlay Component
  const CancelledOverlay = () => (
    <View style={styles.cancelledOverlay}>
      <View style={styles.cancelledBadge}>
        <Ionicons name="close-circle" size={24} color="#DC2626" />
        <Text style={styles.cancelledText}>Event Cancelled</Text>
      </View>
    </View>
  );

  return (
    <Pressable
      style={[styles.bubbleContainer, !isMyMessage && styles.bubbleContainerLeft, embedded && styles.bubbleContainerEmbedded]}
      onLongPress={handleCardLongPress}
      delayLongPress={300}
    >
      <View style={styles.container}>
        {/* Cover Image */}
        {event.displayCoverImage ? (
          <TouchableOpacity
            onPress={() => ImageViewerManager.show([event.displayCoverImage!], 0)}
            onLongPress={() => handleImageLongPress(event.displayCoverImage!)}
            activeOpacity={0.9}
          >
            <AppImage
              source={event.coverImage}
              style={styles.coverImage}
              resizeMode="cover"
              placeholder={{ type: 'icon', icon: 'calendar-outline', iconSize: 48, iconColor: '#ccc' }}
            />
          </TouchableOpacity>
        ) : (
          <View style={styles.coverImagePlaceholder}>
            <Ionicons name="calendar" size={48} color="#ccc" />
          </View>
        )}

        {/* Event Info */}
        <View style={styles.eventInfo}>
          <Text style={[styles.eventTitle, isCancelled && styles.cancelledTitle]} numberOfLines={2}>
            {event.title || 'Event'}
          </Text>
          <Text style={styles.eventDate}>
            {formatEventDate(event.scheduledAt)}
          </Text>
          {isPastEvent && !isCancelled && (
            <View style={styles.pastEventBadge}>
              <Ionicons name="time-outline" size={14} color="#6B7280" />
              <Text style={styles.pastEventText}>Past Event</Text>
            </View>
          )}
          {location && (
            <Text style={styles.eventLocation}>
              {location.icon} {location.text}
            </Text>
          )}
        </View>

        {/* RSVP Options - hide when cancelled or past */}
        {!isCancelled && !isPastEvent && event.rsvpEnabled && rsvpOptions.length > 0 && (
          <View style={styles.rsvpSection}>
            {rsvpsLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={DEFAULT_PRIMARY_COLOR} />
                <Text style={styles.loadingText}>Loading RSVPs...</Text>
              </View>
            ) : (
              rsvpOptions.map((option) => (
                <RsvpOptionRow key={option.id} option={option} />
              ))
            )}
          </View>
        )}

        {/* View Details Button */}
        <TouchableOpacity
          style={styles.viewDetailsButton}
          onPress={handleViewDetails}
        >
          <Text style={styles.viewDetailsText}>View Details</Text>
        </TouchableOpacity>

        {/* Cancelled Overlay */}
        {isCancelled && <CancelledOverlay />}
      </View>
    </Pressable>
  );
}

// Calculate max width in pixels since percentage-based maxWidth doesn't work
// when parent containers (from Stream Chat) don't have explicit width constraints
const BUBBLE_MAX_WIDTH = Dimensions.get('window').width * 0.8;

const styles = StyleSheet.create({
  bubbleContainer: {
    maxWidth: BUBBLE_MAX_WIDTH,
    alignSelf: 'flex-end',
    marginVertical: 4,
    marginRight: 4,
  },
  bubbleContainerLeft: {
    alignSelf: 'flex-start',
    marginRight: 0,
    marginLeft: 4,
  },
  bubbleContainerEmbedded: {
    maxWidth: '100%',
    alignSelf: 'stretch',
    marginVertical: 0,
    marginRight: 0,
    marginLeft: 0,
  },
  container: {
    backgroundColor: '#DCEEFF',
    borderRadius: 12,
    overflow: 'hidden',
    width: '100%',
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.1)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 3,
      },
    }),
  },
  coverImage: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#f5f5f5',
    // Apply border radius directly to image for proper clipping
    // (overflow: hidden on parent doesn't always clip correctly in RN)
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  coverImagePlaceholder: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    // Match image border radius for consistency
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  eventInfo: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  eventDate: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  eventLocation: {
    fontSize: 14,
    color: '#666',
  },
  eventGroup: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  accessPromptSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 16,
    backgroundColor: '#F8F4FF',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  accessPromptText: {
    flex: 1,
    fontSize: 14,
    color: DEFAULT_PRIMARY_COLOR,
    fontWeight: '500',
  },
  rsvpSection: {
    padding: 16,
    gap: 12,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: '#666',
  },
  rsvpRow: {
    gap: 8,
    width: '100%',
  },
  rsvpHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    width: '100%',
  },
  rsvpLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  radioButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#ccc',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioButtonSelected: {
    borderColor: DEFAULT_PRIMARY_COLOR,
  },
  radioButtonInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: DEFAULT_PRIMARY_COLOR,
  },
  rsvpLabel: {
    fontSize: 15,
    color: '#333',
    fontWeight: '500',
  },
  rsvpStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  remainingCount: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
    marginLeft: 4,
  },
  rsvpCount: {
    fontSize: 14,
    color: '#666',
    fontWeight: '600',
    minWidth: 20,
    textAlign: 'right',
  },
  progressBarContainer: {
    height: 6,
    backgroundColor: '#f0f0f0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    borderRadius: 3,
  },
  viewDetailsButton: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    alignItems: 'center',
  },
  viewDetailsText: {
    fontSize: 15,
    color: DEFAULT_PRIMARY_COLOR,
    fontWeight: '600',
  },
  cancelledOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  cancelledBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  cancelledText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#DC2626',
  },
  cancelledTitle: {
    textDecorationLine: 'line-through',
    color: '#999',
  },
  pastEventBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  pastEventText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  // Skeleton loading styles
  skeletonCoverImage: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#E5E5E5',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  skeletonEventInfo: {
    padding: 16,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  skeletonTitle: {
    height: 20,
    width: '80%',
    backgroundColor: '#E5E5E5',
    borderRadius: 4,
  },
  skeletonDate: {
    height: 16,
    width: '60%',
    backgroundColor: '#E5E5E5',
    borderRadius: 4,
  },
  skeletonButton: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    alignItems: 'center',
  },
  skeletonButtonText: {
    height: 16,
    width: 100,
    backgroundColor: '#E5E5E5',
    borderRadius: 4,
  },
});
