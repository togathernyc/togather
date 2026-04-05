/**
 * CommunityWideEventsScreen - Management dashboard for community-wide events
 *
 * Allows community admins to view, edit, and cancel community-wide events
 * that spawn meetings across all groups of a specific type.
 */
import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { format, isPast } from "date-fns";
import { useQuery, useAuthenticatedMutation, api, Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { DEFAULT_PRIMARY_COLOR } from "../../../utils/styles";
import { formatError } from "@/utils/error-handling";

// Type for a community-wide event from the API
interface CommunityWideEvent {
  id: Id<"communityWideEvents">;
  communityId: Id<"communities">;
  groupTypeId: Id<"groupTypes">;
  groupTypeName: string;
  createdById: Id<"users">;
  title: string;
  scheduledAt: number;
  meetingType: number;
  meetingLink: string | null;
  note: string | null;
  status: "scheduled" | "cancelled";
  createdAt: number;
  updatedAt: number | null;
  totalMeetings: number;
  overriddenMeetings: number;
  firstChildMeetingId: Id<"meetings"> | null;
  firstChildGroupId: Id<"groups"> | null;
}

/**
 * Screen for community admins to manage community-wide events.
 * Shows upcoming and past events with stats and actions.
 */
export function CommunityWideEventsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { community, token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const communityId = community?.id as Id<"communities"> | undefined;

  // Fetch events using Convex
  const rawEvents = useQuery(
    api.functions.communityWideEvents.list,
    communityId && token ? { token, communityId } : "skip"
  );

  const isLoading = rawEvents === undefined;
  // Note: Convex queries throw errors rather than returning null, so error state
  // is handled via ErrorBoundary or try-catch in the parent component

  // Transform and group events
  const { upcomingEvents, pastEvents } = useMemo(() => {
    if (!rawEvents) {
      return { upcomingEvents: [], pastEvents: [] };
    }

    const events = rawEvents as CommunityWideEvent[];
    const now = Date.now();

    const upcoming: CommunityWideEvent[] = [];
    const past: CommunityWideEvent[] = [];

    events.forEach((event) => {
      if (event.scheduledAt > now && event.status !== "cancelled") {
        upcoming.push(event);
      } else {
        past.push(event);
      }
    });

    // Sort upcoming by scheduledAt ascending (soonest first)
    upcoming.sort((a, b) => a.scheduledAt - b.scheduledAt);
    // Sort past by scheduledAt descending (most recent first)
    past.sort((a, b) => b.scheduledAt - a.scheduledAt);

    return { upcomingEvents: upcoming, pastEvents: past };
  }, [rawEvents]);

  // Cancel mutation
  const cancelEvent = useAuthenticatedMutation(api.functions.communityWideEvents.cancel);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    // Convex queries auto-refresh, just wait a moment
    await new Promise((resolve) => setTimeout(resolve, 500));
    setIsRefreshing(false);
  }, []);

  const handleCancel = useCallback(
    (event: CommunityWideEvent) => {
      Alert.alert(
        "Cancel Event",
        `Are you sure you want to cancel "${event.title}"?\n\nThis will cancel all ${event.totalMeetings} associated group meetings and cannot be undone.`,
        [
          { text: "Keep Event", style: "cancel" },
          {
            text: "Cancel Event",
            style: "destructive",
            onPress: async () => {
              setIsCancelling(true);
              try {
                await cancelEvent({
                  communityWideEventId: event.id,
                });
                Alert.alert("Success", "Event cancelled successfully");
              } catch (error: any) {
                Alert.alert("Error", formatError(error, "Failed to cancel event"));
              } finally {
                setIsCancelling(false);
              }
            },
          },
        ]
      );
    },
    [cancelEvent]
  );

  const handleEdit = useCallback(
    (event: CommunityWideEvent) => {
      if (!event.firstChildMeetingId || !event.firstChildGroupId) {
        Alert.alert("Error", "No child meetings found for this event.");
        return;
      }
      const dateStr = format(new Date(event.scheduledAt), "EEE, MMM d, yyyy 'at' h:mm a");
      const eventIdentifier = `id-${event.firstChildMeetingId}|${encodeURIComponent(dateStr)}`;
      router.push(
        `/(user)/leader-tools/${event.firstChildGroupId}/events/${eventIdentifier}/edit`
      );
    },
    [router]
  );

  const formatDateTime = (timestamp: number) => {
    try {
      return format(new Date(timestamp), "EEE, MMM d, yyyy 'at' h:mm a");
    } catch {
      return "Unknown date";
    }
  };

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={primaryColor} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading events...</Text>
      </View>
    );
  }

  const isEmpty = upcomingEvents.length === 0 && pastEvents.length === 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.surfaceSecondary }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Community-Wide Events</Text>
        <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
          {isEmpty
            ? "No events created yet"
            : `${upcomingEvents.length} upcoming, ${pastEvents.length} past`}
        </Text>
      </View>

      {isEmpty ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="calendar-outline" size={64} color={primaryColor} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No Events Yet</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Community-wide events you create will appear here. These events automatically create meetings across all groups of a specific type.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
          }
        >
          {/* Upcoming Events Section */}
          {upcomingEvents.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Upcoming</Text>
              {upcomingEvents.map((event) => (
                <EventCard
                  key={String(event.id)}
                  event={event}
                  onEdit={handleEdit}
                  onCancel={handleCancel}
                  formatDateTime={formatDateTime}
                  primaryColor={primaryColor}
                  isCancelling={isCancelling}
                />
              ))}
            </View>
          )}

          {/* Past Events Section */}
          {pastEvents.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Past & Cancelled</Text>
              {pastEvents.map((event) => (
                <EventCard
                  key={String(event.id)}
                  event={event}
                  onEdit={handleEdit}
                  onCancel={handleCancel}
                  formatDateTime={formatDateTime}
                  primaryColor={primaryColor}
                  isCancelling={isCancelling}
                />
              ))}
            </View>
          )}

          <View style={styles.bottomPadding} />
        </ScrollView>
      )}
    </View>
  );
}

