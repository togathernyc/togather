/**
 * ViewToggle Component
 *
 * Segmented control for switching between Groups and Events views
 * in the Explore tab.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useTheme } from '@hooks/useTheme';
import type { ExploreView } from '../hooks/useExploreFilters';

interface ViewToggleProps {
  activeView: ExploreView;
  onViewChange: (view: ExploreView) => void;
}

export function ViewToggle({ activeView, onViewChange }: ViewToggleProps) {
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <TouchableOpacity
        style={[styles.option, activeView === 'groups' && { backgroundColor: primaryColor }]}
        onPress={() => onViewChange('groups')}
        activeOpacity={0.7}
      >
        <Ionicons
          name="people-outline"
          size={16}
          color={activeView === 'groups' ? colors.textInverse : colors.textSecondary}
          style={styles.icon}
        />
        <Text style={[styles.optionText, { color: colors.textSecondary }, activeView === 'groups' && { color: colors.textInverse }]}>
          Groups
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.option, activeView === 'events' && { backgroundColor: primaryColor }]}
        onPress={() => onViewChange('events')}
        activeOpacity={0.7}
      >
        <Ionicons
          name="calendar-outline"
          size={16}
          color={activeView === 'events' ? colors.textInverse : colors.textSecondary}
          style={styles.icon}
        />
        <Text style={[styles.optionText, { color: colors.textSecondary }, activeView === 'events' && { color: colors.textInverse }]}>
          Events
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 4,
    marginBottom: 12,
  },
  option: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  optionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  icon: {
    marginRight: 6,
  },
});
