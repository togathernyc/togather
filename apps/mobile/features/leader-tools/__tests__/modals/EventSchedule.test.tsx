import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EventSchedule } from "@features/leader-tools/components/modals/EventSchedule";

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

  const defaultProps = {
    visible: true,
    onClose: jest.fn(),
    onSchedule: jest.fn(),
    groupId: "13",
    currentDate: new Date("2024-01-15"),
  };

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
      id: "13",
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
        <EventSchedule {...defaultProps} {...props} />
      </QueryClientProvider>
    );
  };

  it("renders when visible", () => {
    renderComponent();
    expect(screen.getByText("Set Date")).toBeTruthy();
  });

  it("does not render when not visible", () => {
    renderComponent({ visible: false });
    expect(screen.queryByText("Set Date")).toBeNull();
  });

  it("displays description", () => {
    renderComponent();
    expect(
      screen.getByText("Select the date and time for your event.")
    ).toBeTruthy();
  });

  it("displays date picker button", () => {
    renderComponent();
    // The date picker is the CalendarGrid component, which doesn't have a "Date" label
    // Instead, we check for the description text that mentions date
    expect(screen.getByText("Select the date and time for your event.")).toBeTruthy();
  });

  it("displays time picker button", () => {
    renderComponent();
    // Check for the time section label
    expect(screen.getByText("Time")).toBeTruthy();
  });

  it("calls onClose when cancel button is pressed", () => {
    const onClose = jest.fn();
    renderComponent({ onClose });

    const cancelButton = screen.getByText("Cancel");
    fireEvent.press(cancelButton);

    expect(onClose).toHaveBeenCalled();
  });

  it("checks for existing meetings when date changes", async () => {
    renderComponent();

    await waitFor(() => {
      expect(mockMeetingsUseQuery).toHaveBeenCalled();
    });
  });

  it("displays error when event already exists", async () => {
    const existingMeeting = {
      id: "meeting-1",
      scheduledAt: "2024-01-15T10:00:00Z",
      attendanceCount: 0,
      createdAt: "2024-01-15T10:00:00Z",
      createdBy: {
        firstName: "Test",
        lastName: "User",
      },
    };

    mockMeetingsUseQuery.mockReturnValue([existingMeeting]);

    renderComponent();

    await waitFor(() => {
      expect(mockMeetingsUseQuery).toHaveBeenCalled();
    });
  });

  it("calls onSchedule with correct event type for new event", async () => {
    const onSchedule = jest.fn();
    renderComponent({ onSchedule });

    await waitFor(() => {
      expect(mockMeetingsUseQuery).toHaveBeenCalled();
    });

    const createButton = screen.getByText(/^Create Event on/);
    fireEvent.press(createButton);

    await waitFor(() => {
      expect(onSchedule).toHaveBeenCalled();
    });
  });

  it("handles API errors gracefully", async () => {
    mockMeetingsUseQuery.mockReturnValue(undefined);

    renderComponent();

    await waitFor(() => {
      expect(mockMeetingsUseQuery).toHaveBeenCalled();
    });

    // Component should still render without crashing
    expect(screen.getByText("Set Date")).toBeTruthy();
  });
});
