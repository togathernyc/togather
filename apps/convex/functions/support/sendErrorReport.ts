"use node";
/**
 * Error Report Support Email
 *
 * Delivers "Send to developer" crash reports from the app-root ErrorBoundary
 * (apps/mobile/components/ErrorBoundary.tsx) to the Togather support inbox
 * via Resend. Uses the shared lazy-Resend-client from `lib/resend.ts` (also
 * used by auth/emailOtp.ts).
 *
 * Must be callable WITHOUT authentication: the ErrorBoundary renders above
 * AuthProvider, so a crash before/during auth setup still needs to be able
 * to reach us.
 */

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { DOMAIN_CONFIG } from "@togather/shared/config";
import { getResendClient } from "../../lib/resend";

/**
 * Where crash reports are delivered. Sourced here (server-side) rather than
 * trusting a client-supplied recipient — the client only sends subject/body.
 */
const SUPPORT_EMAIL = "togather@supa.media";

const EMAIL_FROM = DOMAIN_CONFIG.emailFrom;

/**
 * Abuse guards.
 *
 * This action is unauthenticated by design (see file header), so unlike the
 * OTP flows in auth/phoneOtp.ts / auth/emailOtp.ts there's no user identity
 * (phone/email) to key a rate limit on. Instead the client sends a
 * `reportKey` — a random id it generates once and persists in AsyncStorage
 * (see ErrorBoundary.tsx). This key is entirely client-supplied and
 * therefore spoofable/forgeable by an attacker; it does NOT provide real
 * authentication. Its purpose is narrower: it lets honest clients (the vast
 * majority of callers) get their own rate bucket instead of all sharing one
 * global bucket that a single scripted client could exhaust for everyone.
 * An attacker who rotates the key on every request just falls back to the
 * global backstop below, same as before this change.
 */
const PER_KEY_RATE_LIMIT_MAX_ATTEMPTS = 5;
const PER_KEY_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const GLOBAL_RATE_LIMIT_KEY = "error-report:global";
const GLOBAL_RATE_LIMIT_MAX_ATTEMPTS = 500;
const GLOBAL_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/** Server-side length caps — never trust client-supplied string sizes. */
const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 20000;
const MAX_REPORT_KEY_LENGTH = 64;

/** Fixed prefix applied to every outgoing subject, server-side. */
const SUBJECT_PREFIX = "[Togather error report] ";

/**
 * Bucket key for a client-supplied `reportKey`. Sanitized to a conservative
 * character set and capped in length so a malformed/oversized/adversarial
 * key can't be used to smuggle data into the rate-limit key or blow up the
 * `rateLimits` table with garbage keys.
 */
function sanitizeReportKey(rawKey: string | undefined): string {
  const trimmed = (rawKey ?? "").trim().slice(0, MAX_REPORT_KEY_LENGTH);
  const sanitized = trimmed.replace(/[^a-zA-Z0-9_-]/g, "");
  return sanitized.length > 0 ? sanitized : "anonymous";
}

/**
 * Truncates `value` to at most `maxLength` characters, appending a marker
 * so a truncated report is obviously incomplete rather than silently cut.
 */
export function capLength(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const marker = "\n… [truncated]";
  const keep = Math.max(0, maxLength - marker.length);
  return value.slice(0, keep) + marker;
}

/**
 * Builds the Resend payload from raw client input, applying the server-side
 * length caps, a fixed subject prefix, and fixed from/to addresses. Pulled
 * out as a pure function so the capping/payload logic is unit-testable
 * without a live Resend client.
 *
 * The fixed `SUBJECT_PREFIX` is not optional/skippable by the client — it
 * guarantees every email this action can ever send is unambiguously
 * labeled as a self-serve crash report, so this unauthenticated endpoint
 * can't be abused to send mail from our trusted sender with an arbitrary
 * subject.
 */
export function buildErrorReportEmail(args: { subject: string; body: string }): {
  from: string;
  to: string;
  subject: string;
  text: string;
} {
  const trimmedSubject = args.subject.trim();
  const clientSubject = capLength(
    trimmedSubject.length > 0 ? trimmedSubject : "Togather error report",
    MAX_SUBJECT_LENGTH
  );
  const subject = SUBJECT_PREFIX + clientSubject;
  const text = capLength(args.body, MAX_BODY_LENGTH);

  return {
    from: EMAIL_FROM,
    to: SUPPORT_EMAIL,
    subject,
    text,
  };
}

/** Typed failure reasons so the UI can show accurate, non-misleading copy. */
export type SendErrorReportResult =
  | { success: true }
  | { success: false; reason: "rate_limited" | "unavailable" | "send_failed" };

/**
 * Sends a crash report from the ErrorBoundary's "Send to developer" button.
 * Unauthenticated — see file header. Never throws; failures are reported
 * back as `{ success: false, reason }` so the UI can show an accurate
 * failure state instead of a generic one.
 */
export const sendErrorReport = action({
  args: {
    subject: v.string(),
    body: v.string(),
    reportKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SendErrorReportResult> => {
    const reportKey = sanitizeReportKey(args.reportKey);

    try {
      await ctx.runMutation(
        internal.functions.authInternal.checkRateLimitInternal,
        {
          key: `error-report:key:${reportKey}`,
          maxAttempts: PER_KEY_RATE_LIMIT_MAX_ATTEMPTS,
          windowMs: PER_KEY_RATE_LIMIT_WINDOW_MS,
        }
      );
    } catch (error) {
      console.warn("[Error Report] Per-key rate limited:", error);
      return { success: false, reason: "rate_limited" };
    }

    try {
      await ctx.runMutation(
        internal.functions.authInternal.checkRateLimitInternal,
        {
          key: GLOBAL_RATE_LIMIT_KEY,
          maxAttempts: GLOBAL_RATE_LIMIT_MAX_ATTEMPTS,
          windowMs: GLOBAL_RATE_LIMIT_WINDOW_MS,
        }
      );
    } catch (error) {
      console.warn("[Error Report] Global rate limited:", error);
      return { success: false, reason: "rate_limited" };
    }

    const resend = getResendClient();
    if (!resend) {
      console.error(
        "Resend not configured for error reports - missing RESEND_API_KEY environment variable"
      );
      return { success: false, reason: "unavailable" };
    }

    const email = buildErrorReportEmail(args);

    try {
      const response = await resend.emails.send(email);

      if (response.error) {
        console.error("Resend API error sending error report:", response.error);
        return { success: false, reason: "send_failed" };
      }

      console.log("[Error Report] Sent to support", {
        messageId: response.data?.id,
      });
      return { success: true };
    } catch (error) {
      console.error("Error sending error report email:", error);
      return { success: false, reason: "send_failed" };
    }
  },
});
