/**
 * Notification Preferences Section
 *
 * Simplified notification preferences:
 * - Master toggle for push notifications (enables/disables all push tokens)
 * - Per-group notification toggles
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import Constants from 'expo-constants';
import { useNotifications } from '@providers/NotificationProvider';
import { useQuery, useAuthenticatedMutation, useMutation, api } from '@services/api/convex';
import { useCommunityTheme } from '@hooks/useCommunityTheme';
import { useAuth } from '@providers/AuthProvider';
import type { Id } from '@services/api/convex';

type GroupNotificationToggleProps = {
  groupId: Id<"groups">;
  groupName: string;
  groupType: string;
  enabled: boolean;
  disabled?: boolean;
  primaryColor: string;
  userId: Id<"users">;
};

const GroupNotificationToggle: React.FC<GroupNotificationToggleProps> = ({
  groupId,
  groupName,
  groupType,
  enabled,
  disabled = false,
  primaryColor,
  userId,
}) => {
  const [isPending, setIsPending] = useState(false);
  const setGroupNotifications = useAuthenticatedMutation(api.functions.notifications.preferences.setGroupNotifications);

  const handleToggle = async (value: boolean) => {
    setIsPending(true);
    try {
      await setGroupNotifications({ groupId, enabled: value });
    } catch (error) {
      Alert.alert('Error', 'Failed to update notification setting');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <View style={styles.groupRow}>
      <View style={styles.groupInfo}>
        <Text style={[styles.groupName, disabled && styles.disabledText]}>
          {groupName}
        </Text>
        {groupType && (
          <Text style={[styles.groupType, disabled && styles.disabledText]}>
            {groupType}
          </Text>
        )}
      </View>
      <Switch
        value={enabled}
        onValueChange={handleToggle}
        disabled={disabled || isPending}
        trackColor={{ false: '#e0e0e0', true: primaryColor }}
        thumbColor="#fff"
      />
    </View>
  );
};

export const NotificationPreferencesSection: React.FC = () => {
  const { user, token } = useAuth();
  const { isEnabled, requestPermissions, expoPushToken } = useNotifications();
  const { primaryColor } = useCommunityTheme();
  const userId = user?.id as Id<"users"> | undefined;
  const [isUpdating, setIsUpdating] = useState(false);

  // Fetch preferences using Convex
  const preferences = useQuery(
    api.functions.notifications.preferences.preferences,
    userId && token ? { token } : "skip"
  );
  const isLoading = preferences === undefined && !!userId;

  // Update master toggle mutation
  const updatePreferences = useAuthenticatedMutation(api.functions.notifications.preferences.updatePreferences);

  // Register token mutation (for enabling notifications)
  const registerTokenMutation = useMutation(api.functions.notifications.tokens.registerToken);

  const handleEnableNotifications = async (): Promise<boolean> => {
    const granted = await requestPermissions();
    if (!granted) {
      Alert.alert(
        'Permission Required',
        'Please enable notifications in your device settings to receive updates.'
      );
    }
    return granted;
  };

  // Retry handler for error state
  const handleRetry = () => {
    // Convex queries auto-retry, so we just need to wait for the next update
    // The query will automatically refetch
  };

  if (isLoading) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <ActivityIndicator style={styles.loader} />
      </View>
    );
  }

  if (!preferences) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <Text style={styles.errorText}>Failed to load notification settings</Text>
        <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Check if device permissions are granted
  const devicePermissionsGranted = isEnabled && expoPushToken;

  // Master toggle state - use notificationsEnabled from preferences
  const notificationsEnabled = preferences?.notificationsEnabled ?? false;

  // Notifications are disabled if device permissions are not granted
  const groupTogglesDisabled = !devicePermissionsGranted || !notificationsEnabled;

  const handleToggleMaster = async (enabled: boolean) => {
    if (!userId || !token) return;

    setIsUpdating(true);
    try {
      if (enabled) {
        // When enabling, first check if we have permissions and token
        if (!devicePermissionsGranted) {
          // Request permissions - this will trigger NotificationProvider to register token
          const granted = await handleEnableNotifications();
          if (!granted) {
            setIsUpdating(false);
            return;
          }
        }

        // If we already have a token, register it now
        // Otherwise, NotificationProvider will handle registration after permissions are granted
        if (expoPushToken) {
          const platform = Platform.OS as 'ios' | 'android' | 'web';
          const bundleId = platform === 'ios'
            ? Constants.expoConfig?.ios?.bundleIdentifier
            : Constants.expoConfig?.android?.package;

          await registerTokenMutation({
            authToken: token,
            token: expoPushToken,
            platform,
            bundleId,
          });
        }
        // If expoPushToken is null, NotificationProvider's useEffect will handle it
        // after permissions are granted. The UI will update reactively via the preferences query.
      } else {
        // When disabling, delete the token via updatePreferences
        await updatePreferences({ notificationsEnabled: false });
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to update notification preference');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Notifications</Text>

      {/* Master toggle for notifications */}
      <View style={styles.masterToggleContainer}>
        <View style={styles.masterToggleText}>
          <Text style={styles.masterToggleLabel}>Push Notifications</Text>
          <Text style={styles.masterToggleDescription}>
            {notificationsEnabled
              ? devicePermissionsGranted
                ? 'Enabled'
                : 'Enable device permissions below'
              : 'Turn on to receive notifications'}
          </Text>
        </View>
        <Switch
          value={notificationsEnabled}
          onValueChange={handleToggleMaster}
          disabled={isUpdating}
          trackColor={{ false: '#e0e0e0', true: primaryColor }}
          thumbColor="#fff"
        />
      </View>

      {notificationsEnabled && !devicePermissionsGranted && (
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>
            Push notifications are enabled but device permissions are needed.
          </Text>
          <TouchableOpacity
            style={styles.enableButton}
            onPress={handleEnableNotifications}
          >
            <Text style={styles.enableButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Per-group notification toggles */}
      {preferences?.groups && preferences.groups.length > 0 && userId && (
        <View style={styles.groupsContainer}>
          <Text style={styles.subsectionTitle}>Group Notifications</Text>
          <Text style={styles.subsectionDescription}>
            Choose which groups can send you notifications
          </Text>

          {preferences.groups.map((group) => (
            <GroupNotificationToggle
              key={group.id}
              groupId={group.id as Id<"groups">}
              groupName={group.name}
              groupType={group.groupType}
              enabled={group.notificationsEnabled ?? true}
              disabled={groupTogglesDisabled}
              primaryColor={primaryColor}
              userId={userId}
            />
          ))}
        </View>
      )}

      {preferences?.groups && preferences.groups.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>
            Join a group to manage its notification settings
          </Text>
        </View>
      )}

      {isUpdating && (
        <View style={styles.savingIndicator}>
          <ActivityIndicator size="small" color="#666" />
          <Text style={styles.savingText}>Saving...</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginTop: 12,
    backgroundColor: '#fff',
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 16,
  },
  masterToggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  masterToggleText: {
    flex: 1,
    marginRight: 16,
  },
  masterToggleLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
  },
  masterToggleDescription: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
  },
  subsectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  subsectionDescription: {
    fontSize: 13,
    color: '#666',
    marginBottom: 16,
  },
  groupsContainer: {
    marginTop: 8,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  groupInfo: {
    flex: 1,
    marginRight: 16,
  },
  groupName: {
    fontSize: 16,
    color: '#333',
  },
  groupType: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  disabledText: {
    color: '#aaa',
  },
  warningBox: {
    backgroundColor: '#FFF3E0',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  warningText: {
    fontSize: 14,
    color: '#E65100',
    marginBottom: 12,
  },
  enableButton: {
    backgroundColor: '#FF9800',
    borderRadius: 6,
    padding: 12,
    alignItems: 'center',
  },
  enableButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyState: {
    padding: 20,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  loader: {
    marginVertical: 20,
  },
  errorText: {
    color: '#e53935',
    fontSize: 14,
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: '#f0f0f0',
    borderRadius: 6,
    padding: 12,
    alignItems: 'center',
  },
  retryButtonText: {
    color: '#333',
    fontSize: 14,
    fontWeight: '600',
  },
  savingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  savingText: {
    marginLeft: 8,
    fontSize: 12,
    color: '#666',
  },
});
