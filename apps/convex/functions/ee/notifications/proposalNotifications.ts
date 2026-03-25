/**
 * Proposal Notification Actions (ELv2-licensed)
 *
 * Copyright (c) Togather, Inc. - All Rights Reserved
 * Licensed under the Elastic License 2.0 (ELv2)
 * See /ee/LICENSE for the full license text
 *
 * Internal actions for sending notifications related to community proposals.
 * Includes notifying super admins of new proposals and sending acceptance/rejection emails.
 */

import { v } from "convex/values";
import { internalAction, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { Id } from "../../../_generated/dataModel";
import {
  proposalReceivedEmail,
  proposalAcceptedEmail,
  proposalRejectedEmail,
  newProposalAdminEmail,
} from "../../../lib/ee/emailTemplates";
import { DOMAIN_CONFIG } from "@togather/shared/config";

// ============================================================================
// Notification Actions for Community Proposals
// ============================================================================

/**
 * Notify super admin users when a new community proposal is submitted.
 * Also sends the proposer a confirmation email.
 * Called from community proposal creation flow.
 */
export const notifySuperAdminsOfProposal = internalAction({
  args: {
    proposalId: v.id("communityProposals"),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string; sent?: number }> => {
    try {
      // Get the proposal
      const proposal = await ctx.runQuery(internal.functions.ee.notifications.proposalNotifications.getProposal, {
        proposalId: args.proposalId,
      });
      if (!proposal) {
        console.log("[NotifyProposal] Proposal not found, skipping notification");
        return { success: false, error: "Proposal not found" };
      }

      // Get all super admin users (isStaff or isSuperuser)
      const superAdminIds: Id<"users">[] = await ctx.runQuery(
        internal.functions.ee.notifications.proposalNotifications.getSuperAdminUsers,
      );

      const title = "New Community Proposal";
      const body = `New proposal to create "${proposal.communityName}"`;
      let pushSent = 0;

      if (superAdminIds.length > 0) {
        // Get push tokens for all super admins
        const tokenResults: Array<{ userId: string; tokens: string[] }> = await ctx.runQuery(
          internal.functions.notifications.tokens.getActiveTokensForUsers,
          { userIds: superAdminIds },
        );

        // Build notifications
        const notifications = tokenResults.flatMap((result: { userId: string; tokens: string[] }) =>
          result.tokens.map((token: string) => ({
            token,
            title,
            body,
            data: {
              type: "community_proposal_received",
              proposalId: args.proposalId,
            },
          }))
        );

        if (notifications.length > 0) {
          // Send batch push notifications
          const pushResult = await ctx.runAction(
            internal.functions.notifications.internal.sendBatchPushNotifications,
            { notifications },
          );
          pushSent = pushResult.success ? notifications.length : 0;
        } else {
          console.log("[NotifyProposal] No push tokens found for super admins");
        }

        // Create in-app notification records for each super admin
        const notificationRecords = superAdminIds.map((adminId) => ({
          userId: adminId,
          notificationType: "community_proposal_received",
          title,
          body,
          data: {
            proposalId: args.proposalId,
          },
          status: pushSent > 0 ? "sent" : "pending",
        }));

        await ctx.runMutation(
          internal.functions.notifications.mutations.createNotificationsBatch,
          { notifications: notificationRecords },
        );
      } else {
        console.log("[NotifyProposal] No super admin users found");
      }

      // Query proposer info once (used for both admin email and proposer confirmation)
      const proposerInfo = await ctx.runQuery(
        internal.functions.notifications.internal.getUserEmailInfo,
        { userId: proposal.proposerId },
      );

      // Send email to super admins about the new proposal
      if (superAdminIds.length > 0) {
        const adminEmails: string[] = [];
        for (const adminId of superAdminIds) {
          const adminInfo = await ctx.runQuery(
            internal.functions.notifications.internal.getUserEmailInfo,
            { userId: adminId },
          );
          if (adminInfo?.email) {
            adminEmails.push(adminInfo.email);
          }
        }

        if (adminEmails.length > 0) {
          const proposerName = proposerInfo
            ? [proposerInfo.firstName, proposerInfo.lastName].filter(Boolean).join(" ") || "Unknown"
            : "Unknown";

          const adminEmailHtml = newProposalAdminEmail({
            proposerName,
            proposerEmail: proposerInfo?.email || "N/A",
            communityName: proposal.communityName,
            estimatedSize: proposal.estimatedSize,
            proposedMonthlyPrice: proposal.proposedMonthlyPrice,
            needsMigration: proposal.needsMigration,
            notes: proposal.notes,
          });

          await ctx.runAction(
            internal.functions.notifications.internal.sendEmails,
            {
              emails: adminEmails.map((email) => ({
                to: email,
                subject: `New Community Proposal: ${proposal.communityName}`,
                htmlBody: adminEmailHtml,
              })),
            },
          );
          console.log(`[NotifyProposal] Admin email sent to ${adminEmails.length} super admin(s)`);
        }
      }

      // Send the proposer a confirmation email
      if (proposerInfo?.email) {
        const emailHtml = proposalReceivedEmail({
          communityName: proposal.communityName,
          estimatedSize: proposal.estimatedSize,
          proposedMonthlyPrice: proposal.proposedMonthlyPrice,
          needsMigration: proposal.needsMigration,
          notes: proposal.notes,
        });
        const emailResult = await ctx.runAction(
          internal.functions.notifications.internal.sendEmailNotification,
          {
            to: proposerInfo.email,
            subject: "We've received your community proposal!",
            htmlBody: emailHtml,
            notificationType: "community_proposal_received",
          },
        );
        if (emailResult.success) {
          console.log(`[NotifyProposal] Confirmation email sent to proposer ${proposerInfo.email}`);
        }
      } else {
        console.warn("[NotifyProposal] Proposer has no email, skipping confirmation email");
      }

      console.log(`[NotifyProposal] Sent ${pushSent} push notifications to super admins for "${proposal.communityName}"`);
      return { success: true, sent: pushSent };
    } catch (error) {
      console.error("[NotifyProposal] Error:", error);
      return { success: false, error: String(error) };
    }
  },
});

/**
 * Send email to proposer when their community proposal is accepted.
 * Includes a unique setup URL for community onboarding.
 */
export const sendProposalAcceptedEmail = internalAction({
  args: {
    proposalId: v.id("communityProposals"),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    try {
      // Get the proposal
      const proposal = await ctx.runQuery(internal.functions.ee.notifications.proposalNotifications.getProposal, {
        proposalId: args.proposalId,
      });
      if (!proposal) {
        console.log("[NotifyProposalAccepted] Proposal not found, skipping email");
        return { success: false, error: "Proposal not found" };
      }

      // Get proposer user info
      const proposerInfo = await ctx.runQuery(
        internal.functions.notifications.internal.getUserEmailInfo,
        { userId: proposal.proposerId },
      );

      if (!proposerInfo?.email) {
        console.warn("[NotifyProposalAccepted] Proposer has no email, skipping email");
        return { success: false, error: "Proposer has no email" };
      }

      const proposerFirstName = proposerInfo.firstName?.split(" ")[0] || "there";
      const setupUrl = `${DOMAIN_CONFIG.landingUrl}/onboarding/setup?token=${proposal.setupToken}`;

      const emailHtml = proposalAcceptedEmail({
        communityName: proposal.communityName,
        proposerFirstName,
        setupUrl,
      });

      const emailResult = await ctx.runAction(
        internal.functions.notifications.internal.sendEmailNotification,
        {
          to: proposerInfo.email,
          subject: "Your community has been approved!",
          htmlBody: emailHtml,
          notificationType: "community_proposal_accepted",
        },
      );

      if (emailResult.success) {
        console.log(`[NotifyProposalAccepted] Email sent to ${proposerInfo.email} for "${proposal.communityName}"`);
      }

      return { success: emailResult.success, error: emailResult.error };
    } catch (error) {
      console.error("[NotifyProposalAccepted] Error:", error);
      return { success: false, error: String(error) };
    }
  },
});

/**
 * Send email to proposer when their community proposal is rejected.
 * Includes the rejection reason if provided.
 */
export const sendProposalRejectedEmail = internalAction({
  args: {
    proposalId: v.id("communityProposals"),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    try {
      // Get the proposal
      const proposal = await ctx.runQuery(internal.functions.ee.notifications.proposalNotifications.getProposal, {
        proposalId: args.proposalId,
      });
      if (!proposal) {
        console.log("[NotifyProposalRejected] Proposal not found, skipping email");
        return { success: false, error: "Proposal not found" };
      }

      // Get proposer user info
      const proposerInfo = await ctx.runQuery(
        internal.functions.notifications.internal.getUserEmailInfo,
        { userId: proposal.proposerId },
      );

      if (!proposerInfo?.email) {
        console.warn("[NotifyProposalRejected] Proposer has no email, skipping email");
        return { success: false, error: "Proposer has no email" };
      }

      const proposerFirstName = proposerInfo.firstName?.split(" ")[0] || "there";

      const emailHtml = proposalRejectedEmail({
        communityName: proposal.communityName,
        proposerFirstName,
        reason: proposal.rejectionReason,
      });

      const emailResult = await ctx.runAction(
        internal.functions.notifications.internal.sendEmailNotification,
        {
          to: proposerInfo.email,
          subject: "Update on your community proposal",
          htmlBody: emailHtml,
          notificationType: "community_proposal_rejected",
        },
      );

      if (emailResult.success) {
        console.log(`[NotifyProposalRejected] Email sent to ${proposerInfo.email} for "${proposal.communityName}"`);
      }

      return { success: emailResult.success, error: emailResult.error };
    } catch (error) {
      console.error("[NotifyProposalRejected] Error:", error);
      return { success: false, error: String(error) };
    }
  },
});

// ============================================================================
// Internal Helper Queries
// ============================================================================

/**
 * Get a community proposal by ID
 */
export const getProposal = internalQuery({
  args: {
    proposalId: v.id("communityProposals"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.proposalId);
  },
});

/**
 * Get all super admin users (isStaff === true or isSuperuser === true)
 */
export const getSuperAdminUsers = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Query all users and filter for staff/superuser
    // Note: No index on isStaff/isSuperuser, so we scan and filter.
    // This is acceptable because the number of staff/superuser accounts is small.
    const allUsers = await ctx.db.query("users").collect();
    const superAdmins = allUsers.filter(
      (u) => u.isStaff === true || u.isSuperuser === true,
    );
    return superAdmins.map((u) => u._id);
  },
});
