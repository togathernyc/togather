import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { GroupType } from '@features/groups/types';
import { COLORS, MEETING_TYPE_OPTIONS } from '../constants';
import { useCommunityTheme } from '@hooks/useCommunityTheme';

interface FilterState {
  distance: number | null;
  groupType: number | null;
  dayOfWeek: number | null;
  meetingType: 'all' | 'online' | 'in-person';
  status: 'all' | 'open' | 'closed';
}

interface ExploreFiltersProps {
  filters: FilterState;
  onFilterChange: (filters: Partial<FilterState>) => void;
}

const GROUP_TYPE_OPTIONS = [
  { label: 'All Types', value: null },
  { label: 'Dinner Party', value: GroupType.DINNER_PARTY },
  { label: 'Team', value: GroupType.TEAM },
  { label: 'Public Group', value: GroupType.PUBLIC_GROUP },
  { label: 'Table', value: GroupType.TABLE },
];

interface FilterChipProps {
  label: string;
  isActive: boolean;
  onPress: () => void;
  primaryColor: string;
}

function FilterChip({ label, isActive, onPress, primaryColor }: FilterChipProps) {
  return (
    <TouchableOpacity
      style={[
        styles.chip,
        isActive && { backgroundColor: `${primaryColor}15`, borderColor: primaryColor },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, isActive && { color: primaryColor }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export function ExploreFilters({ filters, onFilterChange }: ExploreFiltersProps) {
  const { primaryColor } = useCommunityTheme();

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Group Type Filter */}
        {GROUP_TYPE_OPTIONS.map((option) => (
          <FilterChip
            key={`type-${option.value}`}
            label={option.label}
            isActive={filters.groupType === option.value}
            onPress={() => onFilterChange({ groupType: option.value })}
            primaryColor={primaryColor}
          />
        ))}

        {/* Meeting Type Filter */}
        {MEETING_TYPE_OPTIONS.map((option) => (
          <FilterChip
            key={`meeting-${option.value}`}
            label={option.label}
            isActive={filters.meetingType === option.value}
            onPress={() => onFilterChange({ meetingType: option.value })}
            primaryColor={primaryColor}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipText: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
});
