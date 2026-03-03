import React, { useRef, useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  LayoutChangeEvent,
} from "react-native";
import { AppImage } from "@components/ui/AppImage";
import { useQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { format } from "date-fns";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";

interface EventsListProps {
  groupId: string;
  selectedDate: string | null;
  onEventSelect: (meetingId: string | null, date: string) => void;
}

interface EventCardData {
  date: string;
  meetingId: string | null;
  name: string;
  groupTypeName: string;
  coverImageUrl?: string | null;
  isPast: boolean;
  rsvpCount: number;
  attendanceCount: number;
}

export function EventsList({
  groupId,
  selectedDate,
  onEventSelect,
}: EventsListProps) {
  // Hooks must be called before any conditional returns
  const scrollViewRef = useRef<ScrollView>(null);
  const hasScrolledToMostRecent = useRef(false);
  const [viewportWidth, setViewportWidth] = useState<number>(0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Fetch meetings from past 90 days to future 90 days (using Convex)
  const meetingsData = useQuery(
    api.functions.meetings.index.listByGroup,
    groupId ? {
      groupId: groupId as Id<"groups">,
      includeCompleted: true,
      includeCancelled: false
    } : "skip"
  );
  const isLoading = groupId && meetingsData === undefined;

  // Convert Convex response to event format expected by the component
  // Convex stores scheduledAt as a timestamp number
  const meetings = meetingsData || [];
  const events: Array<{
    meeting_id: string | null;
    name: string;
    date: string;
    attendee_count: number;
    cover_image_url?: string | null;
    group_type_name?: string;
  }> = meetings.map((meeting) => ({
    meeting_id: meeting._id,
    name: meeting.title || "Meeting",
    // Convert timestamp to ISO string
    date: new Date(meeting.scheduledAt).toISOString(),
    // Total people = attended members + guests
    attendee_count: (meeting.attendanceCount || 0) + (meeting.guestCount || 0),
    cover_image_url: meeting.coverImage || null,
    group_type_name: "Meeting",
  }));

  // Build event card data from simplified API response
  const eventsWithStats: EventCardData[] = events
    .map((event) => {
      if (!event.date) {
        return null;
      }

      const meetingDate = new Date(event.date);
      // Skip if date is invalid
      if (isNaN(meetingDate.getTime())) {
        return null;
      }
      meetingDate.setHours(0, 0, 0, 0);
      const isPast = meetingDate < today;

      return {
        date: event.date,
        meetingId: event.meeting_id,
        name: event.name,
        groupTypeName: event.group_type_name || "Meeting", // Fallback for frontend
        coverImageUrl: event.cover_image_url || null,
        isPast,
        attendanceCount: event.attendee_count ?? 0,
        rsvpCount: 0, // RSVP not included in simplified response
      };
    })
    .filter((event): event is NonNullable<typeof event> => event !== null); // Remove null entries

  // Filter out events with invalid dates and sort by date (earliest first, latest last)
  // Always sort here to ensure correct order regardless of backend ordering
  const sortedEvents = [...eventsWithStats]
    .filter((event) => {
      if (!event.date) return false;
      const date = new Date(event.date);
      return !isNaN(date.getTime());
    })
    .sort((a, b) => {
      // Sort ascending: earliest date first
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return dateA - dateB;
    });

  // Find the most recent event (today's event, or most recently past event)
  // Priority: 1) Today's event, 2) Most recently past event, 3) Future events only if no past/today events exist
  const mostRecentEventIndex =
    sortedEvents.length > 0
      ? (() => {
          // First, try to find today's event
          const todayEventIndex = sortedEvents.findIndex((event) => {
            const eventDate = new Date(event.date);
            eventDate.setHours(0, 0, 0, 0);
            return eventDate.getTime() === today.getTime();
          });

          if (todayEventIndex >= 0) {
            return todayEventIndex;
          }

          // If no today's event, find the most recently past event
          const pastEvents = sortedEvents
            .map((event, index) => {
              const eventDate = new Date(event.date);
              eventDate.setHours(0, 0, 0, 0);
              return { event, index, date: eventDate };
            })
            .filter(({ date }) => date < today)
            .sort((a, b) => b.date.getTime() - a.date.getTime()); // Sort descending (most recent first)

          if (pastEvents.length > 0) {
            return pastEvents[0].index;
          }

          // Fallback: if no past events, use the first future event (closest to today)
          const futureEventIndex = sortedEvents.findIndex((event) => {
            const eventDate = new Date(event.date);
            eventDate.setHours(0, 0, 0, 0);
            return eventDate > today;
          });

          return futureEventIndex >= 0 ? futureEventIndex : 0;
        })()
      : -1;

  // Find the index of the selected date event, or fall back to most recent event
  const targetEventIndex = selectedDate
    ? sortedEvents.findIndex((event) => {
        // Compare dates by day (ignore time) to handle timezone issues
        const eventDate = new Date(event.date);
        eventDate.setHours(0, 0, 0, 0);
        const selectedDateObj = new Date(selectedDate);
        selectedDateObj.setHours(0, 0, 0, 0);
        return eventDate.getTime() === selectedDateObj.getTime();
      })
    : -1;

  const scrollToIndex =
    targetEventIndex >= 0 ? targetEventIndex : mostRecentEventIndex;

  // Function to calculate and perform scroll to center the card
  const scrollToCenterCard = useCallback(
    (index: number) => {
      if (!scrollViewRef.current || index < 0 || viewportWidth === 0) {
        return;
      }

      // Calculate card width (minWidth 120 + padding 16*2 = 152, plus gap 12)
      const cardWidth = 152;
      const gap = 12;
      const initialPadding = 20;

      // Calculate position to center the card in viewport
      // Position = card center - viewport center
      const cardCenter =
        initialPadding + index * (cardWidth + gap) + cardWidth / 2;
      const viewportCenter = viewportWidth / 2;
      const scrollPosition = Math.max(0, cardCenter - viewportCenter);

      scrollViewRef.current.scrollTo({
        x: scrollPosition,
        animated: false,
      });
      hasScrolledToMostRecent.current = true;
    },
    [viewportWidth]
  );

  // Handle viewport width measurement
  const handleLayout = (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    if (width > 0 && width !== viewportWidth) {
      setViewportWidth(width);
    }
  };

  // Handle content size change (for additional layout stability)
  const handleContentSizeChange = useCallback(() => {
    if (
      !isLoading &&
      sortedEvents.length > 0 &&
      scrollToIndex >= 0 &&
      !hasScrolledToMostRecent.current
    ) {
      // Small delay to ensure layout is complete
      setTimeout(() => {
        scrollToCenterCard(scrollToIndex);
      }, 50);
    }
  }, [isLoading, sortedEvents.length, scrollToIndex, scrollToCenterCard]);

  // Scroll to selected/most recent event on initial load or when selectedDate/viewport changes
  useEffect(() => {
    if (
      !isLoading &&
      sortedEvents.length > 0 &&
      scrollToIndex >= 0 &&
      viewportWidth > 0 &&
      !hasScrolledToMostRecent.current
    ) {
      // Use setTimeout to ensure layout is complete
      setTimeout(() => {
        scrollToCenterCard(scrollToIndex);
      }, 100);
    }
  }, [
    isLoading,
    sortedEvents.length,
    scrollToIndex,
    selectedDate,
    viewportWidth,
    scrollToCenterCard,
  ]);

  // Reset scroll flag when selectedDate changes (user manually selects a different event)
  useEffect(() => {
    if (selectedDate && scrollToIndex >= 0 && viewportWidth > 0) {
      hasScrolledToMostRecent.current = false;
      setTimeout(() => {
        scrollToCenterCard(scrollToIndex);
      }, 100);
    }
  }, [selectedDate, scrollToIndex, viewportWidth, scrollToCenterCard]);

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Text style={styles.sectionTitle}>Events</Text>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color="#666" />
          <Text style={styles.loadingText}>Loading events...</Text>
        </View>
      </View>
    );
  }

  if (sortedEvents.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.sectionTitle}>Events</Text>
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>No events scheduled</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Events</Text>
      <View onLayout={handleLayout} style={styles.scrollViewContainer}>
        <ScrollView
          ref={scrollViewRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          onContentSizeChange={handleContentSizeChange}
        >
          {sortedEvents.map((event) => (
            <EventCard
              // FIX for Issue #303: Use meetingId as key instead of date
              // to avoid React key collisions when multiple events exist on the same day
              key={event.meetingId || event.date}
              event={event}
              isSelected={selectedDate === event.date}
              onPress={() => {
                onEventSelect(event.meetingId, event.date);
              }}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

interface EventCardProps {
  event: EventCardData;
  isSelected: boolean;
  onPress: () => void;
}

// EventCard is now a pure presentational component - no API calls
// Stats are passed from parent via the event prop (already fetched in bulk)
function EventCard({ event, isSelected, onPress }: EventCardProps) {
  if (!event.date) {
    return null; // Skip rendering if date is missing
  }

  const eventDate = new Date(event.date);

  // Check if date is valid
  if (isNaN(eventDate.getTime())) {
    return null; // Skip rendering if date is invalid
  }

  // Format date as "Wed, 9/21"
  const formattedDate = format(eventDate, "EEE, M/d");

  // Use event name if available, otherwise use group type name as fallback
  // If name is just the group type name (no custom title), use it directly
  const eventTitle =
    event.name && event.name !== event.groupTypeName
      ? event.name
      : event.groupTypeName;

  return (
    <TouchableOpacity
      style={[styles.card, isSelected && styles.cardSelected]}
      onPress={onPress}
    >
      {/* Cover Image */}
      {event.coverImageUrl ? (
        <AppImage
          source={event.coverImageUrl}
          style={styles.cardImage}
          resizeMode="cover"
          optimizedWidth={400}
          placeholder={{ type: 'icon', icon: 'calendar' }}
        />
      ) : (
        <View style={styles.cardImagePlaceholder}>
          <Text style={styles.cardImagePlaceholderText}>
            {format(eventDate, "MMM")}
          </Text>
        </View>
      )}

      {/* Event Title - Always shown */}
      <Text style={styles.cardName} numberOfLines={2}>
        {eventTitle}
      </Text>

      {/* Date - Always shown */}
      <Text style={styles.cardDate}>{formattedDate}</Text>

      {/* Attendee Count (only show if > 0) */}
      {event.isPast && event.attendanceCount > 0 && (
        <View style={styles.cardStats}>
          <Text style={styles.cardStatsValue}>{event.attendanceCount}</Text>
          <Text style={styles.cardStatsLabel}>
            {event.attendanceCount === 1 ? "person" : "people"}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  scrollViewContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    gap: 12,
  },
  loadingContainer: {
    padding: 20,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 8,
    fontSize: 14,
    color: "#666",
  },
  emptyState: {
    padding: 20,
    alignItems: "center",
  },
  emptyStateText: {
    fontSize: 14,
    color: "#666",
  },
  card: {
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
  cardSelected: {
    borderColor: DEFAULT_PRIMARY_COLOR,
    borderWidth: 2,
    backgroundColor: "#f8f5ff",
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
});
