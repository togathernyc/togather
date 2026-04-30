import React, { useState } from "react";
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
  Pressable,
  Modal,
  Switch,
} from "react-native";
import { useRouter } from "expo-router";
import { format, toZonedTime } from "date-fns-tz";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { useQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { Avatar } from "@components/ui/Avatar";
import { AppImage } from "@components/ui/AppImage";
import { AdminViewNote } from "@components/ui/AdminViewNote";
import { CommunityWideBadge } from "@components/ui/CommunityWideBadge";
import { SeriesBadge } from "@components/ui/SeriesBadge";
import { FloatingRsvpButtons } from "./FloatingRsvpButtons";
import { FloatingRsvpCard } from "./FloatingRsvpCard";
import { GuestListSection } from "./GuestListSection";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { DOMAIN_CONFIG } from "@togather/shared";
import * as Clipboard from "expo-clipboard";
import { DragHandle } from "@components/ui/DragHandle";
import { useTheme } from "@hooks/useTheme";
import { EventBlastSheet } from "./EventBlastSheet";
import { EventBlastHistory } from "./EventBlastHistory";
import { ReportEventSheet } from "@features/events/components/ReportEventSheet";

interface RsvpOption {
  id: number;
  label: string;
  enabled: boolean;
}

interface EventDetailsProps {
  groupId: string;
  eventDate: string;
  meetingId: string;
  isLeader?: boolean;
  onBack: () => void;
  onGroupChat: () => void;
}

export function EventDetails({
  groupId,
  eventDate,
  meetingId,
  isLeader = false,
  onBack,
  onGroupChat,
}: EventDetailsProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const { user } = useAuth();

  // Get user's timezone (default to America/New_York if not set)
  const userTimezone = user?.timezone || 'America/New_York';

  const [expandedOption, setExpandedOption] = useState<number | null>(null);
  const [loadingOptionId, setLoadingOptionId] = useState<number | null>(null);
  const [showRsvpSheet, setShowRsvpSheet] = useState(false);
  const [isSubmittingRsvp, setIsSubmittingRsvp] = useState(false);
  const [showBlastSheet, setShowBlastSheet] = useState(false);
  const [showReportSheet, setShowReportSheet] = useState(false);

  // Computed below once `meeting` is loaded. Declared here so it's referenced
  // by JSX; actual value derives from useQuery result downstream.

  // Fetch meeting details if meetingId is available (using Convex)
  // NOTE: This must be called before any conditional returns (Rules of Hooks)
  const meetingData = useQuery(
    api.functions.meetings.index.getWithDetails,
    groupId && meetingId ? { meetingId: meetingId as Id<"meetings"> } : "skip"
  );
  const meeting = meetingData ?? undefined;
  const isLoadingMeeting = groupId && meetingId && meetingData === undefined;

  // The viewer can edit/moderate when they're a host of this event.
  // Hosts replace the old creator-gated access per the host-decoupling
  // change — backend authority is `canEditMeeting`, which checks the
  // host list (falling back to an empty list, not to createdById).
  const isCreator = !!user?.id && (() => {
    const hosts = ((meeting as any)?.hostUserIds as string[] | undefined) ?? [];
    return hosts.some((id) => String(id) === String(user.id));
  })();

  // Community admins can manage events even when they aren't a leader of
  // the hosting group — backend `canEditMeeting` (and `eventBlasts`) allow
  // them. Treat them as having leader-level affordances here so they can
  // actually act on what the API permits.
  const isCommunityAdmin = user?.is_admin === true;
  const canManageEvent = isLeader || isCreator || isCommunityAdmin;
  // Show "you're seeing this as community admin" disclaimer only when the
  // viewer is acting via admin role, not via being a leader/host of this
  // group/event.
  const isViewingAsAdminOnly = isCommunityAdmin && !isLeader && !isCreator;

  // Fetch RSVPs for the meeting (using Convex)
  const rsvpsRaw = useQuery(
    api.functions.meetingRsvps.list,
    meetingId ? { meetingId: meetingId as Id<"meetings"> } : "skip"
  );
  const isLoadingRsvp = meetingId && rsvpsRaw === undefined;

  // Transform RSVPs into the format expected by the UI
  // Note: meetingRsvps.list returns already-grouped data { rsvps: [...], total }
  const rsvpData = React.useMemo(() => {
    if (!rsvpsRaw) return undefined;
    // Data is already grouped by option from the API
    const rsvps = rsvpsRaw.rsvps.map((group) => ({
      option: { id: group.option.id },
      count: group.count,
      users: group.users.map((user) => ({
        id: user.id,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        profileImage: user.profileImage || undefined,
      })),
    }));
    return { rsvps, total: rsvpsRaw.total };
  }, [rsvpsRaw]);

  // Fetch current user's RSVP (using Convex)
  const myRsvpData = useQuery(
    api.functions.meetingRsvps.myRsvp,
    meetingId ? { meetingId: meetingId as Id<"meetings"> } : "skip"
  );
  // Transform to expected format (myRsvp returns { optionId })
  const myRsvp = myRsvpData ? { optionId: myRsvpData.optionId } : undefined;

  // Submit RSVP mutation (using Convex, auto-injects token)
  const submitRsvpMutation = useAuthenticatedMutation(api.functions.meetingRsvps.submit);

  // Toggle RSVP leader notifications mutation
  const toggleRsvpNotifyMutation = useAuthenticatedMutation(api.functions.meetings.index.toggleRsvpLeaderNotifications);

  // Wrapper for submitRsvp mutation
  const submitRsvp = {
    mutate: async (data: { meetingId: string; optionId: number }) => {
      setIsSubmittingRsvp(true);
      try {
        await submitRsvpMutation({
          meetingId: data.meetingId as Id<"meetings">,
          optionId: data.optionId,
        });
        // Convex automatically updates queries
        setLoadingOptionId(null);
        setShowRsvpSheet(false);
      } catch (error) {
        setLoadingOptionId(null);
      } finally {
        setIsSubmittingRsvp(false);
      }
    },
  };

  // Validate and parse the event date (after all hooks are called)
  if (!eventDate) {
    console.error("EventDetails: eventDate is required");
    return null;
  }

  // Check if eventDate still has the prefix (shouldn't happen, but handle it)
  let cleanEventDate = eventDate;
  if (eventDate.startsWith("date-")) {
    console.warn(
      "EventDetails: eventDate still has 'date-' prefix, removing it:",
      eventDate
    );
    cleanEventDate = eventDate.replace("date-", "");
  } else if (eventDate.startsWith("id-")) {
    console.warn(
      "EventDetails: eventDate has 'id-' prefix, this shouldn't happen:",
      eventDate
    );
    // Try to extract date from id-{id}|{date} format
    const afterPrefix = eventDate.replace("id-", "");
    const separatorIndex = afterPrefix.indexOf("|");
    if (separatorIndex > 0) {
      cleanEventDate = afterPrefix.substring(separatorIndex + 1);
    }
  }

  const eventDateObj = new Date(cleanEventDate);
  if (isNaN(eventDateObj.getTime())) {
    console.error("EventDetails: Invalid eventDate after cleaning:", {
      original: eventDate,
      cleaned: cleanEventDate,
    });
    return null;
  }

  const dateStr = cleanEventDate.split("T")[0]; // YYYY-MM-DD format for API

  // Use meeting data if available, otherwise use eventDate for display
  const displayTitle = meeting?.title || format(eventDateObj, "MMMM dd, yyyy");
  // Convex stores scheduledAt as a timestamp number
  const displayDate = meeting?.scheduledAt ? new Date(meeting.scheduledAt).toISOString() : cleanEventDate;
  const displayLocation = meeting?.locationOverride || null;
  const displayNote = meeting?.note || null;
  // Falls back to group image if no event cover
  const displayCoverImage = meeting?.coverImage || meeting?.group?.preview || null;
  const displayMeetingLink = meeting?.meetingLink || null;
  const displayMeetingType = meeting?.meetingType;
  const rsvpEnabled = meeting?.rsvpEnabled ?? false;
  const rsvpOptions = (meeting?.rsvpOptions as RsvpOption[] | null) || [];
  const isLoading = isLoadingMeeting;
  const rsvpNotifyLeaders = (meeting as any)?.rsvpNotifyLeaders !== false; // defaults to true

  // Handle RSVP notification toggle
  const handleToggleRsvpNotify = async (enabled: boolean) => {
    try {
      await toggleRsvpNotifyMutation({
        meetingId: meetingId as Id<"meetings">,
        enabled,
      });
    } catch (error) {
      console.error("Failed to toggle RSVP notifications:", error);
    }
  };

  // Handle RSVP selection
  const handleRsvpSelect = (optionId: number) => {
    setLoadingOptionId(optionId);
    submitRsvp.mutate({ meetingId: meetingId!, optionId });
  };

  // Open RSVP edit sheet
  const handleEditRsvp = () => {
    setShowRsvpSheet(true);
  };

  // Toggle expanded option to show users
  const toggleExpandOption = (optionId: number) => {
    setExpandedOption(expandedOption === optionId ? null : optionId);
  };

  const handleEdit = () => {
    // Navigate to edit page with the meeting ID
    const eventIdentifier = `id-${meetingId}|${encodeURIComponent(cleanEventDate)}`;
    router.push(
      `/(user)/leader-tools/${groupId}/events/${eventIdentifier}/edit`
    );
  };

  // Get shortId from meeting data for sharing
  const shortId = (meeting as any)?.shortId;

  const handleShare = async () => {
    if (!shortId) {
      Alert.alert("Cannot Share", "This event doesn't have a shareable link yet.");
      return;
    }

    const eventUrl = DOMAIN_CONFIG.eventShareUrl(shortId);
    const eventTitle = displayTitle;

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

  const handleLocationPress = () => {
    if (!displayLocation) return;

    const address = encodeURIComponent(displayLocation);
    const appleMapsUrl = `maps://maps.apple.com/?q=${address}`;
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${address}`;

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Open in Apple Maps", "Open in Google Maps"],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) {
            Linking.openURL(appleMapsUrl).catch((err) =>
              console.error("Failed to open Apple Maps:", err)
            );
          }
          if (buttonIndex === 2) {
            Linking.openURL(googleMapsUrl).catch((err) =>
              console.error("Failed to open Google Maps:", err)
            );
          }
        }
      );
    } else {
      Alert.alert("Open Location", "Choose an app", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Google Maps",
          onPress: () => {
            Linking.openURL(googleMapsUrl).catch((err) =>
              console.error("Failed to open Google Maps:", err)
            );
          },
        },
      ]);
    }
  };

  const isPastEvent = eventDateObj < new Date();

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <DragHandle />
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          testID="back-button"
          style={styles.backButton}
          onPress={onBack}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {displayTitle}
          </Text>
        </View>
        {/* Share Button */}
        <TouchableOpacity
          testID="share-button"
          style={styles.shareButton}
          onPress={handleShare}
        >
          <Ionicons name="share-outline" size={22} color={colors.text} />
        </TouchableOpacity>
        {/* Report Button — members can flag events for the group leaders.
            Creators see it too; backend just won't let them report their own
            event (low-risk of self-abuse). */}
        <TouchableOpacity
          testID="report-event-button"
          accessibilityLabel="Report event"
          style={styles.shareButton}
          onPress={() => setShowReportSheet(true)}
        >
          <Ionicons name="flag-outline" size={20} color={colors.text} />
        </TouchableOpacity>
        {canManageEvent && (
          <TouchableOpacity
            testID="edit-button"
            style={[styles.editButton, { backgroundColor: colors.surfaceSecondary }]}
            onPress={handleEdit}
          >
            <Text style={[styles.editButtonText, { color: colors.text }]}>Edit</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Content */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading event details...</Text>
          </View>
        ) : (
          <>
            {/* Admin-mode banner — only when the viewer's elevated access
                comes from being a community admin (not from leading the
                hosting group or hosting the event itself). */}
            {isViewingAsAdminOnly && (
              <View style={styles.adminNoteWrap}>
                <AdminViewNote text="You're managing this event as a community admin." />
              </View>
            )}

            {/* Cover Image */}
            {displayCoverImage ? (
              <AppImage
                source={displayCoverImage}
                style={styles.coverImage}
                resizeMode="cover"
                optimizedWidth={800}
                placeholder={{ type: 'icon', icon: 'calendar' }}
              />
            ) : (
              <View style={[styles.imagePlaceholder, { backgroundColor: colors.border }]}>
                <Ionicons name="calendar" size={48} color={colors.iconSecondary} />
              </View>
            )}

            {/* Host Attribution. When the event has explicit hosts we show
                "Hosted by {host}" with the host's avatar; otherwise we just
                show the group — creator is never surfaced. */}
            {meeting?.group && (() => {
              type HostRow = {
                id: string;
                firstName: string | null;
                lastName: string | null;
                profilePhoto: string | null;
              };
              const hosts = ((meeting as any).hosts as HostRow[] | undefined) ?? [];
              const primary = hosts[0];
              const extraHostCount = Math.max(0, hosts.length - 1);

              const formatDisplay = (
                first: string | null | undefined,
                last: string | null | undefined,
              ) => {
                const firstName = first || "";
                const lastInitial = last?.[0] ? `${last[0]}.` : "";
                return [firstName, lastInitial].filter(Boolean).join(" ").trim();
              };

              return (
                <View style={[styles.groupInfoCard, { backgroundColor: colors.surface }]}>
                  {primary ? (
                    <>
                      <Avatar
                        name={
                          [primary.firstName, primary.lastName]
                            .filter(Boolean)
                            .join(" ") || meeting.group.name
                        }
                        imageUrl={primary.profilePhoto || null}
                        size={48}
                      />
                      <View style={styles.groupInfoText}>
                        <Text style={[styles.groupName, { color: colors.text }]}>
                          {(() => {
                            const display = formatDisplay(
                              primary.firstName,
                              primary.lastName,
                            );
                            if (!display) return "Hosted";
                            if (extraHostCount > 0) {
                              return `Hosted by ${display} + ${extraHostCount} other${
                                extraHostCount === 1 ? "" : "s"
                              }`;
                            }
                            return `Hosted by ${display}`;
                          })()}
                        </Text>
                        <Text
                          style={[styles.groupName, { color: colors.textSecondary, fontSize: 13, fontWeight: "400", marginTop: 2 }]}
                        >
                          {(meeting as any).group?.isAnnouncementGroup
                            ? "Community"
                            : meeting.group.name}
                        </Text>
                      </View>
                    </>
                  ) : (
                    <>
                      <Avatar
                        name={meeting.group.name}
                        imageUrl={meeting.group.preview || null}
                        size={48}
                      />
                      <View style={styles.groupInfoText}>
                        <Text style={[styles.groupName, { color: colors.text }]}>{meeting.group.name}</Text>
                      </View>
                    </>
                  )}
                </View>
              );
            })()}

            {/* Community-Wide Event Badge */}
            {meeting?.communityWideEventId && (
              <View style={styles.communityWideBadgeContainer}>
                <CommunityWideBadge
                  parentEventTitle={meeting.parentEventTitle}
                  isOverridden={meeting.isOverridden}
                  showOverrideNote={isLeader}
                />
              </View>
            )}

            {/* Series Badge */}
            {meeting?.seriesInfo && (
              <View style={styles.communityWideBadgeContainer}>
                <SeriesBadge
                  seriesName={meeting.seriesInfo.seriesName}
                  seriesNumber={meeting.seriesInfo.seriesNumber}
                  seriesTotalCount={meeting.seriesInfo.seriesTotalCount}
                  size="medium"
                />
              </View>
            )}

            {/* Event Details Section */}
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>EVENT DETAILS</Text>

            {/* Date and Time */}
            <View style={[styles.detailCard, { backgroundColor: colors.surface }]}>
              <View style={styles.detailRow}>
                <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
                <View style={styles.detailContent}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Date & Time</Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>
                    {format(
                      toZonedTime(new Date(displayDate), userTimezone),
                      "EEEE, MMMM dd, yyyy 'at' h:mm a zzz",
                      { timeZone: userTimezone }
                    )}
                  </Text>
                </View>
              </View>
            </View>

            {/* Location */}
            {displayLocation && (
              <View style={[styles.detailCard, { backgroundColor: colors.surface }]}>
                <Pressable
                  style={styles.detailRow}
                  onPress={handleLocationPress}
                >
                  <Ionicons name="location-outline" size={20} color={colors.textSecondary} />
                  <View style={styles.detailContent}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Location</Text>
                    <Text style={[styles.detailValue, styles.linkText]}>
                      {displayLocation}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={DEFAULT_PRIMARY_COLOR} />
                </Pressable>
              </View>
            )}

            {/* Meeting Link (for virtual meetings) */}
            {displayMeetingLink && (
              <View style={[styles.detailCard, { backgroundColor: colors.surface }]}>
                <TouchableOpacity
                  style={styles.detailRow}
                  onPress={() => {
                    Linking.openURL(displayMeetingLink).catch((err) =>
                      console.error("Failed to open link:", err)
                    );
                  }}
                >
                  <Ionicons name="videocam-outline" size={20} color={DEFAULT_PRIMARY_COLOR} />
                  <View style={styles.detailContent}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Meeting Link</Text>
                    <Text style={[styles.detailValue, styles.linkText]}>
                      Join Meeting
                    </Text>
                  </View>
                  <Ionicons name="open-outline" size={16} color={DEFAULT_PRIMARY_COLOR} />
                </TouchableOpacity>
              </View>
            )}

            {/* Description/Note */}
            {displayNote && (
              <View style={[styles.detailCard, { backgroundColor: colors.surface }]}>
                <View style={styles.detailRow}>
                  <Ionicons
                    name="document-text-outline"
                    size={20}
                    color={colors.textSecondary}
                  />
                  <View style={styles.detailContent}>
                    <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Description</Text>
                    <Text style={[styles.detailValue, { color: colors.text }]}>{displayNote}</Text>
                  </View>
                </View>
              </View>
            )}

            {/* Leader-only toggle. Backend `toggleRsvpLeaderNotifications`
                is strictly leader-only per ADR-022 — this controls whose
                notifications fire (the group leaders'), so creators and
                community admins shouldn't be able to silence them.
                Creators always get notified via `notifyRsvpReceived` and
                don't need a toggle here. */}
            {isLeader && rsvpEnabled && (
              <View style={[styles.detailCard, { backgroundColor: colors.surface }]}>
                <View style={styles.detailRow}>
                  <Ionicons name="notifications-outline" size={20} color={colors.textSecondary} />
                  <View style={[styles.detailContent, styles.toggleRow]}>
                    <Text style={[styles.detailValue, { color: colors.text, flex: 1 }]}>
                      Notify on new RSVPs
                    </Text>
                    <Switch
                      value={rsvpNotifyLeaders}
                      onValueChange={handleToggleRsvpNotify}
                      trackColor={{ false: colors.border, true: DEFAULT_PRIMARY_COLOR }}
                    />
                  </View>
                </View>
              </View>
            )}

            {/* Guest List Section */}
            {rsvpEnabled && !isPastEvent && meeting?.rsvpCounts && (
              <GuestListSection
                eventId={meetingId!}
                groupId={groupId}
                totalGoing={meeting.rsvpCounts.yes}
                topGuests={rsvpData?.rsvps?.find(r => r.option.id === 1)?.users?.slice(0, 5).map(u => ({
                  id: u.id,
                  firstName: u.firstName,
                  profileImage: u.profileImage || null,
                })) || []}
                userHasRsvpd={!!myRsvp?.optionId}
                isGroupLeader={isLeader}
                onViewAll={() => {
                  const eventIdentifier = `id-${meetingId}|${encodeURIComponent(cleanEventDate)}`;
                  router.push(
                    `/(user)/leader-tools/${groupId}/events/${eventIdentifier}/guests`
                  );
                }}
              />
            )}

            {/* RSVP Responses Section - shows who responded */}
            {rsvpEnabled && rsvpOptions.length > 0 && !isPastEvent && rsvpData && (
              <>
                <Text style={[styles.sectionTitle, { marginTop: 24, color: colors.textSecondary }]}>RESPONSES</Text>
                <View style={styles.rsvpContainer}>
                  {isLoadingRsvp ? (
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                  ) : (
                    rsvpOptions
                      .filter((option) => option.enabled)
                      .map((option) => {
                        const rsvpGroup = rsvpData?.rsvps?.find(
                          (r) => r.option.id === option.id
                        );
                        const count = rsvpGroup?.count || 0;
                        const users = rsvpGroup?.users || [];
                        const isExpanded = expandedOption === option.id;

                        // Only show options with at least 1 response
                        if (count === 0) return null;

                        return (
                          <View key={option.id} style={styles.rsvpOptionWrapper}>
                            <TouchableOpacity
                              testID={`rsvp-count-${option.id}`}
                              style={[styles.rsvpCountCard, { backgroundColor: colors.surface }]}
                              onPress={() => toggleExpandOption(option.id)}
                            >
                              <View style={styles.rsvpOptionContent}>
                                <Text style={[styles.rsvpOptionLabel, { color: colors.text }]}>
                                  {option.label}
                                </Text>
                              </View>
                              <View style={[styles.rsvpCountBadge, { backgroundColor: colors.surfaceSecondary }]}>
                                <Text style={[styles.rsvpCountText, { color: colors.textSecondary }]}>{count}</Text>
                                <Ionicons
                                  name={isExpanded ? "chevron-up" : "chevron-down"}
                                  size={14}
                                  color={colors.textSecondary}
                                />
                              </View>
                            </TouchableOpacity>

                            {/* Expanded users list */}
                            {isExpanded && users.length > 0 && (
                              <View style={[styles.rsvpUsersList, { backgroundColor: colors.surface }]}>
                                {users.map((user) => (
                                  <View key={user.id} style={styles.rsvpUser}>
                                    <Avatar
                                      name={`${user.firstName} ${user.lastName}`}
                                      imageUrl={user.profileImage || null}
                                      size={32}
                                    />
                                    <Text style={[styles.rsvpUserName, { color: colors.text }]}>
                                      {user.firstName} {user.lastName}
                                    </Text>
                                  </View>
                                ))}
                              </View>
                            )}
                          </View>
                        );
                      })
                  )}
                </View>
                {rsvpData?.total !== undefined && rsvpData.total > 0 && (
                  <Text style={[styles.totalResponses, { color: colors.textSecondary }]}>
                    {rsvpData.total} {rsvpData.total === 1 ? "response" : "responses"}
                  </Text>
                )}
              </>
            )}

            {/* Host actions: Message Attendees + Blast History. Available to
                creators too (ADR-022). Backend `canEditMeeting` also allows
                community admins (`eventBlasts.ts` enforces), so the UI
                opens to them as well — matched here so the affordance
                isn't hidden from someone the API permits. */}
            {canManageEvent && (
              <TouchableOpacity
                style={[styles.messageAttendeesButton, { backgroundColor: colors.surface }]}
                onPress={() => setShowBlastSheet(true)}
              >
                <Ionicons name="megaphone-outline" size={20} color={DEFAULT_PRIMARY_COLOR} />
                <Text style={[styles.messageAttendeesText, { color: DEFAULT_PRIMARY_COLOR }]}>
                  Text Blast
                </Text>
              </TouchableOpacity>
            )}

            {canManageEvent && meetingId && (
              <EventBlastHistory meetingId={meetingId} />
            )}

            {/* Event Status */}
            {isPastEvent && (
              <View style={[styles.statusContainer, { backgroundColor: colors.surface }]}>
                <Text style={[styles.statusText, { color: colors.textSecondary }]}>This event has passed</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Floating RSVP Section - only show if RSVP is enabled and event is not past */}
      {rsvpEnabled && rsvpOptions.length > 0 && !isPastEvent && (
        <>
          {myRsvp?.optionId ? (
            <FloatingRsvpCard
              response={myRsvp as { optionId: number }}
              options={rsvpOptions}
              onEdit={handleEditRsvp}
            />
          ) : (
            <FloatingRsvpButtons
              options={rsvpOptions}
              loadingOptionId={loadingOptionId}
              onSelect={handleRsvpSelect}
            />
          )}
        </>
      )}

      {/* RSVP Edit Modal */}
      <Modal
        visible={showRsvpSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRsvpSheet(false)}
      >
        <TouchableOpacity
          style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
          activeOpacity={1}
          onPress={() => setShowRsvpSheet(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <TouchableOpacity
              activeOpacity={1}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>Change your RSVP</Text>
                <TouchableOpacity onPress={() => setShowRsvpSheet(false)}>
                  <Ionicons name="close" size={24} color={colors.text} />
                </TouchableOpacity>
              </View>
              <View style={styles.modalOptions}>
                {rsvpOptions
                  .filter((option) => option.enabled)
                  .map((option) => {
                    const isSelected = myRsvp?.optionId === option.id;
                    const isLoading = loadingOptionId === option.id;

                    return (
                      <TouchableOpacity
                        key={option.id}
                        testID={`modal-rsvp-option-${option.id}`}
                        style={[
                          styles.modalOption,
                          { backgroundColor: colors.surface, borderColor: colors.border },
                          isSelected && [styles.modalOptionSelected, { backgroundColor: colors.surfaceSecondary }],
                        ]}
                        onPress={() => handleRsvpSelect(option.id)}
                        disabled={loadingOptionId !== null}
                      >
                        <Text
                          style={[
                            styles.modalOptionLabel,
                            { color: colors.text },
                            isSelected && styles.modalOptionLabelSelected,
                          ]}
                        >
                          {option.label}
                        </Text>
                        {isLoading ? (
                          <ActivityIndicator size="small" color={DEFAULT_PRIMARY_COLOR} />
                        ) : (
                          isSelected && (
                            <Ionicons
                              name="checkmark-circle"
                              size={20}
                              color={DEFAULT_PRIMARY_COLOR}
                            />
                          )
                        )}
                      </TouchableOpacity>
                    );
                  })}
              </View>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Event Blast Sheet */}
      {canManageEvent && (
        <EventBlastSheet
          visible={showBlastSheet}
          meetingId={meetingId}
          eventTitle={displayTitle}
          onClose={() => setShowBlastSheet(false)}
          onSent={() => {}}
        />
      )}

      {/* Report Event Sheet (ADR-022) */}
      <ReportEventSheet
        visible={showReportSheet}
        meetingId={meetingId ? (meetingId as Id<"meetings">) : null}
        onClose={() => setShowReportSheet(false)}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    marginRight: 12,
    padding: 8,
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
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
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 180, // Space for floating RSVP buttons
  },
  adminNoteWrap: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 16,
    textTransform: "uppercase",
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
  },
  statusContainer: {
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  statusText: {
    fontSize: 14,
    textAlign: "center",
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    borderTopWidth: 1,
  },
  groupChatButton: {
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  groupChatButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  coverImage: {
    width: "100%",
    height: 200,
    marginBottom: 24,
    borderRadius: 12,
  },
  imagePlaceholder: {
    width: "100%",
    height: 200,
    marginBottom: 24,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  groupInfoCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  groupInfoText: {
    flex: 1,
  },
  groupName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  communityName: {
    fontSize: 14,
  },
  communityWideBadgeContainer: {
    marginBottom: 16,
  },
  detailCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  detailContent: {
    flex: 1,
    marginLeft: 12,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 16,
    lineHeight: 22,
  },
  linkText: {
    color: DEFAULT_PRIMARY_COLOR,
    fontWeight: "600",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  messageAttendeesButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  messageAttendeesText: {
    fontSize: 16,
    fontWeight: "600",
  },
  // RSVP styles
  rsvpContainer: {
    gap: 8,
  },
  rsvpOptionWrapper: {
    marginBottom: 4,
  },
  rsvpCountCard: {
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rsvpOptionContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rsvpOptionLabel: {
    fontSize: 16,
  },
  rsvpOptionLabelSelected: {
    color: DEFAULT_PRIMARY_COLOR,
    fontWeight: "600",
  },
  rsvpCountBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  rsvpCountText: {
    fontSize: 14,
    fontWeight: "600",
  },
  rsvpUsersList: {
    borderRadius: 12,
    marginTop: 4,
    marginLeft: 16,
    padding: 12,
  },
  rsvpUser: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    gap: 10,
  },
  rsvpUserAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#f0f0f0",
  },
  rsvpUserAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    justifyContent: "center",
    alignItems: "center",
  },
  rsvpUserAvatarText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  rsvpUserName: {
    fontSize: 14,
  },
  noUsersText: {
    fontSize: 14,
    fontStyle: "italic",
  },
  totalResponses: {
    fontSize: 12,
    marginTop: 8,
    textAlign: "center",
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  modalOptions: {
    padding: 20,
    gap: 12,
  },
  modalOption: {
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 2,
  },
  modalOptionSelected: {
    borderColor: DEFAULT_PRIMARY_COLOR,
  },
  modalOptionLabel: {
    fontSize: 16,
  },
  modalOptionLabelSelected: {
    color: DEFAULT_PRIMARY_COLOR,
    fontWeight: "600",
  },
});
