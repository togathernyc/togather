/**
 * API Response Utilities
 * 
 * Centralized utilities for extracting data and errors from API responses.
 * Handles the inconsistent response structure from the backend:
 * - Some responses: { data: {...}, errors: [] }
 * - Some responses: {...}
 * - Some responses may have errors with 200 status
 */

/**
 * Recursively extracts the first string from a nested array structure
 * Handles deeply nested error arrays like [[["error message"]]]
 */
function extractFirstString(arr: any): string | null {
  if (typeof arr === "string") {
    return arr;
  }
  if (Array.isArray(arr) && arr.length > 0) {
    return extractFirstString(arr[0]);
  }
  return null;
}

/**
 * Extracts data from API response, handling nested response structure
 * Backend may return: { data: {...}, errors: [] } or just {...}
 * 
 * @param response - The API response object
 * @returns The extracted data
 * @throws Error if response contains errors
 */
export function extractApiData<T>(response: any): T {
  // Check for errors first (backend may return errors with 200 status)
  if (
    response?.data?.errors &&
    Array.isArray(response.data.errors) &&
    response.data.errors.length > 0
  ) {
    // Extract error message from nested array structure
    const errorMessage = extractFirstString(response.data.errors) || String(response.data.errors[0]);
    const error = new Error(errorMessage);
    (error as any).response = { data: response.data };
    throw error;
  }

  // Extract data - may be nested
  return (response?.data?.data ?? response?.data ?? response) as T;
}

/**
 * Extracts all error messages from a nested structure
 * Handles both processed errors ["field: error"] and raw serializer errors
 */
function extractAllErrors(errors: any, prefix = ""): string[] {
  const messages: string[] = [];
  
  if (typeof errors === "string") {
    messages.push(prefix ? `${prefix}: ${errors}` : errors);
  } else if (Array.isArray(errors)) {
    errors.forEach((error, index) => {
      const newPrefix = prefix || (typeof error === "object" && error !== null ? String(index) : "");
      messages.push(...extractAllErrors(error, newPrefix));
    });
  } else if (errors && typeof errors === "object") {
    // Handle dictionary/object structure (field-level errors)
    Object.entries(errors).forEach(([field, fieldErrors]) => {
      messages.push(...extractAllErrors(fieldErrors, field));
    });
  }
  
  return messages;
}

/**
 * Extracts error message from API error response
 * Handles all backend error response formats:
 * - { errors: ["error message"] }
 * - { errors: ["field: error"] } (processed errors)
 * - { errors: [[["error message"]]] } (nested arrays)
 * - { errors: { field: ["error"] } } (raw serializer errors)
 * - { detail: "error message" }
 * - { non_field_errors: ["error message"] }
 * 
 * @param err - The error object (AxiosError or Error)
 * @returns The error message string
 */
export function extractApiError(err: any): string {
  if (err.response?.data) {
    // Check for errors array (may be nested or processed)
    if (
      err.response.data.errors &&
      Array.isArray(err.response.data.errors) &&
      err.response.data.errors.length > 0
    ) {
      // Check if it's a processed error (string format: "field: error")
      const firstError = err.response.data.errors[0];
      if (typeof firstError === "string" && firstError.includes(":")) {
        // Processed error format: "field: error"
        return firstError;
      }
      
      // Try to extract from nested structure
      const errorMessage = extractFirstString(err.response.data.errors);
      if (errorMessage) {
        return errorMessage;
      }
      
      // Extract all errors and return the first one
      const allErrors = extractAllErrors(err.response.data.errors);
      if (allErrors.length > 0) {
        return allErrors[0];
      }
      
      // Fallback: try to stringify the first element
      return String(err.response.data.errors[0]);
    }
    
    // Check for errors object (raw serializer errors)
    if (err.response.data.errors && typeof err.response.data.errors === "object" && !Array.isArray(err.response.data.errors)) {
      const allErrors = extractAllErrors(err.response.data.errors);
      if (allErrors.length > 0) {
        return allErrors[0];
      }
    }
    
    if (err.response.data.detail) {
      return err.response.data.detail;
    }
    if (
      err.response.data.non_field_errors &&
      Array.isArray(err.response.data.non_field_errors) &&
      err.response.data.non_field_errors.length > 0
    ) {
      return err.response.data.non_field_errors[0];
    }
  }
  return err.message || "An error occurred. Please try again.";
}

