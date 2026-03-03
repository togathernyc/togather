/**
 * Notification Sender Actions
 *
 * Internal actions for sending specific notification types.
 * Includes join request, group creation, and leader promotion notifications.
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { joinRequestApprovedEmail } from "../../lib/notifications/emailTemplates";

// ============================================================================
// Notification Actions for Join Requests
// ============================================================================

/**
 * Notify community admins when a join request is received
 * Called from createJoinRequest mutation
 */
export const notifyJoinRequestReceived = internalAction({
  args: {
    groupId: v.id("groups"),
    requesterId: v.id("users"),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string; sent?: number }> => {
    try {
      // Get group info
      const groupInfo: { id: string; name: string; communityId: string } | null = await ctx.runQuery(internal.functions.notifications.internal.getGroupInfo, {
        groupId: args.groupId,
      });
      if (!groupInfo) {
        console.log("[NotifyJoinRequest] Group not found, skipping notification");
        return { success: false, error: "Group not found" };
      }

      // Get requester name
      const requesterName: string = await ctx.runQuery(internal.functions.notifications.internal.getUserDisplayName, {
        userId: args.requesterId,
      });

      // Get community admins
      const adminIds: Id<"users">[] = await ctx.runQuery(internal.functions.notifications.internal.getCommunityAdmins, {
        communityId: groupInfo.communityId as Id<"communities">,
      });

      if (adminIds.length === 0) {
        console.log("[NotifyJoinRequest] No community admins found");
        return { success: true, sent: 0 };
      }

      // Get push tokens for all admins
      const tokenResults: Array<{ userId: string; tokens: string[] }> = await ctx.runQuery(internal.functions.notifications.tokens.getActiveTokensForUsers, {
        userIds: adminIds,
      });

      // Build notifications
      const notifications = tokenResults.flatMap((result: { userId: string; tokens: string[] }) =>
        result.tokens.map((token: string) => ({
          token,
          title: "New Join Request",
          body: `${requesterName} wants to join ${groupInfo.name}`,
          data: {
            type: "join_request_received",
            groupId: args.groupId,
            communityId: groupInfo.communityId,
          },
        }))
      );

      if (notifications.length === 0) {
        console.log("[NotifyJoinRequest] No push tokens found for admins");
        return { success: true, sent: 0 };
      }

      // Send batch push notifications
      const result = await ctx.runAction(internal.functions.notifications.internal.sendBatchPushNotifications, {
        notifications,
      });

      console.log(`[NotifyJoinRequest] Sent ${notifications.length} notifications for group ${groupInfo.name}`);
      return { success: result.success, sent: notifications.length };
    } catch (error) {
      console.error("[NotifyJoinRequest] Error:", error);
      return { success: false, error: String(error) };
    }
  },
});

/**
 * Notify user when their join request is approved
 * Called from reviewJoinRequest mutation
 *
 * Sends both push notification and email (if enabled).
 */
export const notifyJoinRequestApproved = internalAction({
  args: {
    userId: v.id("users"),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    try {
      // Get group info
      const groupInfo = await ctx.runQuery(internal.functions.notifications.internal.getGroupInfo, {
        groupId: args.groupId,
      });
      if (!groupInfo) {
        console.log("[NotifyJoinApproved] Group not found, skipping notification");
        return { success: false, error: "Group not found" };
      }

      const title = "Welcome to the group!";
      const body = `Your request to join ${groupInfo.name} has been approved`;
      let pushSent = 0;
      let emailSent = 0;

      // Get user's push tokens and send push notifications
      const tokens = await ctx.runQuery(internal.functions.notifications.tokens.getActiveTokensForUser, {
        userId: args.userId,
      });

      if (tokens.length > 0) {
        // Build push notifications
        const notifications = tokens.map((t: { token: string }) => ({
          token: t.token,
          title,
          body,
          data: {
            type: "join_request_approved",
            groupId: args.groupId,
            communityId: groupInfo.communityId,
          },
        }));

        // Send push notifications
        const pushResult = await ctx.runAction(internal.functions.notifications.internal.sendBatchPushNotifications, {
          notifications,
        });
        pushSent = pushResult.success ? notifications.length : 0;
      }

      // Send email notification if user has email and notifications enabled
      const userInfo = await ctx.runQuery(internal.functions.notifications.internal.getUserEmailInfo, {
        userId: args.userId,
      });

      if (userInfo?.email && userInfo.emailNotificationsEnabled) {
        const emailHtml = joinRequestApprovedEmail({ groupName: groupInfo.name });
        const emailResult = await ctx.runAction(internal.functions.notifications.internal.sendEmailNotification, {
          to: userInfo.email,
          subject: title,
          htmlBody: emailHtml,
          notificationType: "join_request_approved",
        });
        emailSent = emailResult.success ? 1 : 0;
        if (emailResult.success) {
          console.log(`[NotifyJoinApproved] Email sent to ${userInfo.email}`);
        }
      }

      // Create notification record for the user
      await ctx.runMutation(internal.functions.notifications.mutations.createNotification, {
        userId: args.userId,
        communityId: groupInfo.communityId,
        groupId: args.groupId,
        notificationType: "join_request_approved",
        title,
        body,
        data: {
          groupId: args.groupId,
          communityId: groupInfo.communityId,
        },
        status: pushSent > 0 || emailSent > 0 ? "sent" : "failed",
      });

      console.log(`[NotifyJoinApproved] Notifications sent for group ${groupInfo.name}: push=${pushSent}, email=${emailSent}`);
      return { success: true, pushSent, emailSent };
    } catch (error) {
      console.error("[NotifyJoinApproved] Error:", error);
      return { success: false, error: String(error) };
    }
  },
});

