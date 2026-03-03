/**
 * Notifications Module
 *
 * Re-exports all notification functions organized by category.
 *
 * Functions for managing notifications, push tokens, and notification preferences.
 * Converted from tRPC router at apps/api-trpc/src/routers/notifications.ts
 */

// ============================================================================
// Push Token Management
// ============================================================================
export {
  registerToken,
  unregisterToken,
  cleanupLegacyTokens,
  cleanupAllLegacyTokens,
  getActiveTokensForUser,
  getActiveTokensForUsers,
} from "./tokens";

// ============================================================================
// Notification Preferences
// ============================================================================
export {
  setGroupNotifications,
  getGroupNotifications,
  preferences,
  updatePreferences,
  getChannelPreferences,
  updateChannelPreferences,
} from "./preferences";

// ============================================================================
// Notification Queries
// ============================================================================
export { list, unreadCount } from "./queries";

// ============================================================================
// Notification Mutations
// ============================================================================
export { markRead, markAllRead, createNotification } from "./mutations";

// ============================================================================
// Notification Actions
// ============================================================================
export {
  sendTest,
  sendPushNotification,
  sendTestNotification,
  getNotificationTypes,
  getEmailPreview,
} from "./actions";

// ============================================================================
// Internal Functions
// ============================================================================
export {
  getCommunityAdmins,
  getGroupInfo,
  getUserDisplayName,
  getUserEmailInfo,
  getUserForNotification,
  getGroupMembersForNotification,
  getTestChatChannel,
  sendEmailNotification,
  sendBatchPushNotifications,
  sendEmails,
} from "./internal";

// ============================================================================
// Notification Senders (Join Request, Group Creation, Leader Promotion)
// ============================================================================
export {
  notifyJoinRequestReceived,
  notifyJoinRequestApproved,
  notifyGroupCreationRequest,
  notifyGroupCreationApproved,
  notifyLeaderPromotion,
} from "./senders";

// ============================================================================
// Moderation Functions
// ============================================================================
export {
  sendModerationEmail,
  sendUserBlockedEmail,
  reportUserBlocked,
} from "./moderation";

// ============================================================================
// Debug Functions
// ============================================================================
export {
  debugTokensForUser,
  debugRecentNotifications,
  debugMessageNotifications,
  debugChannelMembership,
} from "./debug";

// ============================================================================
// Migration Functions
// ============================================================================
export {
  upsertPushTokenFromLegacy,
  getUserByLegacyId,
  getGroupByLegacyId,
  getUsersByLegacyIds,
  getGroupMembersWithNotifications,
} from "./migrations";
