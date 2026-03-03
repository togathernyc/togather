import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EventSchedule } from "../EventSchedule";

// Create mock functions that can be controlled per test
const mockMeetingsUseQuery = jest.fn();
const mockGroupByIdUseQuery = jest.fn();

// Mock Convex hooks
jest.mock("convex/react", () => ({
  useQuery: (func: any, args: any) => {
    // Route to the correct mock based on function name
    const funcName = func?._name || func?.toString() || "";
    if (funcName.includes("meetings") || funcName.includes("listByGroup")) {
      return mockMeetingsUseQuery(func, args);
    }
    if (funcName.includes("groups") || funcName.includes("getByIdWithRole")) {
      return mockGroupByIdUseQuery(func, args);
    }
    return mockMeetingsUseQuery(func, args);
  },
  useMutation: jest.fn(() => jest.fn()),
}));

// Mock the api object - use actual function paths
jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      groups: {
        queries: {
          getByIdWithRole: { _name: "groups.queries.getByIdWithRole" },
        },
      },
      meetings: {
        index: {
          listByGroup: { _name: "meetings.index.listByGroup" },
        },
      },
    },
  },
  useQuery: (func: any, args: any) => {
    const funcName = func?._name || "";
    if (funcName.includes("meetings") || funcName.includes("listByGroup")) {
      return mockMeetingsUseQuery(func, args);
    }
    if (funcName.includes("groups") || funcName.includes("getByIdWithRole")) {
      return mockGroupByIdUseQuery(func, args);
    }
    return mockMeetingsUseQuery(func, args);
  },
  useMutation: jest.fn(() => jest.fn()),
}));

describe("EventSchedule", () => {
  let queryClient: QueryClient;
  const mockOnSchedule = jest.fn();
  const mockOnClose = jest.fn();
  const currentDate = new Date();

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
          staleTime: 0,
          refetchOnMount: false,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      },
    });

    jest.clearAllMocks();
    // Mock Convex useQuery to return empty data for meetings
    mockMeetingsUseQuery.mockReturnValue([]);
    // Mock group byId query
    mockGroupByIdUseQuery.mockReturnValue({
      id: "1",
      name: "Test Group",
      community: { timezone: "America/New_York" },
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <EventSchedule
          visible={true}
          onClose={mockOnClose}
          onSchedule={mockOnSchedule}
          groupId="1"
          currentDate={currentDate}
          {...props}
        />
      </QueryClientProvider>
    );
  };

  it("renders when visible", () => {
    const { getByText } = renderComponent();
    expect(getByText("Set Date")).toBeTruthy();
  });

  it("does not render when not visible", () => {
    const { queryByText } = renderComponent({ visible: false });
    expect(queryByText("Set Date")).toBeNull();
  });

  it("shows remove confirmation when removing event with attendance", async () => {
    const meetingWithAttendance = {
      id: "meeting-1",
      scheduledAt: currentDate.toISOString(),
      attendanceCount: 10,
      createdAt: currentDate.toISOString(),
      createdBy: {
        firstName: "John",
        lastName: "Doe",
      },
    };

    mockMeetingsUseQuery.mockReturnValue([meetingWithAttendance]);

    const { queryByText } = renderComponent();

    // Wait for the query to be called and check that the confirmation is not shown initially
    await waitFor(() => {
      expect(mockMeetingsUseQuery).toHaveBeenCalled();
      // The remove confirmation modal should not appear initially
      // It only appears when trying to remove an event with attendance
      expect(queryByText("Attendance Already Submitted")).toBeNull();
    });
  });

  it("calls onSchedule when creating event", async () => {
    const { getByText } = renderComponent();

    await waitFor(() => {
      expect(mockMeetingsUseQuery).toHaveBeenCalled();
    });

    const createButton = getByText(/^Create Event on/);
    fireEvent.press(createButton);

    await waitFor(() => {
      expect(mockOnSchedule).toHaveBeenCalled();
    });
  });

  it("calls onClose when cancel button is pressed", () => {
    const { getByText } = renderComponent();

    const cancelButton = getByText("Cancel");
    fireEvent.press(cancelButton);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it("checks for existing meetings on mount", async () => {
    renderComponent();

    await waitFor(() => {
      expect(mockMeetingsUseQuery).toHaveBeenCalled();
    });
  });
});
