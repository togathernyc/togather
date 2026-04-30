/**
 * UserProfileHeader — avatar + name + member-since line.
 * Role badges live in `UserProfileBadges` for clarity.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { AppImage } from '@components/ui';
import { ImageViewer } from '@components/ui/ImageViewer';
import { NotificationsDisabledBadge } from '@components/ui/NotificationsDisabledBadge';
import { useTheme } from '@hooks/useTheme';

import type { UserProfile } from '../hooks/useUserProfile';

interface UserProfileHeaderProps {
  profile: UserProfile;
}

export function UserProfileHeader({ profile }: UserProfileHeaderProps) {
  const { colors } = useTheme();
  // Local viewer state — rendering the Modal via the root-level
  // ImageViewerProvider doesn't work here because this screen is pushed
  // inside a React Native Screens Stack on iOS, which obscures the
  // root-level Modal. Keeping the Modal colocated with this screen puts
  // it in the same UIViewController hierarchy.
  const [viewerVisible, setViewerVisible] = useState(false);

  const displayName =
    [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim() ||
    'Member';

  const memberSinceLabel = profile.memberSince
    ? formatMemberSince(profile.memberSince)
    : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <TouchableOpacity
        activeOpacity={0.8}
        disabled={!profile.profilePhoto}
        onPress={() => {
          if (profile.profilePhoto) setViewerVisible(true);
        }}
      >
        <View style={styles.avatarWrapper}>
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
          {profile.notificationsDisabled ? (
            <NotificationsDisabledBadge
              avatarSize={96}
              ringColor={colors.surface}
            />
          ) : null}
        </View>
      </TouchableOpacity>
      <Text style={[styles.name, { color: colors.text }]}>{displayName}</Text>
      {memberSinceLabel && (
        <Text style={[styles.memberSince, { color: colors.textSecondary }]}>
          Member since {memberSinceLabel}
        </Text>
      )}
      {profile.profilePhoto && (
        <ImageViewer
          visible={viewerVisible}
          images={[profile.profilePhoto]}
          initialIndex={0}
          onClose={() => setViewerVisible(false)}
        />
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
  avatarWrapper: {
    position: 'relative',
    width: 96,
    height: 96,
    marginBottom: 12,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
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
