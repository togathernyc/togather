import React from "react";
import { render, waitFor, fireEvent } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EventDetails } from "../EventDetails";

// Mock expo-router
const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  canGoBack: jest.fn(() => true),
};

jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));

// Mock react-native-safe-area-context
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock useCommunityTheme hook
jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({
    primaryColor: "#6366F1",
    colors: {
      primary: "#6366F1",
    },
  }),
}));

// Mock AuthProvider
jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({
    user: {
      id: "user-123",
      timezone: "America/New_York",
    },
    token: "mock-token",
    isAuthenticated: true,
  }),
}));

// Create mock functions that can be controlled per test
const mockUseQuery = jest.fn();
const mockUseMutation = jest.fn();

// Mock Convex hooks
jest.mock("convex/react", () => ({
  useQuery: (...args: any[]) => mockUseQuery(...args),
  useMutation: (...args: any[]) => mockUseMutation(...args),
}));

// Mock the api object and re-export hooks
jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      meetings: {
        index: {
          getWithDetails: "api.functions.meetings.index.getWithDetails",
        },
        reports: {
          createReport: "api.functions.meetings.reports.createReport",
        },
      },
      meetingRsvps: {
        list: "api.functions.meetingRsvps.list",
        myRsvp: "api.functions.meetingRsvps.myRsvp",
        submit: "api.functions.meetingRsvps.submit",
      },
      eventBlasts: {
        list: "api.functions.eventBlasts.list",
        initiate: "api.functions.eventBlasts.initiate",
      },
    },
  },
  useQuery: (...args: any[]) => mockUseQuery(...args),
  useMutation: (...args: any[]) => mockUseMutation(...args),
  useAuthenticatedMutation: (...args: any[]) => mockUseMutation(...args),
  useAuthenticatedQuery: (...args: any[]) => mockUseQuery(...args),
  useAuthenticatedAction: jest.fn(() => jest.fn()),
}));


