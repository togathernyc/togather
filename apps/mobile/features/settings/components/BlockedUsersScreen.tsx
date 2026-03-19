/**
 * Blocked Users Screen
 *
 * Displays a list of users the current user has blocked.
 * Allows users to unblock blocked users with confirmation.
 *
 * Uses Convex messaging blocking functions for block management.
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@providers/AuthProvider';
import { useQuery, useMutation, api } from '@services/api/convex';
import { Avatar } from '@components/ui';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useTheme } from '@hooks/useTheme';
import type { Id } from '@services/api/convex';

interface BlockedUser {
  _id: Id<'users'>;
  firstName?: string | null;
  lastName?: string | null;
  profilePhoto?: string | null;
}

export function BlockedUsersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { token } = useAuth();
  const { primaryColor } = useCommunityTheme();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [unblockingUserId, setUnblockingUserId] = useState<Id<'users'> | null>(null);

  // Fetch blocked users from Convex
  // useQuery returns data directly (or undefined when loading)
  const blockedUsers = useQuery(
    api.functions.messaging.blocking.getBlockedUsers,
    token ? { token } : "skip"
  );
  
  // Determine loading state: undefined means loading when token exists
  const isLoading = blockedUsers === undefined && !!token;

  // Unblock mutation
  const unblockUser = useMutation(api.functions.messaging.blocking.unblockUser);

  // Pull-to-refresh handler
  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    // Query will automatically refetch
    setTimeout(() => setIsRefreshing(false), 500);
  }, []);

  // Unblock a user with confirmation
  const handleUnblock = useCallback(
    async (blockedUser: BlockedUser) => {
      const userName = blockedUser.firstName && blockedUser.lastName
        ? `${blockedUser.firstName} ${blockedUser.lastName}`
        : blockedUser.firstName || blockedUser.lastName || 'this user';

      Alert.alert(
        'Unblock User',
        `Are you sure you want to unblock ${userName}? They will be able to message you again.`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Unblock',
            style: 'destructive',
            onPress: async () => {
              if (!token) return;

              setUnblockingUserId(blockedUser._id);
              try {
                await unblockUser({ token, blockedId: blockedUser._id });
              } catch (err) {
                console.error('[BlockedUsers] Failed to unblock user:', err);
                Alert.alert('Error', 'Failed to unblock user. Please try again.');
              } finally {
                setUnblockingUserId(null);
              }
            },
          },
        ]
      );
    },
    [token, unblockUser]
  );

  // Render a blocked user item
  const renderBlockedUser = ({ item }: { item: BlockedUser }) => {
    const isUnblocking = unblockingUserId === item._id;
    const userName = item.firstName && item.lastName
      ? `${item.firstName} ${item.lastName}`
      : item.firstName || item.lastName || 'Unknown User';
    const userImage = item.profilePhoto || undefined;

    return (
      <View style={[styles.userItem, { backgroundColor: colors.surface, shadowColor: colors.shadow }]}>
        <Avatar
          name={userName}
          imageUrl={userImage}
          size={48}
        />
        <View style={styles.userInfo}>
          <Text style={[styles.userName, { color: colors.text }]}>{userName}</Text>
        </View>
        <TouchableOpacity
          style={[styles.unblockButton, { borderColor: primaryColor }]}
          onPress={() => handleUnblock(item)}
          disabled={isUnblocking}
        >
          {isUnblocking ? (
            <ActivityIndicator size="small" color={primaryColor} />
          ) : (
            <Text style={[styles.unblockButtonText, { color: primaryColor }]}>
              Unblock
            </Text>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  // Empty state component
  const EmptyState = () => (
    <View style={styles.emptyState}>
      <Ionicons name="checkmark-circle-outline" size={64} color={colors.iconSecondary} />
      <Text style={[styles.emptyStateTitle, { color: colors.text }]}>No Blocked Users</Text>
      <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>
        You have not blocked anyone. Blocked users will appear here.
      </Text>
    </View>
  );


  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 20, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.push('/(user)/settings');
            }
          }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Blocked Users</Text>
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading blocked users...</Text>
        </View>
      ) : (
        <FlatList
          data={blockedUsers || []}
          keyExtractor={(item) => item._id}
          renderItem={renderBlockedUser}
          contentContainerStyle={[
            styles.listContent,
            (!blockedUsers || blockedUsers.length === 0) && styles.emptyListContent,
          ]}
          ListEmptyComponent={EmptyState}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={primaryColor}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 24,
    fontWeight: 'bold',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  listContent: {
    padding: 16,
  },
  emptyListContent: {
    flex: 1,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  userInfo: {
    flex: 1,
    marginLeft: 12,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
  },
  blockedDate: {
    fontSize: 13,
    marginTop: 2,
  },
  unblockButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  unblockButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: 16,
  },
  emptyStateText: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  errorState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  errorStateTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: 16,
  },
  errorStateText: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  retryButton: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
