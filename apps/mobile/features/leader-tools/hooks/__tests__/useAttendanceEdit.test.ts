/**
 * Tests for useAttendanceEdit hook
 *
 * Specifically tests that attendance is recorded for the correct meeting
 * when there are multiple events on the same day (Issue #303)
 */

import { renderHook, act, waitFor } from "@testing-library/react-native";

// Mock functions - defined before any mock setup
const mockUseQuery = jest.fn();
const mockUseRouter = jest.fn();
const mockUseAuthenticatedMutation = jest.fn();
const mockUseAuth = jest.fn();
const mockUseGroupMembers = jest.fn();

// Mock expo-router
jest.mock("expo-router", () => ({
  useRouter: () => mockUseRouter(),
}));

// Mock Convex hooks
jest.mock("convex/react", () => ({
  useQuery: (...args: any[]) => mockUseQuery(...args),
}));

// Mock the api object
jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      groups: {
        index: {
          getById: "api.functions.groups.index.getById",
        },
      },
      meetings: {
        index: {
          listByGroup: "api.functions.meetings.index.listByGroup",
        },
        attendance: {
          markAttendance: "api.functions.meetings.attendance.markAttendance",
        },
      },
      groupMembers: {
        list: "api.functions.groupMembers.list",
      },
    },
  },
  useQuery: (...args: any[]) => mockUseQuery(...args),
  useAuthenticatedMutation: (...args: any[]) => mockUseAuthenticatedMutation(...args),
  Id: {} as any,
}));

jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock("../useGroupMembers", () => ({
  useGroupMembers: (...args: any[]) => mockUseGroupMembers(...args),
}));

