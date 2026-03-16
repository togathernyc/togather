import type { NotificationDefinition } from './types';
import { escapeHtml } from './emailTemplates';

// ============================================================================
// Data Types
// ============================================================================

// Join Request Types
interface JoinRequestReceivedData {
  requesterName: string;
  groupName: string;
  groupId: string;
  communityId?: string;
}

interface JoinRequestApprovedData {
  groupName: string;
  groupId: string;
  communityId?: string;
}

interface JoinRequestRejectedData {
  groupName: string;
}

// Group Creation Types
interface GroupCreationRequestData {
  creatorName: string;
  groupName: string;
  communityId?: string;
}

interface GroupCreationApprovedData {
  groupName: string;
  groupId: string;
  communityId?: string;
}

// Messaging Types
interface MessageData {
  senderName: string;
  groupName: string;
  messagePreview: string;
  groupId: string;
  channelId: string;
  channelName?: string;
  channelType?: string; // "general" or "leaders" - enables direct routing without extra DB query
  communityId?: string;
}

// Meeting Types
interface MeetingReminderData {
  meetingTitle: string;
  meetingTime: string;
  groupName: string;
  groupId: string;
  communityId?: string;
  shortId?: string;
}

interface EventUpdatedData {
  meetingId: string;
  meetingTitle: string;
  groupId: string;
  groupName: string;
  changes: string[];
  newTime?: string;
  newLocation?: string;
  shortId?: string;
  communityId?: string;
}

interface AttendanceConfirmationData {
  meetingId: string;
  meetingTitle: string;
  groupId: string;
  groupName: string;
  shortId?: string;
  communityId?: string;
}

// Admin Types
interface ContentReportData {
  reporterName: string;
  reportedUserName?: string;
  messagePreview: string;
  reason: string;
  groupName?: string;
  channelName?: string;
  communityId?: string;
  reportedAt?: string;
}

// Role Change Types
interface RoleChangedData {
  groupName: string;
  groupId: string;
  newRole: 'leader' | 'member';
  communityId?: string;
}

// Bot Types
interface BotWelcomeData {
  message: string;
  memberName: string;
  groupName: string;
  groupId: string;
  communityId: string | number;
  chatType?: 'main' | 'leaders';
  senderId?: string;
}

interface BotBirthdayData {
  message: string;
  memberName: string;
  groupName: string;
  groupId: string;
  communityId: string | number;
  chatType?: 'main' | 'leaders';
  senderId?: string;
}

interface BotTaskReminderData {
  message: string;
  taskTitle: string;
  groupName: string;
  groupId: string;
  communityId: string | number;
  chatType?: 'main' | 'leaders';
  senderId?: string;
}

interface BotGenericMessageData {
  message: string;
  groupId: string;
  communityId: string | number;
  chatType?: 'main' | 'leaders';
  senderId?: string;
}

// Follow-up Assignment Types
interface FollowupAssignedData {
  memberName: string;
  groupName: string;
  groupId: string;
  groupMemberId: string;
  communityId?: string;
}

// Test Types
interface TestNotificationData {
  title: string;
  body: string;
  type?: string;
  groupId?: string;
  communityId?: string;
  channelId?: string;
  shortId?: string;
  chatType?: 'main' | 'leaders';
}

// ============================================================================
// Email HTML Templates
// ============================================================================

