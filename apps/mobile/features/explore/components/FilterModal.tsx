import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, DEFAULT_GROUP_COLOR, getGroupTypeColor } from '../constants';
import { useCommunityTheme } from '@hooks/useCommunityTheme';

// Meeting type options - Backend: ONLINE = 1, IN_PERSON = 2
const MEETING_TYPE_OPTIONS = [
  { label: 'All', value: null },
  { label: 'In-Person', value: 2 },
  { label: 'Online', value: 1 },
];

// Group type option from API (Convex returns string IDs)
export interface GroupTypeOption {
  id: string | number; // Support both Convex string IDs and legacy numeric IDs
  legacyId?: string; // Legacy ID from migration
  name: string;
  slug: string;
  description?: string | null;
  icon?: string | null;
  displayOrder?: number; // Optional since some endpoints may not include it
  isActive: boolean;
}

export interface FilterState {
  groupType: string | number | null; // Support both Convex string IDs and legacy numeric IDs
  meetingType: number | null;
}

interface FilterModalProps {
  visible: boolean;
  onClose: () => void;
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  groupTypes?: GroupTypeOption[];
  isLoadingGroupTypes?: boolean;
}

export function FilterModal({
  visible,
  onClose,
  filters,
  onFilterChange,
  groupTypes = [],
  isLoadingGroupTypes = false,
}: FilterModalProps) {
  const { primaryColor } = useCommunityTheme();

  // Build group type options from API data
  const groupTypeOptions = useMemo(() => {
    const options: Array<{ label: string; value: string | number | null; color?: string }> = [
      { label: 'All Types', value: null },
    ];

    // Add options from API - use dynamic color function for any group type ID
    groupTypes.forEach((gt) => {
      options.push({
        label: gt.name,
        value: gt.id,
        color: getGroupTypeColor(gt.id),
      });
    });

    return options;
  }, [groupTypes]);

  if (!visible) return null;

  const handleGroupTypeSelect = (value: string | number | null) => {
    onFilterChange({ ...filters, groupType: value });
  };

  const handleMeetingTypeSelect = (value: number | null) => {
    onFilterChange({ ...filters, meetingType: value });
  };

  const handleReset = () => {
    onFilterChange({ groupType: null, meetingType: null });
  };

  const hasActiveFilters = filters.groupType !== null || filters.meetingType !== null;

  return (
    <View style={styles.overlay}>
      <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />
      <View style={styles.card}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Filters</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton} activeOpacity={0.8}>
            <Ionicons name="close" size={20} color="#333" />
          </TouchableOpacity>
        </View>

        {/* Group Type Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Group Type</Text>
          {isLoadingGroupTypes ? (
            <Text style={styles.loadingText}>Loading group types...</Text>
          ) : (
            <View style={styles.optionsGrid}>
              {groupTypeOptions.map((option) => {
                const isSelected = filters.groupType === option.value;
                const typeColor = option.color || (option.value ? getGroupTypeColor(option.value) : primaryColor);

                return (
                  <TouchableOpacity
                    key={option.label}
                    style={[
                      styles.optionChip,
                      isSelected && { backgroundColor: typeColor, borderColor: typeColor },
                    ]}
                    onPress={() => handleGroupTypeSelect(option.value)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.optionChipText,
                        isSelected && styles.optionChipTextSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* Meeting Type Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Meeting Type</Text>
          <View style={styles.optionsGrid}>
            {MEETING_TYPE_OPTIONS.map((option) => {
              const isSelected = filters.meetingType === option.value;

              return (
                <TouchableOpacity
                  key={option.label}
                  style={[
                    styles.optionChip,
                    isSelected && { backgroundColor: primaryColor, borderColor: primaryColor },
                  ]}
                  onPress={() => handleMeetingTypeSelect(option.value)}
                  activeOpacity={0.7}
                >
                  {option.value === 2 && (
                    <Ionicons
                      name="people-outline"
                      size={16}
                      color={isSelected ? '#fff' : COLORS.textMuted}
                      style={styles.optionIcon}
                    />
                  )}
                  {option.value === 1 && (
                    <Ionicons
                      name="videocam-outline"
                      size={16}
                      color={isSelected ? '#fff' : COLORS.textMuted}
                      style={styles.optionIcon}
                    />
                  )}
                  <Text
                    style={[
                      styles.optionChipText,
                      isSelected && styles.optionChipTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

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
  loadingText: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontStyle: 'italic',
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
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 6,
  },
  resetText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
