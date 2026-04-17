/**
 * EventsFilterModal Component
 *
 * Filter modal for events view with:
 * - Date presets (Today, Upcoming Week, This Month)
 * - Custom date range
 * - Hosting groups multi-select with async search
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@features/explore/constants';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import type { ExploreFilters, DateFilterPreset } from '@features/explore/hooks/useExploreFilters';

// Date preset options
const DATE_PRESETS: Array<{ label: string; value: DateFilterPreset }> = [
  { label: 'All', value: 'all' },
  { label: 'Today', value: 'today' },
  { label: 'Upcoming Week', value: 'this_week' },
  { label: 'This Month', value: 'this_month' },
];

interface GroupOption {
  id: string;
  name: string;
  groupTypeName?: string;
  preview?: string | null;
}

interface EventsFilterModalProps {
  visible: boolean;
  onClose: () => void;
  filters: ExploreFilters;
  onFilterChange: (updates: Partial<ExploreFilters>) => void;
  /** Pre-loaded selected groups (only the ones currently selected) */
  selectedGroups?: GroupOption[];
  /** Search results from async search */
  searchResults?: GroupOption[];
  /** Callback to search for groups */
  onSearchGroups?: (query: string) => void;
  /** Loading state for search */
  isSearching?: boolean;
  /** @deprecated Use selectedGroups instead */
  groups?: GroupOption[];
  /** @deprecated Use isSearching instead */
  isLoadingGroups?: boolean;
}