function baseEmailLayout(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
    .content { padding: 32px; }
    .heading { color: #1a1a1a; font-size: 24px; font-weight: 600; margin: 0 0 16px 0; }
    .text { color: #333; font-size: 16px; line-height: 24px; margin: 0 0 16px 0; }
    .footer { background-color: #f9f9f9; padding: 16px 32px; text-align: center; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      Sent via Togather
    </div>
  </div>
</body>
</html>
`;
}

// ============================================================================
// Join Request Definitions
// ============================================================================

export const joinRequestReceived: NotificationDefinition<JoinRequestReceivedData> =
  {
    type: 'join_request_received',
    description: 'Sent to group leaders when someone requests to join',
    formatters: {
      push: (ctx) => ({
        title: 'New Join Request',
        body: `${ctx.data.requesterName} wants to join ${ctx.data.groupName}`,
        data: {
          type: 'join_request_received',
          groupId: ctx.data.groupId,
          communityId: ctx.data.communityId,
        },
      }),
    },
    defaultChannels: ['push'],
  };

export const joinRequestApproved: NotificationDefinition<JoinRequestApprovedData> =
  {
    type: 'join_request_approved',
    description: 'Sent when a join request is approved',
    formatters: {
      push: (ctx) => ({
        title: 'Request Approved!',
        body: `You've been accepted into ${ctx.data.groupName}`,
        data: {
          type: 'join_request_approved',
          groupId: ctx.data.groupId,
          communityId: ctx.data.communityId,
        },
      }),
      email: (ctx) => ({
        subject: 'Request Approved!',
        htmlBody: baseEmailLayout(`
        <h1 class="heading">Request Approved!</h1>
        <p class="text">You've been accepted into ${escapeHtml(ctx.data.groupName)}</p>
      `),
      }),
    },
    defaultChannels: ['push', 'email'],
  };

export const joinRequestRejected: NotificationDefinition<JoinRequestRejectedData> =
  {
    type: 'join_request_rejected',
    description: 'Sent when a join request is rejected',
    formatters: {
      push: (ctx) => ({
        title: 'Request Not Approved',
        body: `Your request to join ${ctx.data.groupName} was not approved`,
        data: { type: 'join_request_rejected' },
      }),
    },
    defaultChannels: ['push'],
  };

// ============================================================================
// Group Creation Definitions
// ============================================================================

export const groupCreationRequest: NotificationDefinition<GroupCreationRequestData> =
  {
    type: 'group_creation_request',
    description: 'Sent to community admins when a new group is requested',
    formatters: {
      push: (ctx) => ({
        title: 'New Group Request',
        body: `${ctx.data.creatorName} wants to create "${ctx.data.groupName}"`,
        data: {
          type: 'group_creation_request',
          communityId: ctx.data.communityId,
        },
      }),
    },
    defaultChannels: ['push'],
  };

export const groupCreationApproved: NotificationDefinition<GroupCreationApprovedData> =
  {
    type: 'group_creation_approved',
    description: 'Sent when a group creation request is approved',
    formatters: {
      push: (ctx) => ({
        title: 'Group Approved!',
        body: `Your group "${ctx.data.groupName}" has been approved`,
        data: {
          type: 'group_creation_approved',
          groupId: ctx.data.groupId,
          communityId: ctx.data.communityId,
        },
      }),
    },
    defaultChannels: ['push'],
  };

// ============================================================================
// Messaging Definitions
// ============================================================================

function getChannelLabel(data: MessageData): string {
  if (data.channelName?.trim()) {
    return data.channelName.trim();
  }

  if (data.channelType === "leaders") {
    return "Leaders";
  }

  if (data.channelType === "main" || data.channelType === "general") {
    return "General";
  }

  return "General";
}

function formatChatPushBody(data: MessageData): string {
  return `${data.groupName}: ${getChannelLabel(data)}\n${data.messagePreview}`;
}

export const newMessage: NotificationDefinition<MessageData> = {
  type: 'new_message',
  description: 'Sent when a new message is received in a group chat',
  formatters: {
    push: (ctx) => ({
      title: ctx.data.senderName,
      body: formatChatPushBody(ctx.data),
      data: {
        type: 'new_message',
        groupId: ctx.data.groupId,
        channelId: ctx.data.channelId,
        channelName: ctx.data.channelName,
        channelType: ctx.data.channelType, // "general" or "leaders" - enables direct routing (Issue #302)
        communityId: ctx.data.communityId,
      },
    }),
  },
  defaultChannels: ['push'],
};

