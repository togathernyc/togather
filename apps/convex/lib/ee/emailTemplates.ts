/**
 * Proposal-related email templates (ELv2-licensed)
 *
 * Copyright (c) Togather, Inc. - All Rights Reserved
 * Licensed under the Elastic License 2.0 (ELv2)
 * See /ee/LICENSE for the full license text
 */

import { escapeHtml, baseStyles, wrapInLayout } from "../notifications/emailTemplates";
import { DOMAIN_CONFIG } from "@togather/shared/config";

/**
 * Community proposal received confirmation email
 */
export function proposalReceivedEmail(data: {
  communityName: string;
  estimatedSize: number;
  proposedMonthlyPrice: number;
  needsMigration: boolean;
  notes?: string | null;
}): string {
  const content = `
    <h1 style="${baseStyles.heading}">We've received your proposal!</h1>
    <p style="${baseStyles.text}">
      Thanks for submitting a proposal to create <strong>${escapeHtml(data.communityName)}</strong> on Togather. Here's a summary of what you submitted:
    </p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; color: #666; font-size: 14px;">Community name</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; font-size: 14px; font-weight: 600;">${escapeHtml(data.communityName)}</td>
      </tr>
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; color: #666; font-size: 14px;">Estimated size</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; font-size: 14px; font-weight: 600;">${data.estimatedSize} people</td>
      </tr>
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; color: #666; font-size: 14px;">Proposed monthly payment</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; font-size: 14px; font-weight: 600;">$${data.proposedMonthlyPrice}/month</td>
      </tr>
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; color: #666; font-size: 14px;">Migration assistance</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; font-size: 14px; font-weight: 600;">${data.needsMigration ? "Yes" : "No"}</td>
      </tr>
      ${data.notes ? `<tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; color: #666; font-size: 14px;">Notes</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; font-size: 14px;">${escapeHtml(data.notes)}</td>
      </tr>` : ""}
    </table>
    <p style="${baseStyles.text}">
      If approved, your community URL will be something like: <strong>${DOMAIN_CONFIG.baseDomain}/${escapeHtml(data.communityName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))}</strong> (you'll be able to customize this during setup).
    </p>
    <p style="${baseStyles.text}">
      <strong>What happens next?</strong> Our team will review your proposal to determine if we can take on the hosting and support for your community at the proposed monthly payment. We'll get back to you soon with a decision.
    </p>
    <p style="${baseStyles.subtext}">
      Togather is open source and always free to self-host. If you'd prefer to run your own instance, visit our <a href="https://github.com/togathernyc/togather" style="color: #4A90D9;">GitHub repository</a> for setup instructions.
    </p>
  `;
  return wrapInLayout(content);
}

/**
 * New community proposal email for super admins
 */
export function newProposalAdminEmail(data: {
  proposerName: string;
  proposerEmail: string;
  communityName: string;
  estimatedSize: number;
  proposedMonthlyPrice: number;
  needsMigration: boolean;
  notes?: string | null;
}): string {
  const content = `
    <h1 style="${baseStyles.heading}">New Community Proposal</h1>
    <p style="${baseStyles.text}">
      <strong>${escapeHtml(data.proposerName)}</strong> (${escapeHtml(data.proposerEmail)}) submitted a proposal to create a new community:
    </p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; color: #666; font-size: 14px;">Community name</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; font-size: 14px; font-weight: 600;">${escapeHtml(data.communityName)}</td>
      </tr>
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; color: #666; font-size: 14px;">Estimated size</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; font-size: 14px; font-weight: 600;">${data.estimatedSize} people</td>
      </tr>
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; color: #666; font-size: 14px;">Proposed monthly payment</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; font-size: 14px; font-weight: 600;">$${data.proposedMonthlyPrice}/month</td>
      </tr>
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; color: #666; font-size: 14px;">Migration assistance</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; font-size: 14px; font-weight: 600;">${data.needsMigration ? "Yes" : "No"}</td>
      </tr>
      ${data.notes ? `<tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; color: #666; font-size: 14px;">Notes</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #eee; font-size: 14px;">${escapeHtml(data.notes)}</td>
      </tr>` : ""}
    </table>
    <div style="${baseStyles.buttonContainer}">
      <a href="${DOMAIN_CONFIG.landingUrl}/admin/proposals" style="${baseStyles.button}">Review Proposals</a>
    </div>
  `;
  return wrapInLayout(content);
}

/**
 * Community proposal accepted email
 */
export function proposalAcceptedEmail(data: {
  communityName: string;
  proposerFirstName: string;
  setupUrl: string;
}): string {
  const content = `
    <h1 style="${baseStyles.heading}">Your community has been approved!</h1>
    <p style="${baseStyles.text}">
      Great news, ${escapeHtml(data.proposerFirstName)}! Your proposal to create <strong>${escapeHtml(data.communityName)}</strong> has been accepted.
    </p>
    <p style="${baseStyles.text}">
      Click the button below to set up your community — you'll choose your URL, branding colors, and start your subscription.
    </p>
    <div style="${baseStyles.buttonContainer}">
      <a href="${escapeHtml(data.setupUrl)}" style="${baseStyles.button}">Set Up Your Community</a>
    </div>
    <p style="${baseStyles.subtext}">
      This link is unique to your community. Please don't share it.
    </p>
  `;
  return wrapInLayout(content);
}

/**
 * Community proposal rejected email
 */
export function proposalRejectedEmail(data: {
  communityName: string;
  proposerFirstName: string;
  reason?: string;
}): string {
  const reasonText = data.reason
    ? `<p style="${baseStyles.text}">Reason: ${escapeHtml(data.reason)}</p>`
    : "";
  const content = `
    <h1 style="${baseStyles.heading}">Proposal Update</h1>
    <p style="${baseStyles.text}">
      Hi ${escapeHtml(data.proposerFirstName)}, unfortunately we're unable to approve your proposal to create <strong>${escapeHtml(data.communityName)}</strong> at this time.
    </p>
    ${reasonText}
    <p style="${baseStyles.text}">
      If you have questions, feel free to reach out to us at togather@supa.media.
    </p>
  `;
  return wrapInLayout(content);
}
