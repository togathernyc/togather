/**
 * Notification Provider for handling push notifications.
 *
 * This provider:
 * - Registers for push notifications with Expo
 * - Sends the push token to our backend
 * - Handles incoming notifications
 * - Provides notification state and methods to children
 *
 * SETUP REQUIRED:
 * 1. Install expo-notifications: npx expo install expo-notifications expo-device expo-constants
 * 2. Configure app.json/app.config.js with notification settings
 * 3. For iOS: Configure APNs in your Apple Developer account
 * 4. For Android: Configure FCM in Firebase console
 *
 * See: https://docs.expo.dev/push-notifications/overview/
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import { Platform, AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useAuth } from './AuthProvider';
import { convexVanilla, api, useQuery, useMutation } from '@services/api/convex';
import type { Id } from '@services/api/convex';

// Try to import expo-notifications - may not be installed yet
let Notifications: typeof import('expo-notifications') | null = null;
let Device: typeof import('expo-device') | null = null;

try {
  Notifications = require('expo-notifications');
  Device = require('expo-device');
} catch (e) {
  console.warn(
    'expo-notifications not installed. Push notifications will not work. ' +
    'Run: npx expo install expo-notifications expo-device'
  );
}

// =========================================================================
// Types
// =========================================================================

type NotificationContextType = {
  /** Expo push token for this device */
  expoPushToken: string | null;
  /** Whether push notifications are enabled */
  isEnabled: boolean;
  /** Count of unread notifications */
  unreadCount: number;
  /** Whether the notification system is ready */
  isReady: boolean;
  /** Request notification permissions */
  requestPermissions: () => Promise<boolean>;
  /** Refresh unread count from server */
  refreshUnreadCount: () => Promise<void>;
  /** Handle notification received while app is open */
  lastNotification: NotificationData | null;
  /** Handle notification tap - navigate to relevant screen (exposed for testing) */
  handleNotificationTap: (data: Record<string, unknown>) => Promise<void>;
  /** Set the channel currently being viewed (to suppress notifications) */
  setActiveChannelId: (channelId: string | null) => void;
  /** Currently active channel ID */
  activeChannelId: string | null;
};

type NotificationData = {
  id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
};

const NotificationContext = createContext<NotificationContextType>({
  expoPushToken: null,
  isEnabled: false,
  unreadCount: 0,
  isReady: false,
  requestPermissions: async () => false,
  refreshUnreadCount: async () => {},
  lastNotification: null,
  handleNotificationTap: async () => {},
  setActiveChannelId: () => {},
  activeChannelId: null,
});

export const useNotifications = () => useContext(NotificationContext);

