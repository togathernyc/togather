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
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { waAccentPalette } from "@utils/waPalette";
import { WaSectionLabel } from "@components/wa/WaSectionLabel";
import {
  WA_GROUP_MARGIN,
  WA_GROUP_SPACING,
  WA_SECTION_HEADER_GAP,
  WA_ACTION_CARD_RADIUS,
} from "@components/wa/metrics";

/**
 * Event-card metrics. The horizontal picker centers the selected card, so the
 * scroll math and the card styles have to agree on one width — keep these the
 * single source for both.
 */
const CARD_WIDTH = 132;
const CARD_GAP = 12;
const CARD_IMAGE_HEIGHT = 76;
const CARD_RADIUS = WA_ACTION_CARD_RADIUS;

/**
 * Horizontal scroll offset that centers the card at `index` in a viewport of
 * `viewportWidth`. Clamped at 0 so the first cards don't scroll past the strip's
 * leading edge. Exported for test — the arithmetic has to track the card
 * metrics above, and it silently mis-centers if it drifts.
 */
export function eventCardScrollOffset(
  index: number,
  viewportWidth: number
): number {
  const cardCenter =
    WA_GROUP_MARGIN + index * (CARD_WIDTH + CARD_GAP) + CARD_WIDTH / 2;
  return Math.max(0, cardCenter - viewportWidth / 2);
}

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
  const { colors } = useTheme();
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

      scrollViewRef.current.scrollTo({
        x: eventCardScrollOffset(index, viewportWidth),
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
        <WaSectionLabel variant="header">Events</WaSectionLabel>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading events...</Text>
        </View>
      </View>
    );
  }

  if (sortedEvents.length === 0) {
    return (
      <View style={styles.container}>
        <WaSectionLabel variant="header">Events</WaSectionLabel>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>No events scheduled</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WaSectionLabel variant="header">Events</WaSectionLabel>
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
// Stats are passed from parent via the event prop (already fetched in bulk).
// Exported so the `/ui-test/attendance` visual harness can render the picker
// without a Convex backend.
export function EventCard({ event, isSelected, onPress }: EventCardProps) {
  const { colors, isDark } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const accent = waAccentPalette(primaryColor, isDark).accent;
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
      style={[
        styles.card,
        { backgroundColor: colors.surfaceGrouped, borderColor: colors.separator },
        // Colour only — changing borderWidth on a fixed-width card would shrink
        // the content box and nudge the title as you select through the strip.
        isSelected && { borderColor: accent },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
    >
      {/* Cover Image */}
      {event.coverImageUrl ? (
        <AppImage
          source={event.coverImageUrl}
          style={[styles.cardImage, { backgroundColor: colors.backgroundGrouped }]}
          resizeMode="cover"
          optimizedWidth={400}
          placeholder={{ type: 'icon', icon: 'calendar' }}
        />
      ) : (
        <View style={[styles.cardImagePlaceholder, { backgroundColor: colors.backgroundGrouped }]}>
          <Text style={[styles.cardImagePlaceholderText, { color: colors.textTertiary }]}>
            {format(eventDate, "MMM d")}
          </Text>
        </View>
      )}

      <View style={styles.cardBody}>
        {/* Event Title - Always shown */}
        <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={2}>
          {eventTitle}
        </Text>

        {/* Date + headcount share one metadata line so the card stays short */}
        <Text style={[styles.cardMeta, { color: colors.textTertiary }]} numberOfLines={1}>
          {formattedDate}
          {event.isPast && event.attendanceCount > 0
            ? ` · ${event.attendanceCount}`
            : ""}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: WA_GROUP_SPACING,
  },
  scrollViewContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: WA_GROUP_MARGIN,
    paddingTop: WA_SECTION_HEADER_GAP,
    gap: CARD_GAP,
  },
  loadingContainer: {
    padding: 20,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 8,
    fontSize: 14,
  },
  emptyState: {
    padding: 20,
    alignItems: "center",
  },
  emptyStateText: {
    fontSize: 14,
  },
  // WA cards are flat: hairline border on the grouped fill, no drop shadow.
  card: {
    width: CARD_WIDTH,
    borderRadius: CARD_RADIUS,
    overflow: "hidden",
    borderWidth: 2,
  },
  cardImage: {
    width: "100%",
    height: CARD_IMAGE_HEIGHT,
  },
  cardImagePlaceholder: {
    width: "100%",
    height: CARD_IMAGE_HEIGHT,
    justifyContent: "center",
    alignItems: "center",
  },
  cardImagePlaceholderText: {
    fontSize: 15,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  cardBody: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
  },
  cardName: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "600",
    // Two lines' worth of box on every card so the date line stays on one
    // baseline across the strip, whether the title wraps or not.
    height: 38,
  },
  cardMeta: {
    fontSize: 13,
    marginTop: 2,
  },
});
