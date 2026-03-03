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
} from "react-native";
import { useRouter } from "expo-router";
import { format, toZonedTime } from "date-fns-tz";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { useQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { Avatar } from "@components/ui/Avatar";
import { AppImage } from "@components/ui/AppImage";
import { CommunityWideBadge } from "@components/ui/CommunityWideBadge";
import { FloatingRsvpButtons } from "./FloatingRsvpButtons";
import { FloatingRsvpCard } from "./FloatingRsvpCard";
import { GuestListSection } from "./GuestListSection";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { DOMAIN_CONFIG } from "@togather/shared";
import * as Clipboard from "expo-clipboard";
import { DragHandle } from "@components/ui/DragHandle";

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
  const router = useRouter();
  const { user } = useAuth();

  // Get user's timezone (default to America/New_York if not set)
  const userTimezone = user?.timezone || 'America/New_York';

  const [expandedOption, setExpandedOption] = useState<number | null>(null);
  const [loadingOptionId, setLoadingOptionId] = useState<number | null>(null);
  const [showRsvpSheet, setShowRsvpSheet] = useState(false);
  const [isSubmittingRsvp, setIsSubmittingRsvp] = useState(false);

  // Fetch meeting details if meetingId is available (using Convex)
  // NOTE: This must be called before any conditional returns (Rules of Hooks)
  const meetingData = useQuery(
    api.functions.meetings.index.getWithDetails,
    groupId && meetingId ? { meetingId: meetingId as Id<"meetings"> } : "skip"
  );
  const meeting = meetingData ?? undefined;
  const isLoadingMeeting = groupId && meetingId && meetingData === undefined;

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
    <View style={styles.container}>
      <DragHandle />
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          testID="back-button"
          style={styles.backButton}
          onPress={onBack}
        >
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {displayTitle}
          </Text>
        </View>
        {/* Share Button */}
        <TouchableOpacity
          testID="share-button"
          style={styles.shareButton}
          onPress={handleShare}
        >
          <Ionicons name="share-outline" size={22} color="#333" />
        </TouchableOpacity>
        {isLeader && (
          <TouchableOpacity
            testID="edit-button"
            style={styles.editButton}
            onPress={handleEdit}
          >
            <Text style={styles.editButtonText}>Edit</Text>
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
            <ActivityIndicator size="small" color="#666" />
            <Text style={styles.loadingText}>Loading event details...</Text>
          </View>
        ) : (
          <>
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
              <View style={styles.imagePlaceholder}>
                <Ionicons name="calendar" size={48} color="#9CA3AF" />
              </View>
            )}

            {/* Group Info Section */}
            {meeting?.group && (
              <View style={styles.groupInfoCard}>
                <Avatar
                  name={meeting.group.name}
                  imageUrl={meeting.group.preview || null}
                  size={48}
                />
                <View style={styles.groupInfoText}>
                  <Text style={styles.groupName}>{meeting.group.name}</Text>
                </View>
              </View>
            )}

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

            {/* Event Details Section */}
            <Text style={styles.sectionTitle}>EVENT DETAILS</Text>

            {/* Date and Time */}
            <View style={styles.detailCard}>
              <View style={styles.detailRow}>
                <Ionicons name="calendar-outline" size={20} color="#666" />
                <View style={styles.detailContent}>
                  <Text style={styles.detailLabel}>Date & Time</Text>
                  <Text style={styles.detailValue}>
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
              <View style={styles.detailCard}>
                <Pressable
                  style={styles.detailRow}
                  onPress={handleLocationPress}
                >
                  <Ionicons name="location-outline" size={20} color="#666" />
                  <View style={styles.detailContent}>
                    <Text style={styles.detailLabel}>Location</Text>
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
              <View style={styles.detailCard}>
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
                    <Text style={styles.detailLabel}>Meeting Link</Text>
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
              <View style={styles.detailCard}>
                <View style={styles.detailRow}>
                  <Ionicons
                    name="document-text-outline"
                    size={20}
                    color="#666"
                  />
                  <View style={styles.detailContent}>
                    <Text style={styles.detailLabel}>Description</Text>
                    <Text style={styles.detailValue}>{displayNote}</Text>
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
                <Text style={[styles.sectionTitle, { marginTop: 24 }]}>RESPONSES</Text>
                <View style={styles.rsvpContainer}>
                  {isLoadingRsvp ? (
                    <ActivityIndicator size="small" color="#666" />
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
                              style={styles.rsvpCountCard}
                              onPress={() => toggleExpandOption(option.id)}
                            >
                              <View style={styles.rsvpOptionContent}>
                                <Text style={styles.rsvpOptionLabel}>
                                  {option.label}
                                </Text>
                              </View>
                              <View style={styles.rsvpCountBadge}>
                                <Text style={styles.rsvpCountText}>{count}</Text>
                                <Ionicons
                                  name={isExpanded ? "chevron-up" : "chevron-down"}
                                  size={14}
                                  color="#666"
                                />
                              </View>
                            </TouchableOpacity>

                            {/* Expanded users list */}
                            {isExpanded && users.length > 0 && (
                              <View style={styles.rsvpUsersList}>
                                {users.map((user) => (
                                  <View key={user.id} style={styles.rsvpUser}>
                                    <Avatar
                                      name={`${user.firstName} ${user.lastName}`}
                                      imageUrl={user.profileImage || null}
                                      size={32}
                                    />
                                    <Text style={styles.rsvpUserName}>
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
                  <Text style={styles.totalResponses}>
                    {rsvpData.total} {rsvpData.total === 1 ? "response" : "responses"}
                  </Text>
                )}
              </>
            )}

            {/* Event Status */}
            {isPastEvent && (
              <View style={styles.statusContainer}>
                <Text style={styles.statusText}>This event has passed</Text>
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
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowRsvpSheet(false)}
        >
          <View style={styles.modalContent}>
            <TouchableOpacity
              activeOpacity={1}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Change your RSVP</Text>
                <TouchableOpacity onPress={() => setShowRsvpSheet(false)}>
                  <Ionicons name="close" size={24} color="#333" />
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
                          isSelected && styles.modalOptionSelected,
                        ]}
                        onPress={() => handleRsvpSelect(option.id)}
                        disabled={loadingOptionId !== null}
                      >
                        <Text
                          style={[
                            styles.modalOptionLabel,
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
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
    color: "#333",
  },
  shareButton: {
    padding: 8,
    marginRight: 8,
  },
  editButton: {
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 180, // Space for floating RSVP buttons
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
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
    color: "#666",
  },
  statusContainer: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  statusText: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
  },
  groupChatButton: {
    backgroundColor: "#333",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  groupChatButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  coverImage: {
    width: "100%",
    height: 200,
    backgroundColor: "#f0f0f0",
    marginBottom: 24,
    borderRadius: 12,
  },
  imagePlaceholder: {
    width: "100%",
    height: 200,
    backgroundColor: "#E5E5E5",
    marginBottom: 24,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  groupInfoCard: {
    backgroundColor: "#fff",
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
    color: "#333",
    marginBottom: 2,
  },
  communityName: {
    fontSize: 14,
    color: "#666",
  },
  communityWideBadgeContainer: {
    marginBottom: 16,
  },
  detailCard: {
    backgroundColor: "#fff",
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
    color: "#666",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 16,
    color: "#333",
    lineHeight: 22,
  },
  linkText: {
    color: DEFAULT_PRIMARY_COLOR,
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
    backgroundColor: "#fff",
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
    color: "#333",
  },
  rsvpOptionLabelSelected: {
    color: DEFAULT_PRIMARY_COLOR,
    fontWeight: "600",
  },
  rsvpCountBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  rsvpCountText: {
    fontSize: 14,
    color: "#666",
    fontWeight: "600",
  },
  rsvpUsersList: {
    backgroundColor: "#fff",
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
    color: "#333",
  },
  noUsersText: {
    fontSize: 14,
    color: "#999",
    fontStyle: "italic",
  },
  totalResponses: {
    fontSize: 12,
    color: "#666",
    marginTop: 8,
    textAlign: "center",
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#fff",
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
    borderBottomColor: "#e0e0e0",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  modalOptions: {
    padding: 20,
    gap: 12,
  },
  modalOption: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 2,
    borderColor: "#e0e0e0",
  },
  modalOptionSelected: {
    borderColor: DEFAULT_PRIMARY_COLOR,
    backgroundColor: "#F8F0FF",
  },
  modalOptionLabel: {
    fontSize: 16,
    color: "#333",
  },
  modalOptionLabelSelected: {
    color: DEFAULT_PRIMARY_COLOR,
    fontWeight: "600",
  },
});
