/**
 * ViewToggle Component
 *
 * Segmented control for switching between Groups and Events views
 * in the Explore tab.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import type { ExploreView } from '../hooks/useExploreFilters';

interface ViewToggleProps {
  activeView: ExploreView;
  onViewChange: (view: ExploreView) => void;
}

export function ViewToggle({ activeView, onViewChange }: ViewToggleProps) {
  const { primaryColor } = useCommunityTheme();

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.option, activeView === 'groups' && { backgroundColor: primaryColor }]}
        onPress={() => onViewChange('groups')}
        activeOpacity={0.7}
      >
        <Ionicons
          name="people-outline"
          size={16}
          color={activeView === 'groups' ? '#fff' : COLORS.textMuted}
          style={styles.icon}
        />
        <Text style={[styles.optionText, activeView === 'groups' && styles.optionTextActive]}>
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
          color={activeView === 'events' ? '#fff' : COLORS.textMuted}
          style={styles.icon}
        />
        <Text style={[styles.optionText, activeView === 'events' && styles.optionTextActive]}>
          Events
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
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
    color: COLORS.textMuted,
  },
  optionTextActive: {
    color: '#fff',
  },
  icon: {
    marginRight: 6,
  },
});