// Event card component
interface EventCardProps {
  event: CommunityWideEvent;
  onEdit: (event: CommunityWideEvent) => void;
  onCancel: (event: CommunityWideEvent) => void;
  formatDateTime: (timestamp: number) => string;
  primaryColor: string;
  isCancelling: boolean;
}

function EventCard({
  event,
  onEdit,
  onCancel,
  formatDateTime,
  primaryColor,
  isCancelling,
}: EventCardProps) {
  const { colors } = useTheme();
  const isCancelled = event.status === "cancelled";
  const isPastEvent = isPast(new Date(event.scheduledAt));
  const canEdit = !isCancelled;
  const canCancel = !isCancelled && !isPastEvent;

  return (
    <View style={[styles.eventCard, { backgroundColor: colors.surface }, isCancelled && styles.eventCardCancelled]}>
      {/* Event Header */}
      <View style={styles.eventHeader}>
        <View style={styles.eventTitleRow}>
          <Text style={[styles.eventTitle, { color: colors.text }, isCancelled && [styles.eventTitleCancelled, { color: colors.textTertiary }]]}>
            {event.title}
          </Text>
          <StatusBadge status={event.status} isPast={isPastEvent} />
        </View>
        <Text style={[styles.eventDateTime, { color: colors.textSecondary }]}>{formatDateTime(event.scheduledAt)}</Text>
      </View>

      {/* Event Details */}
      <View style={[styles.eventDetails, { borderTopColor: colors.borderLight }]}>
        <View style={styles.eventDetailRow}>
          <Ionicons name="folder-outline" size={16} color={colors.textSecondary} />
          <Text style={[styles.eventDetailText, { color: colors.textSecondary }]}>{event.groupTypeName}</Text>
        </View>
        <View style={styles.eventDetailRow}>
          <Ionicons name="people-outline" size={16} color={colors.textSecondary} />
          <Text style={[styles.eventDetailText, { color: colors.textSecondary }]}>
            {event.totalMeetings} group{event.totalMeetings !== 1 ? "s" : ""}
            {event.overriddenMeetings > 0 && (
              <Text style={[styles.overriddenText, { color: colors.warning }]}>
                {" "}({event.overriddenMeetings} overridden)
              </Text>
            )}
          </Text>
        </View>
        {event.meetingType === 2 && event.meetingLink && (
          <View style={styles.eventDetailRow}>
            <Ionicons name="videocam-outline" size={16} color={colors.textSecondary} />
            <Text style={[styles.eventDetailText, { color: colors.textSecondary }]} numberOfLines={1}>
              Online meeting
            </Text>
          </View>
        )}
      </View>

      {/* Actions — Edit always available (except cancelled), Cancel only for upcoming */}
      {(canEdit || canCancel) && (
        <View style={[styles.eventActions, { borderTopColor: colors.borderLight }]}>
          {canEdit && (
            <TouchableOpacity
              style={[styles.actionButton, { borderColor: primaryColor }]}
              onPress={() => onEdit(event)}
            >
              <Ionicons name="pencil-outline" size={16} color={primaryColor} />
              <Text style={[styles.actionButtonText, { color: primaryColor }]}>Edit</Text>
            </TouchableOpacity>
          )}
          {canCancel && (
            <TouchableOpacity
              style={[styles.actionButton, styles.cancelActionButton]}
              onPress={() => onCancel(event)}
              disabled={isCancelling}
            >
              <Ionicons name="close-circle-outline" size={16} color="#FF6B6B" />
              <Text style={styles.cancelActionButtonText}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

// Status badge component
function StatusBadge({ status, isPast }: { status: string; isPast: boolean }) {
  let backgroundColor = "#E8F5E9";
  let textColor = "#2E7D32";
  let text = "Scheduled";

  if (status === "cancelled") {
    backgroundColor = "#FFEBEE";
    textColor = "#C62828";
    text = "Cancelled";
  } else if (isPast) {
    backgroundColor = "#F5F5F5";
    textColor = "#666";
    text = "Completed";
  }

  return (
    <View style={[styles.statusBadge, { backgroundColor }]}>
      <Text style={[styles.statusBadgeText, { color: textColor }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  errorText: {
    marginTop: 12,
    fontSize: 16,
    color: "#FF6B6B",
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  header: {
    padding: 20,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
  },
  headerSubtitle: {
    fontSize: 14,
    marginTop: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
    maxWidth: 300,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  eventCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  eventCardCancelled: {
    opacity: 0.7,
  },
  eventHeader: {
    marginBottom: 12,
  },
  eventTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  eventTitle: {
    fontSize: 18,
    fontWeight: "600",
    flex: 1,
  },
  eventTitleCancelled: {
    textDecorationLine: "line-through",
  },
  eventDateTime: {
    fontSize: 14,
    marginTop: 4,
  },
  eventDetails: {
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  eventDetailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  eventDetailText: {
    fontSize: 14,
  },
  overriddenText: {
    fontStyle: "italic",
  },
  eventActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  cancelActionButton: {
    borderColor: "#FF6B6B",
  },
  cancelActionButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FF6B6B",
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  bottomPadding: {
    height: 40,
  },
});
