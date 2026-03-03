/**
 * Notification Sample Payloads
 *
 * Sample data for testing different notification types in the NotificationTester.
 * These samples are aligned with the notification types used in Convex.
 *
 * Each notification type includes:
 * - type: The notification type identifier (matches registry type)
 * - name: Human-readable name for display
 * - description: What this notification represents
 * - defaultTitle: Default notification title
 * - defaultBody: Default notification body
 * - getData: Function to generate sample payload data
 */

export interface NotificationSample {
  type: string;
  name: string;
  description: string;
  defaultTitle: string;
  defaultBody: string;
  /**
   * Generate sample notification data payload
   * @param params - Sample parameters like groupId, communityId, channelId, shortId
   */
  getData: (params: {
    groupId: string;
    communityId: string;
    channelId: string;
    shortId: string;
  }) => Record<string, unknown>;
}

// Mock data for preview - aligned with registry definitions
const mockData = {
  groupName: 'Bible Study',
  groupId: 'mock-group-123',
  communityId: '35',
  requesterName: 'John Smith',
  creatorName: 'Jane Doe',
  senderName: 'Bob Wilson',
  messagePreview: 'Hey everyone, just wanted to share...',
  channelId: 'staging_k17abc123_main',
  meetingTitle: 'Weekly Meeting',
  meetingTime: '3:00 PM',
  reporterName: 'Anonymous',
  reason: 'Spam content',
  memberName: 'New Member',
  message: 'Welcome to the group!',
  taskTitle: 'Prepare for Sunday',
};

