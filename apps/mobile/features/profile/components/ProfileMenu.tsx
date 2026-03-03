import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '@components/ui';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@providers/AuthProvider';
import { useAuthenticatedQuery, api } from '@services/api/convex';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import type { Id } from '@services/api/convex';

export function ProfileMenu() {
  const router = useRouter();
  const { user, community } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const userId = user?.id as Id<"users"> | undefined;
  const [isRefetching, setIsRefetching] = useState(false);

  // Use Convex query for communities
  const communities = useAuthenticatedQuery(
    api.functions.communities.listForUser,
    userId ? {} : "skip"
  );
  const isLoadingCommunities = communities === undefined && !!userId;

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
    <Card style={styles.section}>
      <TouchableOpacity
        style={styles.menuItem}
        onPress={() => router.push('/(user)/edit-profile')}
        activeOpacity={0.7}
      >
        <View style={styles.menuIconContainer}>
          <Ionicons name="create-outline" size={24} color={primaryColor} />
        </View>
        <Text style={styles.menuText}>Edit Profile</Text>
        <Ionicons name="chevron-forward" size={20} color="#999" />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.menuItem}
        onPress={handleSwitchCommunity}
        activeOpacity={0.7}
        disabled={isLoadingCommunities || isRefetching}
      >
        <View style={styles.menuIconContainer}>
          <Ionicons
            name={community?.id ? "swap-horizontal-outline" : "people-outline"}
            size={24}
            color={primaryColor}
          />
        </View>
        <View style={styles.menuTextContainer}>
          <Text style={styles.menuText}>
            {community?.id ? "Switch Community" : "Pick a community"}
          </Text>
          {community?.name && (
            <Text style={styles.menuSubtext}>{community.name}</Text>
          )}
        </View>
        {isLoadingCommunities || isRefetching ? (
          <ActivityIndicator size="small" color={primaryColor} />
        ) : (
          <Ionicons name="chevron-forward" size={20} color="#999" />
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.menuItem, styles.menuItemLast]}
        onPress={() => router.push('/(user)/settings')}
        activeOpacity={0.7}
      >
        <View style={styles.menuIconContainer}>
          <Ionicons name="settings-outline" size={24} color={primaryColor} />
        </View>
        <Text style={styles.menuText}>Settings</Text>
        <Ionicons name="chevron-forward" size={20} color="#999" />
      </TouchableOpacity>

    </Card>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 12,
    marginHorizontal: 12,
    padding: 20,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  menuItemLast: {
    borderBottomWidth: 0,
  },
  menuIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f9f5ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  menuText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
  },
  menuTextContainer: {
    flex: 1,
  },
  menuSubtext: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
});
