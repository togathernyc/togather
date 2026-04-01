/**
 * Notification Action Functions
 *
 * Functions for sending push notifications and test notifications.
 * These are actions that make external API calls (Expo Push API).
 */

import { v } from "convex/values";
import { query, action, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { notify, getCurrentEnvironment } from "../../lib/notifications/send";
import type { NotificationChannel, SendMode } from "../../lib/notifications/types";
import { requireAuthFromTokenAction } from "../../lib/auth";

// ============================================================================
// Types
// ============================================================================

// Type for push token result
interface PushToken {
  token: string;
  platform: string;
}

// Type for test notification result
interface TestNotificationResult {
  success: boolean;
  environment: string;
  channelsAttempted: string[];
  channelsSucceeded: string[];
  errors: string[];
}

// Type for push notification result
interface PushNotificationResult {
  success: boolean;
  ticketIds?: string[];
  error?: string;
}

// ============================================================================
// Test Notification Functions
// ============================================================================

/**
 * Send a test push notification
 * Only available in non-production environments, unless devToolsEnabled is true
 */
export const sendTest = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
    title: v.string(),
    body: v.string(),
    type: v.optional(v.string()),
    groupId: v.optional(v.string()),
    communityId: v.optional(v.string()),
    channelId: v.optional(v.string()),
    shortId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<TestNotificationResult> => {
    await requireAuthFromTokenAction(ctx, args.token);
    const env = getCurrentEnvironment();

    // Block in production for security - no client-controlled bypass allowed
    if (env === "production") {
      throw new Error("Test notifications are not available in production");
    }

    // Get active push tokens for the user
    const tokens: PushToken[] = await ctx.runQuery(internal.functions.notifications.tokens.getActiveTokensForUser, {
      userId: args.userId,
    });

    if (tokens.length === 0) {
      return {
        success: false,
        environment: env,
        channelsAttempted: ["push"],
        channelsSucceeded: [],
        errors: ["No active push tokens found for user"],
      };
    }

    // Send push notification via Expo Push API
    const expoPushTokens: string[] = tokens.map((t: PushToken) => t.token);
    const notificationType = args.type || "test_notification";

    try {
      const response: Response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          expoPushTokens.map((token: string) => ({
            to: token,
            title: args.title,
            body: args.body,
            data: {
              type: notificationType,
              groupId: args.groupId,
              communityId: args.communityId,
              channelId: args.channelId,
              shortId: args.shortId,
            },
          }))
        ),
      });

      const result: { message?: string } = await response.json();

      // Create notification record
      await ctx.runMutation(internal.functions.notifications.mutations.createNotification, {
        userId: args.userId,
        notificationType,
        title: args.title,
        body: args.body,
        data: {
          type: notificationType,
          groupId: args.groupId,
          communityId: args.communityId,
          channelId: args.channelId,
          shortId: args.shortId,
        },
        status: response.ok ? "sent" : "failed",
      });

      return {
        success: response.ok,
        environment: env,
        channelsAttempted: ["push"],
        channelsSucceeded: response.ok ? ["push"] : [],
        errors: response.ok ? [] : [result.message || "Failed to send push notification"],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Create failed notification record
      await ctx.runMutation(internal.functions.notifications.mutations.createNotification, {
        userId: args.userId,
        notificationType,
        title: args.title,
        body: args.body,
        data: {
          type: notificationType,
          groupId: args.groupId,
        },
        status: "failed",
      });

      return {
        success: false,
        environment: env,
        channelsAttempted: ["push"],
        channelsSucceeded: [],
        errors: [errorMessage],
      };
    }
  },
});

/**
 * Send a notification to a user (internal use)
 * This is the main function for sending push notifications from other Convex functions
 */
