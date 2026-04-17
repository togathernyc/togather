"use client";

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  ActionSheetIOS,
  Platform,
  Alert,
  Share,
  Switch,
} from "react-native";
import { useLocalSearchParams, useRouter, useSegments } from "expo-router";
import { useQuery, useAuthenticatedMutation, api, Id } from "@services/api/convex";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/providers/AuthProvider";
import { useSelectCommunity } from "@/features/auth/hooks/useAuth";
import { useUserData } from "@/features/profile/hooks/useUserData";
import { format, toZonedTime } from "date-fns-tz";
import { parseISO } from "date-fns";

// URL regex pattern for detecting links in text
const URL_REGEX = /(https?:\/\/[^\s]+)/g;

/**
 * Renders text with clickable links
 * URLs in the text are made tappable and open in browser
 */
function TextWithLinks({ text, style }: { text: string; style?: any }) {
  const parts = text.split(URL_REGEX);

  return (
    <Text style={style}>
      {parts.map((part, index) => {
        if (URL_REGEX.test(part)) {
          // Reset regex lastIndex after test
          URL_REGEX.lastIndex = 0;
          return (
            <Text
              key={index}
              style={styles.linkInText}
              onPress={() => Linking.openURL(part)}
            >
              {part}
            </Text>
          );
        }
        // Reset regex lastIndex
        URL_REGEX.lastIndex = 0;
        return part;
      })}
    </Text>
  );
}

import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { AppImage } from "@components/ui";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useTheme } from "@hooks/useTheme";
import {
  DEFAULT_MAX_GUESTS_PER_RSVP,
  FloatingRsvpButtons,
  FloatingRsvpCard,
  RsvpEditModal,
  RsvpOption,
} from "@/features/events/components/EventRsvpSection";
import {
  GuestListPreview,
  RsvpData,
} from "@/features/events/components/EventGuestList";
import { JoinCommunityCard } from "@/features/events/components/JoinCommunityCard";
import { SharedPageTabBar } from "@/features/events/components/SharedPageTabBar";
import { AttendanceConfirmationModal } from "@/features/events/components/AttendanceConfirmationModal";
import { DOMAIN_CONFIG } from "@togather/shared";
import * as Clipboard from "expo-clipboard";
import { EventBlastSheet } from "@/features/leader-tools/components/EventBlastSheet";
import { EventBlastHistory } from "@/features/leader-tools/components/EventBlastHistory";

/**
 * Initial event data passed from Server Component
 * This is used for initial hydration before Convex queries kick in
 */
export interface InitialEventData {
  id: string;
  shortId: string;
  title: string;
  scheduledAt?: string;
  status?: string;
  coverImage?: string;
  coverImageFallback?: string;
  groupName?: string;
  groupImage?: string;
  groupImageFallback?: string;
  communityName?: string;
  communityLogo?: string;
  communityId?: string;
  groupId?: string;
  locationOverride?: string;
  meetingLink?: string;
  note?: string;
  rsvpEnabled?: boolean;
  rsvpOptions?: RsvpOption[];
  visibility?: string;
  hasAccess?: boolean;
  accessPrompt?: { message: string };
  cancellationReason?: string;
}

interface EventPageClientProps {
  initialEventData?: InitialEventData | null;
}

/**
 * Event Page Client Component
 *
 * Contains all interactive logic for the event page.
 * Receives initial event data from Server Component for faster first paint.
 * Convex queries will take over for real-time updates.
 */
