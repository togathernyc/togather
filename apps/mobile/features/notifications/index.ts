/**
 * Notifications feature exports.
 *
 * Centralized exports for notification hooks and related functionality.
 */

// Screens
export { NotificationFeedScreen } from "./components/NotificationFeedScreen";

// Utils
export { resolveNotificationNavigation } from "./utils/resolveNotificationNavigation";
export {
  iconForNotificationType,
  formatRelativeTime,
} from "./utils/notificationDisplay";

// Hooks
export {
  useRegisterPushToken,
  useUnregisterPushToken,
  useNotificationsList,
  useUnreadCount,
  useMarkRead,
  useMarkAllRead,
  useGroupNotifications,
  useSetGroupNotifications,
} from './hooks';
