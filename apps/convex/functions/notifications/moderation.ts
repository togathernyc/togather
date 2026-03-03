/**
 * Moderation Notification Functions
 *
 * Functions for sending moderation-related emails for content reports and user blocks.
 * Per Apple App Store guidelines, these must be reviewed within 24 hours.
 */

import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { escapeHtml } from "../../lib/notifications/emailTemplates";
import { requireAuthFromToken } from "../../lib/auth";
import { DOMAIN_CONFIG } from "@togather/shared/config";

/**
 * Send moderation email for flagged content
 */
export const sendModerationEmail = internalAction({
  args: {
    reporterName: v.string(),
    reporterEmail: v.optional(v.union(v.string(), v.null())),
    reporterPhone: v.optional(v.union(v.string(), v.null())),
    reportedUserName: v.string(),
    reportedUserEmail: v.optional(v.union(v.string(), v.null())),
    reportedUserPhone: v.optional(v.union(v.string(), v.null())),
    messageContent: v.string(),
    channelId: v.optional(v.string()),
    groupName: v.optional(v.string()),
    reason: v.optional(v.string()),
    reportedAt: v.string(),
  },
  handler: async (_ctx, args) => {
    console.log("[Report Flow - Step 6] sendModerationEmail action started", {
      channelId: args.channelId,
      hasReason: !!args.reason,
      reportedAt: args.reportedAt,
    });

    const resendApiKey = process.env.RESEND_API_KEY;

    if (!resendApiKey) {
      console.error("[Report Flow - Step 6] FAILED: RESEND_API_KEY not configured in environment");
      return { success: false, error: "RESEND_API_KEY not configured" };
    }
    console.log("[Report Flow - Step 6] RESEND_API_KEY is configured");

    const emailFrom = DOMAIN_CONFIG.emailFrom;
    const emailTo = process.env.SUPPORT_EMAIL || "togather@supa.media";
    console.log("[Report Flow - Step 6] Email config:", { from: emailFrom, to: emailTo });

    // Build HTML email content
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background-color: #dc2626;
      color: white;
      padding: 20px;
      border-radius: 8px 8px 0 0;
      margin-bottom: 0;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
    }
    .urgent-badge {
      display: inline-block;
      background-color: #fef2f2;
      color: #dc2626;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      margin-top: 12px;
    }
    .content {
      background-color: #f9fafb;
      padding: 24px;
      border-radius: 0 0 8px 8px;
    }
    .label {
      color: #666;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 16px 0 4px 0;
    }
    .value {
      color: #333;
      font-size: 16px;
      margin: 0 0 8px 0;
    }
    .message-preview {
      background-color: #fff;
      border-left: 3px solid #dc2626;
      padding: 12px 16px;
      margin: 8px 0 16px 0;
      border-radius: 0 6px 6px 0;
      font-style: italic;
    }
    .divider {
      border: none;
      border-top: 1px solid #e5e5e5;
      margin: 24px 0;
    }
    .footer {
      color: #666;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Content Report - Action Required</h1>
    <div class="urgent-badge">Requires review within 24 hours</div>
  </div>
  <div class="content">
    <p class="label">Reported by:</p>
    <p class="value">${escapeHtml(args.reporterName)}</p>
    ${args.reporterEmail ? `<p class="value" style="margin-top: -4px; font-size: 14px; color: #666;">Email: <a href="mailto:${escapeHtml(args.reporterEmail)}">${escapeHtml(args.reporterEmail)}</a></p>` : ""}
    ${args.reporterPhone ? `<p class="value" style="margin-top: -4px; font-size: 14px; color: #666;">Phone: <a href="tel:${escapeHtml(args.reporterPhone)}">${escapeHtml(args.reporterPhone)}</a></p>` : ""}

    <p class="label">Reported user:</p>
    <p class="value">${escapeHtml(args.reportedUserName)}</p>
    ${args.reportedUserEmail ? `<p class="value" style="margin-top: -4px; font-size: 14px; color: #666;">Email: <a href="mailto:${escapeHtml(args.reportedUserEmail)}">${escapeHtml(args.reportedUserEmail)}</a></p>` : ""}
    ${args.reportedUserPhone ? `<p class="value" style="margin-top: -4px; font-size: 14px; color: #666;">Phone: <a href="tel:${escapeHtml(args.reportedUserPhone)}">${escapeHtml(args.reportedUserPhone)}</a></p>` : ""}

    ${args.groupName ? `
    <p class="label">Group:</p>
    <p class="value">${escapeHtml(args.groupName)}</p>
    ` : ""}

    ${args.channelId ? `
    <p class="label">Channel ID:</p>
    <p class="value">${escapeHtml(args.channelId)}</p>
    ` : ""}

    ${args.reason ? `
    <p class="label">Reason:</p>
    <p class="value">${escapeHtml(args.reason)}</p>
    ` : ""}

    <p class="label">Reported message:</p>
    <div class="message-preview">"${escapeHtml(args.messageContent)}"</div>

    <p class="label">Reported at:</p>
    <p class="value">${escapeHtml(args.reportedAt)}</p>

    <hr class="divider">

    <p>Please review this report in the moderation queue or take appropriate action directly.</p>

    <p class="footer">Per App Store guidelines, user-generated content reports must be reviewed within 24 hours.</p>
  </div>
</body>
</html>
    `.trim();

    console.log("[Report Flow - Step 7] Calling Resend API...");
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [emailTo],
          subject: "Content Report - Action Required",
          html: htmlContent,
        }),
      });

      console.log("[Report Flow - Step 7] Resend API response status:", response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Report Flow - Step 7] FAILED: Resend API error:", {
          status: response.status,
          error: errorText,
        });
        return { success: false, error: `Resend API error: ${response.status}` };
      }

      const result = await response.json();
      console.log("[Report Flow - Step 7] SUCCESS: Email sent via Resend", {
        emailId: result.id,
        to: emailTo,
      });
      return { success: true, emailId: result.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[Report Flow - Step 7] EXCEPTION: Failed to send email:", errorMessage);
      return { success: false, error: errorMessage };
    }
  },
});

/**
 * Send email notification when a user blocks another user
 *
 * Per Apple App Store guidelines:
 * - Blocking should notify the developer of the inappropriate content
 * - Developer must act on objectionable content reports within 24 hours
 */
export const sendUserBlockedEmail = internalAction({
  args: {
    blockerName: v.string(),
    blockerEmail: v.optional(v.union(v.string(), v.null())),
    blockerPhone: v.optional(v.union(v.string(), v.null())),
    blockedUserName: v.string(),
    blockedUserEmail: v.optional(v.union(v.string(), v.null())),
    blockedUserPhone: v.optional(v.union(v.string(), v.null())),
    blockedAt: v.string(),
    context: v.optional(v.string()), // e.g., "from chat message" or channel info
  },
  handler: async (_ctx, args) => {
    console.log("[Block Flow] sendUserBlockedEmail action started", {
      hasContext: !!args.context,
      blockedAt: args.blockedAt,
    });

    const resendApiKey = process.env.RESEND_API_KEY;

    if (!resendApiKey) {
      console.error("[Block Flow] FAILED: RESEND_API_KEY not configured");
      return { success: false, error: "RESEND_API_KEY not configured" };
    }

    const emailFrom = DOMAIN_CONFIG.emailFrom;
    const emailTo = process.env.SUPPORT_EMAIL || "togather@supa.media";

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background-color: #f97316;
      color: white;
      padding: 20px;
      border-radius: 8px 8px 0 0;
      margin-bottom: 0;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
    }
    .urgent-badge {
      display: inline-block;
      background-color: #fff7ed;
      color: #c2410c;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      margin-top: 12px;
    }
    .content {
      background-color: #f9fafb;
      padding: 24px;
      border-radius: 0 0 8px 8px;
    }
    .label {
      color: #666;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 16px 0 4px 0;
    }
    .value {
      color: #333;
      font-size: 16px;
      margin: 0 0 8px 0;
    }
    .context-box {
      background-color: #fff;
      border-left: 3px solid #f97316;
      padding: 12px 16px;
      margin: 8px 0 16px 0;
      border-radius: 0 6px 6px 0;
      font-style: italic;
    }
    .divider {
      border: none;
      border-top: 1px solid #e5e5e5;
      margin: 24px 0;
    }
    .footer {
      color: #666;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>User Blocked - Review Required</h1>
    <div class="urgent-badge">Review within 24 hours</div>
  </div>
  <div class="content">
    <p class="label">Blocked by:</p>
    <p class="value">${escapeHtml(args.blockerName)}</p>
    ${args.blockerEmail ? `<p class="value" style="margin-top: -4px; font-size: 14px; color: #666;">Email: <a href="mailto:${escapeHtml(args.blockerEmail)}">${escapeHtml(args.blockerEmail)}</a></p>` : ""}
    ${args.blockerPhone ? `<p class="value" style="margin-top: -4px; font-size: 14px; color: #666;">Phone: <a href="tel:${escapeHtml(args.blockerPhone)}">${escapeHtml(args.blockerPhone)}</a></p>` : ""}

    <p class="label">Blocked user:</p>
    <p class="value">${escapeHtml(args.blockedUserName)}</p>
    ${args.blockedUserEmail ? `<p class="value" style="margin-top: -4px; font-size: 14px; color: #666;">Email: <a href="mailto:${escapeHtml(args.blockedUserEmail)}">${escapeHtml(args.blockedUserEmail)}</a></p>` : ""}
    ${args.blockedUserPhone ? `<p class="value" style="margin-top: -4px; font-size: 14px; color: #666;">Phone: <a href="tel:${escapeHtml(args.blockedUserPhone)}">${escapeHtml(args.blockedUserPhone)}</a></p>` : ""}

    ${args.context ? `
    <p class="label">Context:</p>
    <div class="context-box">${escapeHtml(args.context)}</div>
    ` : ""}

    <p class="label">Blocked at:</p>
    <p class="value">${escapeHtml(args.blockedAt)}</p>

    <hr class="divider">

    <p>A user has blocked another user. Per App Store guidelines, please review this action and investigate potential policy violations by the blocked user.</p>

    <p class="footer">Per App Store guidelines, blocking notifications must be reviewed within 24 hours. If the blocked user has posted objectionable content, take appropriate action.</p>
  </div>
</body>
</html>
    `.trim();

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [emailTo],
          subject: "User Blocked - Review Required",
          html: htmlContent,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Block Flow] FAILED: Resend API error:", {
          status: response.status,
          error: errorText,
        });
        return { success: false, error: `Resend API error: ${response.status}` };
      }

      const result = await response.json();
      console.log("[Block Flow] SUCCESS: Email sent", { emailId: result.id });
      return { success: true, emailId: result.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[Block Flow] EXCEPTION:", errorMessage);
      return { success: false, error: errorMessage };
    }
  },
});

