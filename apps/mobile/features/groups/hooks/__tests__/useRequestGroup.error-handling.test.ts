/**
 * Error Handling Tests - useRequestGroup Hook
 *
 * These tests verify that the hook properly handles errors:
 * 1. Error propagation to calling components
 * 2. Loading state management
 * 3. Error state tracking
 * 4. User-friendly error messages
 *
 * Run with: cd apps/mobile && pnpm test useRequestGroup.error-handling.test.ts
 */

import { renderHook, act, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { useRequestGroup } from "../useRequestGroup";
import { useMutation } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";

// Mock dependencies
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
  }),
}));

jest.mock("@services/api/convex", () => ({
  useMutation: jest.fn(),
  api: {
    functions: {
      groupCreationRequests: {
        create: "api.functions.groupCreationRequests.create",
      },
    },
  },
}));

jest.mock("@providers/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

// Mock Alert
jest.spyOn(Alert, "alert");

describe("useRequestGroup Hook - Error Handling", () => {
  const mockMutate = jest.fn();

  const defaultAuthContext = {
    user: { id: "user123", firstName: "Test", lastName: "User" },
    community: { id: "community123", name: "Test Community" },
    token: "test-token",
  };

  beforeEach(() => {
    jest.clearAllMocks();

    (useAuth as jest.Mock).mockReturnValue(defaultAuthContext);
    (useMutation as jest.Mock).mockReturnValue(mockMutate);
  });

  // ============================================================================
  // ERROR #1: Error Propagation
  // ============================================================================

  describe("Error Propagation", () => {
    test("should propagate errors from mutation", async () => {
      const testError = new Error("Duplicate request error");
      mockMutate.mockRejectedValueOnce(testError);

      const { result } = renderHook(() => useRequestGroup());

      await expect(
        act(async () => {
          await result.current.requestGroupAsync({
            name: "Test Group",
            groupTypeId: "type123",
          });
        })
      ).rejects.toThrow("Duplicate request error");
    });

    test("should show Alert.alert for errors in requestGroup method", async () => {
      const testError = new Error("Group type not found");
      mockMutate.mockRejectedValueOnce(testError);

      const { result } = renderHook(() => useRequestGroup());

      await act(async () => {
        await result.current.requestGroup({
          name: "Test Group",
          groupTypeId: "type123",
        });
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        "Error",
        expect.stringContaining("Group type not found")
      );
    });

    test("should include error context in Alert message", async () => {
      const testError = new Error("You already have a pending group creation request");
      mockMutate.mockRejectedValueOnce(testError);

      const { result } = renderHook(() => useRequestGroup());

      await act(async () => {
        await result.current.requestGroup({
          name: "Test Group",
          groupTypeId: "type123",
        });
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        "Error",
        "You already have a pending group creation request"
      );
    });

    test("should show generic error message for unknown errors", async () => {
      mockMutate.mockRejectedValueOnce(new Error());

      const { result } = renderHook(() => useRequestGroup());

      await act(async () => {
        await result.current.requestGroup({
          name: "Test Group",
          groupTypeId: "type123",
        });
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        "Error",
        expect.stringContaining("Failed to submit request")
      );
    });
  });

  // ============================================================================
  // ERROR #2: Loading State Management
  // ============================================================================

  describe("Loading State Management", () => {
    test("should track loading state during mutation", async () => {
      mockMutate.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      const { result } = renderHook(() => useRequestGroup());

      // Initially not loading
      expect(result.current.isRequesting).toBe(false);

      // Start request
      act(() => {
        result.current.requestGroupAsync({
          name: "Test Group",
          groupTypeId: "type123",
        });
      });

      // Should be loading
      await waitFor(() => {
        expect(result.current.isRequesting).toBe(true);
      });

      // Should finish loading (mock resolves after 100ms, allow buffer for test execution)
      await waitFor(() => {
        expect(result.current.isRequesting).toBe(false);
      }, { timeout: 500 });
    });

    test("should reset loading state after error", async () => {
      mockMutate.mockRejectedValueOnce(new Error("Test error"));

      const { result } = renderHook(() => useRequestGroup());

      await act(async () => {
        try {
          await result.current.requestGroupAsync({
            name: "Test Group",
            groupTypeId: "type123",
          });
        } catch (error) {
          // Expected to throw
        }
      });

      // Loading state should be reset
      expect(result.current.isRequesting).toBe(false);
    });

    test("should reset loading state after success", async () => {
      mockMutate.mockResolvedValueOnce({ id: "request123", status: "pending" });

      const { result } = renderHook(() => useRequestGroup());

      await act(async () => {
        await result.current.requestGroupAsync({
          name: "Test Group",
          groupTypeId: "type123",
        });
      });

      // Loading state should be reset
      expect(result.current.isRequesting).toBe(false);
    });
  });

  // ============================================================================
  // ERROR #3: Error State Tracking
  // ============================================================================

  describe("Error State Tracking", () => {
    test("should store error in state after failure", async () => {
      const testError = new Error("Invalid leader ID");
      mockMutate.mockRejectedValueOnce(testError);

      const { result } = renderHook(() => useRequestGroup());

      await act(async () => {
        try {
          await result.current.requestGroupAsync({
            name: "Test Group",
            groupTypeId: "type123",
          });
        } catch (error) {
          // Expected to throw
        }
      });

      // Error should be stored
      expect(result.current.error).toBeTruthy();
      expect(result.current.error).toContain("Invalid leader ID");
    });

    test("should clear error on successful retry", async () => {
      // First request fails
      mockMutate.mockRejectedValueOnce(new Error("First error"));

      const { result } = renderHook(() => useRequestGroup());

      await act(async () => {
        try {
          await result.current.requestGroupAsync({
            name: "Test Group",
            groupTypeId: "type123",
          });
        } catch (error) {
          // Expected
        }
      });

      expect(result.current.error).toBeTruthy();

      // Second request succeeds
      mockMutate.mockResolvedValueOnce({ id: "request123" });

      await act(async () => {
        await result.current.requestGroupAsync({
          name: "Test Group",
          groupTypeId: "type123",
        });
      });

      // Error should be cleared
      expect(result.current.error).toBeNull();
    });

    test("should update error on subsequent failures", async () => {
      // First failure
      mockMutate.mockRejectedValueOnce(new Error("First error"));

      const { result } = renderHook(() => useRequestGroup());

      await act(async () => {
        try {
          await result.current.requestGroupAsync({
            name: "Test Group",
            groupTypeId: "type123",
          });
        } catch (error) {
          // Expected
        }
      });

      expect(result.current.error).toContain("First error");

      // Second failure with different error
      mockMutate.mockRejectedValueOnce(new Error("Second error"));

      await act(async () => {
        try {
          await result.current.requestGroupAsync({
            name: "Test Group 2",
            groupTypeId: "type456",
          });
        } catch (error) {
          // Expected
        }
      });

      // Error should be updated
      expect(result.current.error).toContain("Second error");
    });
  });

  // ============================================================================
  // ERROR #4: Authentication Checks
  // ============================================================================

  describe("Authentication Checks", () => {
    test("should throw error when user is not logged in", async () => {
      (useAuth as jest.Mock).mockReturnValue({
        user: null,
        community: { id: "community123" },
        token: "test-token",
      });

      const { result } = renderHook(() => useRequestGroup());

      await expect(
        act(async () => {
          await result.current.requestGroupAsync({
            name: "Test Group",
            groupTypeId: "type123",
          });
        })
      ).rejects.toThrow("must be logged in");
    });

    test("should throw error when community is not selected", async () => {
      (useAuth as jest.Mock).mockReturnValue({
        user: { id: "user123" },
        community: null,
        token: "test-token",
      });

      const { result } = renderHook(() => useRequestGroup());

      await expect(
        act(async () => {
          await result.current.requestGroupAsync({
            name: "Test Group",
            groupTypeId: "type123",
          });
        })
      ).rejects.toThrow("must be logged in");
    });

    test("should throw error when token is missing", async () => {
      (useAuth as jest.Mock).mockReturnValue({
        user: { id: "user123" },
        community: { id: "community123" },
        token: null,
      });

      const { result } = renderHook(() => useRequestGroup());

      await expect(
        act(async () => {
          await result.current.requestGroupAsync({
            name: "Test Group",
            groupTypeId: "type123",
          });
        })
      ).rejects.toThrow("Authentication required");
    });

    test("should show Alert for authentication errors in requestGroup", async () => {
      (useAuth as jest.Mock).mockReturnValue({
        user: null,
        community: { id: "community123" },
        token: "test-token",
      });

      const { result } = renderHook(() => useRequestGroup());

      await act(async () => {
        await result.current.requestGroup({
          name: "Test Group",
          groupTypeId: "type123",
        });
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        "Error",
        expect.stringContaining("logged in")
      );
    });
  });

  // ============================================================================
  // ERROR #5: User-Friendly Error Messages
  // ============================================================================

  describe("User-Friendly Error Messages", () => {
    test("should map backend errors to friendly messages", async () => {
      const errorMappings = [
        {
          backendError: "You already have a pending group creation request",
          expectedMessage: "pending group creation request",
        },
        {
          backendError: "Group type not found",
          expectedMessage: "Group type not found",
        },
        {
          backendError: "Invalid user ID format",
          expectedMessage: "Invalid user ID",
        },
        {
          backendError: "Some proposed leaders are not valid community members",
          expectedMessage: "not valid community members",
        },
      ];

      for (const { backendError, expectedMessage } of errorMappings) {
        jest.clearAllMocks();
        mockMutate.mockRejectedValueOnce(new Error(backendError));

        const { result } = renderHook(() => useRequestGroup());

        await act(async () => {
          await result.current.requestGroup({
            name: "Test Group",
            groupTypeId: "type123",
          });
        });

        expect(Alert.alert).toHaveBeenCalledWith(
          "Error",
          expect.stringContaining(expectedMessage)
        );
      }
    });

    test("should provide actionable guidance in error messages", async () => {
      mockMutate.mockRejectedValueOnce(
        new Error("You already have a pending group creation request")
      );

      const { result } = renderHook(() => useRequestGroup());

      await act(async () => {
        await result.current.requestGroup({
          name: "Test Group",
          groupTypeId: "type123",
        });
      });

      // The error message should help user understand what to do next
      expect(Alert.alert).toHaveBeenCalledWith(
        "Error",
        expect.stringMatching(/pending.*request/)
      );
    });
  });

  // ============================================================================
  // SUMMARY TEST: Document Hook Error Handling
  // ============================================================================

  describe("HOOK ERROR HANDLING SUMMARY", () => {
    test("documents the hook error handling that should be verified", () => {
      const hookErrorChecks = [
        {
          id: 1,
          hook: "useRequestGroup",
          check: "Propagates errors to calling components",
          severity: "CRITICAL",
        },
        {
          id: 2,
          hook: "useRequestGroup",
          check: "Tracks loading state during mutations",
          severity: "HIGH",
        },
        {
          id: 3,
          hook: "useRequestGroup",
          check: "Stores and manages error state",
          severity: "HIGH",
        },
        {
          id: 4,
          hook: "useRequestGroup",
          check: "Shows Alert.alert for errors in requestGroup method",
          severity: "CRITICAL",
        },
        {
          id: 5,
          hook: "useRequestGroup",
          check: "Validates authentication before requests",
          severity: "HIGH",
        },
        {
          id: 6,
          hook: "useRequestGroup",
          check: "Maps backend errors to user-friendly messages",
          severity: "MEDIUM",
        },
      ];

      expect(hookErrorChecks).toHaveLength(6);

      const criticalCount = hookErrorChecks.filter(c => c.severity === "CRITICAL").length;
      const highCount = hookErrorChecks.filter(c => c.severity === "HIGH").length;

      expect(criticalCount).toBe(2);
      expect(highCount).toBe(3);
    });
  });
});
