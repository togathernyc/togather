import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Platform, ScrollView, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@providers/AuthProvider';
import { useGroupTypes, useGroupSearchQuery } from '@features/groups/hooks/useGroups';
import { Group } from '@features/groups/types';
import { ExploreMap, MapBounds } from './ExploreMap';
import { ExploreBottomSheet, ExploreBottomSheetRef } from './ExploreBottomSheet';
import { FloatingGroupCard } from './FloatingGroupCard';
import { FilterModal, FilterState } from './FilterModal';
import { EventsFilterModal } from './EventsFilterModal';
import { getGroupCoordinates, geocodeZipCode, geocodeAddressAsync } from '@features/groups/utils/geocodeLocation';
import { useExploreFilters, ExploreView } from '../hooks/useExploreFilters';
import { filterExploreGroups } from '../utils/filterGroups';
import { useCommunityEvents, useLeaderGroups, useMyRsvpedEvents, CommunityEvent } from '../hooks/useCommunityEvents';
import { useEventSearch } from '../hooks/useEventSearch';
import { AppImage } from '@components/ui';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useTheme } from '@hooks/useTheme';
import { useQuery, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';
import { Alert } from 'react-native';

// Get Mapbox token from Expo config
const mapboxToken = Constants.expoConfig?.extra?.mapboxAccessToken ||
  process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';

// Stable empty arrays to prevent infinite re-renders
const EMPTY_GROUPS: Group[] = [];

export function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, community, token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();
  const isAdmin = user?.is_admin === true;
  // Check if user has community context (required for groups and events queries)
  const hasCommunityContext = !!community?.id;
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleGroups, setVisibleGroups] = useState<Group[]>([]);
  const [isFilterModalVisible, setIsFilterModalVisible] = useState(false);
  const [isEventsFilterModalVisible, setIsEventsFilterModalVisible] = useState(false);
  const bottomSheetRef = useRef<ExploreBottomSheetRef>(null);
  // Track if a group was selected to know when to skip bounds updates
  const hadSelectedGroupRef = useRef(false);

  // URL-synced filters for both groups and events
  const {
    filters: exploreFilters,
    setFilters: setExploreFilters,
    hasActiveGroupFilters,
    hasActiveEventFilters,
    activeGroupFilterCount,
    activeEventFilterCount,
  } = useExploreFilters();

  // Fetch community explore defaults (admin-configured default filters)
  const exploreDefaults = useQuery(
    api.functions.admin.settings.getExploreDefaults,
    community?.id && token
      ? {
          token,
          communityId: community.id as Id<"communities">,
        }
      : "skip"
  );

  // Track whether admin defaults have been seeded into the filter state.
  // Defaults are applied once on load; after that the user controls filters freely.
  const defaultsSeededRef = useRef(false);
  const [sessionGroupTypeDefaults, setSessionGroupTypeDefaults] = useState<string[] | null>(null);

  useEffect(() => {
    if (exploreDefaults && !defaultsSeededRef.current) {
      defaultsSeededRef.current = true;

      const updates: Record<string, any> = {};

      // Seed meeting type only if user doesn't already have one set (e.g. from deep link/shared URL)
      if (exploreDefaults.meetingType && !exploreFilters.meetingType) {
        updates.meetingType = exploreDefaults.meetingType;
      }

      // Seed group type default into the visible filter so the user sees what's active.
      // Single admin default → pre-select it in the filter chip.
      // Multiple admin defaults → use session-level restriction (filter is single-select).
      if (exploreDefaults.groupTypes.length > 0 && !exploreFilters.groupType) {
        if (exploreDefaults.groupTypes.length === 1) {
          updates.groupType = exploreDefaults.groupTypes[0];
        } else {
          setSessionGroupTypeDefaults(exploreDefaults.groupTypes as string[]);
        }
      }

      if (Object.keys(updates).length > 0) {
        setExploreFilters(updates);
      }
    }
  }, [exploreDefaults]);

  // Group filters come directly from user's URL-synced state
  const groupFilters: FilterState = useMemo(() => ({
    groupType: exploreFilters.groupType,
    meetingType: exploreFilters.meetingType ?? null,
  }), [exploreFilters.groupType, exploreFilters.meetingType]);

  // Fetch events for events view (requires community context)
  const {
    data: eventsData,
    isLoading: isLoadingEvents,
    refetch: refetchEvents,
    isFetching: isFetchingEvents,
  } = useCommunityEvents(exploreFilters, { enabled: hasCommunityContext });

  // Backend event search (replaces client-side filtering when searching)
  const {
    data: eventSearchData,
    isLoading: isSearchingEvents,
    isSearching: hasActiveEventSearch,
  } = useEventSearch(
    exploreFilters.view === 'events' ? searchQuery : '',
    community?.id
  );

  // Fetch user's leader groups for events filter modal (requires community context)
  const { data: leaderGroups, isLoading: isLoadingLeaderGroups } = useLeaderGroups({ enabled: hasCommunityContext });

  // Fetch user's RSVPed events (does NOT require community context)
  // Used when user has no community to show their upcoming events
  const {
    data: myRsvpedEventsData,
    isLoading: isLoadingMyRsvps,
    isFetching: isFetchingMyRsvps,
    refetch: refetchMyRsvps,
  } = useMyRsvpedEvents({ enabled: !hasCommunityContext });

  // Check if user is a leader of any group
  const isLeader = (leaderGroups?.length ?? 0) > 0;

  // Check if user has pending group creation requests
  const pendingRequests = useQuery(
    api.functions.groupCreationRequests.mine,
    community?.id && token && !isAdmin
      ? {
          communityId: community.id as Id<"communities">,
          token,
          limit: 100,
        }
      : "skip"
  );
  const hasPendingRequest = pendingRequests?.some(
    (request: any) => request.status === "pending"
  );

  // Reset state when community changes (but not on initial mount, to preserve deep link params)
  const prevCommunityIdRef = useRef(community?.id);
  useEffect(() => {
    if (prevCommunityIdRef.current === community?.id) return;
    prevCommunityIdRef.current = community?.id;
    setVisibleGroups([]);
    setSelectedGroup(null);
    setSearchQuery('');
    // Re-seed admin defaults for the new community
    defaultsSeededRef.current = false;
    setSessionGroupTypeDefaults(null);
    // Clear URL-synced filters so stale values from old community don't persist
    setExploreFilters({ groupType: null, meetingType: null });
  }, [community?.id]);

  // Fetch group types for the current community using tRPC
  // Disabled when no community context to prevent 400 errors
  const {
    data: groupTypes,
    isLoading: isLoadingGroupTypes,
  } = useGroupTypes({ enabled: hasCommunityContext });

  // Fetch all groups using Convex search query
  // Convex queries are real-time - no manual refetching needed
  // Disabled when no community context to prevent errors
  const {
    data: groupsData,
    isLoading,
  } = useGroupSearchQuery({}, { enabled: hasCommunityContext });

  // Convex doesn't have error/isFetching states in the same way as tRPC
  const error = null;
  const isFetching = isLoading;

  // Parse groups from tRPC response - tRPC returns array directly
  const allGroups: Group[] = useMemo(() => {
    // Use stable empty array to prevent infinite re-renders
    if (!groupsData) return EMPTY_GROUPS;
    // tRPC search returns array directly
    if (Array.isArray(groupsData)) {
      // Map tRPC camelCase response to expected Group format
      return groupsData.map((g: any) => ({
        _id: g._id || g.id, // Convex document ID (required)
        id: g.id,
        uuid: g.id,
        name: g.name,
        title: g.name,
        description: g.description,
        group_type: g.groupTypeId,
        group_type_name: g.groupTypeName,
        preview: g.preview,
        member_count: g.memberCount,
        is_on_break: g.isOnBreak,
        break_until: g.breakUntil,
        is_member: g.isMember,
        has_pending_request: g.hasPendingRequest,
        user_role: g.userRole,
        meeting_type: g.defaultMeetingType,
        // Address fields for geocoding (map display)
        address_line1: g.addressLine1,
        address_line2: g.addressLine2,
        city: g.city,
        state: g.state,
        zip_code: g.zipCode,
      }));
    }
    return EMPTY_GROUPS;
  }, [groupsData]);

  // Apply filters to groups
  // sessionGroupTypeDefaults acts as a soft default until user interacts with the filter
  const filteredGroups = useMemo(() => {
    return filterExploreGroups(allGroups, groupFilters, sessionGroupTypeDefaults);
  }, [allGroups, groupFilters, sessionGroupTypeDefaults]);

  // Separate groups with and without location for the map
  // Geocode addresses/zip codes to coordinates on-the-fly (no stored coordinates required)
  const { groupsWithLocation, groupsWithoutLocation } = useMemo(() => {
    const withLocation: Group[] = [];
    const withoutLocation: Group[] = [];

    filteredGroups.forEach((group) => {
      // Use geocoding utility to get coordinates from address/zip
      const coords = getGroupCoordinates(group);
      if (coords) {
        withLocation.push({
          ...group,
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
      } else {
        withoutLocation.push(group);
      }
    });

    return { groupsWithLocation: withLocation, groupsWithoutLocation: withoutLocation };
  }, [filteredGroups]);

  // Convert events to map markers, prioritizing event's locationOverride
  // Falls back to hosting group's address if event has no specific location
  // Uses async geocoding to support full addresses without zip codes
  // Use stable empty array to prevent infinite re-renders
  const emptyMarkersRef = useRef<Group[]>([]);
  const [eventsAsMapMarkers, setEventsAsMapMarkers] = useState<Group[]>([]);

  useEffect(() => {
    const events = eventsData?.events ?? [];
    if (events.length === 0) {
      // Use stable empty array reference to prevent infinite re-renders
      setEventsAsMapMarkers(prev => prev.length === 0 ? prev : emptyMarkersRef.current);
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
          // Create a Group-compatible marker for the event
          const eventImageUrl = event.coverImage || event.group?.image || null;
          markers.push({
            _id: event.id, // Convex document ID (required)
            id: parseInt(event.id, 10) || Math.abs(event.id.split('').reduce((a: number, b: string) => ((a << 5) - a) + b.charCodeAt(0), 0)),
            uuid: event.id,
            name: event.title || event.group.name,
            title: event.title || event.group.name,
            preview: eventImageUrl,
            image_url: eventImageUrl,
            group_type_name: event.group.groupTypeName,
            latitude: coords.latitude,
            longitude: coords.longitude,
            // Mark this as an event for special handling
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

  // Handle group/event selection from map
  const handleRequestGroupPress = useCallback(() => {
    // Check if user has pending request before navigating
    if (!isAdmin && hasPendingRequest) {
      Alert.alert(
        'Pending Request',
        'You already have a pending group request. Please wait for it to be reviewed before submitting another request.',
        [{ text: 'OK' }]
      );
      return;
    }

    // Navigate based on admin status
    router.push(isAdmin ? '/(user)/create-group' : '/(user)/request-group');
  }, [isAdmin, hasPendingRequest, router]);

  const handleGroupSelect = useCallback((group: Group | null) => {
    if (!group) {
      setSelectedGroup(null);
      return;
    }

    // Check if this is an event marker (has _isEvent flag)
    const markerAsAny = group as Group & { _isEvent?: boolean; _eventShortId?: string };
    if (markerAsAny._isEvent && markerAsAny._eventShortId) {
      // Navigate directly to event detail
      router.push(`/e/${markerAsAny._eventShortId}?source=app`);
      return;
    }

    // Regular group selection
    hadSelectedGroupRef.current = true;
    setSelectedGroup(group);
  }, [router]);

  // Handle bounds change from map
  // Don't update visibleGroups when a group is selected or was just deselected,
  // as the map zooms in and we want to preserve the original list
  const handleBoundsChange = useCallback((bounds: MapBounds, groupsInView: Group[]) => {
    // Skip if we had a selected group and map hasn't returned to normal view yet
    // We'll update on the next user-initiated map movement
    if (hadSelectedGroupRef.current) {
      return;
    }
    setVisibleGroups(groupsInView);
  }, []);

  // Reset the selection tracking after the card closes
  // This allows bounds updates to resume after user interacts with map
  useEffect(() => {
    if (!selectedGroup && hadSelectedGroupRef.current) {
      // Wait for map animations to settle before allowing bounds updates again
      const timer = setTimeout(() => {
        hadSelectedGroupRef.current = false;
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [selectedGroup]);

  // Track if initial visible groups have been set
  const hasInitializedVisibleGroupsRef = useRef(false);

  // Initialize visibleGroups when data loads
  // Only runs once per data load to prevent infinite loops
  useEffect(() => {
    if (groupsWithLocation.length > 0 && !hasInitializedVisibleGroupsRef.current) {
      hasInitializedVisibleGroupsRef.current = true;
      setVisibleGroups(groupsWithLocation);
    }
  }, [groupsWithLocation]);

  // Reset initialization flag when community changes
  useEffect(() => {
    hasInitializedVisibleGroupsRef.current = false;
  }, [community?.id]);

  // Handle search query change
  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  // Handle view change (groups/events)
  const handleViewChange = useCallback((view: ExploreView) => {
    setExploreFilters({ view });
    setSearchQuery(''); // Clear search when switching views
  }, [setExploreFilters]);

  // Handle event press - navigate to event detail
  const handleEventPress = useCallback((event: CommunityEvent) => {
    router.push(`/e/${event.shortId}?source=app`);
  }, [router]);

  // Handle events refresh
  const handleRefreshEvents = useCallback(() => {
    refetchEvents();
  }, [refetchEvents]);

  // Handle group filter change - clears session group type defaults so the user's
  // explicit filter choice takes full effect (admin defaults stop restricting)
  const handleGroupFilterChange = useCallback((newFilters: FilterState) => {
    setSessionGroupTypeDefaults(null);
    setExploreFilters({
      groupType: newFilters.groupType,
      meetingType: newFilters.meetingType,
    });
  }, [setExploreFilters]);

  // Show error state only if there's an error and no cached data
  if (error && !groupsData) {
    return (
      <View style={[styles.errorContainer, { backgroundColor: colors.backgroundSecondary }]}>
        <Text style={[styles.errorText, { color: colors.text }]}>Failed to load groups</Text>
        <Text style={[styles.errorSubtext, { color: colors.textSecondary }]}>Please try again later</Text>
      </View>
    );
  }

  // Show RSVPed events when no community context
  if (!hasCommunityContext) {
    const myEvents = myRsvpedEventsData?.events ?? [];

    return (
      <View style={[styles.noCommunityContainer, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={[styles.noCommunityHeader, { paddingTop: insets.top + 16, backgroundColor: colors.surface, borderBottomColor: colors.borderLight }]}>
          <Text style={[styles.noCommunityTitle, { color: colors.text }]}>My Events</Text>
          <Text style={[styles.noCommunitySubtitle, { color: colors.textSecondary }]}>Events you've RSVPed to</Text>
        </View>

        {isLoadingMyRsvps ? (
          <View style={[styles.errorContainer, { backgroundColor: colors.backgroundSecondary }]}>
            <Text style={[styles.errorSubtext, { color: colors.textSecondary }]}>Loading your events...</Text>
          </View>
        ) : myEvents.length === 0 ? (
          <View style={[styles.errorContainer, { backgroundColor: colors.backgroundSecondary }]}>
            <Ionicons name="calendar-outline" size={48} color={colors.textSecondary} style={{ marginBottom: 16 }} />
            <Text style={[styles.errorText, { color: colors.text }]}>No upcoming events</Text>
            <Text style={[styles.errorSubtext, { color: colors.textSecondary }]}>Events you RSVP to will appear here</Text>
          </View>
        ) : (
          <ScrollView
            style={styles.noCommunityScrollView}
            contentContainerStyle={styles.noCommunityScrollContent}
            refreshControl={
              <RefreshControl
                refreshing={isFetchingMyRsvps && !isLoadingMyRsvps}
                onRefresh={refetchMyRsvps}
              />
            }
          >
            {myEvents.map((event) => (
              <TouchableOpacity
                key={event.id}
                style={[styles.myEventCard, { backgroundColor: colors.surface }]}
                onPress={() => router.push(`/e/${event.shortId}?source=app`)}
                activeOpacity={0.7}
              >
                <AppImage
                  source={event.coverImage || event.group.image}
                  style={styles.myEventImage}
                  resizeMode="cover"
                  optimizedWidth={150}
                  placeholder={{
                    type: 'initials',
                    name: event.title || event.group.name,
                  }}
                />
                <View style={styles.myEventInfo}>
                  <Text style={[styles.myEventTitle, { color: colors.text }]} numberOfLines={1}>
                    {event.title || event.group.name}
                  </Text>
                  <Text style={[styles.myEventDate, { color: primaryColor }]}>
                    {new Date(event.scheduledAt).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </Text>
                  <Text style={[styles.myEventGroup, { color: colors.textSecondary }]} numberOfLines={1}>
                    {event.group.name} • {event.community.name}
                  </Text>
                </View>
                <View style={[styles.myEventStatus, { backgroundColor: `${primaryColor}15` }]}>
                  <Text style={[styles.myEventStatusText, { color: primaryColor }]}>
                    {event.rsvpStatus.optionLabel || 'RSVPed'}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>
    );
  }

  // Determine which markers to show on the map based on current view
  const mapMarkers = exploreFilters.view === 'events' ? eventsAsMapMarkers : groupsWithLocation;

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}>
      {/* Map layer - shows groups or events based on current view */}
      <ExploreMap
        groups={mapMarkers}
        selectedGroupId={selectedGroup?.id ? (typeof selectedGroup.id === 'number' ? selectedGroup.id : parseInt(String(selectedGroup.id), 10)) : null}
        onGroupSelect={handleGroupSelect}
        onBoundsChange={handleBoundsChange}
        mapboxToken={mapboxToken}
      />

      {/* Floating filter button - hide when a group is selected */}
      {!selectedGroup && (
        <TouchableOpacity
          style={[styles.filterButton, { top: insets.top + 12, backgroundColor: colors.buttonPrimary }]}
          onPress={() => {
            if (exploreFilters.view === 'events') {
              setIsEventsFilterModalVisible(true);
            } else {
              setIsFilterModalVisible(true);
            }
          }}
          activeOpacity={0.9}
        >
          <Ionicons name="options-outline" size={20} color={colors.buttonPrimaryText} />
          {/* Show badge for active filters based on current view */}
          {exploreFilters.view === 'groups' && hasActiveGroupFilters && (
            <View style={[styles.filterBadge, { backgroundColor: primaryColor }]}>
              <Text style={[styles.filterBadgeText, { color: colors.textInverse }]}>{activeGroupFilterCount}</Text>
            </View>
          )}
          {exploreFilters.view === 'events' && hasActiveEventFilters && (
            <View style={[styles.filterBadge, { backgroundColor: primaryColor }]}>
              <Text style={[styles.filterBadgeText, { color: colors.textInverse }]}>{activeEventFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* Floating add button - context-aware based on view */}
      {/* Groups view: all users can create/request groups */}
      {!selectedGroup && exploreFilters.view === 'groups' && (
        <TouchableOpacity
          style={[styles.addButton, { top: insets.top + 64, backgroundColor: colors.buttonPrimary }]}
          onPress={handleRequestGroupPress}
          activeOpacity={0.9}
        >
          <Ionicons name="add" size={24} color={colors.buttonPrimaryText} />
        </TouchableOpacity>
      )}
      {/* Events view: leaders can create events */}
      {!selectedGroup && exploreFilters.view === 'events' && isLeader && (
        <TouchableOpacity
          style={[styles.addButton, { top: insets.top + 64, backgroundColor: colors.buttonPrimary }]}
          onPress={() => router.push('/(user)/create-event')}
          activeOpacity={0.9}
        >
          <Ionicons name="add" size={24} color={colors.buttonPrimaryText} />
        </TouchableOpacity>
      )}

      {/* Bottom sheet - hide when a group is selected */}
      {!selectedGroup && (
        <ExploreBottomSheet
          ref={bottomSheetRef}
          activeView={exploreFilters.view}
          onViewChange={handleViewChange}
          visibleGroups={visibleGroups}
          groupsWithoutLocation={groupsWithoutLocation}
          onGroupSelect={handleGroupSelect}
          isLoadingGroups={isLoading}
          events={eventsData?.events ?? []}
          eventSearchResults={hasActiveEventSearch ? eventSearchData?.events : undefined}
          isSearchingEvents={isSearchingEvents}
          onEventPress={handleEventPress}
          isLoadingEvents={isLoadingEvents}
          onRefreshEvents={handleRefreshEvents}
          isRefreshingEvents={isFetchingEvents}
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
        />
      )}

      {/* Floating card for selected group */}
      {selectedGroup && (
        <FloatingGroupCard
          group={selectedGroup}
          onClose={() => setSelectedGroup(null)}
        />
      )}

      {/* Groups Filter Modal */}
      <FilterModal
        visible={isFilterModalVisible}
        onClose={() => setIsFilterModalVisible(false)}
        filters={groupFilters}
        onFilterChange={handleGroupFilterChange}
        groupTypes={groupTypes || []}
        isLoadingGroupTypes={isLoadingGroupTypes}
      />

      {/* Events Filter Modal */}
      <EventsFilterModal
        visible={isEventsFilterModalVisible}
        onClose={() => setIsEventsFilterModalVisible(false)}
        filters={exploreFilters}
        onFilterChange={setExploreFilters}
        groups={leaderGroups?.filter((g): g is NonNullable<typeof g> => g !== null).map(g => ({
          id: g.id,
          name: g.name,
          groupTypeName: g.groupTypeName,
          preview: g.preview,
        })) ?? []}
        isLoadingGroups={isLoadingLeaderGroups}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  errorSubtext: {
    fontSize: 14,
  },
  filterButton: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.25)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
      },
    }),
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  filterBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  addButton: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.25)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
      },
    }),
  },
  // No-community view styles
  noCommunityContainer: {
    flex: 1,
  },
  noCommunityHeader: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  noCommunityTitle: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 4,
  },
  noCommunitySubtitle: {
    fontSize: 14,
  },
  noCommunityScrollView: {
    flex: 1,
  },
  noCommunityScrollContent: {
    padding: 16,
    gap: 12,
  },
  myEventCard: {
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...Platform.select({
      web: {
        boxShadow: '0px 1px 3px rgba(0, 0, 0, 0.1)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
      },
    }),
  },
  myEventImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  myEventInfo: {
    flex: 1,
  },
  myEventTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  myEventDate: {
    fontSize: 14,
    marginBottom: 2,
  },
  myEventGroup: {
    fontSize: 13,
  },
  myEventStatus: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  myEventStatusText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
