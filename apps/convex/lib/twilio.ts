"use node";
/**
 * Twilio-related utilities for authentication
 *
 * Extracted from auth/helpers.ts to centralize Twilio-specific logic:
 * - Error code mapping for user-friendly messages
 * - Credential retrieval for API authentication
 * - Test phone/email detection for bypass in non-production
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Magic code for bypassing OTP verification in test environments.
 * Only works for test phones/emails or non-production environments.
 */
export const MAGIC_CODE = "000000";

// ============================================================================
// Test Phone/Email Helpers
// ============================================================================

/**
 * Check if phone is in test phone list (from env var).
 * Test phones can use magic code bypass in any environment.
 *
 * @param phone - Phone number to check (any format)
 * @returns true if phone is in OTP_TEST_PHONE_NUMBERS env var
 */
export function isTestPhone(phone: string): boolean {
  const testPhones = process.env.OTP_TEST_PHONE_NUMBERS;
  if (!testPhones) return false;

  const testPhoneList = testPhones.split(",").map((p: string) => p.trim());
  const cleaned = phone.replace(/\D/g, "");

  return testPhoneList.some((testPhone: string) => {
    const testCleaned = testPhone.replace(/\D/g, "");
    return cleaned === testCleaned || cleaned.endsWith(testCleaned);
  });
}

/**
 * Check if email is in test email list (from env var).
 * Test emails can use magic code bypass in any environment.
 *
 * @param email - Email address to check
 * @returns true if email is in OTP_TEST_EMAIL_ADDRESSES env var
 */
export function isTestEmail(email: string): boolean {
  const testEmails = process.env.OTP_TEST_EMAIL_ADDRESSES;
  if (!testEmails) return false;

  const testEmailList = testEmails
    .split(",")
    .map((e: string) => e.trim().toLowerCase());
  return testEmailList.includes(email.toLowerCase());
}

/**
 * Check if magic code bypass is allowed for a phone number.
 *
 * NOTE: Magic code bypass is only allowed server-side for security.
 * Client-controlled flags were removed to prevent authentication bypass attacks.
 *
 * @param phone - The phone number to check
 * @returns true if magic code is allowed
 */
export function isMagicCodeAllowed(phone: string): boolean {
  const isProduction = process.env.NODE_ENV === "production";

  // Magic code allowed for:
  // - Test phones (always) - defined in isTestPhone()
  // - Non-production environments
  return isTestPhone(phone) || !isProduction;
}

// ============================================================================
// Twilio Credential Helpers
// ============================================================================

/**
 * Get Twilio authentication credentials.
 * Returns username and password for Basic Auth.
 *
 * Twilio supports two auth methods:
 * 1. Auth Token: accountSid:authToken
 * 2. API Key: apiKeySid:apiKeySecret (preferred, more secure)
 *
 * @returns {username, password} for Basic Auth, or null if not configured
 */
export function getTwilioAuthCredentials(): {
  username: string;
  password: string;
} | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;

  // Prefer API Key auth if available (more secure)
  if (accountSid && apiKeySid && apiKeySecret) {
    return {
      username: apiKeySid,
      password: apiKeySecret,
    };
  }

  // Fall back to Auth Token
  if (accountSid && authToken) {
    return {
      username: accountSid,
      password: authToken,
    };
  }

  return null;
}

// ============================================================================
// Error Mapping
// ============================================================================

/**
 * Map Twilio error codes to user-friendly error messages.
 *
 * @param status - HTTP status code from Twilio
 * @param errorCode - Twilio error code (e.g., 60200, 60033)
 * @param errorMessage - Raw error message from Twilio
 * @returns User-friendly error message
 */
export function mapTwilioError(
  status: number,
  errorCode: number | undefined,
  errorMessage: string
): string {
  const message = errorMessage.toLowerCase();

  // Rate limiting errors
  if (status === 429 || errorCode === 60200) {
    return "Too many verification attempts. Please try again later.";
  }

  // Max check attempts (verification attempts exceeded)
  if (errorCode === 60203 || message.includes("max check attempts")) {
    return "Too many verification attempts. Please request a new code.";
  }

  // Max send attempts (too many code requests)
  if (errorCode === 60205 || message.includes("max send attempts")) {
    return "Too many SMS requests. Please try again later.";
  }

  // Invalid phone number
  if (
    errorCode === 60033 ||
    message.includes("invalid phone number") ||
    message.includes("invalid parameter")
  ) {
    return "Invalid phone number. Please check and try again.";
  }

  // Unsupported phone number type
  if (
    errorCode === 60210 ||
    message.includes("unsupported phone number type")
  ) {
    return "This phone number type is not supported. Please use a mobile number.";
  }

  // Phone number not reachable - could be carrier issue
  if (errorCode === 60212 || message.includes("unreachable")) {
    return "Your phone carrier cannot deliver messages to this number. This is a carrier issue, not a Togather issue. Please check with your carrier or try again later.";
  }

  // Carrier blocking - make it clear this is the carrier's issue, not ours
  if (
    errorCode === 60214 ||
    message.includes("carrier") ||
    message.includes("blocked")
  ) {
    return "Your phone carrier is blocking SMS messages. This is not an issue with Togather. Please contact your carrier to allow SMS delivery, or try again later.";
  }

  // Service unavailable - could be our issue
  if (
    status === 503 ||
    errorCode === 60215 ||
    message.includes("service unavailable")
  ) {
    return "SMS service is temporarily unavailable. If this persists, please email togather@supa.media with your phone number and we'll help you.";
  }

  // Resource not found (expired verification)
  if (status === 404 || errorCode === 20404 || message.includes("not found")) {
    return "Verification code expired. Please request a new code.";
  }

  // Generic error - could be our issue, provide contact info
  if (errorCode) {
    console.error(
      `Unmapped Twilio error code: ${errorCode}, message: ${errorMessage}`
    );
  }

  return "Failed to send verification code. If this continues, please email togather@supa.media with your phone number and we'll help you.";
}
