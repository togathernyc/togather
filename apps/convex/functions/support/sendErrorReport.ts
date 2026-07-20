"use node";
/**
 * Error Report Support Email
 *
 * Delivers "Send to developer" crash reports from the app-root ErrorBoundary
 * (apps/mobile/components/ErrorBoundary.tsx) to the Togather support inbox
 * via Resend. Mirrors the lazy-Resend-client / RESEND_API_KEY pattern in
 * auth/emailOtp.ts.
 *
 * Must be callable WITHOUT authentication: the ErrorBoundary renders above
 * AuthProvider, so a crash before/during auth setup still needs to be able
 * to reach us.
 */

import { v } from "convex/values";
import { Resend } from "resend";
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { DOMAIN_CONFIG } from "@togather/shared/config";

/**
 * Where crash reports are delivered. Sourced here (server-side) rather than
 * trusting a client-supplied recipient — the client only sends subject/body.
 */
const SUPPORT_EMAIL = "togather@supa.media";

const EMAIL_FROM = DOMAIN_CONFIG.emailFrom;

/**
 * Abuse guards.
 *
 * This action is unauthenticated by design (see file header), so unlike
 * the OTP flows in auth/phoneOtp.ts / auth/emailOtp.ts there's no user
 * identity (phone/email) to key a per-caller rate limit on — the existing
 * `lib/rateLimit.ts` helper (checked before adding this) is generic and
 * reused here, just keyed on a single deployment-wide bucket instead of a
 * per-user one. The cap is intentionally generous: a real incident causing
 * many simultaneous crashes is exactly when reports matter most, so this
 * only needs to stop a runaway loop or scripted flood, not throttle normal
 * usage.
 */
const RATE_LIMIT_KEY = "error-report:global";
const RATE_LIMIT_MAX_ATTEMPTS = 100;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/** Server-side length caps — never trust client-supplied string sizes. */
const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 20000;

// Lazy-initialize Resend client to avoid throwing if API key is missing at module load
let resendClient: Resend | null = null;
function getResendClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) {
    return null;
  }
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
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
 * length caps and fixed from/to addresses. Pulled out as a pure function so
 * the capping/payload logic is unit-testable without a live Resend client.
 */
export function buildErrorReportEmail(args: { subject: string; body: string }): {
  from: string;
  to: string;
  subject: string;
  text: string;
} {
  const trimmedSubject = args.subject.trim();
  const subject = capLength(
    trimmedSubject.length > 0 ? trimmedSubject : "Togather error report",
    MAX_SUBJECT_LENGTH
  );
  const text = capLength(args.body, MAX_BODY_LENGTH);

  return {
    from: EMAIL_FROM,
    to: SUPPORT_EMAIL,
    subject,
    text,
  };
}

/**
 * Sends a crash report from the ErrorBoundary's "Send to developer" button.
 * Unauthenticated — see file header. Never throws; failures are reported
 * back as `{ success: false }` so the UI can show a distinct failed state.
 */
export const sendErrorReport = action({
  args: {
    subject: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    try {
      await ctx.runMutation(
        internal.functions.authInternal.checkRateLimitInternal,
        {
          key: RATE_LIMIT_KEY,
          maxAttempts: RATE_LIMIT_MAX_ATTEMPTS,
          windowMs: RATE_LIMIT_WINDOW_MS,
        }
      );
    } catch (error) {
      console.warn("[Error Report] Rate limited:", error);
      return { success: false };
    }

    const resend = getResendClient();
    if (!resend) {
      console.error(
        "Resend not configured for error reports - missing RESEND_API_KEY environment variable"
      );
      return { success: false };
    }

    const email = buildErrorReportEmail(args);

    try {
      const response = await resend.emails.send(email);

      if (response.error) {
        console.error("Resend API error sending error report:", response.error);
        return { success: false };
      }

      console.log("[Error Report] Sent to support", {
        messageId: response.data?.id,
      });
      return { success: true };
    } catch (error) {
      console.error("Error sending error report email:", error);
      return { success: false };
    }
  },
});
