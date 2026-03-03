"use node";
/**
 * Authentication Helper Functions
 *
 * Re-exports Twilio utilities from lib/twilio.ts and provides additional
 * authentication-specific helpers like date validation and email masking.
 */

// Re-export all Twilio-related helpers from the centralized lib
export {
  MAGIC_CODE,
  isTestPhone,
  isTestEmail,
  isMagicCodeAllowed,
  getTwilioAuthCredentials,
  mapTwilioError,
} from "../../lib/twilio";

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate and parse a date string strictly.
 * Rejects invalid calendar dates like "February 30th".
 *
 * @param dateStr - Date string in ISO format (YYYY-MM-DD) or other parseable format
 * @returns The timestamp in milliseconds
 * @throws Error if the date is invalid
 */
export function parseAndValidateDate(dateStr: string): number {
  if (!dateStr || dateStr.trim() === "") {
    throw new Error("Invalid date format for dateOfBirth");
  }

  const date = new Date(dateStr);
  const timestamp = date.getTime();

  // Check if parsing resulted in Invalid Date
  if (isNaN(timestamp)) {
    throw new Error("Invalid date format for dateOfBirth");
  }

  // For ISO format dates (YYYY-MM-DD), perform strict validation
  // to catch invalid calendar dates like February 30th
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, yearStr, monthStr, dayStr] = isoMatch;
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10) - 1; // JS months are 0-indexed
    const day = parseInt(dayStr, 10);

    // Reconstruct date and verify components match
    const reconstructed = new Date(year, month, day);
    if (
      reconstructed.getFullYear() !== year ||
      reconstructed.getMonth() !== month ||
      reconstructed.getDate() !== day
    ) {
      throw new Error("Invalid date format for dateOfBirth");
    }
  }

  return timestamp;
}

/**
 * Mask email for display (e.g., j***e@example.com)
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const masked =
    local.length > 2
      ? local[0] + "***" + local[local.length - 1]
      : local[0] + "***";
  return `${masked}@${domain}`;
}