export function EventsFilterModal({
  visible,
  onClose,
  filters,
  onFilterChange,
  selectedGroups = [],
  searchResults = [],
  onSearchGroups,
  isSearching = false,
  // Legacy props for backward compatibility
  groups = [],
  isLoadingGroups = false,
}: EventsFilterModalProps) {
  const [groupSearch, setGroupSearch] = useState('');
  const { primaryColor } = useCommunityTheme();

  // Debounce search
  useEffect(() => {
    if (!onSearchGroups) return;

    const timer = setTimeout(() => {
      if (groupSearch.trim().length >= 2) {
        onSearchGroups(groupSearch.trim());
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [groupSearch, onSearchGroups]);

  // Use new props if available, fall back to legacy
  const displaySelectedGroups = selectedGroups.length > 0 ? selectedGroups : groups.filter(g => filters.hostingGroups.includes(g.id));
  const displaySearchResults = searchResults.length > 0 ? searchResults : (groupSearch.trim() ? groups.filter(g => g.name.toLowerCase().includes(groupSearch.toLowerCase())) : []);
  const isLoadingSearch = isSearching || isLoadingGroups;

  // Filter out already selected groups from search results
  const filteredSearchResults = displaySearchResults.filter(
    g => !filters.hostingGroups.includes(g.id)
  );

  if (!visible) return null;

  const handleDatePresetSelect = (value: DateFilterPreset) => {
    onFilterChange({
      dateFilter: value,
      // Clear custom dates when selecting a preset
      startDate: null,
      endDate: null,
    });
  };

  const handleGroupToggle = (groupId: string) => {
    const currentGroups = filters.hostingGroups;
    const isSelected = currentGroups.includes(groupId);

    if (isSelected) {
      onFilterChange({
        hostingGroups: currentGroups.filter((id) => id !== groupId),
      });
    } else {
      onFilterChange({
        hostingGroups: [...currentGroups, groupId],
      });
    }
  };

  const handleReset = () => {
    onFilterChange({
      dateFilter: 'this_week',
      startDate: null,
      endDate: null,
      hostingGroups: [],
    });
    setGroupSearch('');
  };

  const hasActiveFilters =
    (filters.dateFilter !== 'this_week') ||
    filters.startDate !== null ||
    filters.endDate !== null ||
    filters.hostingGroups.length > 0;

  return (
    <View style={styles.overlay}>
      <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />
      <View style={styles.card}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Filter Events</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton} activeOpacity={0.8}>
            <Ionicons name="close" size={20} color="#333" />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Date Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Date Range</Text>
            <View style={styles.optionsGrid}>
              {DATE_PRESETS.map((option) => {
                const isSelected = filters.dateFilter === option.value;
                return (
                  <TouchableOpacity
                    key={option.label}
                    style={[styles.optionChip, isSelected && { backgroundColor: primaryColor, borderColor: primaryColor }]}
                    onPress={() => handleDatePresetSelect(option.value)}
                    activeOpacity={0.7}
                  >
                    {option.value === 'today' && (
                      <Ionicons
                        name="today-outline"
                        size={16}
                        color={isSelected ? '#fff' : COLORS.textMuted}
                        style={styles.optionIcon}
                      />
                    )}
                    {option.value === 'this_week' && (
                      <Ionicons
                        name="calendar-outline"
                        size={16}
                        color={isSelected ? '#fff' : COLORS.textMuted}
                        style={styles.optionIcon}
                      />
                    )}
                    {option.value === 'this_month' && (
                      <Ionicons
                        name="calendar-number-outline"
                        size={16}
                        color={isSelected ? '#fff' : COLORS.textMuted}
                        style={styles.optionIcon}
                      />
                    )}
                    <Text style={[styles.optionChipText, isSelected && styles.optionChipTextSelected]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Hosting Groups Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Hosting Group</Text>
            {filters.hostingGroups.length > 0 && (
              <Text style={[styles.selectedCount, { color: primaryColor }]}>
                {filters.hostingGroups.length} selected
              </Text>
            )}

            {/* Search input for groups */}
            <View style={styles.searchInputWrapper}>
              <Ionicons name="search" size={18} color={COLORS.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search groups..."
                placeholderTextColor={COLORS.textMuted}
                value={groupSearch}
                onChangeText={setGroupSearch}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {groupSearch.length > 0 && (
                <TouchableOpacity onPress={() => setGroupSearch('')}>
                  <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {/* Selected groups - always show at top */}
            {displaySelectedGroups.length > 0 && (
              <View style={styles.groupsList}>
                {displaySelectedGroups.map((group) => (
                  <TouchableOpacity
                    key={group.id}
                    style={[styles.groupItem, { backgroundColor: `${primaryColor}15` }]}
                    onPress={() => handleGroupToggle(group.id)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.groupInfo}>
                      <Text style={[styles.groupName, { color: primaryColor }]} numberOfLines={1}>
                        {group.name}
                      </Text>
                      {group.groupTypeName && (
                        <Text style={styles.groupType}>{group.groupTypeName}</Text>
                      )}
                    </View>
                    <Ionicons name="checkmark-circle" size={22} color={primaryColor} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Search results */}
            {groupSearch.trim().length >= 2 && (
              <>
                {isLoadingSearch ? (
                  <View style={styles.searchingContainer}>
                    <ActivityIndicator size="small" color={primaryColor} />
                    <Text style={styles.searchingText}>Searching...</Text>
                  </View>
                ) : filteredSearchResults.length === 0 ? (
                  <Text style={styles.emptyText}>No groups match your search</Text>
                ) : (
                  <View style={styles.groupsList}>
                    {filteredSearchResults.map((group) => (
                      <TouchableOpacity
                        key={group.id}
                        style={styles.groupItem}
                        onPress={() => handleGroupToggle(group.id)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.groupInfo}>
                          <Text style={styles.groupName} numberOfLines={1}>
                            {group.name}
                          </Text>
                          {group.groupTypeName && (
                            <Text style={styles.groupType}>{group.groupTypeName}</Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}

            {/* Empty state when no search and no selection */}
            {groupSearch.trim().length < 2 && displaySelectedGroups.length === 0 && (
              <Text style={styles.emptyText}>
                Type at least 2 characters to search for groups
              </Text>
            )}
          </View>
        </ScrollView>

        {/* Reset Button */}
        {hasActiveFilters && (
          <TouchableOpacity style={styles.resetButton} onPress={handleReset} activeOpacity={0.7}>
            <Ionicons name="refresh-outline" size={16} color={primaryColor} />
            <Text style={[styles.resetText, { color: primaryColor }]}>Reset filters</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-start',
    paddingTop: Platform.OS === 'ios' ? 110 : 70,
    paddingHorizontal: 16,
    zIndex: 1000,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    maxHeight: '70%',
    ...Platform.select({
      web: {
        boxShadow: '0px 4px 20px rgba(0, 0, 0, 0.15)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 10,
        elevation: 8,
      },
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    flexGrow: 0,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  selectedCount: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 10,
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: '#fff',
  },
  optionChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  optionChipTextSelected: {
    color: '#fff',
  },
  optionIcon: {
    marginRight: 6,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
    marginBottom: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 12,
  },
  searchingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  searchingText: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    paddingVertical: 12,
  },
  groupsList: {
    gap: 8,
  },
  groupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#F8F8F8',
  },
  groupInfo: {
    flex: 1,
    marginRight: 12,
  },
  groupName: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.text,
  },
  groupType: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    marginTop: 8,
  },
  resetText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
