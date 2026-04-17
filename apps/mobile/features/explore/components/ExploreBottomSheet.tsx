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
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import BottomSheet, { BottomSheetFlatList, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { Group } from '@features/groups/types';
import { GroupCard } from './GroupCard';
import { useTheme } from '@hooks/useTheme';

interface ExploreBottomSheetProps {
  // Groups props
  visibleGroups: Group[];
  groupsWithoutLocation: Group[];
  onGroupSelect: (group: Group) => void;
  isLoadingGroups?: boolean;
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
}

const SearchBar = memo(function SearchBar({ searchQuery, onSearchChange, onFocus }: SearchBarProps) {
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
          placeholder="Search groups..."
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
      visibleGroups,
      groupsWithoutLocation,
      onGroupSelect,
      isLoadingGroups = false,
      searchQuery,
      onSearchChange,
    },
    ref
  ) {
    const bottomSheetRef = useRef<BottomSheet>(null);
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();
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
    ), [filteredGroups.length, filteredGroupsWithoutLocation, isNoLocationExpanded, toggleNoLocationSection, handleGroupCardPress, isLoadingGroups, colors]);

    // Shared list content for both web and native
    const groupsListContent = (
      <>
        {isWeb ? (
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
        )}
      </>
    );

    // On web, render a simple panel instead of BottomSheet
    if (isWeb) {
      return (
        <View style={[styles.webPanel, { backgroundColor: colors.surface }, isMapMode && styles.webPanelCollapsed]}>
          {!isMapMode && (
            <>
              <SearchBar
                searchQuery={searchQuery}
                onSearchChange={onSearchChange}
                onFocus={handleSearchFocus}
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
        <SearchBar
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          onFocus={handleSearchFocus}
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
});