export const mention: NotificationDefinition<MessageData> = {
  type: 'mention',
  description: 'Sent when user is mentioned in a message',
  formatters: {
    push: (ctx) => ({
      title: ctx.data.senderName,
      body: formatChatPushBody(ctx.data),
      data: {
        type: 'mention',
        groupId: ctx.data.groupId,
        channelId: ctx.data.channelId,
        channelName: ctx.data.channelName,
        channelType: ctx.data.channelType, // "general" or "leaders" - enables direct routing
        communityId: ctx.data.communityId,
      },
    }),
    email: (ctx) => {
      const firstName = ctx.user?.name?.split(' ')?.[0];
      const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';
      return {
        subject: `${ctx.data.senderName} mentioned you in ${ctx.data.groupName}`,
        htmlBody: baseEmailLayout(`
        <h1 class="heading">${escapeHtml(ctx.data.senderName)} mentioned you</h1>
        <p class="text">${greeting}</p>
        <p class="text">${escapeHtml(ctx.data.senderName)} mentioned you in ${escapeHtml(ctx.data.groupName)}:</p>
        <p class="text" style="background-color: #f5f5f5; padding: 16px; border-radius: 8px; font-style: italic;">
          "${escapeHtml(ctx.data.messagePreview)}"
        </p>
      `),
      };
    },
  },
  defaultChannels: ['push', 'email'],
  defaultMode: 'multi',
};

// ============================================================================
// Meeting Definitions
// ============================================================================

export const meetingReminder: NotificationDefinition<MeetingReminderData> = {
  type: 'meeting_reminder',
  description: 'Reminder for upcoming meeting',
  formatters: {
    push: (ctx) => ({
      title: `${ctx.data.meetingTitle} starts in 2 hours`,
      body: `Your meeting with ${ctx.data.groupName} is coming up`,
      data: {
        type: 'meeting_reminder',
        groupId: ctx.data.groupId,
        communityId: ctx.data.communityId,
        shortId: ctx.data.shortId,
        url: ctx.data.shortId ? `/e/${ctx.data.shortId}?source=app` : undefined,
      },
    }),
  },
  defaultChannels: ['push'],
};

export const eventUpdated: NotificationDefinition<EventUpdatedData> = {
  type: 'event_updated',
  description: 'Notification when an event is updated',
  formatters: {
    push: (ctx) => {
      let bodyText = `${ctx.data.meetingTitle} has been updated.`;
      if (ctx.data.changes.length === 1) {
        bodyText = `${ctx.data.meetingTitle}: ${ctx.data.changes[0]}`;
      } else if (ctx.data.changes.length > 1) {
        bodyText = `${ctx.data.meetingTitle} has multiple updates.`;
      }
      return {
        title: `${ctx.data.meetingTitle} (${ctx.data.groupName}) - Updated`,
        body: bodyText,
        data: {
          type: 'event_updated',
          meetingId: ctx.data.meetingId,
          groupId: ctx.data.groupId,
          communityId: ctx.data.communityId,
          shortId: ctx.data.shortId,
          url: ctx.data.shortId
            ? `/e/${ctx.data.shortId}?source=app`
            : undefined,
        },
      };
    },
  },
  defaultChannels: ['push'],
};

export const attendanceConfirmation: NotificationDefinition<AttendanceConfirmationData> =
  {
    type: 'attendance_confirmation',
    description: 'Request to confirm attendance after an event',
    formatters: {
      push: (ctx) => ({
        title: 'Did you attend?',
        body: `Let us know if you made it to ${ctx.data.meetingTitle}`,
        data: {
          type: 'attendance_confirmation',
          meetingId: ctx.data.meetingId,
          groupId: ctx.data.groupId,
          communityId: ctx.data.communityId,
          shortId: ctx.data.shortId,
          url: ctx.data.shortId
            ? `/e/${ctx.data.shortId}?confirmAttendance=true`
            : undefined,
        },
      }),
    },
    defaultChannels: ['push'],
  };

// ============================================================================
// Admin Definitions
// ============================================================================