export const NOTIFICATION_SAMPLES: NotificationSample[] = [
  // ============================================
  // Join Request Notifications
  // ============================================
  {
    type: 'join_request_received',
    name: 'Join Request Received',
    description: 'Sent to group leaders when someone requests to join',
    defaultTitle: 'New Join Request',
    defaultBody: `${mockData.requesterName} wants to join ${mockData.groupName}`,
    getData: ({ groupId, communityId }) => ({
      type: 'join_request_received',
      requesterName: mockData.requesterName,
      groupName: mockData.groupName,
      groupId: groupId || mockData.groupId,
      communityId: communityId || mockData.communityId,
    }),
  },
  {
    type: 'join_request_approved',
    name: 'Join Request Approved',
    description: 'Sent when a join request is approved',
    defaultTitle: 'Request Approved!',
    defaultBody: `You've been accepted into ${mockData.groupName}`,
    getData: ({ groupId, communityId }) => ({
      type: 'join_request_approved',
      groupName: mockData.groupName,
      groupId: groupId || mockData.groupId,
      communityId: communityId || mockData.communityId,
    }),
  },
  {
    type: 'join_request_rejected',
    name: 'Join Request Rejected',
    description: 'Sent when a join request is rejected',
    defaultTitle: 'Request Not Approved',
    defaultBody: `Your request to join ${mockData.groupName} was not approved`,
    getData: () => ({
      type: 'join_request_rejected',
      groupName: mockData.groupName,
    }),
  },

  // ============================================
  // Group Creation Notifications
  // ============================================
  {
    type: 'group_creation_request',
    name: 'Group Creation Request',
    description: 'Sent to community admins when a new group is requested',
    defaultTitle: 'New Group Request',
    defaultBody: `${mockData.creatorName} wants to create "${mockData.groupName}"`,
    getData: ({ communityId }) => ({
      type: 'group_creation_request',
      creatorName: mockData.creatorName,
      groupName: mockData.groupName,
      communityId: communityId || mockData.communityId,
    }),
  },
  {
    type: 'group_creation_approved',
    name: 'Group Creation Approved',
    description: 'Sent when a group creation request is approved',
    defaultTitle: 'Group Approved!',
    defaultBody: `Your group "${mockData.groupName}" has been approved`,
    getData: ({ groupId, communityId }) => ({
      type: 'group_creation_approved',
      groupName: mockData.groupName,
      groupId: groupId || mockData.groupId,
      communityId: communityId || mockData.communityId,
    }),
  },

  // ============================================
  // Messaging Notifications
  // ============================================
  {
    type: 'new_message',
    name: 'New Message',
    description: 'Sent when a new message is received in a group chat',
    defaultTitle: mockData.groupName,
    defaultBody: `${mockData.senderName}: ${mockData.messagePreview}`,
    getData: ({ groupId, communityId, channelId }) => ({
      type: 'new_message',
      senderName: mockData.senderName,
      groupName: mockData.groupName,
      messagePreview: mockData.messagePreview,
      groupId: groupId || mockData.groupId,
      channelId: channelId || mockData.channelId,
      communityId: communityId || mockData.communityId,
    }),
  },
  {
    type: 'mention',
    name: 'Mention',
    description: 'Sent when user is mentioned in a message',
    defaultTitle: `${mockData.senderName} mentioned you`,
    defaultBody: mockData.messagePreview,
    getData: ({ groupId, communityId, channelId }) => ({
      type: 'mention',
      senderName: mockData.senderName,
      groupName: mockData.groupName,
      messagePreview: mockData.messagePreview,
      groupId: groupId || mockData.groupId,
      channelId: channelId || mockData.channelId,
      communityId: communityId || mockData.communityId,
    }),
  },

  // ============================================
  // Meeting Notifications
  // ============================================
  {
    type: 'meeting_reminder',
    name: 'Meeting Reminder',
    description: 'Reminder for upcoming meeting',
    defaultTitle: 'Meeting Reminder',
    defaultBody: `${mockData.meetingTitle} in ${mockData.groupName} at ${mockData.meetingTime}`,
    getData: ({ groupId, communityId }) => ({
      type: 'meeting_reminder',
      meetingTitle: mockData.meetingTitle,
      meetingTime: mockData.meetingTime,
      groupName: mockData.groupName,
      groupId: groupId || mockData.groupId,
      communityId: communityId || mockData.communityId,
    }),
  },

  // ============================================
  // Admin Notifications
  // ============================================
  {
    type: 'content_report',
    name: 'Content Report',
    description: 'Sent to admins when content is reported',
    defaultTitle: 'Content Reported',
    defaultBody: `${mockData.reporterName} reported: "${mockData.messagePreview.slice(0, 50)}..."`,
    getData: ({ communityId }) => ({
      type: 'content_report',
      reporterName: mockData.reporterName,
      messagePreview: mockData.messagePreview,
      reason: mockData.reason,
      groupName: mockData.groupName,
      communityId: communityId || mockData.communityId,
    }),
  },

  // ============================================
  // Bot Notifications
  // ============================================
  {
    type: 'bot_welcome',
    name: 'Bot Welcome',
    description: 'Welcome message sent by bot to new group members',
    defaultTitle: `Welcome to ${mockData.groupName}!`,
    defaultBody: mockData.message,
    getData: ({ groupId, communityId }) => ({
      type: 'bot_welcome',
      message: mockData.message,
      memberName: mockData.memberName,
      groupName: mockData.groupName,
      groupId: groupId || mockData.groupId,
      communityId: communityId || mockData.communityId,
      chatType: 'main',
      senderId: 'system-bot',
    }),
  },
  {
    type: 'bot_birthday',
    name: 'Bot Birthday',
    description: 'Birthday celebration message sent by bot',
    defaultTitle: `Birthday in ${mockData.groupName}`,
    defaultBody: `Happy birthday ${mockData.memberName}!`,
    getData: ({ groupId, communityId }) => ({
      type: 'bot_birthday',
      message: `Happy birthday ${mockData.memberName}!`,
      memberName: mockData.memberName,
      groupName: mockData.groupName,
      groupId: groupId || mockData.groupId,
      communityId: communityId || mockData.communityId,
      chatType: 'main',
      senderId: 'system-bot',
    }),
  },
  {
    type: 'bot_task_reminder',
    name: 'Bot Task Reminder',
    description: 'Task reminder sent by bot',
    defaultTitle: 'Task Reminder',
    defaultBody: mockData.taskTitle,
    getData: ({ groupId, communityId }) => ({
      type: 'bot_task_reminder',
      message: `Reminder: ${mockData.taskTitle}`,
      taskTitle: mockData.taskTitle,
      groupName: mockData.groupName,
      groupId: groupId || mockData.groupId,
      communityId: communityId || mockData.communityId,
      chatType: 'main',
      senderId: 'system-bot',
    }),
  },
  {
    type: 'bot_generic_message',
    name: 'Bot Generic Message',
    description: 'Generic bot message',
    defaultTitle: mockData.groupName,
    defaultBody: mockData.message,
    getData: ({ groupId, communityId }) => ({
      type: 'bot_generic_message',
      message: mockData.message,
      groupId: groupId || mockData.groupId,
      communityId: communityId || mockData.communityId,
      chatType: 'main',
      senderId: 'system-bot',
    }),
  },

  // ============================================
  // Legacy Notification Types (not yet in registry)
  // Keep these for backwards compatibility testing
  // ============================================
  {
    type: 'role_changed',
    name: 'Role Changed (Leader Promotion)',
    description: 'User promoted to leader',
    defaultTitle: 'Congratulations!',
    defaultBody: "You've been promoted to leader of Small Group. You can now access leader tools.",
    getData: ({ groupId, communityId }) => ({
      type: 'role_changed',
      groupId: groupId || mockData.groupId,
      communityId: communityId || mockData.communityId,
      newRole: 'leader',
    }),
  },
  {
    type: 'mentioned_you',
    name: 'Mentioned You (Legacy)',
    description: 'User mentioned in message (legacy type)',
    defaultTitle: 'John mentioned you',
    defaultBody: '@you Can you bring snacks to the meeting?',
    getData: ({ groupId, communityId, channelId }) => ({
      type: 'mentioned_you',
      channelId:
        channelId || `community${communityId || mockData.communityId}_group${groupId || mockData.groupId}_main`,
      communityId: communityId || mockData.communityId,
    }),
  },
  {
    type: 'event_updated',
    name: 'Event Updated',
    description: 'Event details changed',
    defaultTitle: 'Event Updated',
    defaultBody: 'Small Group Meeting has been updated. New time: 7:00 PM.',
    getData: ({ communityId, shortId }) => ({
      type: 'event_updated',
      shortId: shortId || 'abc123',
      communityId: communityId || mockData.communityId,
    }),
  },
  {
    type: 'attendance_confirmation',
    name: 'Attendance Confirmation',
    description: 'Attendance confirmation request',
    defaultTitle: 'Are you attending?',
    defaultBody: 'Small Group Meeting is tomorrow at 7 PM. Please confirm your attendance.',
    getData: ({ communityId, shortId }) => ({
      type: 'attendance_confirmation',
      shortId: shortId || 'abc123',
      communityId: communityId || mockData.communityId,
      route: `/e/${shortId || 'abc123'}?confirmAttendance=true&source=app`,
    }),
  },
];

/**
 * Get a notification sample by type
 */
export function getNotificationSample(type: string): NotificationSample | undefined {
  return NOTIFICATION_SAMPLES.find((sample) => sample.type === type);
}

/**
 * Get all notification type options for a dropdown
 */
export function getNotificationTypeOptions(): { label: string; value: string }[] {
  return NOTIFICATION_SAMPLES.map((sample) => ({
    label: sample.name,
    value: sample.type,
  }));
}

/**
 * Get all notification types
 */
export function getAllNotificationTypes(): string[] {
  return NOTIFICATION_SAMPLES.map((s) => s.type);
}
