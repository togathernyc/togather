import React, { useCallback, useMemo, useRef, forwardRef, useImperativeHandle, useState, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  TouchableOpacity,
  LayoutAnimation,
  UIManager,
  FlatList,
  SectionList,
  TextInput,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import BottomSheet, { BottomSheetFlatList, BottomSheetTextInput, BottomSheetSectionList } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Group } from '@features/groups/types';
import { GroupCard } from './GroupCard';
import { EventCard } from './EventCard';
import { ViewToggle } from './ViewToggle';
import { COLORS } from '../constants';
import type { ExploreView } from '../hooks/useExploreFilters';
import type { CommunityEvent } from '../hooks/useCommunityEvents';
import { useTheme } from '@hooks/useTheme';

interface ExploreBottomSheetProps {
  // View state
  activeView: ExploreView;
  onViewChange: (view: ExploreView) => void;
  isModeLocked?: boolean; // When true, hides the ViewToggle (for deep-linking from group context)
  // Groups props
  visibleGroups: Group[];
  groupsWithoutLocation: Group[];
  onGroupSelect: (group: Group) => void;
  isLoadingGroups?: boolean;
  // Events props
  events: CommunityEvent[];
  eventSearchResults?: Array<{
    _id: string;
    title: string;
    scheduledAt: number;
    actualEnd?: number;
    meetingType: number;
    locationOverride?: string | null;
    shortId?: string | null;
    visibility?: string | null;
    coverImage?: string | null;
    group?: { _id: string; name: string; city?: string | null; state?: string | null } | null;
  }>;
  isSearchingEvents?: boolean;
  onEventPress?: (event: CommunityEvent) => void;
  isLoadingEvents?: boolean;
  onRefreshEvents?: () => void;
  isRefreshingEvents?: boolean;
  // Shared
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export interface ExploreBottomSheetRef {
  snapToIndex: (index: number) => void;
  collapse: () => void;
}

// Skeleton card component for loading state
const SkeletonCard = () => {
  const { colors } = useTheme();
  return (
    <View style={[skeletonStyles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[skeletonStyles.image, { backgroundColor: colors.borderLight }]} />
      <View style={skeletonStyles.content}>
        <View style={[skeletonStyles.title, { backgroundColor: colors.borderLight }]} />
        <View style={[skeletonStyles.subtitle, { backgroundColor: colors.borderLight }]} />
        <View style={[skeletonStyles.meta, { backgroundColor: colors.borderLight }]} />
      </View>
    </View>
  );
};

const skeletonStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
  },
  image: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  content: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  title: {
    width: '70%',
    height: 16,
    borderRadius: 4,
    marginBottom: 8,
  },
  subtitle: {
    width: '50%',
    height: 12,
    borderRadius: 4,
    marginBottom: 8,
  },
  meta: {
    width: '40%',
    height: 12,
    borderRadius: 4,
  },
});

// Memoized SearchBar component to prevent re-renders that cause keyboard dismissal
const isWeb = Platform.OS === 'web';

interface SearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onFocus: () => void;
  activeView: ExploreView;
}