export default function EventPageClient({ initialEventData }: EventPageClientProps) {
  const { colors } = useTheme();
  const { shortId, source, confirmAttendance, token } = useLocalSearchParams<{
    shortId: string;
    source?: string;
    confirmAttendance?: string;
    token?: string;
  }>();
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, refreshUser, setCommunity, community, user } = useAuth();

  // Get user's timezone (default to America/New_York if not set)
  const userTimezone = user?.timezone || 'America/New_York';

  // Check if this is an in-app navigation (vs. shared link)
  const isInAppNavigation = source === "app";

  // Check if we're in the (user) modal group to navigate correctly
  const isInUserGroup = segments[0] === "(user)";
  const [loadingOptionId, setLoadingOptionId] = useState<number | null>(null);
  const [showRsvpSheet, setShowRsvpSheet] = useState(false);
  const [isJoiningCommunity, setIsJoiningCommunity] = useState(false);
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [showBlastSheet, setShowBlastSheet] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);

  // Load auth token from AsyncStorage for RSVP mutations
  useEffect(() => {
    AsyncStorage.getItem('auth_token').then(setAuthToken);
  }, []);

  // Get user data to check community membership
  const { data: userData, isLoading: isLoadingUser } = useUserData(isAuthenticated);
  const selectCommunityMutation = useSelectCommunity();

  // ============================================================================
  // Data Fetching (Convex)
  // ============================================================================

  // Fetch event by short ID using Convex
  // This will hydrate with initialEventData first, then Convex takes over for real-time updates
  const event = useQuery(
    api.functions.meetings.index.getByShortId,
    shortId ? { shortId, token: authToken ?? undefined } : "skip"
  );

  // Use Convex data if available, otherwise fall back to initial data
  const eventData = event ?? (initialEventData as typeof event);
  const isLoading = event === undefined && !initialEventData;
  const error = event === null;

  // Leader status using Convex
  const leaderStatus = useQuery(
    api.functions.groups.index.isLeader,
    eventData?.groupId && isAuthenticated && eventData?.hasAccess && authToken
      ? { groupId: eventData.groupId as Id<"groups">, token: authToken }
      : "skip"
  );

  // Fetch my RSVP using Convex
  const myRsvp = useQuery(
    api.functions.meetingRsvps.myRsvp,
    eventData?.id && isAuthenticated && eventData?.hasAccess && authToken
      ? { meetingId: eventData.id as Id<"meetings">, token: authToken }
      : "skip"
  );

  // Fetch RSVP list using Convex
  // Pass token if available to get full access (if user has RSVPed), but also works without token
  const rsvpData = useQuery(
    api.functions.meetingRsvps.list,
    eventData?.id && (eventData?.visibility === 'public' || eventData?.hasAccess)
      ? { meetingId: eventData.id as Id<"meetings">, token: authToken ?? undefined }
      : "skip"
  );
  const isLoadingRsvp = rsvpData === undefined;

  // ============================================================================
  // Attendance Confirmation Modal
  // ============================================================================

  // Auto-open attendance confirmation modal when confirmAttendance param is present
  useEffect(() => {
    if (confirmAttendance === "true" && eventData?.id) {
      setShowAttendanceModal(true);
    }
  }, [confirmAttendance, eventData?.id]);

  // ============================================================================
  // RSVP Mutation (Convex)
  // ============================================================================

  // Convex mutations automatically update reactive queries, so no manual cache invalidation needed
  const submitRsvpMutation = useAuthenticatedMutation(api.functions.meetingRsvps.submit);

  // Toggle RSVP leader notifications mutation
  const toggleRsvpNotifyMutation = useAuthenticatedMutation(api.functions.meetings.index.toggleRsvpLeaderNotifications);
  const rsvpNotifyLeaders = (eventData as any)?.rsvpNotifyLeaders !== false; // defaults to true

  const handleToggleRsvpNotify = async (enabled: boolean) => {
    try {
      await toggleRsvpNotifyMutation({
        meetingId: eventData!.id as Id<"meetings">,
        enabled,
      });
    } catch (error) {
      console.error("Failed to toggle RSVP notifications:", error);
    }
  };

  const isLeader = leaderStatus?.isLeader ?? false;

  // Creators can edit their own event even if they aren't group leaders
  // (ADR-022). Backend enforces authoritatively; this just shows the button.
  const isCreator =
    !!user?.id &&
    !!(eventData as any)?.createdById &&
    String(user.id) === String((eventData as any).createdById);
  const canEdit = isLeader || isCreator;

  // ============================================================================
  // Loading & Error States
  // ============================================================================

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
      </SafeAreaView>
    );
  }

  if (error === true || !eventData) {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="calendar-outline" size={48} color={colors.iconSecondary} />
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>Event not found</Text>
        <TouchableOpacity
          style={styles.backButtonError}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)/home');
            }
          }}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleRsvpSelect = async (optionId: number) => {
    if (!isAuthenticated) {
      // Navigate to new phone-based RSVP flow
      router.push(`/e/${shortId}/rsvp/phone?optionId=${optionId}`);
      return;
    }
    if (!eventData?.id) return;
    // Guard against the hydration window where FloatingRsvpButtons renders
    // because myRsvp is still `undefined` (not yet loaded). Submitting with
    // guestCount: 0 during that window would silently erase plus-ones on an
    // existing Going RSVP.
    if (myRsvp === undefined) return;
    setLoadingOptionId(optionId);
    try {
      await submitRsvpMutation({
        meetingId: eventData.id as Id<"meetings">,
        optionId,
        guestCount: 0,
      });
      // Navigate to success screen with animation (use replace to avoid duplicate event screens in stack)
      const selectedOption = rsvpOptions.find((o) => o.id === optionId);
      router.replace({
        pathname: `/e/${shortId}/rsvp/success`,
        params: { optionLabel: selectedOption?.label || "Going" },
      });
    } finally {
      setLoadingOptionId(null);
    }
  };

  const handleRsvpEdit = async (optionId: number, guestCount: number) => {
    if (!eventData?.id) return;
    setLoadingOptionId(optionId);
    try {
      await submitRsvpMutation({
        meetingId: eventData.id as Id<"meetings">,
        optionId,
        guestCount,
      });
      // Close the modal first
      setShowRsvpSheet(false);
      // Only navigate to success screen if the option actually changed.
      // Guest-count-only edits should stay on the event page.
      if (optionId !== myRsvp?.optionId) {
        const selectedOption = rsvpOptions.find((o) => o.id === optionId);
        router.replace({
          pathname: `/e/${shortId}/rsvp/success`,
          params: { optionLabel: selectedOption?.label || "Going" },
        });
      }
    } finally {
      setLoadingOptionId(null);
    }
  };

  // Inline update of guest count from the FloatingRsvpCard stepper —
  // keeps the current option and only changes the plus-one count.
  const handleGuestCountChange = async (guestCount: number) => {
    if (!eventData?.id || myRsvp?.optionId == null) return;
    await submitRsvpMutation({
      meetingId: eventData.id as Id<"meetings">,
      optionId: myRsvp.optionId,
      guestCount,
    });
  };

  const handleEdit = () => {
    if (!eventData.groupId || !eventData.id) return;
    const encodedDate = encodeURIComponent(eventData.scheduledAt || "");
    router.push(
      `/(user)/leader-tools/${eventData.groupId}/events/id-${eventData.id}|${encodedDate}/edit`
    );
  };

  const handleShare = async () => {
    if (!eventData.shortId) {
      Alert.alert(
        "Cannot Share",
        "This event doesn't have a shareable link yet."
      );
      return;
    }

    const eventUrl = DOMAIN_CONFIG.eventShareUrl(eventData.shortId);
    const eventTitle = eventData.title || "Event";

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Copy Link", "Share"],
          cancelButtonIndex: 0,
        },
        async (buttonIndex) => {
          if (buttonIndex === 1) {
            await Clipboard.setStringAsync(eventUrl);
          } else if (buttonIndex === 2) {
            try {
              await Share.share({
                message: `${eventTitle}\n${eventUrl}`,
                url: eventUrl,
              });
            } catch (error) {
              if ((error as any).message !== "User did not share") {
                Alert.alert("Error", "Failed to share link.");
              }
            }
          }
        }
      );
    } else {
      try {
        await Share.share({
          message: `${eventTitle}\n${eventUrl}`,
        });
      } catch (error) {
        if ((error as any).message !== "User did not share") {
          Alert.alert("Error", "Failed to share link.");
        }
      }
    }
  };

  const handleViewGuestList = () => {
    // Navigate within the same route group to avoid modal stacking issues
    const basePath = isInUserGroup ? "/(user)/e" : "/e";
    router.push(`${basePath}/${shortId}/guests`);
  };

  const handleLocationPress = () => {
    const address = encodeURIComponent(eventData.locationOverride!);
    const appleMapsUrl = `maps://maps.apple.com/?q=${address}`;
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${address}`;

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Open in Apple Maps", "Open in Google Maps"],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) Linking.openURL(appleMapsUrl);
          if (buttonIndex === 2) Linking.openURL(googleMapsUrl);
        }
      );
    } else {
      Alert.alert("Open Location", "Choose an app", [
        { text: "Cancel", style: "cancel" },
        { text: "Google Maps", onPress: () => Linking.openURL(googleMapsUrl) },
      ]);
    }
  };

  // ============================================================================
  // Derived Data
  // ============================================================================

  const rsvpOptions = (eventData.rsvpOptions as unknown as RsvpOption[]) ?? [];
  const eventDate = eventData.scheduledAt ? parseISO(eventData.scheduledAt) : null;
  const isPastEvent = eventDate ? eventDate < new Date() : false;
  const maxGuestsPerRsvp =
    ((eventData as any)?.maxGuestsPerRsvp as number | undefined) ??
    DEFAULT_MAX_GUESTS_PER_RSVP;

  // Does the user have access to RSVP data (guest list, counts, etc.) at all?
  const hasEventAccess =
    eventData.status !== 'cancelled' &&
    (eventData.visibility === 'public' || eventData.hasAccess);

  // Can the user actively submit/change an RSVP?
  // Split out from visibility so past events keep showing the guest list.
  const canRSVP =
    eventData.rsvpEnabled &&
    rsvpOptions.length > 0 &&
    !isPastEvent &&
    hasEventAccess;

  // Show the read-only guest list preview even after the event has passed —
  // leaders need to see who RSVP'd to mark attendance, and members like
  // looking back at who came.
  const showGuestListPreview =
    eventData.rsvpEnabled && rsvpOptions.length > 0 && hasEventAccess;

  // Check if user is a member of the event's host community
  // Convex returns communityId as Id<"communities"> (string), while userData has numeric IDs
  const isUserInCommunity = userData?.community_memberships?.some(
    (membership) => membership.community_id?.toString() === String(eventData.communityId)
  ) ?? false;

  // Show Join Community card on shared links for authenticated users not in the community
  // Wait for user data to load before showing card to avoid flash of incorrect state
  const shouldShowJoinCommunityCard = Platform.OS === "web" && !isInAppNavigation && isAuthenticated && !isLoadingUser && !isUserInCommunity;

  // Show tab bar for authenticated users on shared links (web only — native has its own tab bar)
  const shouldShowTabBar = Platform.OS === "web" && !isInAppNavigation && isAuthenticated;
  // Use community from auth context (JWT) not userData (database)
  // This ensures we only show tabs that work with the current token
  const hasActiveCommunity = !!community?.id;
  // Use String() conversion to handle type mismatch: userData has numeric IDs, community.id is a Convex string ID
  const isAdmin = hasActiveCommunity && (userData?.community_memberships?.some(
    (m) => m.role >= 3 && String(m.community_id) === String(community.id)
  ) ?? false);

  // ============================================================================
  // Join Community Handler
  // ============================================================================

  // Uses the same flow as CommunitySelectionScreen.performCommunitySelection
  // Helper to show alerts on both native and web
  const showAlert = (title: string, message: string) => {
    if (Platform.OS === "web") {
      window.alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const performCommunityJoin = async () => {
    if (!eventData.communityId) return;
    setIsJoiningCommunity(true);

    try {
      // Step 1: Join/select the community using authenticated session
      await selectCommunityMutation.mutateAsync({
        communityId: String(eventData.communityId), // Convex ID as string
      });

      // Step 2: Set the community in auth context (for local state)
      // id is now the Convex ID (string)
      await setCommunity({
        id: eventData.communityId ?? "", // Convex ID
        name: eventData.communityName ?? undefined,
        logo: eventData.communityLogo ?? undefined,
      });

      // Step 3: Refresh user data
      await refreshUser();

      // Show success message (stay on event page, don't navigate away)
      showAlert(
        "Welcome!",
        `You've joined ${eventData.communityName}. You can now explore all their groups and events.`
      );
    } catch (err: any) {
      // Handle errors the same way as CommunitySelectionScreen
      let errorMessage = "Failed to join community. Please try again.";
      const detail = err?.response?.data?.detail;
      if (typeof detail === "string") {
        errorMessage = detail;
      } else if (Array.isArray(detail) && detail.length > 0) {
        errorMessage = detail.map((e: any) => e.msg || e.message || String(e)).join(", ");
      } else if (err?.message) {
        errorMessage = err.message;
      }
      showAlert("Error", errorMessage);
    } finally {
      setIsJoiningCommunity(false);
    }
  };

  const handleJoinCommunity = () => {
    // Show confirmation dialog (same as CommunitySelectionScreen.handleSelectCommunity)
    // Use window.confirm on web since Alert.alert doesn't work
    if (Platform.OS === "web") {
      const confirmed = window.confirm(
        `You're about to join ${eventData.communityName}. Community admins will be notified when you join.`
      );
      if (confirmed) {
        performCommunityJoin();
      }
    } else {
      Alert.alert(
        "Join Community",
        `You're about to join ${eventData.communityName}. Community admins will be notified when you join.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Join", onPress: performCommunityJoin },
        ]
      );
    }
  };

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surface }]} edges={["top"]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            // If there's no navigation history (e.g., came from notification), go to home
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)/home');
            }
          }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {eventData.title || "Event"}
          </Text>
        </View>
        <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
          <Ionicons name="share-outline" size={22} color={colors.text} />
        </TouchableOpacity>
        {canEdit && (
          <TouchableOpacity style={[styles.editButton, { backgroundColor: colors.surfaceSecondary }]} onPress={handleEdit}>
            <Text style={[styles.editButtonText, { color: colors.text }]}>Edit</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          shouldShowTabBar && { paddingBottom: 200 }, // Extra padding for tab bar
        ]}
      >
        {/* Cover Image - falls back to group image if no event cover */}
        <AppImage
          source={eventData.coverImage || eventData.groupImage}
          style={[styles.coverImage, { backgroundColor: colors.surfaceSecondary }]}
          resizeMode="cover"
          placeholder={{
            type: 'icon',
            icon: 'calendar',
            iconSize: 48,
            iconColor: colors.iconSecondary,
          }}
        />

        <View style={styles.content}>
          {/* Host Attribution. ADR-022 member-led events must visibly read
              "Hosted by [creator]" so attendees don't mistake them for
              official community posts. We show the creator's name as the
              primary line with the hosting group (or community for
              announcement-group events) as the secondary line. Falls back
              to the old group/community display for legacy rows where
              `createdById` is missing. */}
          <View style={[styles.organizerRow, { borderBottomColor: colors.surfaceSecondary }]}>
            {(eventData as any).creatorName ? (
              <>
                <AppImage
                  source={(eventData as any).creatorImage}
                  style={styles.groupAvatar}
                  placeholder={{
                    type: 'initials',
                    name: (eventData as any).creatorName,
                  }}
                />
                <View style={styles.organizerInfo}>
                  <Text style={[styles.organizerName, { color: colors.text }]}>
                    {`Hosted by ${(eventData as any).creatorName}`}
                  </Text>
                  <Text style={[styles.communityName, { color: colors.textSecondary }]}>
                    {(eventData as any).isAnnouncementGroup
                      ? eventData.communityName
                      : `${eventData.groupName}${eventData.communityName ? ' · ' + eventData.communityName : ''}`}
                  </Text>
                </View>
              </>
            ) : (
              <>
                <AppImage
                  source={eventData.groupImage}
                  style={styles.groupAvatar}
                  placeholder={{
                    type: 'initials',
                    name: (eventData.groupName || eventData.communityName) ?? undefined,
                  }}
                />
                <View style={styles.organizerInfo}>
                  <Text style={[styles.organizerName, { color: colors.text }]}>{eventData.groupName}</Text>
                  <Text style={[styles.communityName, { color: colors.textSecondary }]}>{eventData.communityName}</Text>
                </View>
              </>
            )}
          </View>

          {/* Date */}
          {eventDate && (
            <View style={styles.infoRow}>
              <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
              <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                {format(
                  toZonedTime(eventDate, userTimezone),
                  "EEEE, MMMM d, yyyy 'at' h:mm a zzz",
                  { timeZone: userTimezone }
                )}
              </Text>
            </View>
          )}

          {/* Location */}
          {eventData.locationOverride && (
            <TouchableOpacity
              style={styles.infoRow}
              onPress={handleLocationPress}
              activeOpacity={0.7}
            >
              <Ionicons name="location-outline" size={20} color={DEFAULT_PRIMARY_COLOR} />
              <Text style={[styles.infoText, styles.linkText]}>
                {eventData.locationOverride}
              </Text>
              <Ionicons name="open-outline" size={16} color={DEFAULT_PRIMARY_COLOR} />
            </TouchableOpacity>
          )}

          {/* Meeting Link */}
          {eventData.meetingLink && (
            <TouchableOpacity
              style={styles.infoRow}
              onPress={() => Linking.openURL(eventData.meetingLink!)}
            >
              <Ionicons name="videocam-outline" size={20} color={DEFAULT_PRIMARY_COLOR} />
              <Text style={[styles.infoText, styles.linkText]}>
                Join Meeting
              </Text>
              <Ionicons name="open-outline" size={16} color={DEFAULT_PRIMARY_COLOR} />
            </TouchableOpacity>
          )}

          {/* Description */}
          {eventData.note && (
            <View style={styles.descriptionSection}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>About</Text>
              <TextWithLinks text={eventData.note} style={[styles.description, { color: colors.textSecondary }]} />
            </View>
          )}

          {/* Event Status */}
          {isPastEvent && (
            <View style={[styles.statusContainer, { backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[styles.statusText, { color: colors.textSecondary }]}>This event has passed</Text>
            </View>
          )}
          {eventData.status === 'cancelled' && (
            <View style={[styles.statusContainer, { backgroundColor: '#FEE2E2' }]}>
              <Text style={[styles.statusText, { color: '#991B1B' }]}>This event has been cancelled</Text>
              {eventData.cancellationReason && (
                <Text style={[styles.statusText, { color: '#991B1B', marginTop: 4, fontSize: 14 }]}>
                  {eventData.cancellationReason}
                </Text>
              )}
            </View>
          )}
          {!canRSVP && eventData.rsvpEnabled && eventData.status !== 'cancelled' && !isPastEvent && !eventData.hasAccess && eventData.visibility === 'group' && (
            <View style={[styles.statusContainer, { backgroundColor: '#FEF3C7' }]}>
              <Text style={[styles.statusText, { color: '#92400E' }]}>You must be a member of this group to RSVP</Text>
            </View>
          )}

          {/* Join Community Card - shown on shared links for users not in the community */}
          {shouldShowJoinCommunityCard && (
            <JoinCommunityCard
              communityName={eventData.communityName ?? "Community"}
              communityLogo={eventData.communityLogo ?? null}
              onJoinPress={handleJoinCommunity}
              isLoading={isJoiningCommunity}
            />
          )}

          {/* Guest List Preview — shown for all visible states (including past events) */}
          {showGuestListPreview && !isLoadingRsvp && rsvpData && (
            <GuestListPreview
              rsvpData={rsvpData as RsvpData}
              rsvpOptions={rsvpOptions}
              onViewAll={handleViewGuestList}
            />
          )}

          {/* Leader: jump into the attendance recorder for past events */}
          {isLeader && isPastEvent && eventData.id && eventData.groupId && eventData.scheduledAt && (
            <TouchableOpacity
              style={[styles.messageAttendeesButton, { backgroundColor: colors.surfaceSecondary }]}
              onPress={() => {
                const encodedDate = encodeURIComponent(eventData.scheduledAt!);
                const meetingIdParam = encodeURIComponent(eventData.id as string);
                router.push(
                  `/(user)/leader-tools/${eventData.groupId}/attendance/edit?eventDate=${encodedDate}&meetingId=${meetingIdParam}`
                );
              }}
            >
              <Ionicons name="checkmark-done-outline" size={20} color={DEFAULT_PRIMARY_COLOR} />
              <Text style={[styles.messageAttendeesText, { color: DEFAULT_PRIMARY_COLOR }]}>
                Record Attendance
              </Text>
            </TouchableOpacity>
          )}

          {/* Leader: RSVP Notification Toggle. Leader/admin-only — creators
              always get notified about RSVPs to their own event via a
              separate path in `notifyRsvpReceived`, so they don't need to
              toggle anything here. */}
          {isLeader && eventData.rsvpEnabled && (
            <View style={[styles.leaderCard, { backgroundColor: colors.surfaceSecondary }]}>
              <View style={styles.leaderCardRow}>
                <Ionicons name="notifications-outline" size={20} color={colors.textSecondary} />
                <Text style={[styles.leaderCardText, { color: colors.text }]}>
                  Notify on new RSVPs
                </Text>
                <Switch
                  value={rsvpNotifyLeaders}
                  onValueChange={handleToggleRsvpNotify}
                  trackColor={{ false: colors.border, true: DEFAULT_PRIMARY_COLOR }}
                />
              </View>
            </View>
          )}

          {/* Host actions: Message Attendees + Blast History. ADR-022 extends
              this surface to creators — they're the host, so they should be
              able to reach out to RSVPed guests. Backend is authoritative. */}
          {canEdit && (
            <TouchableOpacity
              style={[styles.messageAttendeesButton, { backgroundColor: colors.surfaceSecondary }]}
              onPress={() => setShowBlastSheet(true)}
            >
              <Ionicons name="megaphone-outline" size={20} color={DEFAULT_PRIMARY_COLOR} />
              <Text style={[styles.messageAttendeesText, { color: DEFAULT_PRIMARY_COLOR }]}>
                Message Attendees
              </Text>
            </TouchableOpacity>
          )}

          {canEdit && eventData.id && (
            <EventBlastHistory meetingId={eventData.id as string} />
          )}
        </View>
      </ScrollView>

      {/* Floating RSVP Section */}
      {canRSVP && (
        <>
          {!eventData.hasAccess && eventData.accessPrompt ? (
            // User can view event but needs to sign in or join to RSVP
            <View style={[
              styles.floatingPrompt,
              {
                paddingBottom: insets.bottom + 16,
                bottom: shouldShowTabBar ? 64 : 0, // Offset for tab bar
                backgroundColor: colors.surface,
                borderTopColor: colors.border,
              }
            ]}>
              <TouchableOpacity
                style={styles.signInButton}
                onPress={() => {
                  // For public events, use the new phone-based RSVP flow
                  // Get the first enabled RSVP option as default
                  const defaultOption = rsvpOptions.find((o) => o.enabled);
                  if (defaultOption) {
                    router.push(`/e/${shortId}/rsvp/phone?optionId=${defaultOption.id}`);
                  } else {
                    router.push("/(auth)/signin" as any);
                  }
                }}
              >
                <Text style={styles.signInButtonText}>
                  {eventData.accessPrompt.message}
                </Text>
              </TouchableOpacity>
            </View>
          ) : myRsvp?.optionId != null ? (
            <FloatingRsvpCard
              response={{ optionId: myRsvp.optionId, guestCount: myRsvp.guestCount ?? 0 }}
              options={rsvpOptions}
              onEdit={() => setShowRsvpSheet(true)}
              onGuestCountChange={handleGuestCountChange}
              maxGuests={maxGuestsPerRsvp}
              insets={insets}
              tabBarOffset={shouldShowTabBar ? 64 : 0}
            />
          ) : (
            <FloatingRsvpButtons
              options={rsvpOptions}
              loadingOptionId={loadingOptionId}
              onSelect={handleRsvpSelect}
              insets={insets}
              tabBarOffset={shouldShowTabBar ? 64 : 0}
            />
          )}
        </>
      )}

      {/* RSVP Edit Modal */}
      <RsvpEditModal
        visible={showRsvpSheet}
        onClose={() => setShowRsvpSheet(false)}
        options={rsvpOptions}
        currentOptionId={myRsvp?.optionId ?? null}
        currentGuestCount={myRsvp?.guestCount ?? 0}
        loadingOptionId={loadingOptionId}
        onSelect={handleRsvpEdit}
        maxGuests={maxGuestsPerRsvp}
      />

      {/* Attendance Confirmation Modal */}
      <AttendanceConfirmationModal
        visible={showAttendanceModal}
        onClose={() => setShowAttendanceModal(false)}
        meetingId={eventData?.id ?? ""}
        token={token}
        eventTitle={eventData?.title}
        eventDate={eventData?.scheduledAt ?? undefined}
        groupName={eventData?.groupName}
      />

      {/* Event Blast Sheet */}
      {isLeader && (
        <EventBlastSheet
          visible={showBlastSheet}
          meetingId={eventData.id as string}
          eventTitle={eventData.title || "Event"}
          onClose={() => setShowBlastSheet(false)}
          onSent={() => setShowBlastSheet(false)}
        />
      )}

      {/* Bottom Tab Bar - shown for authenticated users on shared links */}
      {shouldShowTabBar && (
        <SharedPageTabBar
          hasActiveCommunity={hasActiveCommunity}
          isAdmin={isAdmin}
        />
      )}
    </SafeAreaView>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 200 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    marginRight: 12,
    padding: 8,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  shareButton: {
    padding: 8,
    marginRight: 8,
  },
  editButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },

  // Cover Image
  coverImage: {
    width: "100%",
    aspectRatio: 16 / 9,
  },

  // Content
  content: { padding: 20 },

  // Organizer
  organizerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
  },
  groupAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  organizerInfo: {
    flex: 1,
  },
  organizerName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  communityName: {
    fontSize: 14,
  },

  // Info Rows
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  infoText: { fontSize: 15, flex: 1 },
  linkText: { color: DEFAULT_PRIMARY_COLOR, fontWeight: "600" },

  // Description
  descriptionSection: { marginTop: 20, marginBottom: 20 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  description: { fontSize: 15, lineHeight: 22 },
  linkInText: { color: DEFAULT_PRIMARY_COLOR, textDecorationLine: "underline" as const },

  // Status
  statusContainer: {
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  statusText: {
    fontSize: 14,
    textAlign: "center",
  },

  // Error State
  errorText: { fontSize: 16, marginTop: 12 },
  backButtonError: {
    marginTop: 20,
    padding: 12,
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    borderRadius: 8,
  },
  backButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },

  // Floating Sign-In Prompt
  floatingPrompt: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 16,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  signInButton: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  signInButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },

  // Leader controls
  leaderCard: {
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  leaderCardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  leaderCardText: {
    fontSize: 15,
    fontWeight: "500",
    flex: 1,
  },
  messageAttendeesButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  },
  messageAttendeesText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
