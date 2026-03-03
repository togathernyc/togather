/**
 * Notification hooks using Convex
 *
 * Migrated from tRPC to Convex for real-time updates.
 * Auth token is retrieved from useAuth() hook.
 */

import { useQuery, useMutation, useAuthenticatedMutation, api, Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";

/**
 * Register push notification token
 *
 * Registers the device's push notification token with the backend.
 * Upserts token - if exists for different user, reassigns; if same user, updates.
 *
 * @example
 * ```tsx
 * const registerToken = useRegisterPushToken();
 *
 * await registerToken({
 *   token: 'expo-push-token-xxx',
 *   platform: 'ios',
 *   device_id: 'device-123',
 * });
 * ```
 */
export function useRegisterPushToken() {
  // NOTE: This mutation uses `authToken` (not `token`) for auth because
  // `token` is the push notification token. Cannot use useAuthenticatedMutation.
  const { user, token: authToken } = useAuth();
  const registerMutation = useMutation(api.functions.notifications.tokens.registerToken);

  return async (params: {
    token: string;
    platform: "ios" | "android" | "web";
    device_id?: string;
    bundle_id?: string;
  }) => {
    if (!user?.id || !authToken) {
      throw new Error("User not authenticated");
    }

    return registerMutation({
      authToken,
      token: params.token,
      platform: params.platform,
      deviceId: params.device_id,
      bundleId: params.bundle_id,
    });
  };
}

/**
 * Unregister push notification token
 *
 * Unregisters a push token (typically on logout).
 * Sets is_active to false rather than deleting the token.
 *
 * @example
 * ```tsx
 * const unregisterToken = useUnregisterPushToken();
 *
 * await unregisterToken({ token: 'expo-push-token-xxx' });
 * ```
 */
export function useUnregisterPushToken() {
  const unregisterMutation = useMutation(api.functions.notifications.tokens.unregisterToken);

  return async (params: { token: string }) => {
    return unregisterMutation({ token: params.token });
  };
}

/**
 * Get list of notifications
 *
 * Fetches notifications for the authenticated user with pagination support.
 * Returns both the notifications and unread count.
 *
 * @param options Query options including limit, offset, and unreadOnly filter
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useNotificationsList({
 *   limit: 20,
 *   offset: 0,
 *   unreadOnly: false,
 * });
 *
 * // Access data.notifications and data.unread_count
 * ```
 */
export function useNotificationsList(options: {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
}) {
  const { user, token } = useAuth();

  const data = useQuery(
    api.functions.notifications.queries.list,
    user?.id && token
      ? {
          token,
          limit: options.limit,
          offset: options.offset,
          unreadOnly: options.unreadOnly,
        }
      : "skip"
  );

  return {
    data,
    isLoading: data === undefined && !!user?.id && !!token,
  };
}

/**
 * Get unread notification count
 *
 * Fetches the count of unread notifications for the authenticated user.
 *
 * @example
 * ```tsx
 * const { data } = useUnreadCount();
 *
 * // Access data.unreadCount
 * ```
 */
export function useUnreadCount() {
  const { user, token } = useAuth();

  const data = useQuery(
    api.functions.notifications.queries.unreadCount,
    user?.id && token
      ? { token }
      : "skip"
  );

  return {
    data,
    isLoading: data === undefined && !!user?.id && !!token,
  };
}

/**
 * Mark a notification as read
 *
 * Marks a specific notification as read and returns updated unread count.
 * With Convex, queries auto-update so no manual invalidation needed.
 *
 * @example
 * ```tsx
 * const markRead = useMarkRead();
 *
 * await markRead({ notificationId: 'notification-id' });
 * ```
 */
export function useMarkRead() {
  const { user } = useAuth();
  const markReadMutation = useAuthenticatedMutation(api.functions.notifications.mutations.markRead);

  return async (params: { notificationId: string }) => {
    if (!user?.id) {
      throw new Error("User not authenticated");
    }

    return markReadMutation({
      notificationId: params.notificationId as Id<"notifications">,
    });
  };
}

/**
 * Mark all notifications as read
 *
 * Marks all unread notifications as read for the authenticated user.
 * With Convex, queries auto-update so no manual invalidation needed.
 *
 * @example
 * ```tsx
 * const markAllRead = useMarkAllRead();
 *
 * await markAllRead();
 * ```
 */
export function useMarkAllRead() {
  const { user } = useAuth();
  const markAllReadMutation = useAuthenticatedMutation(api.functions.notifications.mutations.markAllRead);

  return async () => {
    if (!user?.id) {
      throw new Error("User not authenticated");
    }

    return markAllReadMutation({});
  };
}

/**
 * Get group notification setting
 *
 * Fetches the notification setting (enabled/disabled) for a specific group.
 *
 * @param groupId UUID of the group
 *
 * @example
 * ```tsx
 * const { data } = useGroupNotifications('group-uuid-123');
 *
 * // Access data.notificationsEnabled
 * ```
 */
export function useGroupNotifications(groupId: string) {
  const { user, token } = useAuth();

  const data = useQuery(
    api.functions.notifications.preferences.getGroupNotifications,
    user?.id && token && groupId
      ? {
          token,
          groupId: groupId as Id<"groups">,
        }
      : "skip"
  );

  return {
    data: data
      ? {
          groupId: data.groupId,
          notifications_enabled: data.notificationsEnabled,
        }
      : undefined,
    isLoading: data === undefined && !!user?.id && !!token && !!groupId,
  };
}

/**
 * Set group notification setting
 *
 * Toggles notifications on/off for a specific group.
 * With Convex, queries auto-update so no manual invalidation needed.
 *
 * @example
 * ```tsx
 * const setNotifications = useSetGroupNotifications();
 *
 * await setNotifications({
 *   groupId: 'group-uuid-123',
 *   enabled: true,
 * });
 * ```
 */
export function useSetGroupNotifications() {
  const { user } = useAuth();
  const setNotificationsMutation = useAuthenticatedMutation(
    api.functions.notifications.preferences.setGroupNotifications
  );

  return async (params: { groupId: string; enabled: boolean }) => {
    if (!user?.id) {
      throw new Error("User not authenticated");
    }

    return setNotificationsMutation({
      groupId: params.groupId as Id<"groups">,
      enabled: params.enabled,
    });
  };
}