const SearchBar = memo(function SearchBar({ searchQuery, onSearchChange, onFocus, activeView }: SearchBarProps) {
  const placeholder = activeView === 'events' ? 'Search events...' : 'Search groups...';
  const InputComponent = isWeb ? TextInput : BottomSheetTextInput;
  const { colors } = useTheme();

  return (
    <View style={styles.searchContainer}>
      <View style={[styles.searchInputWrapper, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
        <Ionicons
          name="search"
          size={20}
          color={colors.inputPlaceholder}
          style={styles.searchIcon}
        />
        <InputComponent
          style={[styles.searchInput, { color: colors.text }]}
          placeholder={placeholder}
          placeholderTextColor={colors.inputPlaceholder}
          value={searchQuery}
          onChangeText={onSearchChange}
          onFocus={onFocus}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => onSearchChange('')}>
            <Ionicons
              name="close-circle"
              size={20}
              color={colors.inputPlaceholder}
            />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});

export const ExploreBottomSheet = forwardRef<ExploreBottomSheetRef, ExploreBottomSheetProps>(
  function ExploreBottomSheet(
    {
      activeView,
      onViewChange,
      isModeLocked = false,
      visibleGroups,
      groupsWithoutLocation,
      onGroupSelect,
      isLoadingGroups = false,
      events,
      eventSearchResults,
      isSearchingEvents = false,
      onEventPress,
      isLoadingEvents = false,
      onRefreshEvents,
      isRefreshingEvents = false,
      searchQuery,
      onSearchChange,
    },
    ref
  ) {
    const bottomSheetRef = useRef<BottomSheet>(null);
    const insets = useSafeAreaInsets();
    const { colors, isDark } = useTheme();
    // Use a topInset to ensure the handle is always visible below the status bar/notch
    const topInset = insets.top + 20; // Extra space to keep handle accessible
    const snapPoints = useMemo(() => ['12%', '50%', '75%'], []);
    const [isNoLocationExpanded, setIsNoLocationExpanded] = useState(false);
    const [isMapMode, setIsMapMode] = useState(false);

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
      snapToIndex: (index: number) => {
        bottomSheetRef.current?.snapToIndex(index);
      },
      collapse: () => {
        bottomSheetRef.current?.snapToIndex(0);
        setIsMapMode(true);
      },
    }));

    const handleToggleMapList = useCallback(() => {
      if (isMapMode) {
        // Switch to list mode
        bottomSheetRef.current?.snapToIndex(1); // 50%
        setIsMapMode(false);
      } else {
        // Switch to map mode
        bottomSheetRef.current?.snapToIndex(0); // 12%
        setIsMapMode(true);
      }
    }, [isMapMode]);

    // Expand bottom sheet when search is focused so keyboard doesn't cover it
    const handleSearchFocus = useCallback(() => {
      bottomSheetRef.current?.snapToIndex(2); // Snap to highest point (75%)
    }, []);

    const handleGroupCardPress = useCallback((group: Group) => {
      onGroupSelect(group);
    }, [onGroupSelect]);

    // Filter groups based on search query
    const filteredGroups = useMemo(() => {
      if (!searchQuery.trim()) return visibleGroups;

      const query = searchQuery.toLowerCase();
      return visibleGroups.filter((group) => {
        const name = (group.title || group.name || '').toLowerCase();
        const location = (group.location || group.city || '').toLowerCase();
        return name.includes(query) || location.includes(query);
      });
    }, [visibleGroups, searchQuery]);

    // Filter groups without location based on search query
    const filteredGroupsWithoutLocation = useMemo(() => {
      if (!searchQuery.trim()) return groupsWithoutLocation;

      const query = searchQuery.toLowerCase();
      return groupsWithoutLocation.filter((group) => {
        const name = (group.title || group.name || '').toLowerCase();
        const location = (group.location || group.city || '').toLowerCase();
        return name.includes(query) || location.includes(query);
      });
    }, [groupsWithoutLocation, searchQuery]);

    // Filter events based on search query.
    // When backend search results are available, map them to CommunityEvent shape.
    // Otherwise fall back to client-side filtering.
    const filteredEvents = useMemo(() => {
      if (eventSearchResults) {
        // Map backend search results to CommunityEvent-compatible objects
        return eventSearchResults.map((result) => ({
          id: result._id,
          shortId: result.shortId ?? null,
          title: result.title,
          scheduledAt: new Date(result.scheduledAt).toISOString(),
          status: 'scheduled',
          visibility: (result.visibility ?? 'group') as 'group' | 'community' | 'public',
          coverImage: result.coverImage ?? null,
          locationOverride: result.locationOverride ?? null,
          meetingType: result.meetingType,
          rsvpEnabled: false,
          group: {
            id: result.group?._id ?? '',
            name: result.group?.name ?? '',
            groupTypeName: '',
            addressLine1: null,
            addressLine2: null,
            city: result.group?.city ?? null,
            state: result.group?.state ?? null,
            zipCode: null,
          },
          rsvpSummary: { totalGoing: 0, topGoingGuests: [] },
        })) as CommunityEvent[];
      }

      if (!searchQuery.trim()) return events;

      const query = searchQuery.toLowerCase();
      return events.filter((event) => {
        const title = (event.title || '').toLowerCase();
        const groupName = event.group.name.toLowerCase();
        const location = (event.locationOverride || '').toLowerCase();
        return title.includes(query) || groupName.includes(query) || location.includes(query);
      });
    }, [events, eventSearchResults, searchQuery]);

    // Group events by date sections
    const eventSections = useMemo(() => {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
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
        } else if (eventDate >= startOfTomorrow && eventDate < startOfDayAfterTomorrow) {
          tomorrow.push(event);
        } else if (eventDate >= startOfDayAfterTomorrow && eventDate < endOfWeek) {
          thisWeek.push(event);
        } else if (eventDate >= endOfWeek) {
          later.push(event);
        }
      });

      const sections: Array<{ title: string; data: CommunityEvent[] }> = [];
      if (today.length > 0) sections.push({ title: 'TODAY', data: today });
      if (tomorrow.length > 0) sections.push({ title: 'TOMORROW', data: tomorrow });
      if (thisWeek.length > 0) sections.push({ title: 'THIS WEEK', data: thisWeek });
      if (later.length > 0) sections.push({ title: 'COMING UP', data: later });

      return sections;
    }, [filteredEvents]);

    // Toggle the no-location section with animation
    const toggleNoLocationSection = useCallback(() => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setIsNoLocationExpanded((prev) => !prev);
    }, []);

    // Render group card for list
    const renderGroupCard = useCallback(
      ({ item }: { item: Group }) => (
        <GroupCard
          group={item}
          onPress={handleGroupCardPress}
          variant="large"
        />
      ),
      [handleGroupCardPress]
    );

    // Render event card for list
    const renderEventCard = useCallback(
      ({ item }: { item: CommunityEvent }) => (
        <EventCard
          event={item}
          onPress={onEventPress ? () => onEventPress(item) : undefined}
        />
      ),
      [onEventPress]
    );

    // Render event section header
    const renderEventSectionHeader = useCallback(
      ({ section }: { section: { title: string; data: CommunityEvent[] } }) => (
        <View style={styles.eventSectionHeader}>
          <Text style={[styles.eventSectionTitle, { color: colors.textSecondary }]}>{section.title}</Text>
          <Text style={[styles.eventSectionCount, { color: COLORS.primary, backgroundColor: isDark ? '#2d1f4e' : '#F3E8FF' }]}>{section.data.length}</Text>
        </View>
      ),
      [colors, isDark]
    );

    // List header with count and collapsible "Groups not on map" section (search is rendered separately)
    const GroupsListHeaderComponent = useCallback(() => (
      <View style={styles.listHeader}>
        {/* Groups count */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {isLoadingGroups ? 'Loading groups...' : `${filteredGroups.length + filteredGroupsWithoutLocation.length} ${filteredGroups.length + filteredGroupsWithoutLocation.length === 1 ? 'group' : 'groups'}`}
        </Text>

        {/* Collapsible "Groups not on map" section */}
        {filteredGroupsWithoutLocation.length > 0 && (
          <View style={[styles.noLocationSection, { borderBottomColor: colors.border }]}>
            <TouchableOpacity
              style={styles.noLocationHeader}
              onPress={toggleNoLocationSection}
              activeOpacity={0.7}
            >
              <View style={styles.noLocationHeaderLeft}>
                <Ionicons
                  name="location-outline"
                  size={18}
                  color={colors.textSecondary}
                />
                <Text style={[styles.noLocationHeaderText, { color: colors.textSecondary }]}>
                  Groups not on map ({filteredGroupsWithoutLocation.length})
                </Text>
              </View>
              <Ionicons
                name={isNoLocationExpanded ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            {isNoLocationExpanded && (
              <View style={[styles.noLocationContent, { borderTopColor: colors.border }]}>
                {filteredGroupsWithoutLocation.map((group) => (
                  <GroupCard
                    key={group.id}
                    group={group}
                    onPress={handleGroupCardPress}
                    variant="large"
                  />
                ))}
              </View>
            )}
          </View>
        )}

        {/* Groups on map section header */}
        {filteredGroups.length > 0 && (
          <View style={styles.onMapHeader}>
            <Ionicons name="map-outline" size={16} color={colors.textSecondary} />
            <Text style={[styles.onMapHeaderText, { color: colors.textSecondary }]}>
              Groups on map ({filteredGroups.length})
            </Text>
          </View>
        )}
      </View>
    ), [filteredGroups.length, filteredGroupsWithoutLocation, isNoLocationExpanded, toggleNoLocationSection, handleGroupCardPress, isLoadingGroups, colors, isDark]);

    // Events empty component
    const EventsEmptyComponent = useCallback(() => {
      if (isLoadingEvents) {
        return (
          <View>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </View>
        );
      }
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="calendar-outline" size={48} color={colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No upcoming events</Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Check back later for new events</Text>
        </View>
      );
    }, [isLoadingEvents, colors]);

    // Shared list content for both web and native
    const groupsListContent = (
      <>
        {activeView === 'groups' ? (
          isWeb ? (
            <FlatList
              data={filteredGroups}
              keyExtractor={(item) => String(item.id)}
              renderItem={renderGroupCard}
              ListHeaderComponent={GroupsListHeaderComponent}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                isLoadingGroups ? (
                  <View>
                    <SkeletonCard />
                    <SkeletonCard />
                    <SkeletonCard />
                  </View>
                ) : filteredGroupsWithoutLocation.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <Ionicons name="people-outline" size={48} color={colors.textSecondary} />
                    <Text style={[styles.emptyTitle, { color: colors.text }]}>No groups in view</Text>
                    <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Pan the map to explore different areas</Text>
                  </View>
                ) : null
              }
            />
          ) : (
            <BottomSheetFlatList
              data={filteredGroups}
              keyExtractor={(item: Group) => String(item.id)}
              renderItem={renderGroupCard}
              ListHeaderComponent={GroupsListHeaderComponent}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                isLoadingGroups ? (
                  <View>
                    <SkeletonCard />
                    <SkeletonCard />
                    <SkeletonCard />
                  </View>
                ) : filteredGroupsWithoutLocation.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <Ionicons name="people-outline" size={48} color={colors.textSecondary} />
                    <Text style={[styles.emptyTitle, { color: colors.text }]}>No groups in view</Text>
                    <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Pan the map to explore different areas</Text>
                  </View>
                ) : null
              }
            />
          )
        ) : isWeb ? (
          <SectionList
            sections={eventSections}
            keyExtractor={(item) => item.id}
            renderItem={renderEventCard}
            renderSectionHeader={renderEventSectionHeader}
            stickySectionHeadersEnabled={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={EventsEmptyComponent}
            ItemSeparatorComponent={() => <View style={styles.eventSeparator} />}
          />
        ) : (
          <BottomSheetSectionList
            sections={eventSections}
            keyExtractor={(item: CommunityEvent) => item.id}
            renderItem={renderEventCard}
            renderSectionHeader={renderEventSectionHeader}
            stickySectionHeadersEnabled={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={EventsEmptyComponent}
            ItemSeparatorComponent={() => <View style={styles.eventSeparator} />}
          />
        )}
      </>
    );

    // On web, render a simple panel instead of BottomSheet
    if (isWeb) {
      return (
        <View style={[styles.webPanel, { backgroundColor: colors.surface }, isMapMode && styles.webPanelCollapsed]}>
          {/* View Toggle - hidden when mode is locked */}
          {!isModeLocked && (
            <View style={styles.toggleContainer}>
              <ViewToggle activeView={activeView} onViewChange={onViewChange} />
            </View>
          )}

          {!isMapMode && (
            <>
              <SearchBar
                searchQuery={searchQuery}
                onSearchChange={onSearchChange}
                onFocus={handleSearchFocus}
                activeView={activeView}
              />

              {groupsListContent}
            </>
          )}

          {/* Map/List Toggle Button */}
          <TouchableOpacity
            style={styles.mapListToggleButton}
            onPress={() => setIsMapMode(!isMapMode)}
            activeOpacity={0.9}
          >
            <Text style={[styles.mapButtonText, { color: colors.textInverse }]}>{isMapMode ? 'List' : 'Map'}</Text>
            <Ionicons name={isMapMode ? 'list' : 'map'} size={16} color={colors.textInverse} />
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={1}
        snapPoints={snapPoints}
        topInset={topInset}
        enablePanDownToClose={false}
        enableContentPanningGesture={true}
        enableHandlePanningGesture={true}
        handleIndicatorStyle={[styles.handleIndicator, { backgroundColor: colors.iconSecondary }]}
        backgroundStyle={[styles.background, { backgroundColor: colors.surface }]}
        style={styles.bottomSheet}
        keyboardBehavior="extend"
        keyboardBlurBehavior="restore"
      >
        {/* View Toggle - hidden when mode is locked (deep-linking from specific context) */}
        {!isModeLocked && (
          <View style={styles.toggleContainer}>
            <ViewToggle activeView={activeView} onViewChange={onViewChange} />
          </View>
        )}

        <SearchBar
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          onFocus={handleSearchFocus}
          activeView={activeView}
        />

        {groupsListContent}

        {/* Map/List Toggle Button */}
        <TouchableOpacity
          style={styles.mapListToggleButton}
          onPress={handleToggleMapList}
          activeOpacity={0.9}
        >
          <Text style={[styles.mapButtonText, { color: colors.textInverse }]}>{isMapMode ? 'List' : 'Map'}</Text>
          <Ionicons name={isMapMode ? 'list' : 'map'} size={16} color={colors.textInverse} />
        </TouchableOpacity>
      </BottomSheet>
    );
  }
);

const styles = StyleSheet.create({
  webPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '75%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    boxShadow: '0px -4px 16px rgba(0, 0, 0, 0.1)',
  },
  webPanelCollapsed: {
    maxHeight: 120,
    paddingBottom: 16,
  },
  bottomSheet: {
    ...Platform.select({
      web: {
        boxShadow: '0px -4px 16px rgba(0, 0, 0, 0.1)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 5,
      },
    }),
  },
  background: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  handleIndicator: {
    width: 40,
    height: 4,
  },
  listHeader: {
    paddingTop: 8,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  mapListToggleButton: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#222224',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 6,
    ...Platform.select({
      web: {
        boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.3)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 5,
      },
    }),
  },
  mapButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  noLocationSection: {
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  noLocationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  noLocationHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  noLocationHeaderText: {
    fontSize: 14,
    fontWeight: '600',
  },
  noLocationContent: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  onMapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 16,
    marginBottom: 16,
  },
  onMapHeaderText: {
    fontSize: 14,
    fontWeight: '600',
  },
  toggleContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  eventSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  eventSectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  eventSectionCount: {
    fontSize: 12,
    fontWeight: '500',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  eventSeparator: {
    height: 12,
  },
});
