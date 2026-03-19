/**
 * Blocked Users Section
 *
 * Displays a link to the Blocked Users management screen.
 * Part of the Privacy settings.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useTheme } from '@hooks/useTheme';

export function BlockedUsersSection() {
  const router = useRouter();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  return (
    <View style={[styles.section, { backgroundColor: colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Privacy</Text>

      <TouchableOpacity
        style={[styles.menuItem, { backgroundColor: colors.surfaceSecondary }]}
        onPress={() => router.push('/(user)/settings/blocked-users')}
      >
        <View style={styles.menuItemContent}>
          <Ionicons name="ban-outline" size={22} color={colors.textSecondary} style={styles.icon} />
          <View style={styles.menuItemText}>
            <Text style={[styles.menuItemLabel, { color: colors.text }]}>Blocked Users</Text>
            <Text style={[styles.menuItemDescription, { color: colors.textSecondary }]}>
              Manage users you have blocked
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={primaryColor} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 12,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    padding: 16,
  },
  menuItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  icon: {
    marginRight: 12,
  },
  menuItemText: {
    flex: 1,
  },
  menuItemLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  menuItemDescription: {
    fontSize: 13,
    marginTop: 2,
  },
});
