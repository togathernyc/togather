"use node";
/**
 * Email OTP Verification
 *
 * Internal helpers for email-based OTP verification.
 * Used by claimAccount for email verification during account claiming.
 *
 * Uses Resend for email delivery with custom verification code templates.
 */

import { Resend } from "resend";
import { render } from "@react-email/render";
import {
  VerificationCodeEmail,
  verificationCodeSubject,
} from "../../lib/email/templates/VerificationCode";
import { internal } from "../../_generated/api";
import { ActionCtx } from "../../_generated/server";
import { MAGIC_CODE, isTestEmail } from "./helpers";

// Email sender address
const EMAIL_FROM = "Togather <togather@supa.media>";

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
 * Generate a random 6-digit code
 */
function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Send OTP to an email address via Resend
 * @returns true if sent successfully
 * @throws Error with user-friendly message on failure
 */
export async function sendEmailOTP(
  ctx: ActionCtx,
  email: string
): Promise<boolean> {
  const normalizedEmail = email.toLowerCase();

  // Check for magic code bypass - skip sending for test emails
  const isProduction = process.env.NODE_ENV === "production";
  const isDebug = process.env.DEBUG === "true";
  const canUseTestBypass =
    isTestEmail(normalizedEmail) && (!isProduction || isDebug);

  if (canUseTestBypass) {
    console.log(`[Email OTP] Test email detected, skipping actual send: ${normalizedEmail}`);
    // Store the magic code so verification works
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
    await ctx.runMutation(internal.functions.authInternal.storeEmailVerificationCode, {
      email: normalizedEmail,
      code: MAGIC_CODE,
      expiresAt,
    });
    return true;
  }

  const resend = getResendClient();
  if (!resend) {
    console.error(
      "Resend not configured for email OTP - missing RESEND_API_KEY environment variable"
    );
    throw new Error(
      "Email verification service is not available. Please email togather@supa.media with your email address and we'll help you."
    );
  }

  // Rate limit check: if a code was sent within the last 30 seconds, skip
  // This prevents race conditions when users click "Resend" rapidly
  const hasRecentCode = await ctx.runQuery(
    internal.functions.authInternal.hasRecentEmailCode,
    { email: normalizedEmail }
  );

  if (hasRecentCode) {
    console.log(`[Email OTP] Rate limited - recent code exists for ${normalizedEmail}`);
    return true; // Return success without sending another email
  }

  // Generate a random 6-digit code
  const code = generateVerificationCode();

  // Calculate expiration (10 minutes from now)
  const expiresAt = Date.now() + 10 * 60 * 1000;

  // Store the code in the database
  await ctx.runMutation(internal.functions.authInternal.storeEmailVerificationCode, {
    email: normalizedEmail,
    code,
    expiresAt,
  });

  try {
    // Render the email template to HTML
    const emailHtml = await render(
      VerificationCodeEmail({ code, email: normalizedEmail })
    );

    // Send the email via Resend
    const response = await resend.emails.send({
      from: EMAIL_FROM,
      to: normalizedEmail,
      subject: verificationCodeSubject,
      html: emailHtml,
    });

    if (response.error) {
      console.error("Resend API error:", {
        error: response.error,
        email: normalizedEmail,
      });
      throw new Error(
        "Failed to send verification email. Please try again or email togather@supa.media for help."
      );
    }

    console.log(`[Email OTP] Verification email sent to ${normalizedEmail}`, {
      messageId: response.data?.id,
    });

    return true;
  } catch (error) {
    console.error("Error sending verification email:", {
      error,
      email: normalizedEmail,
    });

    // Re-throw if it's already a user-friendly error
    if (error instanceof Error && error.message.includes("togather@supa.media")) {
      throw error;
    }

    throw new Error(
      "Failed to send verification email. Please try again or email togather@supa.media for help."
    );
  }
}

/**
 * Verify email OTP code
 * @returns true if verification succeeded
 * @throws Error with user-friendly message on failure
 */
export async function verifyEmailOTP(
  ctx: ActionCtx,
  email: string,
  code: string
): Promise<boolean> {
  const normalizedEmail = email.toLowerCase();

  // Magic code only allowed for test emails (same security as phone verification)
  const isProduction = process.env.NODE_ENV === "production";
  const isDebug = process.env.DEBUG === "true";
  const isMagicCodeValid =
    isTestEmail(normalizedEmail) &&
    code === MAGIC_CODE &&
    (!isProduction || isDebug);

  // Log security warning when magic code is used
  if (isMagicCodeValid) {
    console.warn(`[SECURITY] Magic code used for email: ${normalizedEmail}`);
    return true;
  }

  // Verify the code against the database
  const result = await ctx.runMutation(internal.functions.authInternal.verifyEmailCode, {
    email: normalizedEmail,
    code,
  });

  return result.valid;
}
