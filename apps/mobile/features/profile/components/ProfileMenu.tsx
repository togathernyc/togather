import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '@components/ui';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@providers/AuthProvider';
import { useAuthenticatedQuery, api } from '@services/api/convex';
import type { Id } from '@services/api/convex';

// Design constants
const ICON_COLOR = "#1a1a1a";
const ICON_BG = "#f5f5f5";

export function ProfileMenu() {
  const router = useRouter();
  const { user, community } = useAuth();
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
          style={styles.menuItem}
          onPress={() => router.push('/(user)/edit-profile')}
          activeOpacity={0.7}
        >
          <View style={styles.menuIconContainer}>
            <Ionicons name="person-outline" size={20} color={ICON_COLOR} />
          </View>
          <Text style={styles.menuText}>Edit Profile</Text>
          <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.menuItem}
          onPress={handleSwitchCommunity}
          activeOpacity={0.7}
          disabled={isLoadingCommunities || isRefetching}
        >
          <View style={styles.menuIconContainer}>
            <Ionicons name="people-outline" size={20} color={ICON_COLOR} />
          </View>
          {community?.name ? (
            <View style={styles.menuTextContainer}>
              <Text style={styles.menuText}>Switch Community</Text>
              <Text style={styles.menuSubtext}>{community.name}</Text>
            </View>
          ) : (
            <Text style={styles.menuText}>Pick a community</Text>
          )}
          {isLoadingCommunities || isRefetching ? (
            <ActivityIndicator size="small" color="#999" />
          ) : (
            <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.menuItem, styles.menuItemLast]}
          onPress={() => router.push('/(user)/settings')}
          activeOpacity={0.7}
        >
          <View style={styles.menuIconContainer}>
            <Ionicons name="settings-outline" size={20} color={ICON_COLOR} />
          </View>
          <Text style={styles.menuText}>Settings</Text>
          <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
        </TouchableOpacity>
      </Card>

      {hasLeaderAccess === true ? (
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Leader Tools</Text>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() =>
              router.push({
                pathname: "/tasks",
                params: { returnTo: "/(tabs)/profile" },
              })
            }
            activeOpacity={0.7}
          >
            <View style={styles.menuIconContainer}>
              <Ionicons name="checkbox-outline" size={20} color={ICON_COLOR} />
            </View>
            <Text style={styles.menuText}>Tasks</Text>
            <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemLast]}
            onPress={() =>
              router.push({
                pathname: "/people",
                params: { returnTo: "/(tabs)/profile" },
              })
            }
            activeOpacity={0.7}
          >
            <View style={styles.menuIconContainer}>
              <Ionicons name="people-outline" size={20} color={ICON_COLOR} />
            </View>
            <Text style={styles.menuText}>People</Text>
            <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
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
    borderBottomColor: '#e5e5e5',
  },
  menuItemLast: {
    borderBottomWidth: 0,
  },
  menuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: ICON_BG,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '400',
    color: '#1a1a1a',
  },
  menuTextContainer: {
    flex: 1,
  },
  menuSubtext: {
    fontSize: 13,
    color: '#8e8e93',
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: '#8e8e93',
    marginTop: 8,
    marginBottom: 4,
  },
});
