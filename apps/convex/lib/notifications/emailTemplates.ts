/**
 * Simple HTML email templates for Convex notifications
 *
 * These are plain HTML strings since we can't use React in Convex actions.
 * Templates are designed to match the styling of the React Email templates
 * in packages/notifications/src/email/templates/.
 *
 * IMPORTANT: All user-provided content must be escaped with escapeHtml()
 * to prevent XSS vulnerabilities.
 */

import { DOMAIN_CONFIG } from "@togather/shared/config";

// ============================================================================
// HTML Entity Escaping
// ============================================================================

/**
 * Escape HTML entities to prevent XSS
 */
export function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return text.replace(/[&<>"']/g, (char) => htmlEntities[char] || char);
}

// ============================================================================
// Base Styles
// ============================================================================

const baseStyles = {
  body: `
    background-color: #f6f9fc;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    margin: 0;
    padding: 0;
  `,
  container: `
    background-color: #ffffff;
    margin: 0 auto;
    padding: 20px;
    max-width: 600px;
  `,
  heading: `
    color: #1a1a1a;
    font-size: 24px;
    font-weight: 600;
    margin: 0 0 16px;
  `,
  text: `
    color: #333;
    font-size: 16px;
    line-height: 24px;
    margin: 0 0 12px;
  `,
  subtext: `
    color: #666;
    font-size: 14px;
    line-height: 20px;
    margin: 0;
  `,
  hr: `
    border: none;
    border-top: 1px solid #e6ebf1;
    margin: 20px 0;
  `,
  footer: `
    text-align: center;
    color: #8898aa;
    font-size: 12px;
  `,
  button: `
    background-color: #3B82F6;
    border-radius: 8px;
    color: #ffffff;
    font-size: 16px;
    font-weight: 600;
    text-decoration: none;
    text-align: center;
    padding: 14px 32px;
    display: inline-block;
  `,
  buttonContainer: `
    text-align: center;
    margin: 24px 0;
  `,
  link: `
    color: #3B82F6;
    text-decoration: underline;
  `,
  messageBox: `
    background-color: #f8f9fa;
    border-left: 4px solid #3B82F6;
    padding: 16px 20px;
    margin: 0 0 24px;
    border-radius: 0 8px 8px 0;
  `,
  urgentBadge: `
    color: #dc2626;
    font-size: 14px;
    font-weight: 600;
    background-color: #fef2f2;
    padding: 8px 12px;
    border-radius: 6px;
    margin: 0 0 16px;
    display: inline-block;
  `,
  label: `
    color: #666;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 12px 0 4px;
  `,
  value: `
    color: #333;
    font-size: 16px;
    line-height: 24px;
    margin: 0 0 8px;
  `,
};

// ============================================================================
// Base Layout
// ============================================================================

/**
 * Wrap content in the base email layout
 */
function wrapInLayout(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="${baseStyles.body}">
  <div style="${baseStyles.container}">
    ${content}
    <hr style="${baseStyles.hr}">
    <p style="${baseStyles.footer}">Sent by Togather</p>
  </div>
</body>
</html>
  `.trim();
}

// ============================================================================
// Email Templates
// ============================================================================

/**
 * Join request approved email
 */
export function joinRequestApprovedEmail(data: { groupName: string }): string {
  const content = `
    <h1 style="${baseStyles.heading}">Request Approved!</h1>
    <p style="${baseStyles.text}">
      You've been accepted into <strong>${escapeHtml(data.groupName)}</strong>
    </p>
    <div style="${baseStyles.buttonContainer}">
      <a href="${DOMAIN_CONFIG.appUrl}" style="${baseStyles.button}">Open Togather</a>
    </div>
  `;
  return wrapInLayout(content);
}

/**
 * Mention notification email
 */
export function mentionEmail(data: {
  senderName: string;
  groupName: string;
  messagePreview: string;
  firstName?: string;
}): string {
  const greeting = data.firstName
    ? `Hi ${escapeHtml(data.firstName)},`
    : "Hi there,";

  const content = `
    <p style="${baseStyles.text}">${greeting}</p>
    <h1 style="${baseStyles.heading}">Someone mentioned you in Togather</h1>
    <p style="${baseStyles.text}">
      <strong>${escapeHtml(data.senderName)}</strong> mentioned you in
      <strong>${escapeHtml(data.groupName)}</strong>:
    </p>
    <div style="${baseStyles.messageBox}">
      <p style="color: #1a1a1a; font-size: 15px; line-height: 24px; margin: 0;">
        "${escapeHtml(data.messagePreview)}"
      </p>
    </div>
    <p style="${baseStyles.text}">
      Open the Togather app to see the full conversation and reply.
    </p>
    <div style="${baseStyles.buttonContainer}">
      <a href="${DOMAIN_CONFIG.appUrl}" style="${baseStyles.button}">Open Togather</a>
    </div>
    <hr style="${baseStyles.hr}">
    <p style="${baseStyles.subtext}; text-align: center;">
      Don't have the app yet?
      <a href="${DOMAIN_CONFIG.appUrl}" style="${baseStyles.link}">Download Togather</a>
      to stay connected with your community.
    </p>
  `;
  return wrapInLayout(content);
}

/**
 * Content report email (for moderation)
 */
export function contentReportEmail(data: {
  reporterName: string;
  reportedUserName?: string;
  messagePreview: string;
  groupName?: string;
  channelId?: string;
  reason?: string;
  reportedAt?: string;
}): string {
  const reportedUserSection = data.reportedUserName
    ? `
    <p style="${baseStyles.label}">Reported user:</p>
    <p style="${baseStyles.value}">${escapeHtml(data.reportedUserName)}</p>
  `
    : "";

  const groupSection = data.groupName
    ? `
    <p style="${baseStyles.label}">Group:</p>
    <p style="${baseStyles.value}">${escapeHtml(data.groupName)}</p>
  `
    : "";

  const channelSection = data.channelId
    ? `
    <p style="${baseStyles.label}">Channel ID:</p>
    <p style="${baseStyles.value}">${escapeHtml(data.channelId)}</p>
  `
    : "";

  const reasonSection = data.reason
    ? `
    <p style="${baseStyles.label}">Reason:</p>
    <p style="${baseStyles.value}">${escapeHtml(data.reason)}</p>
  `
    : "";

  const reportedAtSection = data.reportedAt
    ? `
    <p style="${baseStyles.label}">Reported at:</p>
    <p style="${baseStyles.value}">${escapeHtml(data.reportedAt)}</p>
  `
    : "";

  const content = `
    <h1 style="${baseStyles.heading}">Content Report - Action Required</h1>
    <p style="${baseStyles.urgentBadge}">Requires review within 24 hours</p>
    <hr style="${baseStyles.hr}">

    <p style="${baseStyles.label}">Reported by:</p>
    <p style="${baseStyles.value}">${escapeHtml(data.reporterName)}</p>

    ${reportedUserSection}
    ${groupSection}
    ${channelSection}
    ${reasonSection}

    <p style="${baseStyles.label}">Reported message:</p>
    <div style="background-color: #fff; border-left: 3px solid #dc2626; padding: 12px 16px; margin: 8px 0 16px; border-radius: 0 6px 6px 0; font-style: italic; color: #333;">
      "${escapeHtml(data.messagePreview)}"
    </div>

    ${reportedAtSection}

    <hr style="${baseStyles.hr}">

    <p style="${baseStyles.text}">
      Please review this report in the Stream Dashboard moderation queue or take appropriate action directly.
    </p>
    <p style="${baseStyles.subtext}">
      Per App Store guidelines, user-generated content reports must be reviewed within 24 hours.
    </p>
  `;
  return wrapInLayout(content);
}

/**
 * Meeting reminder email
 */
export function meetingReminderEmail(data: {
  meetingTitle: string;
  meetingTime: string;
  groupName: string;
}): string {
  const groupSection = data.groupName
    ? `<p style="${baseStyles.subtext}">${escapeHtml(data.groupName)}</p>`
    : "";

  const timeSection = data.meetingTime
    ? `<p style="${baseStyles.subtext}">${escapeHtml(data.meetingTime)}</p>`
    : "";

  const content = `
    <h1 style="${baseStyles.heading}">Meeting Reminder</h1>
    <p style="${baseStyles.text}">
      <strong>${escapeHtml(data.meetingTitle)}</strong> starts in 2 hours
    </p>
    ${groupSection}
    ${timeSection}
    <div style="${baseStyles.buttonContainer}">
      <a href="${DOMAIN_CONFIG.appUrl}" style="${baseStyles.button}">Open Togather</a>
    </div>
  `;
  return wrapInLayout(content);
}

/**
 * Event updated email
 */
export function eventUpdatedEmail(data: {
  eventTitle: string;
  groupName: string;
  changes: string[];
  newTime?: string;
  newLocation?: string;
}): string {
  const changesHtml =
    data.changes.length > 0
      ? `
    <p style="${baseStyles.text}">Changes:</p>
    <ul style="color: #333; font-size: 16px; line-height: 24px; margin: 0 0 16px; padding-left: 20px;">
      ${data.changes.map((change) => `<li>${escapeHtml(change)}</li>`).join("")}
    </ul>
  `
      : "";

  const newTimeSection = data.newTime
    ? `<p style="${baseStyles.text}"><strong>New time:</strong> ${escapeHtml(data.newTime)}</p>`
    : "";

  const newLocationSection = data.newLocation
    ? `<p style="${baseStyles.text}"><strong>New location:</strong> ${escapeHtml(data.newLocation)}</p>`
    : "";

  const content = `
    <h1 style="${baseStyles.heading}">Event Updated</h1>
    <p style="${baseStyles.text}">
      <strong>${escapeHtml(data.eventTitle)}</strong> in ${escapeHtml(data.groupName)} has been updated.
    </p>
    ${changesHtml}
    ${newTimeSection}
    ${newLocationSection}
    <div style="${baseStyles.buttonContainer}">
      <a href="${DOMAIN_CONFIG.appUrl}" style="${baseStyles.button}">View Event</a>
    </div>
  `;
  return wrapInLayout(content);
}

/**
 * Leader onboarding email (when group creation is approved)
 */
export function leaderOnboardingEmail(data: {
  leaderName: string;
  groupName: string;
  groupTypeName: string;
  communityName: string;
  groupLink?: string;
}): string {
  const firstName = data.leaderName?.split(" ")[0] || "Leader";

  const groupLinkSection = data.groupLink
    ? `
    <hr style="${baseStyles.hr}">
    <p style="${baseStyles.text}">
      <a href="${escapeHtml(data.groupLink)}" style="color: #0066cc; text-decoration: none; font-weight: 500;">
        View Your Group &rarr;
      </a>
    </p>
  `
    : "";

  const content = `
    <h1 style="${baseStyles.heading}">Welcome to Your New Group!</h1>
    <p style="${baseStyles.text}">Hi ${escapeHtml(firstName)},</p>
    <p style="${baseStyles.text}">
      Congratulations! <strong>${escapeHtml(data.groupName)}</strong> has been approved and
      you've been added as a leader. Here's what you need to know to get started.
    </p>

    <hr style="${baseStyles.hr}">

    <h2 style="color: #1a1a1a; font-size: 18px; font-weight: 600; margin: 16px 0 12px;">
      Getting Started Checklist
    </h2>

    <p style="${baseStyles.text}; padding-left: 8px;">
      <strong>1. Add a group photo</strong> - A great photo helps members find and recognize your group. Go to group settings to upload one.
    </p>
    <p style="${baseStyles.text}; padding-left: 8px;">
      <strong>2. Update your group description</strong> - Tell potential members what your ${escapeHtml(data.groupTypeName.toLowerCase())} is about, when you meet, and what to expect.
    </p>
    <p style="${baseStyles.text}; padding-left: 8px;">
      <strong>3. Schedule your first meeting</strong> - Create an event so members know when to show up. You can set up recurring meetings too.
    </p>
    <p style="${baseStyles.text}; padding-left: 8px;">
      <strong>4. Invite members</strong> - Share your group with others in ${escapeHtml(data.communityName)} or wait for people to discover and join.
    </p>

    <hr style="${baseStyles.hr}">

    <h2 style="color: #1a1a1a; font-size: 18px; font-weight: 600; margin: 16px 0 12px;">
      As a Leader, You Can:
    </h2>

    <p style="${baseStyles.text}">
      &bull; Schedule and manage group meetings<br>
      &bull; Take attendance at meetings<br>
      &bull; Message your group members<br>
      &bull; Add or remove members<br>
      &bull; Update group details and settings
    </p>

    ${groupLinkSection}

    <hr style="${baseStyles.hr}">

    <p style="${baseStyles.subtext}">
      Questions? Reach out to your community admin for help getting started.
    </p>
  `;
  return wrapInLayout(content);
}

/**
 * Group creation request email (for admins)
 */
export function groupCreationRequestEmail(data: {
  requesterName: string;
  groupName: string;
}): string {
  const content = `
    <h1 style="${baseStyles.heading}">New Group Request</h1>
    <p style="${baseStyles.text}">
      <strong>${escapeHtml(data.requesterName)}</strong> wants to create
      "<strong>${escapeHtml(data.groupName)}</strong>"
    </p>
    <p style="${baseStyles.text}">
      Please review this request and approve or deny it in the admin dashboard.
    </p>
    <div style="${baseStyles.buttonContainer}">
      <a href="${DOMAIN_CONFIG.appUrl}" style="${baseStyles.button}">Review Request</a>
    </div>
  `;
  return wrapInLayout(content);
}

/**
 * Generic notification email
 * Used as fallback for notification types without specific templates
 */
export function genericEmail(data: { title: string; body: string }): string {
  const content = `
    <h1 style="${baseStyles.heading}">${escapeHtml(data.title)}</h1>
    <p style="${baseStyles.text}">${escapeHtml(data.body)}</p>
    <div style="${baseStyles.buttonContainer}">
      <a href="${DOMAIN_CONFIG.appUrl}" style="${baseStyles.button}">Open Togather</a>
    </div>
    <hr style="${baseStyles.hr}">
    <p style="${baseStyles.subtext}; text-align: center;">
      Don't have the app yet?
      <a href="${DOMAIN_CONFIG.appUrl}" style="${baseStyles.link}">Download Togather</a>
      to stay connected with your community.
    </p>
  `;
  return wrapInLayout(content);
}
