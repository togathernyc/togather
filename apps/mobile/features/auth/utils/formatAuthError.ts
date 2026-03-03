// Format authentication errors from API responses

// Map of known error messages to user-friendly versions
const ERROR_MAPPINGS: Record<string, string> = {
  "Invalid verification code":
    "The code you entered is incorrect. Please try again.",
  "Verification code expired":
    "This code has expired. Please request a new one.",
  "Verification code expired. Please request a new code.":
    "This code has expired. Please request a new one.",
  "Phone number already registered":
    "This phone number is already registered. Please sign in instead.",
  "User not found": "We couldn't find an account with that phone number.",
  "Too many verification attempts":
    "Too many attempts. Please wait a few minutes and try again.",
  "Too many verification attempts. Please try again later.":
    "Too many attempts. Please wait a few minutes and try again.",
  "Too many verification attempts. Please request a new code.":
    "Too many attempts. Please request a new code.",
  "Too many SMS requests. Please try again later.":
    "Too many SMS requests. Please wait a few minutes and try again.",
  "Invalid phone number. Please check and try again.":
    "Invalid phone number. Please check and try again.",
  "This phone number type is not supported. Please use a mobile number.":
    "This phone number type is not supported. Please use a mobile number.",
  "This phone number is not reachable. Please check the number and try again.":
    "This phone number is not reachable. Please check the number and try again.",
  "Your phone carrier is blocking SMS messages. This is not an issue with Togather. Please contact your carrier to allow SMS delivery, or try again later.":
    "Your phone carrier is blocking SMS messages. This is not an issue with Togather. Please contact your carrier to allow SMS delivery, or try again later.",
  "Your phone carrier cannot deliver messages to this number. This is a carrier issue, not a Togather issue. Please check with your carrier or try again later.":
    "Your phone carrier cannot deliver messages to this number. This is a carrier issue, not a Togather issue. Please check with your carrier or try again later.",
  "SMS service is temporarily unavailable. If this persists, please email togather@supa.media with your phone number and we'll help you.":
    "SMS service is temporarily unavailable. If this persists, please email togather@supa.media with your phone number and we'll help you.",
  "Failed to send verification code. If this continues, please email togather@supa.media with your phone number and we'll help you.":
    "Failed to send verification code. If this continues, please email togather@supa.media with your phone number and we'll help you.",
  "SMS service is not available. Please email togather@supa.media with your phone number and we'll help you.":
    "SMS service is not available. Please email togather@supa.media with your phone number and we'll help you.",
  "Email verification service is not available. Please email togather@supa.media with your email address and we'll help you.":
    "Email verification service is not available. Please email togather@supa.media with your email address and we'll help you.",
  "Email verification is not configured. Please email togather@supa.media with your email address and we'll help you.":
    "Email verification is not configured. Please email togather@supa.media with your email address and we'll help you.",
};

/**
 * Extract user-friendly error message from error string
 * Handles both Convex errors and simple "Error: message" format
 *
 * Convex errors typically look like:
 * "[CONVEX A(functions/auth:sendPhoneOTP)] [Request ID: xxx] Server Error
 *  Uncaught Error: Failed to send verification code. Please try again.
 *    at handler (...)"
 */
function parseErrorMessage(message: string): string {
  // Try to extract the actual error message after "Uncaught Error:" or "Error:"
  // This regex handles multiple spaces, newlines, and stops at " at " (stack trace start)
  const errorMatch = message.match(
    /(?:Server\s+Error\s+)?(?:Uncaught\s+)?Error:\s*(.+?)(?:\s+at\s+|\n|$)/i
  );
  if (errorMatch && errorMatch[1]) {
    const rawError = errorMatch[1].trim();

    // Check if this exact error has a mapping
    if (ERROR_MAPPINGS[rawError]) {
      return ERROR_MAPPINGS[rawError];
    }

    // Also check if the error message (without period) has a mapping
    const withoutPeriod = rawError.replace(/\.$/, "");
    if (ERROR_MAPPINGS[withoutPeriod]) {
      return ERROR_MAPPINGS[withoutPeriod];
    }

    // Check if error starts with known patterns (more precise than includes)
    for (const [key, value] of Object.entries(ERROR_MAPPINGS)) {
      if (rawError.startsWith(key)) {
        return value;
      }
    }

    // Return cleaned error if it's simple enough
    if (
      rawError.length < 100 &&
      !rawError.includes("[CONVEX") &&
      !rawError.includes("handler")
    ) {
      return rawError;
    }
  }

  // If it's a Convex error we couldn't parse, return generic message
  // to avoid exposing internal error details to users
  if (message.includes("[CONVEX") || message.includes("handler (")) {
    return "We couldn't send a verification code. Please try again in a moment.";
  }

  // If no error pattern found, return the original message
  return message;
}

export function formatAuthError(err: any): string {
  // Handle null/undefined
  if (!err) {
    return "An error occurred. Please try again.";
  }

  let errorMessage = "An error occurred. Please try again.";

  if (err.response?.data) {
    // Check for errors array (backend format: { data: null, errors: [...] })
    if (
      err.response.data.errors &&
      Array.isArray(err.response.data.errors) &&
      err.response.data.errors.length > 0
    ) {
      errorMessage = err.response.data.errors[0];
    }
    // Check for detail field (standard DRF format)
    else if (err.response.data.detail) {
      errorMessage = err.response.data.detail;
    }
    // Check for non_field_errors
    else if (
      err.response.data.non_field_errors &&
      Array.isArray(err.response.data.non_field_errors) &&
      err.response.data.non_field_errors.length > 0
    ) {
      errorMessage = err.response.data.non_field_errors[0];
    }
  } else if (err.message) {
    // Parse error messages (Convex and standard errors) to extract user-friendly messages
    errorMessage = parseErrorMessage(err.message);
  }

  return errorMessage;
}
