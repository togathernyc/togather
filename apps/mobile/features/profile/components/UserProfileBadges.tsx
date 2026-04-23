/**
 * Role pills: Primary Admin, Community Admin, Group Leader.
 * Returns null when the user has no badges to show (keeps the layout tight).
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import { useCommunityTheme } from '@hooks/useCommunityTheme';

import type { UserProfile } from '../hooks/useUserProfile';

interface UserProfileBadgesProps {
  profile: UserProfile;
}

export function UserProfileBadges({ profile }: UserProfileBadgesProps) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  const isLeader = (profile.leaderGroupIds?.length ?? 0) > 0;

  if (!profile.isPrimaryAdmin && !profile.isCommunityAdmin && !isLeader) {
    return null;
  }

  return (
    <View style={styles.container}>
      {profile.isPrimaryAdmin && (
        <Pill
          icon="star"
          label="Primary Admin"
          backgroundColor={primaryColor + '20'}
          color={primaryColor}
        />
      )}
      {!profile.isPrimaryAdmin && profile.isCommunityAdmin && (
        <Pill
          icon="shield-checkmark"
          label="Community Admin"
          backgroundColor={primaryColor + '15'}
          color={primaryColor}
        />
      )}
      {isLeader && (
        <Pill
          icon="flag"
          label="Group Leader"
          backgroundColor={colors.surface}
          color={colors.text}
        />
      )}
    </View>
  );
}

interface PillProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  backgroundColor: string;
  color: string;
}

function Pill({ icon, label, backgroundColor, color }: PillProps) {
  return (
    <View style={[styles.pill, { backgroundColor }]}>
      <Ionicons name={icon} size={14} color={color} />
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    gap: 6,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