// =========================================================================
// Provider
// =========================================================================

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, isAuthenticated, community, setCommunity } = useAuth();
  // Store the auth token from AsyncStorage for passing to Convex functions
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [lastNotification, setLastNotification] = useState<NotificationData | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);

  const notificationListener = useRef<any>(null);
  const responseListener = useRef<any>(null);
  const appState = useRef(AppState.currentState);
  // Use ref for active channel to access in notification handler without stale closure
  const activeChannelIdRef = useRef<string | null>(null);
  // Track handled notification IDs to prevent duplicate navigation
  const handledNotificationIds = useRef<Set<string>>(new Set());

  // Keep ref in sync with state
  useEffect(() => {
    activeChannelIdRef.current = activeChannelId;
  }, [activeChannelId]);

  // Load auth token from AsyncStorage
  useEffect(() => {
    AsyncStorage.getItem('auth_token').then(setAuthToken);
  }, []);

  // Use reactive query for unread count - only when we have a valid auth token
  const unreadCountResult = useQuery(
    api.functions.notifications.queries.unreadCount,
    authToken ? { token: authToken } : "skip"
  );
  const unreadCount = unreadCountResult?.unreadCount ?? 0;

  // Use mutation hook for registering push token
  // NOTE: This mutation uses `authToken` (not `token`) for auth because
  // `token` is the push notification token. Cannot use useAuthenticatedMutation.
  const registerTokenMutation = useMutation(api.functions.notifications.tokens.registerToken);

  // Refresh unread count - now just a no-op since useQuery handles reactivity
  // Keeping for API compatibility with existing code that calls refreshUnreadCount
  const refreshUnreadCount = useCallback(async () => {
    // useQuery automatically keeps data fresh through subscriptions
    // This function exists for API compatibility but doesn't need to do anything
  }, []);

  // Request notification permissions
  const requestPermissions = useCallback(async (): Promise<boolean> => {
    if (!Notifications || !Device) {
      console.warn('expo-notifications not available');
      return false;
    }

    // Check if physical device (notifications don't work in simulator)
    if (!Device.isDevice) {
      console.warn('Push notifications only work on physical devices');
      return false;
    }

    try {
      const { status: existingStatus } =
        await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.log('Push notification permission not granted');
        setIsEnabled(false);
        return false;
      }

      setIsEnabled(true);
      return true;
    } catch (error) {
      console.error('Error requesting notification permissions:', error);
      return false;
    }
  }, []);

  // Register push token with backend using Convex
  const registerToken = useCallback(async () => {
    if (!Notifications || !isAuthenticated || !user) return;

    // Skip push notifications on web - requires VAPID key configuration
    if (Platform.OS === 'web') {
      console.log('Push notifications not supported on web (VAPID not configured)');
      return;
    }

    try {
      // Get Expo push token
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
      });
      const pushToken = tokenData.data;

      console.log('Expo push token:', pushToken);
      setExpoPushToken(pushToken);

      // Store token in AsyncStorage so AuthProvider can access it during logout
      await AsyncStorage.setItem('expo_push_token', pushToken);

      // Get the stored Convex user ID
      const storedUserId = await AsyncStorage.getItem("convex_user_id");
      if (!storedUserId) {
        console.warn('No stored user ID for push token registration');
        return;
      }

      // Register with backend using Convex
      const platform = Platform.OS as 'ios' | 'android' | 'web';
      // Select bundle ID based on current platform
      const bundleId = platform === 'ios'
        ? Constants.expoConfig?.ios?.bundleIdentifier
        : Constants.expoConfig?.android?.package;

      if (!authToken) {
        console.warn('No auth token available for push token registration');
        return;
      }

      await registerTokenMutation({
        authToken,
        token: pushToken,
        platform,
        bundleId,
      });
      console.log('Push token registered with backend');
    } catch (error) {
      console.error('Failed to register push token:', error);
    }
  }, [isAuthenticated, user, authToken, registerTokenMutation]);

  /**
   * Resolve a group ID for navigation.
   * Now that we use Convex IDs directly in routes, this simply returns the groupId.
   */
  const resolveGroupIdForNavigation = useCallback(async (groupId: string): Promise<string | null> => {
    if (!groupId) return null;
    return groupId;
  }, []);

  // Handle notification tap - navigate to relevant screen
  // Exported via context for testing via DeepLinkTester
  const handleNotificationTap = useCallback(async (data: Record<string, unknown>) => {
    // WORKAROUND: iOS push notifications sometimes have channelId nested inside data.data
    // while other fields (type, groupId, communityId) are at the top level.
    // Root cause unknown - may be Expo or iOS APNs restructuring the payload.
    // TODO: Investigate why iOS notification data has inconsistent nesting for channelId
    const nestedData = data.data as Record<string, unknown> | undefined;

    const type = data.type as string;
    const url = data.url as string;
    const groupId = (data.groupId || nestedData?.groupId) as string;
    const communityId = (data.communityId || nestedData?.communityId) as string | undefined;
    // channelId may be at top level or nested inside data.data
    const channelId = (data.channelId || nestedData?.channelId) as string | undefined;

    console.log('Handle notification tap:', { type, url, groupId, communityId, channelId, nestedData, data });
    console.log('Full notification data keys:', Object.keys(data));
    console.log('channelId value:', channelId, 'typeof:', typeof channelId);

    // Switch community if needed before navigating
    // community.id is now a Convex ID string
    if (communityId && community?.id !== String(communityId)) {
      console.log(`Switching community from ${community?.id} to ${communityId}`);
      try {
        await setCommunity({ id: String(communityId) });
        // Small delay to allow state to propagate
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error('Failed to switch community:', error);
      }
    }

    // If url is provided, navigate directly
    if (url) {
      router.push(url as any);
      return;
    }

    // Helper to navigate to a group, resolving legacy IDs to Convex IDs
    const navigateToGroup = async (gId: string) => {
      const resolvedId = await resolveGroupIdForNavigation(gId);
      if (resolvedId) {
        router.push(`/groups/${resolvedId}` as any);
      }
    };

    // Type-specific navigation fallbacks
    switch (type) {
      case 'join_request_received':
        router.push('/(tabs)/admin');
        break;
      case 'join_request_approved':
        if (groupId) {
          await navigateToGroup(groupId);
        }
        break;
      case 'group_creation_approved':
        if (groupId) {
          await navigateToGroup(groupId);
        }
        break;
      case 'new_message':
      case 'mention': {
        // Use URL-based slug routing: /inbox/[groupId]/[channelSlug]
        // Extract channelType from the notification data and resolve to slug
        const channelType = (data.channelType || nestedData?.channelType) as string | undefined;
        console.log(`[${type}] Extracted channelId:`, channelId, 'groupId:', groupId, 'channelType:', channelType);

        if (groupId && channelType) {
          // Map channelType to slug: "main" -> "general", "leaders" -> "leaders"
          // For custom channels, the channelType IS the slug
          const channelSlug = channelType === 'main' ? 'general' : (channelType === 'leaders' ? 'leaders' : channelType);
          const targetPath = `/inbox/${groupId}/${channelSlug}`;
          console.log(`[${type}] Navigating to:`, targetPath);
          router.push(targetPath as any);
        } else if (channelId) {
          // Use legacy route which will query DB to determine correct channel slug
          // This ensures leaders channel notifications land on the correct tab
          const targetPath = `/inbox/${channelId}`;
          console.log(`[${type}] Navigating to legacy route:`, targetPath);
          router.push({
            pathname: targetPath,
            params: groupId ? { groupId } : undefined,
          } as any);
        } else if (groupId) {
          // Last resort: have groupId but no channelType and no channelId
          // Default to general (best guess)
          const targetPath = `/inbox/${groupId}/general`;
          console.log(`[${type}] Navigating with default channelSlug:`, targetPath);
          router.push(targetPath as any);
        } else {
          console.log(`[${type}] No groupId or channelId, falling back to /(tabs)/chat`);
          router.push('/(tabs)/chat');
        }
        break;
      }
      case 'role_changed':
        // User was promoted to leader - navigate to group chat
        if (groupId) {
          await navigateToGroup(groupId);
        }
        break;
      case 'event_updated':
      case 'meeting_reminder': {
        // Navigate to event detail screen
        const shortId = data.shortId as string;
        if (shortId) {
          router.push(`/e/${shortId}?source=app` as any);
        }
        break;
      }
      case 'attendance_confirmation': {
        // Navigate to event detail screen with attendance confirmation modal
        const shortId = data.shortId as string;
        const route = data.route as string;
        if (route) {
          router.push(route as any);
        } else if (shortId) {
          router.push(`/e/${shortId}?confirmAttendance=true&source=app` as any);
        }
        break;
      }
      case 'followup_assigned': {
        // Navigate to the member's follow-up card via top-level route
        const groupMemberId = (data.groupMemberId || nestedData?.groupMemberId) as string;
        if (groupId && groupMemberId) {
          router.push(`/followup/${groupId}/${groupMemberId}` as any);
        }
        break;
      }
      default:
        // Default: do nothing or navigate to home
        console.log('Unknown notification type:', type);
    }
  }, [community?.id, setCommunity, resolveGroupIdForNavigation]);

  // Configure notification handler
  useEffect(() => {
    if (!Notifications) return;

    // Configure how notifications are handled when app is in foreground
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        // Check if this is a chat notification for the channel we're currently viewing
        const data = notification.request.content.data as Record<string, unknown>;
        const notificationChannelId = data?.channelId as string | undefined;
        const notificationType = data?.type as string | undefined;

        // Suppress banner/alert if user is actively viewing this channel
        const isViewingChannel =
          activeChannelIdRef.current &&
          notificationChannelId &&
          activeChannelIdRef.current === notificationChannelId &&
          (notificationType === 'new_message' || notificationType === 'mention');

        if (isViewingChannel) {
          console.log('[NotificationProvider] Suppressing notification - user viewing channel:', notificationChannelId);
          return {
            shouldShowAlert: false,
            shouldPlaySound: false,
            shouldSetBadge: true, // Still update badge count
            shouldShowBanner: false,
            shouldShowList: true, // Still add to notification center
          };
        }

        // Show notification normally
        return {
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: true,
          shouldShowList: true,
        };
      },
    });
  }, []);

  // Initialize notifications when authenticated
  useEffect(() => {
    if (!Notifications) {
      setIsReady(true);
      return;
    }

    if (!isAuthenticated) {
      // User logged out - just clear local state
      // AuthProvider handles unregistering the token with the backend before clearing auth
      setExpoPushToken(null);
      setIsReady(true);
      return;
    }

    const initialize = async () => {
      // Request permissions
      const granted = await requestPermissions();

      if (granted) {
        // Register token
        await registerToken();
      }

      // Get initial unread count
      await refreshUnreadCount();

      // Check if app was launched by tapping a notification (from killed state)
      try {
        const lastResponse = await Notifications.getLastNotificationResponseAsync();
        if (lastResponse) {
          const notificationId = lastResponse.notification.request.identifier;
          // Check if we've already handled this notification to prevent duplicates
          if (handledNotificationIds.current.has(notificationId)) {
            console.log('Skipping already handled notification:', notificationId);
          } else {
            console.log('App launched from notification tap - handling initial notification');
            console.log('Initial notification response:', JSON.stringify(lastResponse, null, 2));
            const data = lastResponse.notification.request.content.data as Record<string, unknown>;
            console.log('Initial notification data:', JSON.stringify(data, null, 2));
            // Mark as handled before processing
            handledNotificationIds.current.add(notificationId);
            // Handle navigation after a small delay to ensure the app is fully loaded
            setTimeout(() => {
              handleNotificationTap(data);
            }, 500);
          }
        }
      } catch (error) {
        console.error('Error getting initial notification response:', error);
      }

      setIsReady(true);
    };

    initialize();

    // Listen for notifications received while app is open
    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        console.log('Notification received:', notification);

        const data: NotificationData = {
          id: notification.request.identifier,
          title: notification.request.content.title || '',
          body: notification.request.content.body || '',
          data: (notification.request.content.data || {}) as Record<string, unknown>,
        };
        setLastNotification(data);

        // Refresh unread count
        refreshUnreadCount();
      });

    // Listen for notification interactions (taps)
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const notificationId = response.notification.request.identifier;

        // Check if we've already handled this notification to prevent duplicates
        if (handledNotificationIds.current.has(notificationId)) {
          console.log('Skipping already handled notification (from listener):', notificationId);
          return;
        }

        console.log('Notification tapped - full response:', JSON.stringify(response, null, 2));
        console.log('Notification content:', JSON.stringify(response.notification.request.content, null, 2));

        const data = response.notification.request.content.data as Record<string, unknown>;
        console.log('Notification data extracted:', JSON.stringify(data, null, 2));

        // Mark as handled before processing
        handledNotificationIds.current.add(notificationId);

        // Handle navigation based on notification type
        handleNotificationTap(data);
      });

    return () => {
      // Cleanup listeners - call remove() which is now a void function
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [isAuthenticated, requestPermissions, registerToken, refreshUnreadCount, handleNotificationTap]);

  // Refresh unread count when app comes to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // App came to foreground - refresh unread count
        refreshUnreadCount();
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [refreshUnreadCount]);

  return (
    <NotificationContext.Provider
      value={{
        expoPushToken,
        isEnabled,
        unreadCount,
        isReady,
        requestPermissions,
        refreshUnreadCount,
        lastNotification,
        handleNotificationTap,
        setActiveChannelId,
        activeChannelId,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};