// ============================================================================
// Notification Actions for Group Creation Requests
// ============================================================================

/**
 * Notify community admins when a group creation request is submitted
 * Called from groupCreationRequests.create mutation
 */
export const notifyGroupCreationRequest = internalAction({
  args: {
    communityId: v.id("communities"),
    requesterId: v.id("users"),
    groupName: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string; sent?: number }> => {
    try {
      // Get requester name
      const requesterName = await ctx.runQuery(internal.functions.notifications.internal.getUserDisplayName, {
        userId: args.requesterId,
      });

      // Get community admins
      const adminIds: Id<"users">[] = await ctx.runQuery(internal.functions.notifications.internal.getCommunityAdmins, {
        communityId: args.communityId,
      });

      if (adminIds.length === 0) {
        console.log("[NotifyGroupCreation] No community admins found");
        return { success: true, sent: 0 };
      }

      // Get push tokens for all admins
      const tokenResults: Array<{ userId: string; tokens: string[] }> = await ctx.runQuery(internal.functions.notifications.tokens.getActiveTokensForUsers, {
        userIds: adminIds,
      });

      // Build notifications
      const notifications: Array<{ token: string; title: string; body: string; data: Record<string, unknown> }> = tokenResults.flatMap((result: { userId: string; tokens: string[] }) =>
        result.tokens.map((token: string) => ({
          token,
          title: "New Group Request",
          body: `${requesterName} wants to create "${args.groupName}"`,
          data: {
            type: "group_creation_request",
            communityId: args.communityId,
          },
        }))
      );

      if (notifications.length === 0) {
        console.log("[NotifyGroupCreation] No push tokens found for admins");
        return { success: true, sent: 0 };
      }

      // Send batch push notifications
      const result: { success: boolean; ticketIds: string[]; errors: string[] } = await ctx.runAction(internal.functions.notifications.internal.sendBatchPushNotifications, {
        notifications,
      });

      console.log(`[NotifyGroupCreation] Sent ${notifications.length} notifications for "${args.groupName}"`);
      return { success: result.success, sent: notifications.length };
    } catch (error) {
      console.error("[NotifyGroupCreation] Error:", error);
      return { success: false, error: String(error) };
    }
  },
});

/**
 * Notify leaders when their group creation request is approved
 * Called from groupCreationRequests.review mutation
 */
