/**
 * UserProfileHeader — avatar + name + member-since line.
 * Role badges live in `UserProfileBadges` for clarity.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { AppImage } from '@components/ui';
import { useTheme } from '@hooks/useTheme';

import type { UserProfile } from '../hooks/useUserProfile';

interface UserProfileHeaderProps {
  profile: UserProfile;
}

export function UserProfileHeader({ profile }: UserProfileHeaderProps) {
  const { colors } = useTheme();

  const displayName =
    [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim() ||
    'Member';

  const memberSinceLabel = profile.memberSince
    ? formatMemberSince(profile.memberSince)
    : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <AppImage
        source={profile.profilePhoto ?? undefined}
        style={styles.avatar}
        optimizedWidth={200}
        placeholder={{
          type: 'initials',
          name: displayName,
          backgroundColor: '#E5E5E5',
        }}
      />
      <Text style={[styles.name, { color: colors.text }]}>{displayName}</Text>
      {memberSinceLabel && (
        <Text style={[styles.memberSince, { color: colors.textSecondary }]}>
          Member since {memberSinceLabel}
        </Text>
      )}
    </View>
  );
}

function formatMemberSince(timestampMs: number): string {
  const d = new Date(timestampMs);
  // "April 2024" — month name + year.
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
  });
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 12,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    marginBottom: 12,
  },
  name: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  memberSince: {
    fontSize: 13,
  },
});
