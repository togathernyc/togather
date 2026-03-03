/**
 * Unified Notification System for Convex
 *
 * This module provides a registry-based notification system that supports
 * multiple channels (push, email, sms, chat) with cascade and multi-send modes.
 *
 * Usage:
 * ```typescript
 * import { notify, notifyBatch, notifyCommunityAdmins, notifyGroup } from "../lib/notifications";
 * import { getDefinition, hasDefinition, getAllTypes } from "../lib/notifications";
 *
 * // Send notification to a single user
 * const result = await notify(ctx, {
 *   type: "join_request_approved",
 *   userId: userId,
 *   data: { groupName: "My Group", groupId: "xxx" },
 * });
 *
 * // Send to multiple users
 * const results = await notifyBatch(ctx, {
 *   type: "event_updated",
 *   userIds: [user1, user2, user3],
 *   data: { eventTitle: "Meeting", changes: ["Time changed"] },
 * });
 *
 * // Send to community admins
 * const results = await notifyCommunityAdmins(ctx, {
 *   communityId: communityId,
 *   type: "group_creation_request",
 *   data: { requesterName: "John", groupName: "New Group" },
 * });
 *
 * // Send to group members
 * const results = await notifyGroup(ctx, {
 *   groupId: groupId,
 *   type: "meeting_reminder",
 *   data: { meetingTitle: "Weekly Sync", meetingTime: "in 1 hour" },
 *   filter: "all", // or "leaders"
 * });
 * ```
 */

// Re-export types
export * from "./types";

// Re-export registry functions
export { registry, getDefinition, getAllTypes, hasDefinition } from "./registry";

// Re-export send functions
export { notify, notifyBatch, notifyCommunityAdmins, notifyGroup } from "./send";

// Re-export individual definitions for direct import
export {
  // Join requests
  joinRequestReceived,
  joinRequestApproved,
  joinRequestRejected,
  // Group creation
  groupCreationRequest,
  groupCreationApproved,
  // Messaging
  newMessage,
  mention,
  // Meeting
  meetingReminder,
  eventUpdated,
  attendanceConfirmation,
  // Admin
  contentReport,
  // Bot messages
  botWelcome,
  botBirthday,
  botTaskReminder,
  botGenericMessage,
  // Test/Dev
  testNotification,
} from "./definitions";
