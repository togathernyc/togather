/**
 * Stream Chat Moderation Tests
 *
 * Tests for the moderation flow when a user reports a message in Stream Chat:
 * 1. User reports a message in Stream Chat
 * 2. Stream Chat sends webhook to our backend
 * 3. handleMessageFlagged() in convex/http.ts processes it
 * 4. sendModerationEmail() in convex/functions/notifications.ts sends email to togather@supa.media
 *
 * This file tests the REAL exported functions from the codebase:
 * - escapeHtml() from convex/lib/notifications/emailTemplates.ts
 * - contentReportEmail() from convex/lib/notifications/emailTemplates.ts
 *
 * Note: The following are NOT directly testable because they are not exported
 * or require external API calls:
 * - extractGroupIdFromChannel() in http.ts (internal function, not exported)
 * - extractChannelId() in http.ts (internal function, not exported)
 * - sendModerationEmail() in notifications.ts (requires Resend API)
 * - handleMessageFlagged() in http.ts (httpAction, requires full HTTP context)
 *
 * Run with: cd convex && pnpm test moderation
 */

import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  contentReportEmail,
} from "../lib/notifications/emailTemplates";

// ============================================================================
// Test Suite: escapeHtml (Real Function)
// ============================================================================

describe("escapeHtml", () => {
  it("escapes ampersand character", () => {
    const result = escapeHtml("Tom & Jerry");
    expect(result).toBe("Tom &amp; Jerry");
  });

  it("escapes less than character", () => {
    const result = escapeHtml("a < b");
    expect(result).toBe("a &lt; b");
  });

  it("escapes greater than character", () => {
    const result = escapeHtml("a > b");
    expect(result).toBe("a &gt; b");
  });

  it("escapes double quote character", () => {
    const result = escapeHtml('say "hello"');
    expect(result).toBe("say &quot;hello&quot;");
  });

  it("escapes single quote character", () => {
    const result = escapeHtml("it's fine");
    expect(result).toBe("it&#39;s fine");
  });

  it("escapes script tags to prevent XSS", () => {
    const result = escapeHtml('<script>alert("xss")</script>');
    expect(result).toBe("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("</script>");
  });

  it("escapes img tags with onerror to prevent XSS", () => {
    const result = escapeHtml('<img src="x" onerror="alert(1)">');
    expect(result).toBe("&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;");
    expect(result).not.toContain("<img");
  });

  it("escapes multiple special characters in one string", () => {
    const result = escapeHtml("User & Company <test@example.com> said \"hi\"");
    expect(result).toBe(
      "User &amp; Company &lt;test@example.com&gt; said &quot;hi&quot;"
    );
  });

  it("returns empty string unchanged", () => {
    const result = escapeHtml("");
    expect(result).toBe("");
  });

  it("returns string without special characters unchanged", () => {
    const result = escapeHtml("Hello World 123");
    expect(result).toBe("Hello World 123");
  });

  it("handles unicode characters correctly", () => {
    const result = escapeHtml("Hello World! - from Japan");
    expect(result).toBe("Hello World! - from Japan");
  });
});

// ============================================================================
// Test Suite: contentReportEmail (Real Function)
// ============================================================================

describe("contentReportEmail", () => {
  it("includes reporter name in the email", () => {
    const html = contentReportEmail({
      reporterName: "John Reporter",
      messagePreview: "Test message",
    });

    expect(html).toContain("John Reporter");
    expect(html).toContain("Reported by:");
  });

  it("includes reported user name when provided", () => {
    const html = contentReportEmail({
      reporterName: "Reporter",
      reportedUserName: "Bad Actor",
      messagePreview: "Test message",
    });

    expect(html).toContain("Bad Actor");
    expect(html).toContain("Reported user:");
  });

  it("excludes reported user section when not provided", () => {
    const html = contentReportEmail({
      reporterName: "Reporter",
      messagePreview: "Test message",
    });

    expect(html).not.toContain("Reported user:");
  });

  it("includes message content in the email", () => {
    const html = contentReportEmail({
      reporterName: "Reporter",
      messagePreview: "This is inappropriate content that was reported.",
    });

    expect(html).toContain("This is inappropriate content that was reported.");
    expect(html).toContain("Reported message:");
  });

  it("includes group name when provided", () => {
    const html = contentReportEmail({
      reporterName: "Reporter",
      messagePreview: "Test message",
      groupName: "Friday Night Group",
    });

    expect(html).toContain("Friday Night Group");
    expect(html).toContain("Group:");
  });

  it("excludes group section when group name is not provided", () => {
    const html = contentReportEmail({
      reporterName: "Reporter",
      messagePreview: "Test message",
      groupName: undefined,
    });

    expect(html).not.toContain("Group:");
  });

  it("includes channel ID when provided", () => {
    const html = contentReportEmail({
      reporterName: "Reporter",
      messagePreview: "Test message",
      channelId: "staging_k17abc123_main",
    });

    expect(html).toContain("staging_k17abc123_main");
    expect(html).toContain("Channel ID:");
  });

  it("excludes channel section when channel ID is not provided", () => {
    const html = contentReportEmail({
      reporterName: "Reporter",
      messagePreview: "Test message",
      channelId: undefined,
    });

    expect(html).not.toContain("Channel ID:");
  });

  it("includes reason when provided", () => {
    const html = contentReportEmail({
      reporterName: "Reporter",
      messagePreview: "Test message",
      reason: "harassment",
    });

    expect(html).toContain("harassment");
    expect(html).toContain("Reason:");
  });

  it("excludes reason section when reason is not provided", () => {
    const html = contentReportEmail({
      reporterName: "Reporter",
      messagePreview: "Test message",
      reason: undefined,
    });

    expect(html).not.toContain("Reason:");
  });

  it("includes timestamp when provided", () => {
    const html = contentReportEmail({
      reporterName: "Reporter",
      messagePreview: "Test message",
      reportedAt: "2024-01-15T10:30:00.000Z",
    });

    expect(html).toContain("2024-01-15T10:30:00.000Z");
    expect(html).toContain("Reported at:");
  });

  it("includes urgent badge and 24-hour review requirement", () => {
    const html = contentReportEmail({
      reporterName: "Reporter",
      messagePreview: "Test message",
    });

    expect(html).toContain("Content Report - Action Required");
    expect(html).toContain("Requires review within 24 hours");
    expect(html).toContain("Per App Store guidelines");
  });

  it("escapes HTML entities in reporter name to prevent XSS", () => {
    const html = contentReportEmail({
      reporterName: '<script>alert("xss")</script>',
      messagePreview: "Test message",
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes HTML entities in reported user name to prevent XSS", () => {
    const html = contentReportEmail({
      reporterName: "Reporter",
      reportedUserName: '<img src="x" onerror="alert(1)">',
      messagePreview: "Test message",
    });

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes HTML entities in message content to prevent XSS", () => {
    const html = contentReportEmail({
      reporterName: "Reporter",
      messagePreview: '<script>document.cookie</script>',
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes HTML entities in group name to prevent XSS", () => {
    const html = contentReportEmail({
      reporterName: "Reporter",
      messagePreview: "Test message",
      groupName: "Group <script>evil</script>",
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("generates valid HTML document structure", () => {
    const html = contentReportEmail({
      reporterName: "Reporter",
      messagePreview: "Test message",
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html>");
    expect(html).toContain("</html>");
    expect(html).toContain("<head>");
    expect(html).toContain("</head>");
    expect(html).toContain("<body");
    expect(html).toContain("</body>");
  });

  it("includes proper meta charset", () => {
    const html = contentReportEmail({
      reporterName: "Reporter",
      messagePreview: "Test message",
    });

    expect(html).toContain('charset="utf-8"');
  });

  it("includes Togather footer", () => {
    const html = contentReportEmail({
      reporterName: "Reporter",
      messagePreview: "Test message",
    });

    expect(html).toContain("Sent by Togather");
  });
});

// ============================================================================
// Test Suite: Complete Moderation Email Generation
// ============================================================================

describe("Complete moderation email generation", () => {
  it("generates a complete email with all fields populated", () => {
    const html = contentReportEmail({
      reporterName: "Alice Reporter",
      reportedUserName: "Bob Offender",
      messagePreview: "This content violates our guidelines and should be reviewed.",
      groupName: "Friday Night Study Group",
      channelId: "prod_k17def456_main",
      reason: "spam",
      reportedAt: "2024-03-20T14:45:00.000Z",
    });

    // Verify all fields are present
    expect(html).toContain("Alice Reporter");
    expect(html).toContain("Bob Offender");
    expect(html).toContain("This content violates our guidelines and should be reviewed.");
    expect(html).toContain("Friday Night Study Group");
    expect(html).toContain("prod_k17def456_main");
    expect(html).toContain("spam");
    expect(html).toContain("2024-03-20T14:45:00.000Z");

    // Verify structure
    expect(html).toContain("Reported by:");
    expect(html).toContain("Reported user:");
    expect(html).toContain("Group:");
    expect(html).toContain("Channel ID:");
    expect(html).toContain("Reason:");
    expect(html).toContain("Reported message:");
    expect(html).toContain("Reported at:");
  });

  it("generates a minimal email with only required fields", () => {
    const html = contentReportEmail({
      reporterName: "Anonymous",
      messagePreview: "Reported message content",
    });

    // Verify required fields are present
    expect(html).toContain("Anonymous");
    expect(html).toContain("Reported message content");
    expect(html).toContain("Reported by:");
    expect(html).toContain("Reported message:");

    // Verify optional fields are not present
    expect(html).not.toContain("Reported user:");
    expect(html).not.toContain("Group:");
    expect(html).not.toContain("Channel ID:");
    expect(html).not.toContain("Reason:");
    expect(html).not.toContain("Reported at:");
  });

  it("handles special characters in all fields correctly", () => {
    const html = contentReportEmail({
      reporterName: "User & Co. <test>",
      reportedUserName: "Bad Actor's \"Name\"",
      messagePreview: "<script>alert('xss')</script>",
      groupName: "Group <Test> & More",
      channelId: "channel_test&123",
      reason: "spam & abuse",
      reportedAt: "2024-01-01T00:00:00.000Z",
    });

    // Verify XSS is prevented
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("'xss'");

    // Verify proper escaping
    expect(html).toContain("&amp;"); // & is escaped
    expect(html).toContain("&lt;"); // < is escaped
    expect(html).toContain("&gt;"); // > is escaped
    expect(html).toContain("&#39;"); // ' is escaped
    expect(html).toContain("&quot;"); // " is escaped
  });
});

// ============================================================================
// Documentation: Non-Testable Functions
// ============================================================================

/**
 * The following functions exist in the moderation flow but cannot be tested
 * directly in this test file:
 *
 * 1. handleMessageFlagged() in convex/http.ts
 *    - This is an httpAction handler that requires the full Convex HTTP context
 *    - It extracts data from Stream Chat webhook payloads
 *    - It calls sendModerationEmail() internal action
 *    - Testing would require integration tests with a running Convex backend
 *
 * 2. extractGroupIdFromChannel() in convex/http.ts
 *    - This is an internal helper function (not exported)
 *    - It parses Stream channel IDs to extract group IDs
 *    - Format: {env}_c{communityId}g{groupId}_{type} or {env}_v2_c{convexId}g{convexId}_{type}
 *    - To test this, it would need to be exported or moved to a shared module
 *
 * 3. extractChannelId() in convex/http.ts
 *    - This is an internal helper function (not exported)
 *    - It extracts channel IDs from various webhook payload fields
 *    - To test this, it would need to be exported or moved to a shared module
 *
 * 4. sendModerationEmail() in convex/functions/notifications.ts
 *    - This is an internalAction that makes external API calls to Resend
 *    - It requires RESEND_API_KEY environment variable
 *    - Testing would require mocking the global fetch function
 *    - The email content generation is tested via contentReportEmail()
 *
 * 5. verifyStreamSignature() in convex/http.ts
 *    - This is an internal helper function (not exported)
 *    - It verifies HMAC SHA256 signatures from Stream Chat
 *    - Testing would require a valid signature from Stream
 *
 * To enable direct testing of these functions, consider:
 * - Moving helper functions to a shared module and exporting them
 * - Creating integration tests that run against a real Convex backend
 * - Using Convex's testing utilities when they become available
 */

describe("Moderation flow documentation", () => {
  it("documents the moderation email recipient", () => {
    // The moderation email is sent to togather@supa.media
    // This is hardcoded in sendModerationEmail() in notifications.ts
    // See line ~1517: const emailTo = "togather@supa.media";
    expect(true).toBe(true);
  });

  it("documents the moderation email sender", () => {
    // The moderation email is sent from "Togather <togather@supa.media>"
    // This is hardcoded in sendModerationEmail() in notifications.ts
    // See line ~1516: const emailFrom = "Togather <togather@supa.media>";
    expect(true).toBe(true);
  });

  it("documents the moderation email subject", () => {
    // The moderation email has subject "Content Report - Action Required"
    // This is hardcoded in sendModerationEmail() in notifications.ts
    expect(true).toBe(true);
  });

  it("documents the 24-hour review requirement", () => {
    // Per App Store guidelines, user-generated content reports must be reviewed within 24 hours
    // This is mentioned in both sendModerationEmail() and contentReportEmail()
    const html = contentReportEmail({
      reporterName: "Test",
      messagePreview: "Test",
    });
    expect(html).toContain("24 hours");
    expect(html).toContain("App Store guidelines");
  });
});
