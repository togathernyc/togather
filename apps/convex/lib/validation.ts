/**
 * Validation helpers for Convex functions
 *
 * Provides runtime validation for data that passes schema validation
 * but may still be semantically invalid.
 */

// ============================================================================
// Date Validation
// ============================================================================

/**
 * Parse a date string and return a timestamp with strict calendar date validation.
 * Throws if the date string is invalid or represents an invalid calendar date.
 *
 * @param dateStr - The date string to parse (e.g., "2024-01-15", "2024-01-15T00:00:00Z")
 * @param fieldName - The name of the field for error messages
 * @returns The timestamp in milliseconds
 * @throws Error if the date string is invalid or invalid calendar date (e.g., Feb 30th)
 */
export function parseDate(dateStr: string, fieldName: string = "date"): number {
  if (!dateStr || dateStr.trim() === "") {
    throw new Error(`Invalid ${fieldName} format`);
  }

  const date = new Date(dateStr);
  const timestamp = date.getTime();

  // Check if parsing resulted in Invalid Date
  if (isNaN(timestamp)) {
    throw new Error(`Invalid ${fieldName} format`);
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
      throw new Error(`Invalid ${fieldName} format - invalid calendar date`);
    }
  }

  return timestamp;
}

/**
 * Optionally parse a date string and return a timestamp.
 * Returns undefined if dateStr is undefined.
 * Throws if the date string is defined but invalid.
 *
 * @param dateStr - The date string to parse, or undefined
 * @param fieldName - The name of the field for error messages
 * @returns The timestamp in milliseconds, or undefined
 * @throws Error if the date string is defined but invalid
 */
export function parseDateOptional(
  dateStr: string | undefined,
  fieldName: string = "date"
): number | undefined {
  if (dateStr === undefined) {
    return undefined;
  }
  return parseDate(dateStr, fieldName);
}
