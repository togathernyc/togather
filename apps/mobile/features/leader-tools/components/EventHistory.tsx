import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Pressable,
} from "react-native";
import { AppImage } from "@components/ui/AppImage";
import { Ionicons } from "@expo/vector-icons";
import { format, addMonths, subMonths } from "date-fns";
import { useRouter } from "expo-router";
import { useMeetingDatesForMonth } from "../hooks";
import { MeetingSummary } from "../types";

interface EventHistoryProps {
  groupId: string;
  onNewEvent?: () => void;
  onEventPress: (event: MeetingSummary) => void;
  groupTypeName?: string;
  isLeader?: boolean;
}

export function EventHistory({
  groupId,
  onNewEvent,
  onEventPress,
  groupTypeName = "Event",
  isLeader = false,
}: EventHistoryProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const router = useRouter();

  // Fetch events for the current month
  const {
    data: meetingDatesData,
    isLoading,
    refetch,
  } = useMeetingDatesForMonth(groupId, currentMonth);

  // Log the data we receive for debugging
  if (__DEV__) {
    console.log("📅 EventHistory - Raw data:", {
      meetingDatesData,
      hasData: !!meetingDatesData,
      isArray: Array.isArray(meetingDatesData),
      dataType: typeof meetingDatesData,
      hasDataData: !!meetingDatesData?.data,
      isLoading,
    });
  }

  // Handle both { data: MeetingSummary[] } and MeetingSummary[] response formats
  const meetingDates: MeetingSummary[] = Array.isArray(meetingDatesData)
    ? meetingDatesData
    : Array.isArray(meetingDatesData?.data)
      ? meetingDatesData.data
      : [];

  if (__DEV__) {
    console.log("📅 EventHistory - Processed meetingDates:", {
      count: meetingDates.length,
      dates: meetingDates.map((m) => m.date),
      shortIds: meetingDates.map((m) => m.short_id),
    });
  }

  // Sort events by date (earliest first, latest last)
  const sortedEvents = [...meetingDates]
    .filter((event) => {
      // Filter out events with invalid dates
      if (!event.date) return false;
      try {
        const date = new Date(event.date);
        return !isNaN(date.getTime());
      } catch {
        return false;
      }
    })
    .sort((a, b) => {
      try {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) return 0;
        // Sort ascending: earliest date first
        return dateA.getTime() - dateB.getTime();
      } catch {
        return 0;
      }
    });

  const handlePreviousMonth = () => {
    setCurrentMonth(subMonths(currentMonth, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(addMonths(currentMonth, 1));
  };

  const isPastEvent = (eventDate: string) => {
    if (!eventDate) return false;
    try {
      const date = new Date(eventDate);
      if (isNaN(date.getTime())) return false;
      return date < new Date();
    } catch {
      return false;
    }
  };

  const getEventStatus = (event: MeetingSummary) => {
    if (isPastEvent(event.date)) {
      if (event.attendee_count !== undefined && event.attendee_count > 0) {
        return `${event.attendee_count} Attended`;
      }
      if (event.stats?.presentCount !== undefined) {
        return `${event.stats.presentCount || 0} Attended`;
      }
      return "0 Attended";
    }
    return "Scheduled";
  };

  const getEventSubtext = (event: MeetingSummary) => {
    if (!isPastEvent(event.date)) {
      // For future events, show RSVP count
      return "0 RSVPs"; // TODO: Get actual RSVP count from API
    }
    return null;
  };

  const handleNewEvent = () => {
    // Navigate to the new event creation screen
    router.push(`/(user)/create-event?hostingGroupId=${groupId}`);
  };

  const getEventTitle = (event: MeetingSummary, eventDate: Date): string => {
    // Use event name if available, otherwise use group type name
    if (event.name && event.name !== event.group_type_name) return event.name;
    return event.group_type_name || groupTypeName;
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.sectionTitle}>EVENT HISTORY</Text>
        {isLeader && (
          <TouchableOpacity
            style={styles.newEventButton}
            onPress={handleNewEvent}
          >
            <Text style={styles.newEventButtonText}>New Event</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Month Navigation */}
      <View style={styles.monthNavigation}>
        <TouchableOpacity
          style={styles.monthNavButton}
          onPress={handlePreviousMonth}
        >
          <Ionicons name="chevron-back" size={20} color="#666" />
        </TouchableOpacity>
        <Text style={styles.monthText}>
          {format(currentMonth, "MMMM yyyy")}
        </Text>
        <TouchableOpacity
          style={styles.monthNavButton}
          onPress={handleNextMonth}
        >
          <Ionicons name="chevron-forward" size={20} color="#666" />
        </TouchableOpacity>
      </View>

      {/* Events List */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading events...</Text>
        </View>
      ) : sortedEvents.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>
            No events scheduled for this month
          </Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.eventsScrollContent}
          nestedScrollEnabled={true}
        >
          {sortedEvents.map((event) => {
            if (!event.date) return null;

            let eventDate: Date | null = null;
            try {
              const parsed = new Date(event.date);
              if (!isNaN(parsed.getTime())) {
                eventDate = parsed;
              }
            } catch (error) {
              console.warn("Invalid date for event:", event.date, error);
            }

            if (!eventDate) return null;

            const title = getEventTitle(event, eventDate);
            const formattedDate = format(eventDate, "EEE, M/d"); // e.g., "Wed, 9/21"
            const isPast = isPastEvent(event.date);
            const attendeeCount = event.attendee_count || 0;

            return (
              <Pressable
                key={event.meeting_id || event.id || event.date}
                style={({ pressed }) => [
                  styles.eventCard,
                  pressed && styles.eventCardPressed,
                ]}
                onPress={() => {
                  console.log("📅 EventCard pressed:", { short_id: event.short_id, meeting_id: event.meeting_id });
                  onEventPress(event);
                }}
              >
                {/* Cover Image */}
                {(event as any).cover_image_url ? (
                  <AppImage
                    source={(event as any).cover_image_url}
                    style={styles.cardImage}
                    resizeMode="cover"
                    optimizedWidth={300}
                    placeholder={{ type: 'icon', icon: 'calendar' }}
                  />
                ) : (
                  <View style={styles.cardImagePlaceholder}>
                    <Text style={styles.cardImagePlaceholderText}>
                      {format(eventDate, "MMM")}
                    </Text>
                  </View>
                )}

                {/* Event Title */}
                <Text style={styles.cardName} numberOfLines={2}>
                  {title}
                </Text>

                {/* Date */}
                <Text style={styles.cardDate}>{formattedDate}</Text>

                {/* Attendee Count (only show if > 0) */}
                {isPast && attendeeCount > 0 && (
                  <View style={styles.cardStats}>
                    <Text style={styles.cardStatsValue}>{attendeeCount}</Text>
                    <Text style={styles.cardStatsLabel}>
                      {attendeeCount === 1 ? "person" : "people"}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 32,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    textTransform: "uppercase",
  },
  newEventButton: {
    backgroundColor: "#000",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  newEventButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  monthNavigation: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  monthNavButton: {
    padding: 8,
  },
  monthText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
  },
  eventsScrollContent: {
    paddingHorizontal: 20,
    gap: 12,
    paddingBottom: 8,
  },
  eventCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
    minWidth: 140,
    maxWidth: 160,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  eventCardPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  cardImage: {
    width: "100%",
    height: 100,
    backgroundColor: "#f0f0f0",
  },
  cardImagePlaceholder: {
    width: "100%",
    height: 100,
    backgroundColor: "#e8e8e8",
    justifyContent: "center",
    alignItems: "center",
  },
  cardImagePlaceholderText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#999",
    textTransform: "uppercase",
  },
  cardName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 4,
  },
  cardDate: {
    fontSize: 13,
    color: "#666",
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  cardStats: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  cardStatsValue: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  cardStatsLabel: {
    fontSize: 12,
    color: "#666",
  },
  loadingContainer: {
    padding: 20,
    alignItems: "center",
  },
  loadingText: {
    fontSize: 14,
    color: "#666",
  },
  emptyContainer: {
    padding: 20,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
    color: "#999",
  },
});
