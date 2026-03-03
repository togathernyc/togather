/**
 * Decodes Unicode escape sequences in strings to actual characters/emojis
 * 
 * Converts patterns like:
 * - `\\ud83c\\udf89` → 🎉
 * - `\\u000A` → newline
 * 
 * Based on web-deprecated utils/emoji.js pattern, adapted for React Native
 */
export function decodeEmoji(value: string | null | undefined): string {
  if (!value) return "";

  return value
    // Convert Unicode escape sequences (4 hex digits) to characters
    // Handles surrogate pairs like \ud83c\udf89 (emoji) correctly
    .replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    })
    // Convert octal escape sequences (3 digits) to characters
    .replace(/\\(\d{3})/g, (match, octal) => {
      return String.fromCharCode(parseInt(octal, 8));
    })
    // Replace remaining backslashes with spaces (cleanup)
    .replace(/\\/g, " ");
}