export const contentReport: NotificationDefinition<ContentReportData> = {
  type: 'content_report',
  description: 'Sent to admins when content is reported',
  formatters: {
    push: (ctx) => ({
      title: 'Content Reported',
      body: `${ctx.data.reporterName} reported: "${ctx.data.messagePreview.slice(0, 50)}..."`,
      data: {
        type: 'content_report',
        communityId: ctx.data.communityId,
      },
    }),
    email: (ctx) => {
      const reportedAt = ctx.data.reportedAt || new Date().toISOString();
      const formattedDate = new Date(reportedAt).toLocaleString();
      return {
        subject: `Content Report: ${ctx.data.reporterName} flagged a message`,
        htmlBody: baseEmailLayout(`
        <h1 class="heading">Content Report</h1>
        <p class="text"><strong>Reporter:</strong> ${escapeHtml(ctx.data.reporterName)}</p>
        <p class="text"><strong>Reported User:</strong> ${escapeHtml(ctx.data.reportedUserName || 'Unknown')}</p>
        ${ctx.data.groupName ? `<p class="text"><strong>Group:</strong> ${escapeHtml(ctx.data.groupName)}</p>` : ''}
        ${ctx.data.channelName ? `<p class="text"><strong>Channel:</strong> ${escapeHtml(ctx.data.channelName)}</p>` : ''}
        <p class="text"><strong>Reason:</strong> ${escapeHtml(ctx.data.reason)}</p>
        <p class="text"><strong>Reported At:</strong> ${escapeHtml(formattedDate)}</p>
        <div style="background-color: #fff3cd; border: 1px solid #ffc107; padding: 16px; border-radius: 8px; margin-top: 16px;">
          <p class="text" style="margin: 0;"><strong>Message Content:</strong></p>
          <p class="text" style="margin: 8px 0 0 0; font-style: italic;">"${escapeHtml(ctx.data.messagePreview)}"</p>
        </div>
      `),
      };
    },
  },
  defaultChannels: ['push', 'email'],
  defaultMode: 'multi',
};

// ============================================================================
// Role Change Definitions
// ============================================================================

export const roleChanged: NotificationDefinition<RoleChangedData> = {
  type: 'role_changed',
  description: 'Sent when a user role is changed (e.g., promoted to leader)',
  formatters: {
    push: (ctx) => {
      const isPromotion = ctx.data.newRole === 'leader';
      return {
        title: isPromotion ? 'You are now a leader!' : 'Role Updated',
        body: isPromotion
          ? `You've been promoted to leader of ${ctx.data.groupName}`
          : `Your role in ${ctx.data.groupName} has been updated`,
        data: {
          type: 'role_changed',
          groupId: ctx.data.groupId,
          communityId: ctx.data.communityId,
          newRole: ctx.data.newRole,
        },
      };
    },
  },
  defaultChannels: ['push'],
};

// ============================================================================
// Bot Definitions
// ============================================================================

export const botWelcome: NotificationDefinition<BotWelcomeData> = {
  type: 'bot_welcome',
  description: 'Welcome message sent by bot to new group members',
  formatters: {
    chat: (ctx) => ({
      message: ctx.data.message,
      senderId: ctx.data.senderId || 'system-bot',
    }),
    push: (ctx) => ({
      title: `Welcome to ${ctx.data.groupName}!`,
      body: ctx.data.message,
      data: {
        type: 'bot_welcome',
        groupId: ctx.data.groupId,
        communityId: String(ctx.data.communityId),
      },
    }),
  },
  defaultChannels: ['chat', 'push'],
  defaultMode: 'multi',
};

export const botBirthday: NotificationDefinition<BotBirthdayData> = {
  type: 'bot_birthday',
  description: 'Birthday celebration message sent by bot',
  formatters: {
    chat: (ctx) => ({
      message: ctx.data.message,
      senderId: ctx.data.senderId || 'system-bot',
    }),
    push: (ctx) => ({
      title: `Birthday in ${ctx.data.groupName}`,
      body: `Happy birthday ${ctx.data.memberName}!`,
      data: {
        type: 'bot_birthday',
        groupId: ctx.data.groupId,
        communityId: String(ctx.data.communityId),
      },
    }),
  },
  defaultChannels: ['chat'],
  defaultMode: 'multi',
};