export const notifyGroupCreationApproved = internalAction({
  args: {
    groupId: v.id("groups"),
    leaderIds: v.array(v.id("users")),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string; sent?: number }> => {
    try {
      // Get group info
      const groupInfo = await ctx.runQuery(internal.functions.notifications.internal.getGroupInfo, {
        groupId: args.groupId,
      });
      if (!groupInfo) {
        console.log("[NotifyGroupApproved] Group not found, skipping notification");
        return { success: false, error: "Group not found" };
      }

      if (args.leaderIds.length === 0) {
        console.log("[NotifyGroupApproved] No leader IDs provided");
        return { success: true, sent: 0 };
      }

      // Get push tokens for all leaders
      const tokenResults: Array<{ userId: string; tokens: string[] }> = await ctx.runQuery(internal.functions.notifications.tokens.getActiveTokensForUsers, {
        userIds: args.leaderIds,
      });

      // Build notifications
      const notifications: Array<{ token: string; title: string; body: string; data: Record<string, unknown> }> = tokenResults.flatMap((result: { userId: string; tokens: string[] }) =>
        result.tokens.map((token: string) => ({
          token,
          title: "Your group has been approved!",
          body: `${groupInfo.name} is now live. Start inviting members!`,
          data: {
            type: "group_creation_approved",
            groupId: args.groupId,
            communityId: groupInfo.communityId,
          },
        }))
      );

      if (notifications.length === 0) {
        console.log("[NotifyGroupApproved] No push tokens found for leaders");
        return { success: true, sent: 0 };
      }

      // Send batch push notifications
      const result: { success: boolean; ticketIds: string[]; errors: string[] } = await ctx.runAction(internal.functions.notifications.internal.sendBatchPushNotifications, {
        notifications,
      });

      // Create notification records for all leaders in a single atomic transaction
      const notificationRecords = args.leaderIds.map((leaderId) => ({
        userId: leaderId,
        communityId: groupInfo.communityId as Id<"communities">,
        groupId: args.groupId,
        notificationType: "group_creation_approved",
        title: "Your group has been approved!",
        body: `${groupInfo.name} is now live. Start inviting members!`,
        data: {
          groupId: args.groupId,
          communityId: groupInfo.communityId,
        },
        status: result.success ? "sent" : "failed",
      }));

      await ctx.runMutation(internal.functions.notifications.mutations.createNotificationsBatch, {
        notifications: notificationRecords,
      });

      console.log(`[NotifyGroupApproved] Sent ${notifications.length} notifications for group ${groupInfo.name}`);
      return { success: result.success, sent: notifications.length };
    } catch (error) {
      console.error("[NotifyGroupApproved] Error:", error);
      return { success: false, error: String(error) };
    }
  },
});

// ============================================================================
// Notification Action for Leader Promotion
// ============================================================================

/**
 * Notify user when they are promoted to leader
 * Called from updateRole mutation
 */
export const notifyLeaderPromotion = internalAction({
  args: {
    userId: v.id("users"),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string; sent?: number }> => {
    try {
      // Get group info
      const groupInfo = await ctx.runQuery(internal.functions.notifications.internal.getGroupInfo, {
        groupId: args.groupId,
      });
      if (!groupInfo) {
        console.log("[NotifyLeaderPromotion] Group not found, skipping notification");
        return { success: false, error: "Group not found" };
      }

      // Get user's push tokens
      const tokens: Array<{ token: string; platform: string }> = await ctx.runQuery(internal.functions.notifications.tokens.getActiveTokensForUser, {
        userId: args.userId,
      });

      if (tokens.length === 0) {
        console.log("[NotifyLeaderPromotion] No push tokens for user");
        return { success: true, sent: 0 };
      }

      // Build notifications
      const notifications: Array<{ token: string; title: string; body: string; data: Record<string, unknown> }> = tokens.map((t: { token: string; platform: string }) => ({
        token: t.token,
        title: "You're now a leader!",
        body: `You've been promoted to leader of ${groupInfo.name}. Please refresh the app to access leader tools.`,
        data: {
          type: "role_changed",
          groupId: args.groupId,
          communityId: groupInfo.communityId,
          newRole: "leader",
        },
      }));

      // Send push notifications
      const result: { success: boolean; ticketIds: string[]; errors: string[] } = await ctx.runAction(internal.functions.notifications.internal.sendBatchPushNotifications, {
        notifications,
      });

      // Create notification record
      await ctx.runMutation(internal.functions.notifications.mutations.createNotification, {
        userId: args.userId,
        communityId: groupInfo.communityId,
        groupId: args.groupId,
        notificationType: "role_changed",
        title: "You're now a leader!",
        body: `You've been promoted to leader of ${groupInfo.name}. Please refresh the app to access leader tools.`,
        data: {
          groupId: args.groupId,
          communityId: groupInfo.communityId,
          newRole: "leader",
        },
        status: result.success ? "sent" : "failed",
      });

      console.log(`[NotifyLeaderPromotion] Sent notification to user for group ${groupInfo.name}`);
      return { success: result.success, sent: notifications.length };
    } catch (error) {
      console.error("[NotifyLeaderPromotion] Error:", error);
      return { success: false, error: String(error) };
    }
  },
});

