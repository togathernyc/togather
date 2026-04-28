/**
 * UserProfileScreen — view another user's profile within the active
 * community. Composed of the smaller section components in this folder;
 * this file owns loading/error/not-found and page chrome.
 *
 * Route: /profile/[userId]
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Pressable,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@providers/AuthProvider';
import { useTheme } from '@hooks/useTheme';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useConvexFeatureFlag } from '@hooks/useConvexFeatureFlag';
import type { Id } from '@services/api/convex';
import { useStartDirectMessage } from '@features/chat/hooks/useStartDirectMessage';
import { RequireProfilePhotoSheet } from '@features/chat/components/RequireProfilePhotoSheet';

import { useUserProfile } from '../hooks/useUserProfile';
import { UserProfileHeader } from './UserProfileHeader';
import { UserProfileBadges } from './UserProfileBadges';
import { UserProfileBio } from './UserProfileBio';
import { UserProfileSocials } from './UserProfileSocials';
import { UserProfileDetailsCard } from './UserProfileDetailsCard';
import { UserProfileMutualGroups } from './UserProfileMutualGroups';
import { UserProfileUpcomingEvents } from './UserProfileUpcomingEvents';

export function UserProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user, community } = useAuth();
  const params = useLocalSearchParams<{ userId: string }>();
  const userId = params.userId as Id<'users'> | undefined;
  const communityId = community?.id as Id<'communities'> | undefined;

  const isSelf = !!userId && !!user?.id && userId === user.id;

  const {
    profile,
    mutualGroups,
    upcomingEvents,
    isLoading,
  } = useUserProfile({
    userId: userId ?? null,
    communityId: communityId ?? null,
    // Skip the viewer-dependent queries when looking at your own profile —
    // the dedicated self profile screen already owns that view.
    skipViewerScopedQueries: isSelf,
  });

  // DM entry point. Hidden behind the `direct-messages` feature flag; while
  // the flag is hydrating we render nothing so the button doesn't flicker in.
  const { enabled: dmsEnabled, loaded: dmsFlagLoaded } =
    useConvexFeatureFlag('direct-messages');
  const { messageUser, isStarting, canMessage } = useStartDirectMessage();
  const [photoSheetVisible, setPhotoSheetVisible] = useState(false);

  const showMessageButton =
    dmsFlagLoaded &&
    dmsEnabled &&
    !isSelf &&
    !!profile &&
    canMessage;

  const handleMessagePress = async () => {
    if (!profile || !userId) return;
    const displayName =
      [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
    const outcome = await messageUser({
      otherUserId: userId,
      firstName: profile.firstName ?? null,
      displayName: displayName.length > 0 ? displayName : null,
      profilePhoto: profile.profilePhoto ?? null,
    });
    if (outcome.kind === 'needs_self_photo') {
      setPhotoSheetVisible(true);
    }
  };

  const headerBar = (
    <View
      style={[
        styles.header,
        { paddingTop: insets.top + 12, backgroundColor: colors.surface },
      ]}
    >
      <TouchableOpacity
        onPress={() => router.back()}
        style={styles.backButton}
        accessibilityLabel="Go back"
      >
        <Ionicons name="arrow-back" size={24} color={colors.text} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: colors.text }]}>Profile</Text>
      {isSelf ? (
        <TouchableOpacity
          onPress={() => router.push('/(user)/edit-profile')}
          style={styles.editButton}
          accessibilityLabel="Edit profile"
        >
          <Text style={[styles.editButtonText, { color: colors.text }]}>Edit</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.headerSpacer} />
      )}
    </View>
  );

  if (!userId || !communityId) {
    return (
      <View
        style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}
      >
        {headerBar}
        <View style={styles.centered}>
          <Text style={[styles.missingText, { color: colors.textSecondary }]}>
            Profile unavailable.
          </Text>
        </View>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View
        style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}
      >
        {headerBar}
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.text} />
        </View>
      </View>
    );
  }

  if (!profile) {
    return (
      <View
        style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}
      >
        {headerBar}
        <View style={styles.centered}>
          <Ionicons
            name="person-outline"
            size={48}
            color={colors.iconSecondary}
            style={{ marginBottom: 12 }}
          />
          <Text style={[styles.missingTitle, { color: colors.text }]}>
            Profile not found
          </Text>
          <Text style={[styles.missingText, { color: colors.textSecondary }]}>
            This member is not in your community.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}
    >
      {headerBar}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        <UserProfileHeader profile={profile} />
        <UserProfileBadges profile={profile} />
        {showMessageButton ? (
          <MessageButton
            onPress={handleMessagePress}
            disabled={isStarting}
          />
        ) : null}
        <UserProfileBio bio={profile.bio} />
        <UserProfileSocials
          instagramHandle={profile.instagramHandle}
          linkedinHandle={profile.linkedinHandle}
        />
        <UserProfileDetailsCard
          birthdayMonth={profile.birthdayMonth}
          birthdayDay={profile.birthdayDay}
          location={profile.location}
        />
        {!isSelf && (
          <UserProfileMutualGroups groups={mutualGroups ?? []} />
        )}
        {!isSelf && (
          <UserProfileUpcomingEvents events={upcomingEvents ?? []} />
        )}
      </ScrollView>
      <RequireProfilePhotoSheet
        visible={photoSheetVisible}
        onClose={() => setPhotoSheetVisible(false)}
      />
    </View>
  );
}

interface MessageButtonProps {
  onPress: () => void;
  disabled?: boolean;
}

function MessageButton({ onPress, disabled }: MessageButtonProps) {
  const { primaryColor } = useCommunityTheme();
  // Web RN ignores layout styles passed via Pressable's function-style prop —
  // keep all layout on the inner View and only use the function form to dim
  // the press state on native.
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Message"
      style={({ pressed }) => ({
        opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
      })}
    >
      <View style={[styles.messageButton, { backgroundColor: primaryColor }]}>
        {disabled ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <>
            <Ionicons name="chatbubble-outline" size={18} color="#fff" />
            <Text style={styles.messageButtonText}>Message</Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.05)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
      },
    }),
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
  },
  editButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 40,
    alignItems: 'flex-end',
  },
  editButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
    gap: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  missingTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 6,
  },
  missingText: {
    fontSize: 14,
    textAlign: 'center',
  },
  messageButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 8,
  },
  messageButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
