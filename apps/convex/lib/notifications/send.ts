/**
 * Unified Notification Sending Logic for Convex
 *
 * This module provides the core notification sending functionality.
 * It mirrors the logic from packages/notifications/src/unified.ts but
 * adapted for Convex actions.
 *
 * Usage:
 * - Use `notify()` to send a notification to a single user
 * - Use `notifyBatch()` to send to multiple users
 * - Use `notifyCommunityAdmins()` to send to all admins of a community
 * - Use `notifyGroup()` to send to group members
 */

import { ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { getDefinition } from "./registry";
import { DOMAIN_CONFIG } from "@togather/shared/config";
import type {
  SendOptions,
  BatchSendOptions,
  CommunityAdminSendOptions,
  GroupNotifyOptions,
  SendResult,
  NotificationChannel,
  FormatterContext,
  NotificationDefinition,
  ChannelSendResult,
  PushOutput,
  EmailOutput,
  SendMode,
} from "./types";

// ============================================================================
// Environment Helpers
// ============================================================================

/**
 * Get the current environment for push token filtering
 */
export function getCurrentEnvironment(): "staging" | "production" {
  // Only treat as production when explicitly configured.
  // Staging deployments commonly run with NODE_ENV=production for performance.
  return process.env.APP_ENV === "production" ? "production" : "staging";
}

/**
 * Email sender configuration
 */
const EMAIL_FROM = DOMAIN_CONFIG.emailFrom;

// ============================================================================
// Main Notification Functions
// ============================================================================

/**
 * Send notification to a single user
 *
 * Implements cascade and multi mode logic:
 * - cascade: try each channel in order, stop on first success
 * - multi: try all channels in parallel
 */
export async function notify<TData extends Record<string, unknown>>(
  ctx: ActionCtx,
  options: SendOptions<TData>
): Promise<SendResult> {
  const { type, userId, data, mode } = options;

  // Get notification definition from registry
  const definition = getDefinition<TData>(type);
  if (!definition) {
    console.error(`[notify] Unknown notification type: ${type}`);
    return {
      success: false,
      channelsAttempted: [],
      channelsSucceeded: [],
      errors: [{ channel: "push", error: `Unknown notification type: ${type}` }],
    };
  }

  // Query user from Convex DB
  const user = await ctx.runQuery(internal.functions.notifications.internal.getUserForNotification, {
    userId,
  });

  if (!user) {
    console.error(`[notify] User not found: ${userId}`);
    return {
      success: false,
      channelsAttempted: [],
      channelsSucceeded: [],
      errors: [{ channel: "push", error: `User not found: ${userId}` }],
    };
  }

  // Build formatter context with user preferences
  // Note: pushEnabled is no longer used - we check for active tokens instead
  // This ensures tokens are the single source of truth for push notification state
  const formatterCtx: FormatterContext<TData> = {
    data,
    userId,
    user: {
      name: [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined,
      email: user.email || undefined,
      phone: user.phone || undefined,
      emailEnabled: user.emailNotificationsEnabled ?? true,
    },
  };

  // Determine channels to use
  const channels = options.channels || definition.defaultChannels;
  // Use nullish coalescing to allow definition.defaultMode when mode is undefined
  const effectiveMode: SendMode = mode ?? definition.defaultMode ?? "cascade";

  const result: SendResult = {
    success: false,
    channelsAttempted: [],
    channelsSucceeded: [],
    errors: [],
  };

  if (effectiveMode === "cascade") {
    // Cascade mode: try each channel until one succeeds
    for (const channel of channels) {
      result.channelsAttempted.push(channel);

      const channelResult = await sendToChannel(
        ctx,
        channel,
        definition,
        formatterCtx,
        userId,
        type,
        options.communityId,
        options.groupId
      );

      if (channelResult.success) {
        result.channelsSucceeded.push(channel);
        result.success = true;
        break; // Stop on first success
      } else {
        result.errors.push({ channel, error: channelResult.error || "Channel send failed" });
      }
    }
  } else {
    // Multi mode: send to all channels simultaneously
    const promises = channels.map(async (channel) => {
      const channelResult = await sendToChannel(
        ctx,
        channel,
        definition,
        formatterCtx,
        userId,
        type,
        options.communityId,
        options.groupId
      );
      return { channel, ...channelResult };
    });

    const results = await Promise.all(promises);

    for (const { channel, success, error } of results) {
      result.channelsAttempted.push(channel);
      if (success) {
        result.channelsSucceeded.push(channel);
      } else {
        result.errors.push({ channel, error: error || "Channel send failed" });
      }
    }

    result.success = result.channelsSucceeded.length > 0;
  }

  console.log(
    `[notify] ${type} to ${userId}: ${result.success ? "SUCCESS" : "FAILED"} via ${result.channelsSucceeded.join(", ") || "none"}`
  );

  return result;
}

/**
 * Send to a specific channel
 */
async function sendToChannel<TData extends Record<string, unknown>>(
  ctx: ActionCtx,
  channel: NotificationChannel,
  definition: NotificationDefinition<TData>,
  formatterCtx: FormatterContext<TData>,
  userId: Id<"users">,
  notificationType: string,
  communityId?: Id<"communities">,
  groupId?: Id<"groups">
): Promise<ChannelSendResult> {
  console.log(`[notify] Attempting to send ${notificationType} via ${channel} to user ${userId}`);

  const formatter = definition.formatters[channel];
  if (!formatter) {
    const error = `No formatter for channel ${channel} on type ${definition.type}`;
    console.warn(`[notify] ${error}`);
    return { success: false, error };
  }

  try {
    switch (channel) {
      case "push": {
        return await sendPushChannel(
          ctx,
          formatter as (ctx: FormatterContext<TData>) => PushOutput,
          formatterCtx,
          userId,
          notificationType,
          communityId,
          groupId
        );
      }

      case "email": {
        return await sendEmailChannel(
          ctx,
          formatter as (ctx: FormatterContext<TData>) => EmailOutput,
          formatterCtx,
          userId,
          notificationType
        );
      }

      case "chat": {
        // Chat channel removed - Stream Chat message sending is no longer supported
        const error = "Chat channel not implemented";
        console.warn(`[notify] ${error}`);
        return { success: false, error };
      }

      case "sms": {
        // SMS not implemented yet
        const error = "SMS channel not implemented";
        console.warn(`[notify] ${error}`);
        return { success: false, error };
      }

      default: {
        const error = `Unknown channel: ${channel}`;
        console.warn(`[notify] ${error}`);
        return { success: false, error };
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[notify] Error sending to ${channel}:`, err);
    return { success: false, error: errorMessage };
  }
}

/**
 * Send push notification
 *
 * Push notification state is determined by active tokens for the current environment.
 * If user has no active tokens, push is effectively disabled.
 * This ensures tokens are the single source of truth.
 */
async function sendPushChannel<TData extends Record<string, unknown>>(
  ctx: ActionCtx,
  formatter: (ctx: FormatterContext<TData>) => PushOutput,
  formatterCtx: FormatterContext<TData>,
  userId: Id<"users">,
  notificationType: string,
  communityId?: Id<"communities">,
  groupId?: Id<"groups">
): Promise<ChannelSendResult> {
  const output = formatter(formatterCtx);
  let groupNotificationImageUrl: string | undefined;

  if (groupId) {
    const groupInfo = await ctx.runQuery(
      internal.functions.notifications.internal.getGroupInfo,
      { groupId }
    );
    groupNotificationImageUrl = groupInfo?.groupAvatarUrl;
  } else if (communityId) {
    // Community-level notifications (no group context) should use community branding.
    const communityInfo = await ctx.runQuery(
      internal.functions.notifications.internal.getCommunityInfo,
      { communityId }
    );
    groupNotificationImageUrl = communityInfo?.communityLogoUrl;
  }

  const senderAvatarFromPayload =
    output.data &&
    typeof output.data === "object" &&
    "senderAvatarUrl" in output.data &&
    typeof (output.data as { senderAvatarUrl?: unknown }).senderAvatarUrl === "string"
      ? (output.data as { senderAvatarUrl: string }).senderAvatarUrl
      : undefined;

  // Prefer sender avatar for chat-like notifications; keep group/community image as fallback.
  const notificationImageUrl = senderAvatarFromPayload || groupNotificationImageUrl;

  // Get push tokens for user (filters by environment and active status)
  // No tokens = user has disabled push or hasn't registered a token
  const tokens = await ctx.runQuery(internal.functions.notifications.tokens.getActiveTokensForUser, {
    userId,
  });

  if (tokens.length === 0) {
    const env = getCurrentEnvironment();
    const error = `No active push tokens for user ${userId} in ${env}. Enable push in Settings or re-register device.`;
    console.warn(`[notify] ${error}`);
    return { success: false, error };
  }

  // Send push notifications using existing batch action
  const notificationData = {
    type: notificationType,
    ...output.data,
    ...(senderAvatarFromPayload ? { senderAvatarUrl: senderAvatarFromPayload } : {}),
    ...(groupNotificationImageUrl ? { groupAvatarUrl: groupNotificationImageUrl } : {}),
  };
  console.log(`[sendPushChannel] Building push notification with data:`, JSON.stringify(notificationData));

  const notifications = tokens.map((t: { token: string }) => ({
    token: t.token,
    title: output.title,
    body: output.body,
    data: notificationData,
    imageUrl: notificationImageUrl,
  }));

  const result = await ctx.runAction(internal.functions.notifications.internal.sendBatchPushNotifications, {
    notifications,
  });

  // Create notification record
  await ctx.runMutation(internal.functions.notifications.mutations.createNotification, {
    userId,
    communityId,
    groupId,
    notificationType,
    title: output.title,
    body: output.body,
    data: {
      ...(output.data || {}),
      ...(senderAvatarFromPayload ? { senderAvatarUrl: senderAvatarFromPayload } : {}),
      ...(groupNotificationImageUrl ? { groupAvatarUrl: groupNotificationImageUrl } : {}),
    },
    status: result.success ? "sent" : "failed",
  });

  if (result.success) {
    return { success: true };
  }

  const errorMessage = result.errors?.join("; ") || "Push send failed";
  return { success: false, error: errorMessage };
}

/**
 * Send email notification
 */
async function sendEmailChannel<TData extends Record<string, unknown>>(
  ctx: ActionCtx,
  formatter: (ctx: FormatterContext<TData>) => EmailOutput,
  formatterCtx: FormatterContext<TData>,
  userId: Id<"users">,
  notificationType: string
): Promise<ChannelSendResult> {
  // Check if user has email notifications enabled
  if (formatterCtx.user?.emailEnabled === false) {
    const error = `Email notifications disabled for user ${userId}`;
    console.warn(`[notify] ${error}`);
    return { success: false, error };
  }

  if (!formatterCtx.user?.email) {
    const error = `No email address for user ${userId}`;
    console.warn(`[notify] ${error}`);
    return { success: false, error };
  }

  const output = formatter(formatterCtx);

  // Send email via Resend
  const result = await ctx.runAction(internal.functions.notifications.internal.sendEmailNotification, {
    to: formatterCtx.user.email,
    subject: output.subject,
    htmlBody: output.htmlBody,
    notificationType,
  });

  return result;
}

// ============================================================================
// Batch Notification Functions
// ============================================================================

/**
 * Send notification to multiple users
 */
export async function notifyBatch<TData extends Record<string, unknown>>(
  ctx: ActionCtx,
  options: BatchSendOptions<TData>
): Promise<SendResult[]> {
  const { userIds, ...rest } = options;

  const results = await Promise.all(
    userIds.map((userId) =>
      notify(ctx, { ...rest, userId } as SendOptions<TData>)
    )
  );

  return results;
}

/**
 * Send notification to all community admins
 *
 * Finds users with roles >= 3 (admin threshold) in userCommunities
 */
export async function notifyCommunityAdmins<TData extends Record<string, unknown>>(
  ctx: ActionCtx,
  options: CommunityAdminSendOptions<TData>
): Promise<SendResult[]> {
  const { communityId, ...rest } = options;

  // Get all community admins
  const adminIds = await ctx.runQuery(internal.functions.notifications.internal.getCommunityAdmins, {
    communityId,
  });

  if (adminIds.length === 0) {
    console.warn(`[notify] No admins found for community ${communityId}`);
    return [];
  }

  return notifyBatch(ctx, {
    ...rest,
    userIds: adminIds,
    communityId,
  } as BatchSendOptions<TData>);
}

/**
 * Send notification to group members
 *
 * @param filter - 'all' for all members, 'leaders' for only leaders/admins
 */
export async function notifyGroup<TData extends Record<string, unknown>>(
  ctx: ActionCtx,
  options: GroupNotifyOptions<TData>
): Promise<SendResult[]> {
  const { groupId, filter = "all", ...rest } = options;

  // Get group members
  const memberIds = await ctx.runQuery(
    internal.functions.notifications.internal.getGroupMembersForNotification,
    {
      groupId,
      filter,
    }
  );

  if (memberIds.length === 0) {
    console.warn(`[notify] No ${filter} members found for group ${groupId}`);
    return [];
  }

  return notifyBatch(ctx, {
    ...rest,
    userIds: memberIds,
    groupId,
  } as BatchSendOptions<TData>);
}