export const sendPushNotification = internalAction({
  args: {
    userId: v.id("users"),
    title: v.string(),
    body: v.string(),
    notificationType: v.string(),
    data: v.optional(v.any()),
    communityId: v.optional(v.id("communities")),
    groupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, args): Promise<PushNotificationResult> => {
    // Get active push tokens for the user
    const tokens: PushToken[] = await ctx.runQuery(internal.functions.notifications.tokens.getActiveTokensForUser, {
      userId: args.userId,
    });

    if (tokens.length === 0) {
      // Still create the notification record even if no push tokens
      await ctx.runMutation(internal.functions.notifications.mutations.createNotification, {
        userId: args.userId,
        communityId: args.communityId,
        groupId: args.groupId,
        notificationType: args.notificationType,
        title: args.title,
        body: args.body,
        data: args.data,
        status: "pending", // Pending because user has no push tokens
      });

      return {
        success: false,
        error: "No active push tokens found for user",
      };
    }

    // Send push notification via Expo Push API
    const expoPushTokens: string[] = tokens.map((t: PushToken) => t.token);

    try {
      const response: Response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          expoPushTokens.map((token: string) => ({
            to: token,
            title: args.title,
            body: args.body,
            data: {
              type: args.notificationType,
              ...args.data,
            },
          }))
        ),
      });

      const result: { data?: Array<{ id: string }>; message?: string } = await response.json();

      // Create notification record
      await ctx.runMutation(internal.functions.notifications.mutations.createNotification, {
        userId: args.userId,
        communityId: args.communityId,
        groupId: args.groupId,
        notificationType: args.notificationType,
        title: args.title,
        body: args.body,
        data: args.data,
        status: response.ok ? "sent" : "failed",
      });

      return {
        success: response.ok,
        ticketIds: response.ok ? result.data?.map((r) => r.id) : [],
        error: response.ok ? undefined : result.message,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await ctx.runMutation(internal.functions.notifications.mutations.createNotification, {
        userId: args.userId,
        communityId: args.communityId,
        groupId: args.groupId,
        notificationType: args.notificationType,
        title: args.title,
        body: args.body,
        data: args.data,
        status: "failed",
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  },
});

// ============================================================================
// Dev Testing Functions
// ============================================================================

/**
 * Available notification types for the dev testing page
 * These define what notification types can be tested and their available channels
 */
const NOTIFICATION_TYPES = [
  {
    type: "new_message",
    availableChannels: ["push", "email"],
    defaultChannels: ["push"],
    defaultMode: "cascade",
  },
  {
    type: "event_reminder",
    availableChannels: ["push", "email", "chat"],
    defaultChannels: ["push"],
    defaultMode: "cascade",
  },
  {
    type: "new_member_joined",
    availableChannels: ["push", "chat"],
    defaultChannels: ["push"],
    defaultMode: "cascade",
  },
  {
    type: "group_announcement",
    availableChannels: ["push", "email", "chat"],
    defaultChannels: ["push", "email"],
    defaultMode: "multi",
  },
  {
    type: "attendance_reminder",
    availableChannels: ["push", "chat"],
    defaultChannels: ["push"],
    defaultMode: "cascade",
  },
  {
    type: "test_notification",
    availableChannels: ["push", "email", "chat", "sms"],
    defaultChannels: ["push"],
    defaultMode: "cascade",
  },
];

/**
 * Get available notification types for testing
 * Used by the dev notification tester page
 */
export const getNotificationTypes = query({
  args: {},
  handler: async () => {
    return {
      types: NOTIFICATION_TYPES,
    };
  },
});

/**
 * Get email preview for a notification type (stub for dev testing)
 * In production this would render actual email templates
 */
export const getEmailPreview = query({
  args: {
    type: v.string(),
    data: v.object({
      title: v.optional(v.string()),
      body: v.optional(v.string()),
      groupId: v.optional(v.string()),
      communityId: v.optional(v.string()),
      channelId: v.optional(v.string()),
      shortId: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    // Generate a simple email preview
    const subject = `[Togather] ${args.data.title || "Notification"}`;
    const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #007AFF; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f5f5f5; padding: 20px; border-radius: 0 0 8px 8px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${args.data.title || "Notification"}</h1>
    </div>
    <div class="content">
      <p>${args.data.body || "Notification body"}</p>
      ${args.data.groupId ? `<p><small>Group ID: ${args.data.groupId}</small></p>` : ""}
      ${args.data.communityId ? `<p><small>Community ID: ${args.data.communityId}</small></p>` : ""}
    </div>
  </div>
</body>
</html>
    `.trim();

    return {
      subject,
      html,
    };
  },
});

/**
 * Send a multi-channel test notification using the CENTRALIZED notification system
 * Used by the dev notification tester page for comprehensive testing
 *
 * This goes through the full notification pipeline:
 * - Looks up notification definition from registry
 * - Uses formatters from the definition
 * - Respects user preferences
 * - Filters tokens by environment
 */
export const sendTestNotification = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
    type: v.string(),
    channels: v.array(v.string()),
    mode: v.string(), // "cascade" or "multi"
    data: v.object({
      title: v.optional(v.string()),
      body: v.optional(v.string()),
      groupId: v.optional(v.string()),
      communityId: v.optional(v.string()),
      channelId: v.optional(v.string()),
      shortId: v.optional(v.string()),
    }),
    chatTarget: v.optional(v.string()), // "main" or "leaders"
  },
  handler: async (ctx, args) => {
    await requireAuthFromTokenAction(ctx, args.token);
    const env = getCurrentEnvironment();

    // Block in production for security - no client-controlled bypass allowed
    if (env === "production") {
      throw new Error("Test notifications are not available in production");
    }

    // Use the centralized notification system
    // This ensures we test the ACTUAL notification pipeline (including preference checks)
    const result = await notify(ctx, {
      type: "test_notification", // Use the registered test notification type
      userId: args.userId,
      data: {
        title: args.data.title || "Test Notification",
        body: args.data.body || "This is a test notification",
        type: args.type, // Pass through the selected type for payload
        groupId: args.data.groupId,
        communityId: args.data.communityId,
        channelId: args.data.channelId,
        shortId: args.data.shortId,
      },
      channels: args.channels as NotificationChannel[],
      mode: args.mode as SendMode,
      // Pass groupId for chat channel resolution
      groupId: args.data.groupId ? (args.data.groupId as Id<"groups">) : undefined,
    });

    return {
      success: result.success,
      environment: env,
      notificationType: args.type,
      channelsAttempted: result.channelsAttempted,
      channelsSucceeded: result.channelsSucceeded,
      errors: result.errors,
    };
  },
});
