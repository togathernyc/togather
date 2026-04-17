/**
 * Group Events Modal Screen
 *
 * Full-screen modal showing events for a specific group with map + list.
 * Opened from chat or leader tools, allows viewing all group events.
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  SectionList,
  TextInput,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import BottomSheet, {
  BottomSheetSectionList,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";

const isWeb = Platform.OS === "web";
import { useQuery, api, Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { ExploreMap, MapBounds } from "@features/explore/components/ExploreMap";
import { EventCard } from "@features/events/components/EventCard";
import { EventsFilterModal } from "@features/events/components/EventsFilterModal";
import { COLORS } from "@features/explore/constants";
import { getGroupCoordinates, geocodeAddressAsync } from "@features/groups/utils/geocodeLocation";
import { Group } from "@features/groups/types";
import type { CommunityEvent } from "@features/events/hooks/useCommunityEvents";
import type {
  DateFilterPreset,
  ExploreFilters,
} from "@features/explore/hooks/useExploreFilters";
import { useTheme } from "@hooks/useTheme";

const mapboxToken =
  Constants.expoConfig?.extra?.mapboxAccessToken ||
  process.env.EXPO_PUBLIC_MAPBOX_TOKEN ||
  "";

export default function GroupEventsModal() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    groupId: string;
    groupName?: string;
  }>();
  const groupId = params.groupId;
  const groupName = params.groupName || "Events";

  const bottomSheetRef = useRef<BottomSheet>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isFilterModalVisible, setIsFilterModalVisible] = useState(false);

  // Filter state
  const [dateFilter, setDateFilter] = useState<DateFilterPreset | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(
    groupId ? [groupId] : []
  );
  const [groupSearchQuery, setGroupSearchQuery] = useState("");

  // Snap points for bottom sheet
  const snapPoints = useMemo(() => ["12%", "50%", "75%"], []);
  const topInset = insets.top + 60; // Extra space for header

  // Get community and auth token from auth context
  const { community, token } = useAuth();

  // Fetch only the selected groups' details (for display in filter)
  // Convert string IDs to Convex IDs
  const selectedGroupsData = useQuery(
    api.functions.groups.queries.byIds,
    selectedGroupIds.length > 0
      ? { groupIds: selectedGroupIds as Id<"groups">[] }
      : "skip"
  );

  // Search for groups when user types in filter modal
  const searchResultsData = useQuery(
    api.functions.groupSearch.searchGroups,
    groupSearchQuery.length >= 2 && community?.id
      ? { communityId: community.id as Id<"communities">, query: groupSearchQuery }
      : "skip"
  );
  const isSearchingGroups = searchResultsData === undefined && groupSearchQuery.length >= 2;

  // Transform selected groups for filter modal
  const selectedGroups = useMemo(() => {
    if (!selectedGroupsData || !Array.isArray(selectedGroupsData)) return [];
    return selectedGroupsData.map((g: any) => ({
      id: g.id,
      name: g.name,
      groupTypeName: g.groupTypeName,
      preview: g.preview,
    }));
  }, [selectedGroupsData]);

  // Transform search results for filter modal
  const searchResults = useMemo(() => {
    if (!searchResultsData || !Array.isArray(searchResultsData)) return [];
    return searchResultsData.map((g: any) => ({
      id: g.id,
      name: g.name,
      groupTypeName: g.groupTypeName,
      preview: g.preview,
    }));
  }, [searchResultsData]);

  // Handle group search from filter modal
  const handleSearchGroups = useCallback((query: string) => {
    setGroupSearchQuery(query);
  }, []);

  // Determine if showing all events (no group filter)
  const showAllEvents = selectedGroupIds.length === 0;

  // Fetch events based on filter
  const hostingGroupIds = showAllEvents ? undefined : selectedGroupIds as Id<"groups">[];
  const eventsData = useQuery(
    api.functions.meetings.explore.communityEvents,
    community?.id
      ? {
          communityId: community.id as Id<"communities">,
          hostingGroupIds,
          datePreset: dateFilter === 'all' ? undefined : (dateFilter ?? undefined),
          token: token ?? undefined,
        }
      : "skip"
  );
  const isLoadingEvents = eventsData === undefined;

  // Convert events to map markers, prioritizing event's locationOverride
  // Falls back to hosting group's address if event has no specific location
  // Uses async geocoding to support full addresses without zip codes
  const [eventsAsMapMarkers, setEventsAsMapMarkers] = useState<Group[]>([]);

  useEffect(() => {
    const events = eventsData?.events ?? [];
    if (events.length === 0) {
      setEventsAsMapMarkers([]);
      return;
    }

    let cancelled = false;

    async function geocodeEvents() {
      const markers: Group[] = [];

      for (const event of events) {
        if (cancelled) return;

        let coords = null;

        // Priority 1: Try event's own locationOverride (event-specific venue)
        if (event.locationOverride) {
          // First try sync zip code extraction
          coords = getGroupCoordinates({ location: event.locationOverride });

          // If no zip code found, try async geocoding (Apple/Google Maps)
          if (!coords) {
            coords = await geocodeAddressAsync(event.locationOverride);
          }
        }

        // Priority 2: Fall back to hosting group's address
        if (!coords) {
          const groupData = {
            address_line1: event.group.addressLine1,
            address_line2: event.group.addressLine2,
            city: event.group.city,
            state: event.group.state,
            zip_code: event.group.zipCode,
          };
          coords = getGroupCoordinates(groupData as any);
        }

        if (coords) {
          const eventImageUrl = event.coverImage || event.group?.image || null;
          markers.push({
            _id: event.id, // Convex document ID (required)
            id:
              parseInt(event.id, 10) ||
              Math.abs(
                event.id
                  .split("")
                  .reduce((a: number, b: string) => (a << 5) - a + b.charCodeAt(0), 0)
              ),
            uuid: event.id,
            name: event.title || event.group.name,
            title: event.title || event.group.name,
            preview: eventImageUrl,
            image_url: eventImageUrl,
            group_type_name: event.group.groupTypeName,
            latitude: coords.latitude,
            longitude: coords.longitude,
            _isEvent: true,
            _eventShortId: event.shortId,
          } as Group & { _isEvent: boolean; _eventShortId: string });
        }
      }

      if (!cancelled) {
        setEventsAsMapMarkers(markers);
      }
    }

    geocodeEvents();

    return () => {
      cancelled = true;
    };
  }, [eventsData?.events]);

  // Handle map marker selection
  const handleMarkerSelect = useCallback(
    (marker: Group | null) => {
      if (!marker) return;

      const markerAsAny = marker as Group & {
        _isEvent?: boolean;
        _eventShortId?: string;
      };
      if (markerAsAny._isEvent && markerAsAny._eventShortId) {
        router.push(`/e/${markerAsAny._eventShortId}?source=app`);
      }
    },
    [router]
  );

  // Handle event card press
  const handleEventPress = useCallback(
    (event: CommunityEvent) => {
      router.push(`/e/${event.shortId}?source=app`);
    },
    [router]
  );

  // Handle create event press
  const handleCreateEvent = useCallback(() => {
    router.push(`/(user)/create-event?hostingGroupId=${groupId}`);
  }, [router, groupId]);

  // Filter events based on search
  const filteredEvents = useMemo(() => {
    const events = eventsData?.events ?? [];
    if (!searchQuery.trim()) return events;

    const query = searchQuery.toLowerCase();
    return events.filter((event) => {
      const title = (event.title || "").toLowerCase();
      const eventGroupName = event.group.name.toLowerCase();
      const location = (event.locationOverride || "").toLowerCase();
      return (
        title.includes(query) ||
        eventGroupName.includes(query) ||
        location.includes(query)
      );
    });
  }, [eventsData?.events, searchQuery]);

  // Group events by date sections
  const eventSections = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    const startOfDayAfterTomorrow = new Date(startOfToday);
    startOfDayAfterTomorrow.setDate(startOfDayAfterTomorrow.getDate() + 2);
    const endOfWeek = new Date(startOfToday);
    endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));

    const today: CommunityEvent[] = [];
    const tomorrow: CommunityEvent[] = [];
    const thisWeek: CommunityEvent[] = [];
    const later: CommunityEvent[] = [];

    filteredEvents.forEach((event) => {
      const eventDate = new Date(event.scheduledAt);
      if (eventDate >= startOfToday && eventDate < startOfTomorrow) {
        today.push(event);
      } else if (
        eventDate >= startOfTomorrow &&
        eventDate < startOfDayAfterTomorrow
      ) {
        tomorrow.push(event);
      } else if (
        eventDate >= startOfDayAfterTomorrow &&
        eventDate < endOfWeek
      ) {
        thisWeek.push(event);
      } else if (eventDate >= endOfWeek) {
        later.push(event);
      }
    });

    const sections: Array<{ title: string; data: CommunityEvent[] }> = [];
    if (today.length > 0) sections.push({ title: "TODAY", data: today });
    if (tomorrow.length > 0)
      sections.push({ title: "TOMORROW", data: tomorrow });
    if (thisWeek.length > 0)
      sections.push({ title: "THIS WEEK", data: thisWeek });
    if (later.length > 0) sections.push({ title: "COMING UP", data: later });

    return sections;
  }, [filteredEvents]);

  // Render event card
  const renderEventCard = useCallback(
    ({ item }: { item: CommunityEvent }) => (
      <EventCard event={item} onPress={() => handleEventPress(item)} />
    ),
    [handleEventPress]
  );

  // Render section header
  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string; data: CommunityEvent[] } }) => (
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{section.title}</Text>
        <Text style={[styles.sectionCount, { color: COLORS.primary, backgroundColor: colors.selectedBackground }]}>{section.data.length}</Text>
      </View>
    ),
    [colors]
  );

  // Handle filter changes from modal
  const handleFilterChange = useCallback((updates: Partial<ExploreFilters>) => {
    if (updates.dateFilter !== undefined) {
      setDateFilter(updates.dateFilter);
    }
    if (updates.hostingGroups !== undefined) {
      setSelectedGroupIds(updates.hostingGroups);
    }
  }, []);

  // Build current filters object for modal
  const currentFilters: ExploreFilters = useMemo(
    () => ({
      view: "events",
      mode: undefined,
      groupType: null,
      meetingType: null,
      dateFilter,
      startDate: null,
      endDate: null,
      hostingGroups: selectedGroupIds,
    }),
    [dateFilter, selectedGroupIds]
  );

  // Determine header title based on selection
  const headerTitle = useMemo(() => {
    if (selectedGroupIds.length === 0) return "All Events";
    if (selectedGroupIds.length === 1 && selectedGroupIds[0] === groupId) {
      return `${groupName} Events`;
    }
    if (selectedGroupIds.length === 1) {
      const selected = selectedGroups.find((g) => g.id === selectedGroupIds[0]);
      return selected ? `${selected.name} Events` : "Events";
    }
    return `${selectedGroupIds.length} Groups`;
  }, [selectedGroupIds, groupId, groupName, selectedGroups]);

  // Check if there are active filters
  const hasActiveFilters = dateFilter !== null || selectedGroupIds.length > 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: colors.surface, borderBottomColor: colors.border, shadowColor: colors.shadow }]}>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={28} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {headerTitle}
          </Text>
          {selectedGroupIds.length > 0 && groupId && (
            <TouchableOpacity onPress={() => setSelectedGroupIds([])}>
              <Text style={styles.showAllLink}>Show all events</Text>
            </TouchableOpacity>
          )}
          {selectedGroupIds.length === 0 && groupId && (
            <TouchableOpacity onPress={() => setSelectedGroupIds([groupId])}>
              <Text style={styles.showAllLink}>Show {groupName} only</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={styles.filterButton}
          onPress={() => setIsFilterModalVisible(true)}
        >
          <Ionicons name="options-outline" size={24} color={colors.text} />
          {hasActiveFilters && <View style={styles.filterBadge} />}
        </TouchableOpacity>
      </View>

      {/* Map */}
      <ExploreMap
        groups={eventsAsMapMarkers}
        selectedGroupId={null}
        onGroupSelect={handleMarkerSelect}
        mapboxToken={mapboxToken}
      />

      {/* Bottom Sheet with Events List - use regular components on web */}
      {isWeb ? (
        <View style={[styles.webBottomPanel, { backgroundColor: colors.surface }]}>
          {/* Search Bar */}
          <View style={styles.searchContainer}>
            <View style={[styles.searchInputWrapper, { backgroundColor: colors.surfaceSecondary }]}>
              <Ionicons name="search" size={20} color={colors.textSecondary} />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Search events..."
                placeholderTextColor={colors.textSecondary}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery("")}>
                  <Ionicons
                    name="close-circle"
                    size={20}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Events List */}
          <SectionList
            sections={eventSections}
            keyExtractor={(item) => item.id}
            renderItem={renderEventCard}
            renderSectionHeader={renderSectionHeader}
            stickySectionHeadersEnabled={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              isLoadingEvents ? (
                <View style={styles.emptyContainer}>
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Loading events...</Text>
                </View>
              ) : (
                <View style={styles.emptyContainer}>
                  <Ionicons
                    name="calendar-outline"
                    size={48}
                    color={colors.textSecondary}
                  />
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>No upcoming events</Text>
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    Check back later for new events
                  </Text>
                </View>
              )
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        </View>
      ) : (
        <BottomSheet
          ref={bottomSheetRef}
          index={1}
          snapPoints={snapPoints}
          topInset={topInset}
          enablePanDownToClose={false}
          handleIndicatorStyle={[styles.handleIndicator, { backgroundColor: colors.border }]}
          backgroundStyle={[styles.sheetBackground, { backgroundColor: colors.surface }]}
        >
          {/* Search Bar */}
          <View style={styles.searchContainer}>
            <View style={[styles.searchInputWrapper, { backgroundColor: colors.surfaceSecondary }]}>
              <Ionicons name="search" size={20} color={colors.textSecondary} />
              <BottomSheetTextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Search events..."
                placeholderTextColor={colors.textSecondary}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery("")}>
                  <Ionicons
                    name="close-circle"
                    size={20}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Events List */}
          <BottomSheetSectionList
            sections={eventSections}
            keyExtractor={(item: CommunityEvent) => item.id}
            renderItem={renderEventCard}
            renderSectionHeader={renderSectionHeader}
            stickySectionHeadersEnabled={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              isLoadingEvents ? (
                <View style={styles.emptyContainer}>
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Loading events...</Text>
                </View>
              ) : (
                <View style={styles.emptyContainer}>
                  <Ionicons
                    name="calendar-outline"
                    size={48}
                    color={colors.textSecondary}
                  />
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>No upcoming events</Text>
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    Check back later for new events
                  </Text>
                </View>
              )
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        </BottomSheet>
      )}

      {/* Create Event FAB - only show when viewing a specific group */}
      {groupId && (
        <TouchableOpacity
          style={[styles.fab, { bottom: insets.bottom + 100, shadowColor: colors.shadow }]}
          onPress={handleCreateEvent}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Filter Modal */}
      <EventsFilterModal
        visible={isFilterModalVisible}
        onClose={() => {
          setIsFilterModalVisible(false);
          setGroupSearchQuery(""); // Clear search when closing
        }}
        filters={currentFilters}
        onFilterChange={handleFilterChange}
        selectedGroups={selectedGroups}
        searchResults={searchResults}
        onSearchGroups={handleSearchGroups}
        isSearching={isSearchingGroups}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  closeButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  showAllLink: {
    fontSize: 13,
    color: COLORS.primary,
    marginTop: 2,
  },
  filterButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  filterBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  handleIndicator: {
    width: 40,
    height: 4,
  },
  sheetBackground: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  searchInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: "500",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
  },
  separator: {
    height: 12,
  },
  webBottomPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "50%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    boxShadow: "0px -4px 16px rgba(0, 0, 0, 0.1)",
  },
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    justifyContent: "center",
    alignItems: "center",
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
      },
      android: {
        elevation: 8,
      },
    }),
  },
});
