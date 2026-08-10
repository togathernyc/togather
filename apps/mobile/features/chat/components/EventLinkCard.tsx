/**
 * EventLinkCard - Event card for chat messages
 *
 * Displays event details with RSVP functionality.
 * Fetches live event data using the shortId.
 */
import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet, ActivityIndicator, Platform, Dimensions, Alert, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO, isPast } from 'date-fns';
import { Avatar } from '@components/ui/Avatar';
import { AppImage } from '@components/ui/AppImage';
import { getMediaUrl } from '@/utils/media';
import { useQuery, useMutation, api, useStoredAuthToken } from '@services/api/convex';
import type { Id } from '@services/api/convex';
import { useRouter } from 'expo-router';
import { ImageViewerManager } from '@/providers/ImageViewerProvider';
import type { RsvpOption } from '../types';
import { handleImageLongPress, handleEventLongPress, copyEventLink } from '../utils/imageActions';
import { getRsvpStatsForOption, hasPrefetchedRsvpOptions } from '../utils/rsvpStats';
import { DEFAULT_PRIMARY_COLOR } from '@utils/styles';
import { useTheme } from '@hooks/useTheme';
import type { PrefetchedEventData } from '../context/ChatPrefetchContext';
import {
  DEFAULT_MAX_GUESTS_PER_RSVP,
  GuestStepper,
  isGoingRsvpOption,
} from '@/features/events/components/EventRsvpSection';
import {
  WA_CARD_COVER_ASPECT,
  WA_CARD_PADDING,
  WA_CARD_PILL_FILL_DARK,
  WA_CARD_PILL_FILL_LIGHT,
  WA_CARD_PILL_HEIGHT,
  WA_CARD_PILL_RADIUS,
  WA_CARD_PILL_SELECTED_ALPHA,
  WA_CARD_SHADOW_WEB,
  WA_BUBBLE_SHADOW,
} from '../waChatChrome';
import { hexToRgb } from '@utils/waPalette';

/**
 * WhatsApp-shell dressing for the card, supplied by `MessageItem` **only when
 * `whatsappShellEnabled` is true** — the same "parent owns the flag, child
 * owns the anatomy" split `ReplyQuoteBlock` uses. Its presence *is* the flag:
 * when it's absent every branch below renders exactly the pre-WhatsApp card.
 *
 * The two colors can't be derived in here: `bubbleFill` depends on the
 * community's brand tint (outgoing) vs. the theme's incoming white, both of
 * which `MessageItem` has already computed for the message's own bubble, and
 * reusing them is what makes the card read as *that same bubble*.
 */
export interface WaEventCardTheme {
  /** §1.3 dark-mode-adjusted brand accent: pill ink, footer links. */
  accent: string;
  /** §1.6 bubble fill for this message's direction (mint out / white in). */
  bubbleFill: string;
}

interface EventLinkCardProps {
  shortId: string;
  isMyMessage?: boolean;
  /** When true, removes self-alignment and margins (for use inside MessageItem) */
  embedded?: boolean;
  /** Prefetched event data (optional) - skips network fetch if provided */
  prefetchedData?: PrefetchedEventData | null;
  /** WhatsApp-shell dressing; omitted (flag-off) renders the legacy card. */
  wa?: WaEventCardTheme | null;
}