const mockToastError = jest.fn();
jest.mock("@components/ui/Toast", () => ({
  ToastManager: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// Import after mocks
import { useAttendanceEdit } from "../useAttendanceEdit";

describe("useAttendanceEdit", () => {
  const mockRouter = {
    push: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
  };

  const mockMarkAttendance = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRouter.mockReturnValue(mockRouter);
    mockUseAuth.mockReturnValue({ user: { id: "user-123" } });
    mockUseAuthenticatedMutation.mockReturnValue(mockMarkAttendance);
    mockUseGroupMembers.mockReturnValue({
      members: [],
      isLoading: false,
    });
  });

  describe("meeting ID selection (Issue #303)", () => {
    it("should use initialMeetingId when provided instead of searching by date", async () => {
      // Setup: Group data
      mockUseQuery
        .mockReturnValueOnce({
          _id: "group-123",
          name: "Test Group",
          defaultStartTime: "10:00",
        })
        // Meetings data - two meetings on the same day
        .mockReturnValueOnce([
          {
            _id: "meeting-morning",
            scheduledAt: new Date("2024-01-15T10:00:00Z").getTime(),
            title: "Morning Meeting",
            status: "scheduled",
          },
          {
            _id: "meeting-evening",
            scheduledAt: new Date("2024-01-15T19:00:00Z").getTime(),
            title: "Evening Meeting",
            status: "scheduled",
          },
        ]);

      const { result } = renderHook(() =>
        useAttendanceEdit(
          "group-123",
          "2024-01-15T19:00:00Z", // eventDate for evening meeting
          "meeting-evening" // initialMeetingId - THIS IS THE FIX
        )
      );

      await waitFor(() => {
        // The meetingId should be the one we passed, not the first meeting found by date
        expect(result.current.meetingId).toBe("meeting-evening");
      });
    });

    it("should select the CORRECT meeting when multiple events exist on the same day", async () => {
      // This test reproduces the bug: when two events are on the same day,
      // the hook incorrectly picks the first one found instead of the one
      // that matches the event time

      // Setup: Group data
      mockUseQuery
        .mockReturnValueOnce({
          _id: "group-123",
          name: "Test Group",
          defaultStartTime: "10:00",
        })
        // Meetings data - two meetings on the same day with SAME NAME
        .mockReturnValueOnce([
          {
            _id: "meeting-morning",
            scheduledAt: new Date("2024-01-15T10:00:00Z").getTime(),
            title: "Community Meeting", // Same name as evening!
            status: "scheduled",
          },
          {
            _id: "meeting-evening",
            scheduledAt: new Date("2024-01-15T19:00:00Z").getTime(),
            title: "Community Meeting", // Same name as morning!
            status: "scheduled",
          },
        ]);

      // User selected the EVENING meeting (7 PM)
      const { result } = renderHook(() =>
        useAttendanceEdit(
          "group-123",
          "2024-01-15T19:00:00Z", // This is the evening event
          "meeting-evening" // Pass the correct meeting ID
        )
      );

      await waitFor(() => {
        // BUG: Without the fix, this would return "meeting-morning" because
        // the current code just finds the first meeting with a matching DATE
        // and ignores the time component
        expect(result.current.meetingId).toBe("meeting-evening");
      });
    });

    it("should have null meetingId when no initialMeetingId is provided", async () => {
      // Every meeting should have an ID - no fallback to date-based search
      // If no meetingId is provided, it should remain null
      const testDate = new Date();
      testDate.setDate(testDate.getDate() - 1);

      const groupData = {
        _id: "group-123",
        name: "Test Group",
        defaultStartTime: "10:00",
      };

      mockUseQuery.mockImplementation((queryFn: any) => {
        if (queryFn === "api.functions.groups.index.getById") {
          return groupData;
        }
        return undefined;
      });

      const { result } = renderHook(() =>
        useAttendanceEdit(
          "group-123",
          testDate.toISOString(),
          null // No meeting ID provided
        )
      );

      // meetingId should be null - we require explicit meetingId, no fallback
      expect(result.current.meetingId).toBeNull();
    });

    it("should handle date selection while preserving meetingId context", async () => {
      // This test verifies that when a user manually selects a date from the calendar,
      // and there are multiple meetings on that date, the system should handle it gracefully

      mockUseQuery
        .mockReturnValueOnce({
          _id: "group-123",
          name: "Test Group",
        })
        .mockReturnValueOnce([
          {
            _id: "meeting-1",
            scheduledAt: new Date("2024-01-15T10:00:00Z").getTime(),
            title: "Meeting 1",
            status: "scheduled",
          },
        ]);

      const { result } = renderHook(() =>
        useAttendanceEdit("group-123", "2024-01-15T10:00:00Z", "meeting-1")
      );

      await waitFor(() => {
        expect(result.current.meetingId).toBe("meeting-1");
      });

      // Verify handleDateSelect is available
      expect(typeof result.current.handleDateSelect).toBe("function");
    });
  });

  describe("basic functionality", () => {
    it("initializes event date from parameter", async () => {
      mockUseQuery
        .mockReturnValueOnce({
          _id: "group-123",
          name: "Test Group",
        })
        .mockReturnValueOnce([]);

      const { result } = renderHook(() =>
        useAttendanceEdit("group-123", "2024-01-15T10:00:00Z", null)
      );

      await waitFor(() => {
        expect(result.current.eventDate).toBe("2024-01-15T10:00:00Z");
      });
    });
  });

  describe("handleSubmitAttendance date validation", () => {
    beforeEach(() => {
      mockUseGroupMembers.mockReturnValue({
        members: [{ user: { _id: "member-1" } }],
        isLoading: false,
      });
      mockMarkAttendance.mockResolvedValue(undefined);
    });

    it("shows invalid-date toast when eventDate is unparseable", async () => {
      mockUseQuery.mockReturnValue({
        _id: "group-123",
        name: "Test Group",
        defaultStartTime: "10:00",
      });

      const { result } = renderHook(() =>
        useAttendanceEdit("group-123", "not-a-valid-date", "meeting-1")
      );

      await waitFor(() => {
        expect(result.current.eventDate).toBe("not-a-valid-date");
      });

      await act(() => {
        result.current.setAttendanceList(["member-1"]);
      });
      await act(async () => {
        await result.current.handleSubmitAttendance();
      });

      expect(mockToastError).toHaveBeenCalledWith(
        "Invalid event date. Please select a valid date."
      );
      expect(mockMarkAttendance).not.toHaveBeenCalled();
    });

    it("shows future-event toast when eventDate is in the future", async () => {
      const futureIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      mockUseQuery.mockReturnValue({
        _id: "group-123",
        name: "Test Group",
        defaultStartTime: "10:00",
      });

      const { result } = renderHook(() =>
        useAttendanceEdit("group-123", futureIso, "meeting-1")
      );

      await waitFor(() => {
        expect(result.current.eventDate).toBe(futureIso);
      });

      await act(() => {
        result.current.setAttendanceList(["member-1"]);
      });
      await act(async () => {
        await result.current.handleSubmitAttendance();
      });

      expect(mockToastError).toHaveBeenCalledWith(
        "Cannot submit attendance for future events."
      );
      expect(mockMarkAttendance).not.toHaveBeenCalled();
    });
  });
});