// ============================================================================
// Notification Action for Shared Channel Invitations
// ============================================================================

/**
 * Notify leaders of a group when they receive a shared channel invitation
 * Called when a group is invited to a shared channel by another group
 */
export const notifySharedChannelInvite = internalAction({
  args: {
    invitedGroupId: v.id("groups"),
    primaryGroupId: v.id("groups"),
    inviterId: v.id("users"),
    channelName: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string; sent?: number }> => {
    try {
      // Get inviter name
      const inviterName: string = await ctx.runQuery(internal.functions.notifications.internal.getUserDisplayName, {
        userId: args.inviterId,
      });

      // Get primary group info
      const primaryGroupInfo: { id: string; name: string; communityId: string } | null = await ctx.runQuery(internal.functions.notifications.internal.getGroupInfo, {
        groupId: args.primaryGroupId,
      });
      if (!primaryGroupInfo) {
        console.log("[NotifySharedChannelInvite] Primary group not found, skipping notification");
        return { success: false, error: "Primary group not found" };
      }

      // Get invited group info
      const invitedGroupInfo: { id: string; name: string; communityId: string } | null = await ctx.runQuery(internal.functions.notifications.internal.getGroupInfo, {
        groupId: args.invitedGroupId,
      });
      if (!invitedGroupInfo) {
        console.log("[NotifySharedChannelInvite] Invited group not found, skipping notification");
        return { success: false, error: "Invited group not found" };
      }

      // Get leader user IDs of the invited group
      const leaderIds: Id<"users">[] = await ctx.runQuery(internal.functions.notifications.internal.getGroupMembersForNotification, {
        groupId: args.invitedGroupId,
        filter: "leaders",
      });

      if (leaderIds.length === 0) {
        console.log("[NotifySharedChannelInvite] No leaders found for invited group");
        return { success: true, sent: 0 };
      }

      // Get push tokens for all leaders
      const tokenResults: Array<{ userId: string; tokens: string[] }> = await ctx.runQuery(internal.functions.notifications.tokens.getActiveTokensForUsers, {
        userIds: leaderIds,
      });

      const title = "Shared Channel Invitation";
      const body = `${inviterName} invited ${invitedGroupInfo.name} to #${args.channelName} from ${primaryGroupInfo.name}`;

      // Build notifications
      const notifications: Array<{ token: string; title: string; body: string; data: Record<string, unknown> }> = tokenResults.flatMap((result: { userId: string; tokens: string[] }) =>
        result.tokens.map((token: string) => ({
          token,
          title,
          body,
          data: {
            type: "shared_channel_invite",
            groupId: args.invitedGroupId,
            primaryGroupId: args.primaryGroupId,
            communityId: primaryGroupInfo.communityId,
          },
        }))
      );

      if (notifications.length === 0) {
        console.log("[NotifySharedChannelInvite] No push tokens found for leaders");
        return { success: true, sent: 0 };
      }

      // Send batch push notifications
      const result: { success: boolean; ticketIds: string[]; errors: string[] } = await ctx.runAction(internal.functions.notifications.internal.sendBatchPushNotifications, {
        notifications,
      });

      // Create notification records for all leaders in a single atomic transaction
      const notificationRecords = leaderIds.map((leaderId) => ({
        userId: leaderId,
        communityId: primaryGroupInfo.communityId as Id<"communities">,
        groupId: args.invitedGroupId,
        notificationType: "shared_channel_invite",
        title,
        body,
        data: {
          groupId: args.invitedGroupId,
          primaryGroupId: args.primaryGroupId,
          communityId: primaryGroupInfo.communityId,
        },
        status: result.success ? "sent" : "failed",
      }));

      await ctx.runMutation(internal.functions.notifications.mutations.createNotificationsBatch, {
        notifications: notificationRecords,
      });

      console.log(`[NotifySharedChannelInvite] Sent ${notifications.length} notifications for shared channel invite to ${invitedGroupInfo.name}`);
      return { success: result.success, sent: notifications.length };
    } catch (error) {
      console.error("[NotifySharedChannelInvite] Error:", error);
      return { success: false, error: String(error) };
    }
  },
});
