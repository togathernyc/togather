/**
 * Phone and Email Normalization Utilities
 *
 * Provides functions to normalize phone numbers and email addresses
 * for consistent matching between Planning Center and Together users.
 */

/**
 * Normalize a phone number by stripping non-digits and ensuring US format.
 * Examples:
 * - "(555) 123-4567" -> "15551234567"
 * - "555-123-4567" -> "15551234567"
 * - "+1 555 123 4567" -> "15551234567"
 * - "5551234567" -> "15551234567"
 */
export function normalizePhone(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, "");

  // Handle common formats
  if (digits.length === 10) {
    // US number without country code, add it
    return "1" + digits;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    // US number with country code
    return digits;
  }

  // Return as-is for international numbers or unusual formats
  return digits;
}

/**
 * Check if two phone numbers match after normalization.
 */
export function phonesMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return false;
  return normalizePhone(a) === normalizePhone(b);
}

/**
 * Normalize an email address for comparison.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Check if two email addresses match after normalization.
 */
export function emailsMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return false;
  return normalizeEmail(a) === normalizeEmail(b);
}