/**
 * Report user block from frontend
 * Called to notify moderation team when a user is blocked
 */
export const reportUserBlocked = action({
  args: {
    authToken: v.string(),
    blockedUserStreamId: v.string(), // Legacy user ID
    blockedUserName: v.string(), // Display name
    context: v.optional(v.string()), // Optional context like channel info
  },
  handler: async (ctx, args): Promise<{ success: boolean; emailId?: string; error?: string }> => {
    // Verify auth and get user ID from token
    // This may be a Convex ID or legacy ID depending on how it was generated
    const tokenUserId = await requireAuthFromToken(args.authToken);

    // Try to get blocker's contact info
    // First try as legacy ID, then as Convex ID
    let blockerContact: { name: string; email: string | null; phone: string | null } | null = null;

    // Try legacy ID first
    blockerContact = await ctx.runQuery(
      internal.functions.users.getContactInfoByLegacyId,
      { legacyId: tokenUserId }
    );

    // If not found by legacy ID, try as Convex ID
    if (!blockerContact && tokenUserId.includes(":")) {
      // Looks like a Convex ID format
      try {
        blockerContact = await ctx.runQuery(
          internal.functions.users.getContactInfoByConvexId,
          { convexId: tokenUserId as Id<"users"> }
        );
      } catch {
        // Not a valid Convex ID, continue with null
      }
    }

    // Try to get blocked user's contact info from our database
    const blockedUserContact = await ctx.runQuery(
      internal.functions.users.getContactInfoByLegacyId,
      { legacyId: args.blockedUserStreamId }
    );

    // Send the notification email
    const result = await ctx.runAction(internal.functions.notifications.moderation.sendUserBlockedEmail, {
      blockerName: blockerContact?.name || "Unknown user",
      blockerEmail: blockerContact?.email || null,
      blockerPhone: blockerContact?.phone || null,
      blockedUserName: blockedUserContact?.name || args.blockedUserName,
      blockedUserEmail: blockedUserContact?.email || null,
      blockedUserPhone: blockedUserContact?.phone || null,
      blockedAt: new Date().toISOString(),
      context: args.context,
    });

    return result;
  },
});
