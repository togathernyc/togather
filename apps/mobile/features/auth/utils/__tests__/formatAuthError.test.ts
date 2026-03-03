/**
 * Tests for formatAuthError utility
 */
import { formatAuthError } from "../formatAuthError";

describe("formatAuthError", () => {
  describe("Convex error parsing", () => {
    it("extracts error message from Convex error with stack trace", () => {
      const convexError = {
        message:
          "[CONVEX AI(functions/auth:verifyPhoneOTP)] (Request ID: 8c884432f0ebl6f) Server Error Uncaught Error: Invalid verification code at handler (../../convex/functions/auth.ts:34319)",
      };

      expect(formatAuthError(convexError)).toBe(
        "The code you entered is incorrect. Please try again."
      );
    });

    it("extracts error message from Convex error without 'Uncaught'", () => {
      const convexError = {
        message:
          "[CONVEX A(functions/auth:sendPhoneOTP)] Error: SMS service is not available. Please email togather@supa.media with your phone number and we'll help you.",
      };

      expect(formatAuthError(convexError)).toBe(
        "SMS service is not available. Please email togather@supa.media with your phone number and we'll help you."
      );
    });

    it("handles verification code expired error", () => {
      const convexError = {
        message:
          "[CONVEX A(functions/auth:verifyPhoneOTP)] Uncaught Error: Verification code expired at handler",
      };

      expect(formatAuthError(convexError)).toBe(
        "This code has expired. Please request a new one."
      );
    });

    it("handles too many attempts error", () => {
      const convexError = {
        message:
          "[CONVEX A(functions/auth:sendPhoneOTP)] Error: Too many verification attempts. Please try again later.",
      };

      expect(formatAuthError(convexError)).toBe(
        "Too many attempts. Please wait a few minutes and try again."
      );
    });

    it("handles invalid phone number error", () => {
      const convexError = {
        message:
          "[CONVEX A(functions/auth:sendPhoneOTP)] Error: Invalid phone number. Please check and try again.",
      };

      expect(formatAuthError(convexError)).toBe(
        "Invalid phone number. Please check and try again."
      );
    });

    it("returns generic message for unparseable Convex error", () => {
      const convexError = {
        message: "[CONVEX A(functions/auth:test)] Something went wrong",
      };

      expect(formatAuthError(convexError)).toBe(
        "We couldn't send a verification code. Please try again in a moment."
      );
    });
  });

  describe("API response error handling", () => {
    it("extracts error from errors array", () => {
      const apiError = {
        response: {
          data: {
            errors: ["Phone number is required"],
          },
        },
      };

      expect(formatAuthError(apiError)).toBe("Phone number is required");
    });

    it("extracts error from detail field", () => {
      const apiError = {
        response: {
          data: {
            detail: "Authentication failed",
          },
        },
      };

      expect(formatAuthError(apiError)).toBe("Authentication failed");
    });

    it("extracts error from non_field_errors", () => {
      const apiError = {
        response: {
          data: {
            non_field_errors: ["Invalid credentials"],
          },
        },
      };

      expect(formatAuthError(apiError)).toBe("Invalid credentials");
    });

    it("prefers errors array over detail field", () => {
      const apiError = {
        response: {
          data: {
            errors: ["First error"],
            detail: "Detail error",
          },
        },
      };

      expect(formatAuthError(apiError)).toBe("First error");
    });
  });

  describe("Non-Convex simple error messages", () => {
    it("returns error message for simple error object", () => {
      const simpleError = {
        message: "Network error",
      };

      expect(formatAuthError(simpleError)).toBe("Network error");
    });

    it("returns generic message for empty error", () => {
      expect(formatAuthError({})).toBe("An error occurred. Please try again.");
    });

    it("returns generic message for null", () => {
      expect(formatAuthError(null)).toBe(
        "An error occurred. Please try again."
      );
    });
  });

  describe("Error message mappings", () => {
    it("maps 'Invalid verification code' to user-friendly message", () => {
      const error = { message: "Error: Invalid verification code" };
      expect(formatAuthError(error)).toBe(
        "The code you entered is incorrect. Please try again."
      );
    });

    it("maps 'Failed to send verification code' to user-friendly message", () => {
      const error = {
        message: "Error: Failed to send verification code. Please try again.",
      };
      expect(formatAuthError(error)).toBe(
        "Failed to send verification code. Please try again."
      );
    });

    it("maps 'Phone number already registered' to user-friendly message", () => {
      const error = { message: "Error: Phone number already registered" };
      expect(formatAuthError(error)).toBe(
        "This phone number is already registered. Please sign in instead."
      );
    });
  });
});
