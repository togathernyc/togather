/**
 * EventLinkCard - Event card for chat messages
 *
 * Displays event details with RSVP functionality.
 * Fetches live event data using the shortId.
 */
import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet, ActivityIndicator, Platform, Dimensions, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO, isPast } from 'date-fns';
import { Avatar } from '@components/ui/Avatar';
import { AppImage } from '@components/ui/AppImage';
import { useQuery, useMutation, api, useStoredAuthToken } from '@services/api/convex';
import type { Id } from '@services/api/convex';
import { useRouter } from 'expo-router';
import { ImageViewerManager } from '@/providers/ImageViewerProvider';
import type { RsvpOption } from '../types';
import { handleImageLongPress, handleEventLongPress } from '../utils/imageActions';
import { getRsvpStatsForOption, hasPrefetchedRsvpOptions } from '../utils/rsvpStats';
import { DEFAULT_PRIMARY_COLOR } from '@utils/styles';
import { useTheme } from '@hooks/useTheme';
import type { PrefetchedEventData } from '../context/ChatPrefetchContext';
import {
  DEFAULT_MAX_GUESTS_PER_RSVP,
  GuestStepper,
  isGoingOptionLabel,
} from '@/features/events/components/EventRsvpSection';

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
  const { colors, isDark } = useTheme();
  const [loadingOptionId, setLoadingOptionId] = useState<number | null>(null);
  const token = useStoredAuthToken();

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

  const handleRsvp = async (optionId: number, guestCount: number = 0) => {
    if (event?.id && token) {
      setLoadingOptionId(optionId);
      try {
        await submitRsvpMutation({
          token,
          meetingId: event.id as Id<"meetings">,
          optionId,
          guestCount,
        });
      } finally {
        setLoadingOptionId(null);
      }
    }
  };

  // Inline update of guest count when the user is already "Going".
  // Serialized the same way as FloatingRsvpCard: at most one submit
  // in flight, newer taps stash the latest value and drain when the
  // current request settles. Prevents rapid taps from producing
  // out-of-order writes where an earlier request lands last and
  // overwrites the user's actual intent.
  const guestCountInFlightRef = useRef(false);
  const guestCountQueuedRef = useRef<number | null>(null);

  const handleGuestCountChange = (guestCount: number) => {
    if (!event?.id || !token || myRsvp?.optionId == null) return;

    if (guestCountInFlightRef.current) {
      guestCountQueuedRef.current = guestCount;
      return;
    }

    const run = (value: number) => {
      guestCountInFlightRef.current = true;
      const optionId = myRsvp?.optionId;
      if (optionId == null || !event?.id || !token) {
        guestCountInFlightRef.current = false;
        return;
      }
      submitRsvpMutation({
        token,
        meetingId: event.id as Id<"meetings">,
        optionId,
        guestCount: value,
      })
        .then(() => {
          guestCountInFlightRef.current = false;
          const queued = guestCountQueuedRef.current;
          guestCountQueuedRef.current = null;
          if (queued !== null && queued !== value) {
            run(queued);
          }
        })
        .catch(() => {
          guestCountInFlightRef.current = false;
          guestCountQueuedRef.current = null;
        });
    };

    run(guestCount);
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
          <Text style={[styles.remainingCount, { color: colors.textSecondary }]}>+{remainingCount}</Text>
        )}
      </View>
    );
  };

  // Progress bar component
  const ProgressBar = ({ percentage }: { percentage: number }) => (
    <View style={[styles.progressBarContainer, { backgroundColor: colors.borderLight }]}>
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

    // Re-tapping the currently selected option must preserve the user's
    // existing guestCount. Only clear guests when switching to a
    // different option. Without this, tapping Going while already Going
    // silently wipes any plus-ones they'd set via the stepper.
    const handlePress = () => {
      // Ignore taps while myRsvp is still hydrating — during that window
      // `isSelected` is false for every option, so any tap would take the
      // "clear guests" branch and silently erase plus-ones on an existing
      // Going RSVP. `myRsvp === undefined` means the query hasn't
      // resolved; `null` means "loaded, no RSVP yet".
      if (myRsvp === undefined) return;
      if (isSelected) {
        handleRsvp(option.id, myGuestCount);
      } else {
        handleRsvp(option.id, 0);
      }
    };

    return (
      <TouchableOpacity
        style={styles.rsvpRow}
        onPress={handlePress}
        disabled={false}
      >
        <View style={styles.rsvpHeader}>
          <View style={styles.rsvpLabelContainer}>
            {isLoading ? (
              <ActivityIndicator size="small" color={DEFAULT_PRIMARY_COLOR} style={{ width: 20, height: 20 }} />
            ) : (
              <View style={[
                styles.radioButton,
                { borderColor: colors.iconSecondary },
                isSelected && styles.radioButtonSelected
              ]}>
                {isSelected && <View style={styles.radioButtonInner} />}
              </View>
            )}
            <Text style={[styles.rsvpLabel, { color: colors.text }]}>
              {option.label} {emoji}
            </Text>
          </View>
          <View style={styles.rsvpStats}>
            <AvatarStack users={stats.users} />
            <Text style={[styles.rsvpCount, { color: colors.textSecondary }]}>{stats.count}</Text>
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
        <View style={[styles.container, { backgroundColor: isDark ? colors.surface : '#DCEEFF' }]}>
          {/* Skeleton cover image */}
          <View style={[styles.skeletonCoverImage, { backgroundColor: isDark ? colors.surfaceSecondary : '#E5E5E5' }]} />
          {/* Skeleton event info */}
          <View style={[styles.skeletonEventInfo, { borderBottomColor: colors.borderLight }]}>
            <View style={[styles.skeletonTitle, { backgroundColor: isDark ? colors.surfaceSecondary : '#E5E5E5' }]} />
            <View style={[styles.skeletonDate, { backgroundColor: isDark ? colors.surfaceSecondary : '#E5E5E5' }]} />
          </View>
          {/* Skeleton button */}
          <View style={[styles.skeletonButton, { borderTopColor: colors.borderLight }]}>
            <View style={[styles.skeletonButtonText, { backgroundColor: isDark ? colors.surfaceSecondary : '#E5E5E5' }]} />
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
        <View style={[styles.container, { backgroundColor: isDark ? colors.surface : '#DCEEFF' }]}>
          {/* Cover Image */}
          {event.displayCoverImage ? (
            <TouchableOpacity
              onPress={() => ImageViewerManager.show([event.displayCoverImage!], 0)}
              onLongPress={() => handleImageLongPress(event.displayCoverImage!)}
              activeOpacity={0.9}
            >
              <AppImage
                source={event.coverImage}
                style={[styles.coverImage, { backgroundColor: colors.surfaceSecondary }]}
                resizeMode="cover"
                placeholder={{ type: 'icon', icon: 'calendar-outline', iconSize: 48, iconColor: colors.iconSecondary }}
              />
            </TouchableOpacity>
          ) : (
            <View style={[styles.coverImagePlaceholder, { backgroundColor: colors.surfaceSecondary }]}>
              <Ionicons name="calendar" size={48} color={colors.iconSecondary} />
            </View>
          )}

          {/* Limited Event Info */}
          <View style={[styles.eventInfo, { borderBottomColor: colors.borderLight }]}>
            <Text style={[styles.eventTitle, { color: colors.text }]} numberOfLines={2}>
              {event.title || 'Event'}
            </Text>
            <Text style={[styles.eventDate, { color: colors.textSecondary }]}>
              {formatEventDate(event.scheduledAt)}
            </Text>
            <Text style={[styles.eventGroup, { color: colors.textSecondary }]}>
              {event.groupName}{event.communityName ? ` · ${event.communityName}` : ''}
            </Text>
          </View>

          {/* Access Prompt */}
          <View style={[styles.accessPromptSection, { backgroundColor: isDark ? colors.surfaceSecondary : '#F8F4FF', borderBottomColor: colors.borderLight }]}>
            <Ionicons name="lock-closed" size={20} color={DEFAULT_PRIMARY_COLOR} />
            <Text style={styles.accessPromptText}>{event.accessPrompt.message}</Text>
          </View>

          {/* View Details Button */}
          <TouchableOpacity
            style={[styles.viewDetailsButton, { borderTopColor: colors.borderLight }]}
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

  // Identify the currently-selected option (if any) to conditionally show
  // the plus-ones stepper underneath the RSVP list.
  const selectedOption = rsvpOptions.find((o) => o.id === myRsvp?.optionId) ?? null;
  const selectedIsGoing = selectedOption
    ? isGoingOptionLabel(selectedOption.label)
    : false;
  const maxGuests =
    ((eventData as any)?.maxGuestsPerRsvp as number | undefined) ??
    DEFAULT_MAX_GUESTS_PER_RSVP;
  const myGuestCount = (myRsvp as { guestCount?: number } | null | undefined)?.guestCount ?? 0;

  // Cancelled Overlay Component
  const CancelledOverlay = () => (
    <View style={[styles.cancelledOverlay, { backgroundColor: isDark ? 'rgba(0, 0, 0, 0.75)' : 'rgba(255, 255, 255, 0.85)' }]}>
      <View style={[styles.cancelledBadge, { backgroundColor: isDark ? '#450a0a' : '#FEF2F2', borderColor: isDark ? '#7f1d1d' : '#FECACA' }]}>
        <Ionicons name="close-circle" size={24} color={colors.error} />
        <Text style={[styles.cancelledText, { color: colors.error }]}>Event Cancelled</Text>
      </View>
    </View>
  );

  return (
    <Pressable
      style={[styles.bubbleContainer, !isMyMessage && styles.bubbleContainerLeft, embedded && styles.bubbleContainerEmbedded]}
      onLongPress={handleCardLongPress}
      delayLongPress={300}
    >
      <View style={[styles.container, { backgroundColor: isDark ? colors.surface : '#DCEEFF' }]}>
        {/* Cover Image */}
        {event.displayCoverImage ? (
          <TouchableOpacity
            onPress={() => ImageViewerManager.show([event.displayCoverImage!], 0)}
            onLongPress={() => handleImageLongPress(event.displayCoverImage!)}
            activeOpacity={0.9}
          >
            <AppImage
              source={event.coverImage}
              style={[styles.coverImage, { backgroundColor: colors.surfaceSecondary }]}
              resizeMode="cover"
              placeholder={{ type: 'icon', icon: 'calendar-outline', iconSize: 48, iconColor: colors.iconSecondary }}
            />
          </TouchableOpacity>
        ) : (
          <View style={[styles.coverImagePlaceholder, { backgroundColor: colors.surfaceSecondary }]}>
            <Ionicons name="calendar" size={48} color={colors.iconSecondary} />
          </View>
        )}

        {/* Event Info */}
        <View style={[styles.eventInfo, { borderBottomColor: colors.borderLight }]}>
          <Text style={[styles.eventTitle, { color: colors.text }, isCancelled && { textDecorationLine: 'line-through', color: colors.textTertiary }]} numberOfLines={2}>
            {event.title || 'Event'}
          </Text>
          <Text style={[styles.eventDate, { color: colors.textSecondary }]}>
            {formatEventDate(event.scheduledAt)}
          </Text>
          {isPastEvent && !isCancelled && (
            <View style={[styles.pastEventBadge, { backgroundColor: colors.surfaceSecondary }]}>
              <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
              <Text style={[styles.pastEventText, { color: colors.textSecondary }]}>Past Event</Text>
            </View>
          )}
          {location && (
            <Text style={[styles.eventLocation, { color: colors.textSecondary }]}>
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
                <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading RSVPs...</Text>
              </View>
            ) : (
              <>
                {rsvpOptions.map((option) => (
                  <RsvpOptionRow key={option.id} option={option} />
                ))}
                {selectedIsGoing && (
                  <View style={[styles.guestStepperRow, { borderTopColor: colors.borderLight }]}>
                    <GuestStepper
                      value={myGuestCount}
                      onChange={handleGuestCountChange}
                      max={maxGuests}
                      label={myGuestCount === 0 ? "Bringing guests?" : "Guests"}
                      compact
                    />
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {/* View Details Button */}
        <TouchableOpacity
          style={[styles.viewDetailsButton, { borderTopColor: colors.borderLight }]}
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
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  coverImagePlaceholder: {
    width: '100%',
    aspectRatio: 16 / 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  eventInfo: {
    padding: 16,
    borderBottomWidth: 1,
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  eventDate: {
    fontSize: 14,
    marginBottom: 4,
  },
  eventLocation: {
    fontSize: 14,
  },
  eventGroup: {
    fontSize: 14,
    marginTop: 4,
  },
  accessPromptSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 16,
    borderBottomWidth: 1,
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
  guestStepperRow: {
    paddingTop: 12,
    borderTopWidth: 1,
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
    fontWeight: '600',
    marginLeft: 4,
  },
  rsvpCount: {
    fontSize: 14,
    fontWeight: '600',
    minWidth: 20,
    textAlign: 'right',
  },
  progressBarContainer: {
    height: 6,
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
    alignItems: 'center',
  },
  viewDetailsText: {
    fontSize: 15,
    color: DEFAULT_PRIMARY_COLOR,
    fontWeight: '600',
  },
  cancelledOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  cancelledBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  cancelledText: {
    fontSize: 16,
    fontWeight: '600',
  },
  pastEventBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  pastEventText: {
    fontSize: 12,
    fontWeight: '500',
  },
  // Skeleton loading styles
  skeletonCoverImage: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  skeletonEventInfo: {
    padding: 16,
    gap: 8,
    borderBottomWidth: 1,
  },
  skeletonTitle: {
    height: 20,
    width: '80%',
    borderRadius: 4,
  },
  skeletonDate: {
    height: 16,
    width: '60%',
    borderRadius: 4,
  },
  skeletonButton: {
    padding: 16,
    borderTopWidth: 1,
    alignItems: 'center',
  },
  skeletonButtonText: {
    height: 16,
    width: 100,
    borderRadius: 4,
  },
});
