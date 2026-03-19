import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '@components/ui';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@providers/AuthProvider';
import { useTheme } from '@hooks/useTheme';
import { useAuthenticatedQuery, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';

export function ProfileMenu() {
  const router = useRouter();
  const { user, community } = useAuth();
  const { colors } = useTheme();
  const userId = user?.id as Id<"users"> | undefined;
  const [isRefetching, setIsRefetching] = useState(false);

  // Use Convex query for communities
  const communities = useAuthenticatedQuery(
    api.functions.communities.listForUser,
    userId ? {} : "skip"
  );
  const isLoadingCommunities = communities === undefined && !!userId;
  const hasLeaderAccess = useAuthenticatedQuery(
    api.functions.tasks.index.hasLeaderAccess,
    community?.id ? { communityId: community.id as Id<"communities"> } : "skip"
  );

  const handleSwitchCommunity = async () => {
    try {
      // Mark as refetching to show loading indicator
      setIsRefetching(true);

      // Convex queries auto-update, so we just need to use the latest data
      const communitiesData = communities;

      if (communitiesData && communitiesData.length > 0) {
        router.push({
          pathname: '/(auth)/select-community',
          params: { communities: JSON.stringify(communitiesData) },
        });
      } else {
        // Navigate anyway - the screen has search functionality
        router.push('/(auth)/select-community');
      }
    } catch (error) {
      console.error('Failed to fetch communities:', error);
      // Navigate anyway - the screen has search functionality
      router.push('/(auth)/select-community');
    } finally {
      setIsRefetching(false);
    }
  };

  return (
    <>
      <Card style={styles.section}>
        <TouchableOpacity
          style={[styles.menuItem, { borderBottomColor: colors.border }]}
          onPress={() => router.push('/(user)/edit-profile')}
          activeOpacity={0.7}
        >
          <View style={[styles.menuIconContainer, { backgroundColor: colors.surfaceSecondary }]}>
            <Ionicons name="person-outline" size={20} color={colors.text} />
          </View>
          <Text style={[styles.menuText, { color: colors.text }]}>Edit Profile</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.iconSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.menuItem, { borderBottomColor: colors.border }]}
          onPress={handleSwitchCommunity}
          activeOpacity={0.7}
          disabled={isLoadingCommunities || isRefetching}
        >
          <View style={[styles.menuIconContainer, { backgroundColor: colors.surfaceSecondary }]}>
            <Ionicons name="people-outline" size={20} color={colors.text} />
          </View>
          {community?.name ? (
            <View style={styles.menuTextContainer}>
              <Text style={[styles.menuText, { color: colors.text }]}>Switch Community</Text>
              <Text style={[styles.menuSubtext, { color: colors.textTertiary }]}>{community.name}</Text>
            </View>
          ) : (
            <Text style={[styles.menuText, { color: colors.text }]}>Pick a community</Text>
          )}
          {isLoadingCommunities || isRefetching ? (
            <ActivityIndicator size="small" color={colors.textTertiary} />
          ) : (
            <Ionicons name="chevron-forward" size={18} color={colors.iconSecondary} />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.menuItem, styles.menuItemLast, { borderBottomColor: colors.border }]}
          onPress={() => router.push('/(user)/settings')}
          activeOpacity={0.7}
        >
          <View style={[styles.menuIconContainer, { backgroundColor: colors.surfaceSecondary }]}>
            <Ionicons name="settings-outline" size={20} color={colors.text} />
          </View>
          <Text style={[styles.menuText, { color: colors.text }]}>Settings</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.iconSecondary} />
        </TouchableOpacity>
      </Card>

      {hasLeaderAccess === true ? (
        <Card style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Leader Tools</Text>
          <TouchableOpacity
            style={[styles.menuItem, { borderBottomColor: colors.border }]}
            onPress={() =>
              router.push({
                pathname: "/tasks",
                params: { returnTo: "/(tabs)/profile" },
              })
            }
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconContainer, { backgroundColor: colors.surfaceSecondary }]}>
              <Ionicons name="checkbox-outline" size={20} color={colors.text} />
            </View>
            <Text style={[styles.menuText, { color: colors.text }]}>Tasks</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.iconSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemLast, { borderBottomColor: colors.border }]}
            onPress={() =>
              router.push({
                pathname: "/people",
                params: { returnTo: "/(tabs)/profile" },
              })
            }
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconContainer, { backgroundColor: colors.surfaceSecondary }]}>
              <Ionicons name="people-outline" size={20} color={colors.text} />
            </View>
            <Text style={[styles.menuText, { color: colors.text }]}>People</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.iconSecondary} />
          </TouchableOpacity>
        </Card>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 12,
    marginHorizontal: 16,
    paddingVertical: 4,
    paddingHorizontal: 16,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuItemLast: {
    borderBottomWidth: 0,
  },
  menuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '400',
  },
  menuTextContainer: {
    flex: 1,
  },
  menuSubtext: {
    fontSize: 13,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 4,
  },
});