describe("EventDetails", () => {
  let queryClient: QueryClient;
  const mockOnBack = jest.fn();
  const mockOnGroupChat = jest.fn();

  // Mock meeting data in Convex format
  const mockMeeting = {
    _id: "meeting-123",
    title: "Weekly Meeting",
    scheduledAt: new Date("2025-11-26T10:00:00Z").getTime(),
    status: "scheduled",
    meetingType: 1,
    meetingLink: null,
    locationOverride: "123 Main St",
    note: "Bring snacks",
    coverImage: null,
    shortId: "abc123",
    rsvpEnabled: false,
    rsvpOptions: [],
    rsvpCounts: { yes: 0, no: 0, maybe: 0 },
    group: {
      _id: "group-13",
      name: "Test Group",
      preview: null,
    },
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    jest.clearAllMocks();

    // Default mock implementation for useQuery based on function name
    mockUseQuery.mockImplementation((func: string, args: any) => {
      // Skip queries return undefined
      if (args === "skip") return undefined;

      // Route to different mocks based on function name
      if (func === "api.functions.meetings.index.getWithDetails") {
        return mockMeeting;
      }
      if (func === "api.functions.meetingRsvps.list") {
        // Return an empty array (iterable) for RSVPs
        return { rsvps: [], total: 0 };
      }
      if (func === "api.functions.meetingRsvps.myRsvp") {
        return null;
      }
      return undefined;
    });

    // Default mock for useMutation
    mockUseMutation.mockReturnValue(jest.fn());
  });

  it("renders event details with meeting title", async () => {
    const eventDate = new Date("2025-11-26T10:00:00Z").toISOString();

    const { getByText } = render(
      <QueryClientProvider client={queryClient}>
        <EventDetails
          groupId="13"
          eventDate={eventDate}
          meetingId="meeting-123"
          onBack={mockOnBack}
          onGroupChat={mockOnGroupChat}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(getByText("Weekly Meeting")).toBeTruthy();
    });
  });

  it("displays loading state while fetching meeting details", () => {
    // Return undefined for getWithDetails to trigger loading state
    mockUseQuery.mockImplementation((func: string, args: any) => {
      if (args === "skip") return undefined;
      if (func === "api.functions.meetings.index.getWithDetails") {
        return undefined; // Still loading
      }
      if (func === "api.functions.meetingRsvps.list") {
        return { rsvps: [], total: 0 };
      }
      if (func === "api.functions.meetingRsvps.myRsvp") {
        return null;
      }
      return undefined;
    });

    const eventDate = new Date("2025-11-26T10:00:00Z").toISOString();

    const { getByText } = render(
      <QueryClientProvider client={queryClient}>
        <EventDetails
          groupId="13"
          eventDate={eventDate}
          meetingId="meeting-123"
          onBack={mockOnBack}
          onGroupChat={mockOnGroupChat}
        />
      </QueryClientProvider>
    );

    expect(getByText("Loading event details...")).toBeTruthy();
  });

  it("calls onBack when back button is pressed", async () => {
    const eventDate = new Date("2025-11-26T10:00:00Z").toISOString();

    const { getByTestId } = render(
      <QueryClientProvider client={queryClient}>
        <EventDetails
          groupId="13"
          eventDate={eventDate}
          meetingId="meeting-123"
          onBack={mockOnBack}
          onGroupChat={mockOnGroupChat}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(getByTestId("back-button")).toBeTruthy();
    });

    fireEvent.press(getByTestId("back-button"));
    expect(mockOnBack).toHaveBeenCalledTimes(1);
  });

  it("shows edit button when isLeader is true and navigates on press", async () => {
    const eventDate = new Date("2025-11-26T10:00:00Z").toISOString();

    const { getByTestId } = render(
      <QueryClientProvider client={queryClient}>
        <EventDetails
          groupId="13"
          eventDate={eventDate}
          meetingId="meeting-123"
          isLeader={true}
          onBack={mockOnBack}
          onGroupChat={mockOnGroupChat}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(getByTestId("edit-button")).toBeTruthy();
    });

    fireEvent.press(getByTestId("edit-button"));

    expect(mockRouter.push).toHaveBeenCalledWith(
      expect.stringContaining("/leader-tools/13/events/")
    );
  });

  it("does not show edit button when isLeader is false", async () => {
    const eventDate = new Date("2025-11-26T10:00:00Z").toISOString();

    const { queryByTestId } = render(
      <QueryClientProvider client={queryClient}>
        <EventDetails
          groupId="13"
          eventDate={eventDate}
          meetingId="meeting-123"
          isLeader={false}
          onBack={mockOnBack}
          onGroupChat={mockOnGroupChat}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(queryByTestId("edit-button")).toBeNull();
    });
  });

  it("handles API error gracefully", async () => {
    // Return undefined for getWithDetails to simulate loading/error state
    mockUseQuery.mockImplementation((func: string, args: any) => {
      if (args === "skip") return undefined;
      if (func === "api.functions.meetings.index.getWithDetails") {
        return undefined;
      }
      if (func === "api.functions.meetingRsvps.list") {
        return { rsvps: [], total: 0 };
      }
      if (func === "api.functions.meetingRsvps.myRsvp") {
        return null;
      }
      return undefined;
    });

    const eventDate = new Date("2025-11-26T10:00:00Z").toISOString();

    const { getByTestId } = render(
      <QueryClientProvider client={queryClient}>
        <EventDetails
          groupId="13"
          eventDate={eventDate}
          meetingId="meeting-123"
          onBack={mockOnBack}
          onGroupChat={mockOnGroupChat}
        />
      </QueryClientProvider>
    );

    // Should still render the back button even on error
    await waitFor(() => {
      expect(getByTestId("back-button")).toBeTruthy();
    });
  });

  it("back button has sufficient touch target size (44x44 minimum)", async () => {
    const eventDate = new Date("2025-11-26T10:00:00Z").toISOString();

    const { getByTestId } = render(
      <QueryClientProvider client={queryClient}>
        <EventDetails
          groupId="13"
          eventDate={eventDate}
          meetingId="meeting-123"
          onBack={mockOnBack}
          onGroupChat={mockOnGroupChat}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(getByTestId("back-button")).toBeTruthy();
    });

    const backButton = getByTestId("back-button");
    const style = backButton.props.style;

    // Check that the button has adequate touch target dimensions
    // The minWidth and minHeight should be at least 44 (iOS Human Interface Guidelines)
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
  });
});