export const botTaskReminder: NotificationDefinition<BotTaskReminderData> = {
  type: 'bot_task_reminder',
  description: 'Task reminder sent by bot',
  formatters: {
    chat: (ctx) => ({
      message: ctx.data.message,
      senderId: ctx.data.senderId || 'system-bot',
    }),
    push: (ctx) => ({
      title: ctx.data.taskTitle || 'Task Reminder',
      body: ctx.data.message,
      data: {
        type: 'bot_task_reminder',
        groupId: ctx.data.groupId,
        communityId: String(ctx.data.communityId),
      },
    }),
    email: (ctx) => {
      const firstName = ctx.user?.name?.split(' ')?.[0];
      const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';
      return {
        subject: `Task Reminder: ${ctx.data.taskTitle || 'You have a task today'}`,
        htmlBody: baseEmailLayout(`
        <h1 class="heading">Task Reminder</h1>
        <p class="text">${greeting}</p>
        <p class="text">You have a task today in ${escapeHtml(ctx.data.groupName)}:</p>
        <p class="text" style="font-weight: bold;">${escapeHtml(ctx.data.message)}</p>
      `),
      };
    },
  },
  defaultChannels: ['chat', 'push'],
  defaultMode: 'multi',
};

export const botGenericMessage: NotificationDefinition<BotGenericMessageData> =
  {
    type: 'bot_generic_message',
    description: 'Generic bot message',
    formatters: {
      chat: (ctx) => ({
        message: ctx.data.message,
        senderId: ctx.data.senderId || 'system-bot',
      }),
    },
    defaultChannels: ['chat'],
  };

// ============================================================================
// Follow-up Assignment Definitions
// ============================================================================

export const followupAssigned: NotificationDefinition<FollowupAssignedData> = {
  type: 'followup_assigned',
  description: 'Sent when a leader is assigned to follow up with a member',
  formatters: {
    push: (ctx) => ({
      title: 'New follow-up assignment',
      body: `You've been assigned to follow up with ${ctx.data.memberName} in ${ctx.data.groupName}`,
      data: {
        type: 'followup_assigned',
        groupId: ctx.data.groupId,
        groupMemberId: ctx.data.groupMemberId,
        communityId: ctx.data.communityId,
      },
    }),
  },
  defaultChannels: ['push'],
};

// ============================================================================
// Test Definitions
// ============================================================================

/**
 * Test notification for dev/staging environments.
 *
 * This notification type is used by the notification tester in the mobile app
 * to send notifications through ALL channels in the centralized system,
 * ensuring that environment handling (staging vs production) is correctly tested.
 *
 * Supports all channels: push, email, chat, and sms (placeholder).
 *
 * Chat channel requirements:
 * - Must provide either `channelId` directly, OR `groupId` + `communityId` to build one
 * - If neither is provided, the notification will fail
 */
export const testNotification: NotificationDefinition<TestNotificationData> = {
  type: 'test_notification',
  description:
    'Test notification for dev/staging environments (supports all channels)',
  formatters: {
    push: (ctx) => ({
      title: ctx.data.title,
      body: ctx.data.body,
      data: {
        type: ctx.data.type || 'test_notification',
        groupId: ctx.data.groupId,
        communityId: ctx.data.communityId,
        channelId: ctx.data.channelId,
        shortId: ctx.data.shortId,
      },
    }),
    email: (ctx) => ({
      subject: `[Test] ${ctx.data.title}`,
      htmlBody: baseEmailLayout(`
        <h1 class="heading">${escapeHtml(ctx.data.title)}</h1>
        <p class="text">${escapeHtml(ctx.data.body)}</p>
        <p class="text" style="color: #666; font-size: 12px;">This is a test notification.</p>
      `),
    }),
    chat: (ctx) => ({
      message: `**${ctx.data.title}**\n\n${ctx.data.body}`,
      // senderId defaults to 'system-bot' in handler
      // channelId is extracted from data by the handler
    }),
    sms: (ctx) => ({
      body: `${ctx.data.title}: ${ctx.data.body}`,
    }),
  },
  defaultChannels: ['push'],
  defaultMode: 'multi',
};
