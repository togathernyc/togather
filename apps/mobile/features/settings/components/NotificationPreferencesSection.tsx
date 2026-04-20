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
import { useTheme } from '@hooks/useTheme';
import { ThemedHeading } from '@components/ui/ThemedHeading';
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
  colors: {
    text: string;
    textSecondary: string;
    textTertiary: string;
    border: string;
    borderLight: string;
    textInverse: string;
  };
};

const GroupNotificationToggle: React.FC<GroupNotificationToggleProps> = ({
  groupId,
  groupName,
  groupType,
  enabled,
  disabled = false,
  primaryColor,
  userId,
  colors,
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
    <View style={[styles.groupRow, { borderBottomColor: colors.borderLight }]}>
      <View style={styles.groupInfo}>
        <Text style={[styles.groupName, { color: colors.text }, disabled && { color: colors.textTertiary }]}>
          {groupName}
        </Text>
        {groupType && (
          <Text style={[styles.groupType, { color: colors.textSecondary }, disabled && { color: colors.textTertiary }]}>
            {groupType}
          </Text>
        )}
      </View>
      <Switch
        value={enabled}
        onValueChange={handleToggle}
        disabled={disabled || isPending}
        trackColor={{ false: colors.border, true: primaryColor }}
        thumbColor={colors.textInverse}
      />
    </View>
  );
};

export const NotificationPreferencesSection: React.FC = () => {
  const { user, token } = useAuth();
  const { isEnabled, requestPermissions, expoPushToken } = useNotifications();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();
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
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <ThemedHeading level={2} style={[styles.sectionTitle, { color: colors.text }]}>Notifications</ThemedHeading>
        <ActivityIndicator style={styles.loader} />
      </View>
    );
  }

  if (!preferences) {
    return (
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <ThemedHeading level={2} style={[styles.sectionTitle, { color: colors.text }]}>Notifications</ThemedHeading>
        <Text style={[styles.errorText, { color: colors.error }]}>Failed to load notification settings</Text>
        <TouchableOpacity
          style={[styles.retryButton, { backgroundColor: colors.surfaceSecondary }]}
          onPress={handleRetry}
        >
          <Text style={[styles.retryButtonText, { color: colors.text }]}>Retry</Text>
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
    <View style={[styles.section, { backgroundColor: colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Notifications</Text>

      {/* Master toggle for notifications */}
      <View style={[styles.masterToggleContainer, { backgroundColor: colors.surfaceSecondary }]}>
        <View style={styles.masterToggleText}>
          <Text style={[styles.masterToggleLabel, { color: colors.text }]}>Push Notifications</Text>
          <Text style={[styles.masterToggleDescription, { color: colors.textSecondary }]}>
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
          trackColor={{ false: colors.border, true: primaryColor }}
          thumbColor={colors.textInverse}
        />
      </View>

      {notificationsEnabled && !devicePermissionsGranted && (
        <View style={[styles.warningBox, { backgroundColor: colors.warning + '1A' }]}>
          <Text style={[styles.warningText, { color: colors.warning }]}>
            Push notifications are enabled but device permissions are needed.
          </Text>
          <TouchableOpacity
            style={[styles.enableButton, { backgroundColor: colors.warning }]}
            onPress={handleEnableNotifications}
          >
            <Text style={[styles.enableButtonText, { color: colors.textInverse }]}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Per-group notification toggles */}
      {preferences?.groups && preferences.groups.length > 0 && userId && (
        <View style={styles.groupsContainer}>
          <Text style={[styles.subsectionTitle, { color: colors.text }]}>Group Notifications</Text>
          <Text style={[styles.subsectionDescription, { color: colors.textSecondary }]}>
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
              colors={colors}
            />
          ))}
        </View>
      )}

      {preferences?.groups && preferences.groups.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>
            Join a group to manage its notification settings
          </Text>
        </View>
      )}

      {isUpdating && (
        <View style={styles.savingIndicator}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
          <Text style={[styles.savingText, { color: colors.textSecondary }]}>Saving...</Text>
        </View>
      )}
    </View>
  );
};

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
  masterToggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  },
  masterToggleDescription: {
    fontSize: 13,
    marginTop: 4,
  },
  subsectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  subsectionDescription: {
    fontSize: 13,
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
  },
  groupInfo: {
    flex: 1,
    marginRight: 16,
  },
  groupName: {
    fontSize: 16,
  },
  groupType: {
    fontSize: 13,
    marginTop: 2,
  },
  warningBox: {
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  warningText: {
    fontSize: 14,
    marginBottom: 12,
  },
  enableButton: {
    borderRadius: 6,
    padding: 12,
    alignItems: 'center',
  },
  enableButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  emptyState: {
    padding: 20,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 14,
    textAlign: 'center',
  },
  loader: {
    marginVertical: 20,
  },
  errorText: {
    fontSize: 14,
    marginBottom: 12,
  },
  retryButton: {
    borderRadius: 6,
    padding: 12,
    alignItems: 'center',
  },
  retryButtonText: {
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
  },
});