/** Pale accent wash for the §1.6 selected RSVP pill. */
function waSelectedPillFill(accent: string): string {
  const rgb = hexToRgb(accent);
  if (!rgb) return WA_CARD_PILL_FILL_LIGHT;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${WA_CARD_PILL_SELECTED_ALPHA})`;
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

export function EventLinkCard({ shortId, isMyMessage = true, embedded = false, prefetchedData, wa }: EventLinkCardProps) {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  // §7: flag-on, the card *is* a bubble — it takes the message's own fill and
  // the brand accent for its interactive ink. Flag-off, `wa` is undefined and
  // every `waShell &&` below collapses to the original tree.
  const waShell = !!wa;
  const waAccent = wa?.accent ?? DEFAULT_PRIMARY_COLOR;
  const waCardFill = wa?.bubbleFill;
  const waPillFill = isDark ? WA_CARD_PILL_FILL_DARK : WA_CARD_PILL_FILL_LIGHT;
  const waPillSelectedFill = waSelectedPillFill(waAccent);
  // Flag-off keeps the pale-blue tinted panel; flag-on takes the bubble fill
  // so the card is indistinguishable from the message bubbles around it.
  const cardFill = waCardFill ?? (isDark ? colors.surface : '#DCEEFF');
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
      hideRsvpCount: data.hideRsvpCount === true,
      viewerIsLeader: data.viewerIsLeader === true,
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

  // Render the cover image in its natural aspect ratio so portrait/square
  // posters aren't cropped. Default to 1:1 while loading; once Image.getSize
  // resolves, switch to the real ratio. The brief layout shift is preferable
  // to permanently cropping the top/bottom of the artwork.
  const coverImagePath = (eventData as { coverImage?: string | null } | null | undefined)?.coverImage ?? null;
  const [coverAspectRatio, setCoverAspectRatio] = useState(1);
  useEffect(() => {
    // Reset to the 1:1 fallback whenever the cover source changes so a new
    // image is never laid out with the previous image's ratio while
    // Image.getSize is in flight (or if it fails for the new URL).
    setCoverAspectRatio(1);
    if (!coverImagePath) return;
    const url = getMediaUrl(coverImagePath);
    if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) return;
    let cancelled = false;
    Image.getSize(
      url,
      (w, h) => {
        if (!cancelled && w > 0 && h > 0) setCoverAspectRatio(w / h);
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [coverImagePath]);

  // Unified submit queue shared by BOTH the option-change handler and the
  // guest-stepper handler. Previously each handler had its own in-flight
  // ref, which meant a stepper write in flight could race an option change
  // (or vice versa): whichever response landed last would overwrite the
  // other, potentially flipping a user back to Going after they picked
  // Maybe. One queue fixes the cross-handler race — at most one
  // meetingRsvps.submit request is in flight, and newer intents (of any
  // kind) replace whatever's queued.
  const submitInFlightRef = useRef(false);
  const submitQueuedRef = useRef<{ optionId: number; guestCount: number } | null>(null);
  // Local optimistic guest count so the stepper advances immediately on
  // tap, even while writes are in flight. Without this, GuestStepper reads
  // `myGuestCount` from the query, which is stale until the request lands
  // — rapid taps would compute 0→1 twice instead of 0→1→2, and the queue's
  // dedupe would then drop the second tap.
  const [pendingGuestCount, setPendingGuestCount] = useState<number | null>(null);

  // Clear optimistic pending value once the reactive query has caught up.
  // Must run unconditionally (before any early returns) to satisfy
  // react-hooks/rules-of-hooks.
  const myRsvpGuestCount =
    (myRsvp as { guestCount?: number } | null | undefined)?.guestCount ?? 0;
  useEffect(() => {
    if (pendingGuestCount !== null && pendingGuestCount === myRsvpGuestCount) {
      setPendingGuestCount(null);
    }
  }, [myRsvpGuestCount, pendingGuestCount]);

  const submitRsvp = (optionId: number, guestCount: number): Promise<void> => {
    if (!event?.id || !token) return Promise.resolve();

    if (submitInFlightRef.current) {
      submitQueuedRef.current = { optionId, guestCount };
      return Promise.resolve();
    }

    const run = (value: { optionId: number; guestCount: number }): Promise<void> => {
      submitInFlightRef.current = true;
      if (!event?.id || !token) {
        submitInFlightRef.current = false;
        return Promise.resolve();
      }
      return submitRsvpMutation({
        token,
        meetingId: event.id as Id<"meetings">,
        optionId: value.optionId,
        guestCount: value.guestCount,
      })
        .then(() => {
          submitInFlightRef.current = false;
          const queued = submitQueuedRef.current;
          submitQueuedRef.current = null;
          if (
            queued &&
            (queued.optionId !== value.optionId ||
              queued.guestCount !== value.guestCount)
          ) {
            return run(queued);
          }
          return undefined;
        })
        .catch(() => {
          submitInFlightRef.current = false;
          submitQueuedRef.current = null;
          setPendingGuestCount(null);
        });
    };

    return run({ optionId, guestCount });
  };

  const handleRsvp = async (optionId: number, guestCount: number = 0) => {
    if (!event?.id || !token) return;
    setLoadingOptionId(optionId);
    // Switching option invalidates any optimistic stepper state — reset
    // so the UI snaps to the fresh query result instead of showing a
    // stale pending value.
    setPendingGuestCount(null);
    try {
      await submitRsvp(optionId, guestCount);
    } finally {
      setLoadingOptionId(null);
    }
  };

  const handleGuestCountChange = (guestCount: number) => {
    if (!event?.id || !token || myRsvp?.optionId == null) return;
    setPendingGuestCount(guestCount);
    void submitRsvp(myRsvp.optionId, guestCount);
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

  const [linkCopied, setLinkCopied] = useState(false);
  const handleCopyLink = async () => {
    const eventShortId = event?.shortId || shortId;
    if (!eventShortId) {
      Alert.alert('Error', 'This event is missing a share link.');
      return;
    }
    await copyEventLink(eventShortId);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  // Format date
  const formatEventDate = (dateString: string | undefined): string => {
    if (!dateString) return '';
    try {
      const date = parseISO(dateString);
      // Flag-on uses WhatsApp's middot separator on the preview's meta line
      // ("Fri, Jul 31 · 12:31 AM") — shorter, and it matches the middot the
      // rest of the WA surfaces already use to join metadata.
      return format(date, waShell ? 'EEE, MMM d · h:mm a' : "EEE, MMM d 'at' h:mm a");
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

  // Avatar stack component. When the RSVP count is private (hidden from
  // non-leaders), render "+ more" instead of a numeric overflow so we don't
  // leak the headcount through the stack.
  const AvatarStack = ({ users, hideOverflowCount }: { users: RsvpUser[]; hideOverflowCount?: boolean }) => {
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
          <Text style={[styles.remainingCount, { color: colors.textSecondary }]}>
            {hideOverflowCount ? 'and more' : `+${remainingCount}`}
          </Text>
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

  // Whether the numeric RSVP count should be suppressed for this viewer.
  // Avatars stay visible either way so there's still some social proof.
  const countIsHidden = !!event?.hideRsvpCount && !event?.viewerIsLeader;
  const showLeaderBadge = !!event?.hideRsvpCount && !!event?.viewerIsLeader;

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
        handleRsvp(option.id, displayedGuestCount);
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
            <AvatarStack users={stats.users} hideOverflowCount={countIsHidden} />
            {!countIsHidden && (
              <Text style={[styles.rsvpCount, { color: colors.textSecondary }]}>{stats.count}</Text>
            )}
          </View>
        </View>
        {!countIsHidden && <ProgressBar percentage={stats.percentage} />}
      </TouchableOpacity>
    );
  };

  /**
   * §7 flag-on RSVP affordance: the three options collapse from three
   * full-height radio rows (radio + label + avatar stack + progress bar,
   * ~46pt each) into ONE 32pt chips row. Same `handlePress` semantics as
   * `RsvpOptionRow` — including the "re-tapping the selected option keeps my
   * guests" rule — so the mutation behaviour is untouched; only the anatomy
   * changes. Counts ride inline in the label when non-zero, which is what
   * buys back the avatar stack's vertical space.
   */
  const WaRsvpPill = ({ option }: { option: RsvpOption }) => {
    if (!option.enabled) return null;

    const stats = getRsvpStats(option.id);
    const isSelected = myRsvp?.optionId === option.id;
    const isOptionLoading = loadingOptionId === option.id;
    const emoji = EMOJI_MAP[option.label] || '';
    const showCount = !countIsHidden && stats.count > 0;

    const handlePress = () => {
      if (myRsvp === undefined) return;
      handleRsvp(option.id, isSelected ? displayedGuestCount : 0);
    };

    return (
      <TouchableOpacity
        style={[
          styles.waRsvpPill,
          { backgroundColor: isSelected ? waPillSelectedFill : waPillFill },
        ]}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
        testID={`wa-rsvp-pill-${option.id}`}
      >
        {isOptionLoading ? (
          <ActivityIndicator size="small" color={waAccent} />
        ) : (
          <Text
            numberOfLines={1}
            style={[
              styles.waRsvpPillLabel,
              // §1.6 selected chip: pale tint + accent ink, never accent-filled.
              { color: isSelected ? waAccent : colors.text },
            ]}
          >
            {option.label}
            {emoji ? ` ${emoji}` : ''}
            {showCount ? ` ${stats.count}` : ''}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  // Loading state - show skeleton with fixed dimensions to prevent layout jumps
  if (isLoading) {
    return (
      <View style={[styles.bubbleContainer, !isMyMessage && styles.bubbleContainerLeft, embedded && styles.bubbleContainerEmbedded]}>
        <View style={[styles.container, waShell && styles.waContainer, { backgroundColor: cardFill }]}>
          {/* Skeleton cover image */}
          <View style={[styles.skeletonCoverImage, waShell && styles.waCoverImage, { backgroundColor: isDark ? colors.surfaceSecondary : '#E5E5E5' }]} />
          {/* Skeleton event info */}
          <View style={[styles.skeletonEventInfo, waShell && styles.waEventInfo, { borderBottomColor: colors.borderLight }]}>
            <View style={[styles.skeletonTitle, { backgroundColor: isDark ? colors.surfaceSecondary : '#E5E5E5' }]} />
            <View style={[styles.skeletonDate, { backgroundColor: isDark ? colors.surfaceSecondary : '#E5E5E5' }]} />
          </View>
          {/* Skeleton button */}
          <View style={[styles.skeletonButton, waShell && styles.waFooterRow, { borderTopColor: colors.borderLight }]}>
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
        <View style={[styles.container, waShell && styles.waContainer, { backgroundColor: cardFill }]}>
          {/* Cover Image */}
          {event.displayCoverImage ? (
            <TouchableOpacity
              onPress={() => ImageViewerManager.show([event.displayCoverImage!], 0)}
              onLongPress={() => handleImageLongPress(event.displayCoverImage!)}
              activeOpacity={0.9}
            >
              <AppImage
                source={event.coverImage}
                style={[styles.coverImage, { backgroundColor: colors.surfaceSecondary, aspectRatio: waShell ? WA_CARD_COVER_ASPECT : coverAspectRatio }]}
                resizeMode="cover"
                placeholder={{ type: 'icon', icon: 'calendar-outline', iconSize: 48, iconColor: colors.iconSecondary }}
              />
            </TouchableOpacity>
          ) : (
            <View style={[styles.coverImagePlaceholder, waShell && styles.waCoverImage, { backgroundColor: colors.surfaceSecondary }]}>
              <Ionicons name="calendar" size={48} color={colors.iconSecondary} />
            </View>
          )}

          {/* Limited Event Info */}
          <View style={[styles.eventInfo, waShell && styles.waEventInfo, { borderBottomColor: colors.borderLight }]}>
            <Text style={[styles.eventTitle, waShell && styles.waEventTitle, { color: colors.text }]} numberOfLines={2}>
              {event.title || 'Event'}
            </Text>
            <Text style={[styles.eventDate, waShell && styles.waEventMeta, { color: colors.textSecondary }]}>
              {formatEventDate(event.scheduledAt)}
            </Text>
            <Text style={[styles.eventGroup, waShell && styles.waEventMeta, { color: colors.textSecondary }]}>
              {event.groupName}{event.communityName ? ` · ${event.communityName}` : ''}
            </Text>
          </View>

          {/* Access Prompt */}
          <View style={[styles.accessPromptSection, waShell && styles.waAccessPromptSection, { backgroundColor: isDark ? colors.surfaceSecondary : '#F8F4FF', borderBottomColor: colors.borderLight }]}>
            <Ionicons name="lock-closed" size={20} color={waShell ? waAccent : DEFAULT_PRIMARY_COLOR} />
            <Text style={[styles.accessPromptText, waShell && styles.waAccessPromptText, waShell && { color: waAccent }]}>{event.accessPrompt.message}</Text>
          </View>

          {/* Footer: Copy link + View Details */}
          <View style={[styles.footerRow, waShell && styles.waFooterRow, { borderTopColor: colors.borderLight }]}>
            <TouchableOpacity
              style={styles.copyLinkButton}
              onPress={handleCopyLink}
              hitSlop={8}
            >
              {!waShell && (
                <Ionicons
                  name={linkCopied ? 'checkmark' : 'link-outline'}
                  size={16}
                  color={DEFAULT_PRIMARY_COLOR}
                />
              )}
              <Text style={[styles.viewDetailsText, waShell && { color: waAccent }]}>
                {linkCopied ? 'Copied' : 'Copy link'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleViewDetails} hitSlop={8}>
              <Text style={[styles.viewDetailsText, waShell && { color: waAccent }]}>
                {waShell ? 'View details' : 'View Details'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Pressable>
    );
  }

  // Full access - show complete event card
  const rsvpOptions = event.rsvpOptions || [];

  // Identify the currently-selected option (if any) to conditionally show
  // the plus-ones stepper underneath the RSVP list.
  const selectedOption = rsvpOptions.find((o) => o.id === myRsvp?.optionId) ?? null;
  const selectedIsGoing = isGoingRsvpOption(selectedOption);
  const maxGuests =
    ((eventData as any)?.maxGuestsPerRsvp as number | undefined) ??
    DEFAULT_MAX_GUESTS_PER_RSVP;
  const myGuestCount = myRsvpGuestCount;
  const displayedGuestCount = pendingGuestCount ?? myGuestCount;

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
      <View style={[styles.container, waShell && styles.waContainer, { backgroundColor: cardFill }]}>
        {/* Cover Image */}
        {event.displayCoverImage ? (
          <TouchableOpacity
            onPress={() => ImageViewerManager.show([event.displayCoverImage!], 0)}
            onLongPress={() => handleImageLongPress(event.displayCoverImage!)}
            activeOpacity={0.9}
          >
            <AppImage
              source={event.coverImage}
              // §7 flag-on: a wide banner across the bubble top, not a
              // full-bleed poster in the image's own (often square/portrait)
              // ratio — that single change is most of the height saving.
              style={[styles.coverImage, { backgroundColor: colors.surfaceSecondary, aspectRatio: waShell ? WA_CARD_COVER_ASPECT : coverAspectRatio }]}
              resizeMode="cover"
              placeholder={{ type: 'icon', icon: 'calendar-outline', iconSize: 48, iconColor: colors.iconSecondary }}
            />
          </TouchableOpacity>
        ) : (
          <View style={[styles.coverImagePlaceholder, waShell && styles.waCoverImage, { backgroundColor: colors.surfaceSecondary }]}>
            <Ionicons name="calendar" size={48} color={colors.iconSecondary} />
          </View>
        )}

        {/* Event Info */}
        <View style={[styles.eventInfo, waShell && styles.waEventInfo, { borderBottomColor: colors.borderLight }]}>
          <Text style={[styles.eventTitle, waShell && styles.waEventTitle, { color: colors.text }, isCancelled && { textDecorationLine: 'line-through', color: colors.textTertiary }]} numberOfLines={2}>
            {event.title || 'Event'}
          </Text>
          <Text style={[styles.eventDate, waShell && styles.waEventMeta, { color: colors.textSecondary }]}>
            {formatEventDate(event.scheduledAt)}
          </Text>
          {isPastEvent && !isCancelled && (
            <View style={[styles.pastEventBadge, { backgroundColor: colors.surfaceSecondary }]}>
              <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
              <Text style={[styles.pastEventText, { color: colors.textSecondary }]}>Past Event</Text>
            </View>
          )}
          {location && (
            <Text style={[styles.eventLocation, waShell && styles.waEventMeta, { color: colors.textSecondary }]} numberOfLines={waShell ? 1 : undefined}>
              {location.icon} {location.text}
            </Text>
          )}
        </View>

        {/* RSVP Options - hide when cancelled or past */}
        {!isCancelled && !isPastEvent && event.rsvpEnabled && rsvpOptions.length > 0 && (
          <View style={[styles.rsvpSection, waShell && styles.waRsvpSection]}>
            {showLeaderBadge && (
              <View style={[styles.leaderBadge, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
                <Ionicons name="eye-outline" size={12} color={colors.textSecondary} />
                <Text style={[styles.leaderBadgeText, { color: colors.textSecondary }]}>
                  RSVP count hidden from attendees · only you see this
                </Text>
              </View>
            )}
            {rsvpsLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={DEFAULT_PRIMARY_COLOR} />
                <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading RSVPs...</Text>
              </View>
            ) : (
              <>
                {waShell ? (
                  <View style={styles.waRsvpPillRow}>
                    {rsvpOptions.map((option) => (
                      <WaRsvpPill key={option.id} option={option} />
                    ))}
                  </View>
                ) : (
                  rsvpOptions.map((option) => (
                    <RsvpOptionRow key={option.id} option={option} />
                  ))
                )}
                {selectedIsGoing && (
                  <View style={[styles.guestStepperRow, waShell && styles.waGuestStepperRow, { borderTopColor: colors.borderLight }]}>
                    <GuestStepper
                      value={displayedGuestCount}
                      onChange={handleGuestCountChange}
                      max={maxGuests}
                      label={displayedGuestCount === 0 ? "Bringing guests?" : "Guests"}
                      compact
                    />
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {/* Footer: Copy link + View Details */}
        <View style={[styles.footerRow, waShell && styles.waFooterRow, { borderTopColor: colors.borderLight }]}>
          <TouchableOpacity
            style={styles.copyLinkButton}
            onPress={handleCopyLink}
            hitSlop={8}
          >
            {!waShell && (
              <Ionicons
                name={linkCopied ? 'checkmark' : 'link-outline'}
                size={16}
                color={DEFAULT_PRIMARY_COLOR}
              />
            )}
            <Text style={[styles.viewDetailsText, waShell && { color: waAccent }]}>
              {linkCopied ? 'Copied' : 'Copy link'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleViewDetails} hitSlop={8}>
            <Text style={[styles.viewDetailsText, waShell && { color: waAccent }]}>
              {waShell ? 'View details' : 'View Details'}
            </Text>
          </TouchableOpacity>
        </View>

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
    // Default 1:1 — overridden inline with the image's natural aspect ratio
    // once Image.getSize resolves. Square is a good fallback because most
    // event posters are square or portrait.
    aspectRatio: 1,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  coverImagePlaceholder: {
    width: '100%',
    aspectRatio: 1,
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
  leaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  leaderBadgeText: {
    fontSize: 11,
    fontWeight: '500',
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
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderTopWidth: 1,
  },
  copyLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
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
    aspectRatio: 1,
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

  /* --- WhatsApp shell (§7 "event cards inside chat -> bubble-shaped cards")
   * Every style below is applied only when `wa` is supplied; flag-off render
   * never reaches them. They deliberately *override* the legacy style they're
   * paired with rather than replacing it, so the diff stays readable and the
   * flag-off tree is provably untouched. --- */

  /** §7: a bubble, not an elevated "feature card" — the legacy 8pt/elevation-3
   *  drop shadow becomes the §1.6 1px bubble shadow. */
  waContainer: {
    ...WA_BUBBLE_SHADOW,
    // On web `styles.container`'s raw `boxShadow` isn't overridden by the
    // shadow* props above, so restate it at the bubble's weight.
    ...Platform.select({ web: { boxShadow: WA_CARD_SHADOW_WEB } }),
  },
  /** Wide banner instead of the poster-sized natural/1:1 crop. */
  waCoverImage: {
    aspectRatio: WA_CARD_COVER_ASPECT,
  },
  /** Bubble gutter, and no hairline carving the bubble into sections. */
  waEventInfo: {
    padding: WA_CARD_PADDING,
    paddingBottom: 6,
    borderBottomWidth: 0,
  },
  waEventTitle: {
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 2,
  },
  waEventMeta: {
    fontSize: 13,
    lineHeight: 17,
    marginTop: 0,
    marginBottom: 0,
  },
  waRsvpSection: {
    paddingHorizontal: WA_CARD_PADDING,
    paddingTop: 0,
    paddingBottom: 6,
    gap: 6,
  },
  /** §7 RSVP pill row "docked at the bubble's bottom edge". */
  waRsvpPillRow: {
    flexDirection: 'row',
    gap: 6,
  },
  waRsvpPill: {
    // Equal thirds: the row keeps its geometry when a label swaps for the
    // in-flight spinner, so tapping never reflows the bubble.
    flex: 1,
    height: WA_CARD_PILL_HEIGHT,
    borderRadius: WA_CARD_PILL_RADIUS,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waRsvpPillLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  waGuestStepperRow: {
    paddingTop: 6,
    borderTopWidth: 0,
  },
  /** Footer links sit on the bubble fill, left-aligned, no divider. */
  waFooterRow: {
    paddingVertical: 8,
    paddingHorizontal: WA_CARD_PADDING,
    borderTopWidth: 0,
    justifyContent: 'flex-start',
    gap: 20,
  },
  waAccessPromptSection: {
    padding: WA_CARD_PADDING,
    borderBottomWidth: 0,
  },
  waAccessPromptText: {
    fontSize: 13,
  },
});
