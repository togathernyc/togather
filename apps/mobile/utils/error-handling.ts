/**
 * Error Handling Utilities
 *
 * Centralized error formatting for consistent error display across the app.
 * All features should use this utility instead of custom error formatters.
 */

import { Alert, Platform } from 'react-native';
import { extractApiError } from './api-response';

/**
 * Show a user-facing alert on any platform. React Native's `Alert.alert`
 * is a no-op on React Native Web, so features using it directly silently
 * fail on web. Callers should prefer this helper for error notices.
 */
export function showAlert(title: string, message: string): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(`${title}\n\n${message}`);
    }
    return;
  }
  Alert.alert(title, message);
}

/**
 * Map of known error messages to user-friendly versions
 * Add entries here to customize error messages shown to users
 */
const USER_FRIENDLY_ERRORS: Record<string, string> = {
  // Permission errors
  "Only group leaders can update group": "You don't have permission to edit this group.",
  "You don't have permission to edit this group": "You don't have permission to edit this group.",
  "Community admin role required": "You don't have permission to perform this action.",
  "Primary Admin role required": "Only the primary admin can perform this action.",

  // Authentication errors
  "Authentication required": "Please sign in to continue.",
  "Invalid token": "Your session has expired. Please sign in again.",

  // Resource errors
  "Group not found": "This group no longer exists.",
  "User not found": "User not found.",
  "Community not found": "This community no longer exists.",

  // Validation errors
  "Invalid verification code": "The code you entered is incorrect. Please try again.",
  "Verification code expired": "This code has expired. Please request a new one.",
};

/**
 * Extract the user-friendly error message from a Convex error string
 *
 * Convex errors typically look like:
 * "[CONVEX M(functions/groups:update)] [Request ID: xxx] Server Error
 *  Uncaught Error: Only group leaders can update group
 *    at handler (...)"
 */
function parseConvexError(message: string): string | null {
  // Check if this is a Convex error
  if (!message.includes("[CONVEX") && !message.includes("Server Error")) {
    return null;
  }

  // Try to extract the actual error message after "Uncaught Error:" or "Error:"
  // This regex handles multiple spaces, newlines, and stops at " at " (stack trace start)
  const errorMatch = message.match(/(?:Server\s+Error\s+)?(?:Uncaught\s+)?Error:\s*(.+?)(?:\s+at\s+handler|\s+at\s+|\n|$)/i);
  if (errorMatch && errorMatch[1]) {
    const rawError = errorMatch[1].trim();

    // Check if this exact error has a user-friendly mapping
    if (USER_FRIENDLY_ERRORS[rawError]) {
      return USER_FRIENDLY_ERRORS[rawError];
    }

    // Also check without trailing period
    const withoutPeriod = rawError.replace(/\.$/, '');
    if (USER_FRIENDLY_ERRORS[withoutPeriod]) {
      return USER_FRIENDLY_ERRORS[withoutPeriod];
    }

    // If the raw error is clean enough (no technical details), return it
    if (rawError.length < 150 && !rawError.includes("[CONVEX") && !rawError.includes("handler (")) {
      return rawError;
    }
  }

  // Could not extract a clean error message
  return null;
}

/**
 * Formats error for display to user
 * Handles both REST API errors and Convex errors consistently
 *
 * @param err - The error object (AxiosError, ConvexError, or Error)
 * @param defaultMessage - Default message if error cannot be extracted
 * @returns Formatted error message string
 */
export function formatError(
  err: any,
  defaultMessage: string = "An error occurred. Please try again."
): string {
  // Handle null/undefined
  if (!err) {
    return defaultMessage;
  }

  // First, try to extract from REST API response structure
  const apiError = extractApiError(err);

  // If extractApiError returns the raw error.message, check if it's a Convex error
  if (apiError && err.message && apiError === err.message) {
    const convexError = parseConvexError(err.message);
    if (convexError) {
      return convexError;
    }
  }

  // Check if the error message itself is a Convex error
  if (err.message) {
    const convexError = parseConvexError(err.message);
    if (convexError) {
      return convexError;
    }

    // Check if the plain message has a user-friendly mapping
    if (USER_FRIENDLY_ERRORS[err.message]) {
      return USER_FRIENDLY_ERRORS[err.message];
    }
  }

  // Use the API error if we extracted one
  if (apiError && apiError !== err.message) {
    return apiError;
  }

  // If we have a clean error message, use it
  if (err.message && err.message.length < 150 && !err.message.includes("[CONVEX")) {
    return err.message;
  }

  return defaultMessage;
}

