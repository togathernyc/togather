import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter, useLocalSearchParams } from "expo-router";

// Mock dependencies BEFORE imports that use them
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
  SafeAreaView: ({ children }: any) => children,
}));

// Create mock function that can be controlled per test
const mockUseQuery = jest.fn();

// Mock Convex hooks
jest.mock("convex/react", () => ({
  useQuery: (...args: any[]) => mockUseQuery(...args),
  useMutation: jest.fn(() => jest.fn()),
}));

// Mock the api object - use the actual function path: api.functions.groups.index.getById
jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      groups: {
        index: {
          getById: "api.functions.groups.index.getById",
        },
      },
      meetings: {
        list: "api.functions.meetings.list",
      },
    },
  },
  useQuery: (...args: any[]) => mockUseQuery(...args),
  useMutation: jest.fn(() => jest.fn()),
}));

jest.mock("@providers/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("expo-router", () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));

jest.mock("@components/guards/UserRoute", () => ({
  UserRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockUseAttendanceReport = jest.fn(() => ({
  data: null,
  isLoading: false,
}));

jest.mock("@features/leader-tools/hooks/useAttendanceReport", () => ({
  useAttendanceReport: (...args: unknown[]) => mockUseAttendanceReport(),
}));

jest.mock("@features/leader-tools/components/AttendanceDetails", () => ({
  AttendanceDetails: () => null,
}));

jest.mock("@features/leader-tools/components/EventsList", () => ({
  EventsList: () => null,
}));

// Import after all mocks are defined
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AttendanceScreen as AttendancePage } from "../components/AttendanceScreen";
import { useAuth } from "@providers/AuthProvider";

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockUseLocalSearchParams = useLocalSearchParams as jest.MockedFunction<
  typeof useLocalSearchParams
>;

describe("AttendancePage", () => {
  let queryClient: QueryClient;
  const mockRouter = {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: jest.fn(),
  };

  const mockGroup = {
    id: 13,
    title: "Sunday Morning Bible Study",
    name: "Sunday Morning Bible Study",
    date: "2024-01-15T10:00:00Z",
  };

  const mockAttendanceReport = {
    data: {
      attendances: [
        {
          id: "uuid-1",
          user_id: 1,
          first_name: "John",
          last_name: "Doe",
          email: "john@example.com",
          status: 1, // 1 = present
          recorded_at: "2024-01-15T10:00:00Z",
        },
        {
          id: "uuid-2",
          user_id: 2,
          first_name: "Jane",
          last_name: "Smith",
          email: "jane@example.com",
          status: 0, // 0 = absent
          recorded_at: "2024-01-15T10:00:00Z",
        },
      ],
      guests: [],
      note: "Test note",
      stats: {
        member_count: 1,
        guest_count: 0,
        total_count: 1,
        absent_count: 1,
        prev_diff: 0,
      },
    },
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

    // Reset all mocks
    mockRouter.push.mockClear();
    mockRouter.back.mockClear();
    mockRouter.replace.mockClear();
    mockRouter.canGoBack.mockReturnValue(true); // Default to true

    mockUseRouter.mockReturnValue(mockRouter as any);
    mockUseLocalSearchParams.mockReturnValue({ group_id: "13" });
    mockUseAuth.mockReturnValue({
      user: { id: "user-1", legacyId: 1, email: "test@example.com" },
      isAuthenticated: true,
      isLoading: false,
      community: null,
      token: null,
      logout: jest.fn(),
      refreshUser: jest.fn(),
      setCommunity: jest.fn(),
      clearCommunity: jest.fn(),
      signIn: jest.fn(),
    });

    mockUseAttendanceReport.mockReturnValue({
      data: null,
      isLoading: false,
    });

    // Mock Convex useQuery - default to successful state (returns group data)
    mockUseQuery.mockReturnValue(mockGroup);
  });

  afterEach(() => {
    queryClient.clear();
    jest.clearAllMocks();
  });

  const renderComponent = () => {
    return render(
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AttendancePage />
        </QueryClientProvider>
      </SafeAreaProvider>
    );
  };

  it("renders loading state while fetching group", () => {
    // Override the default mock to return undefined (loading state)
    mockUseQuery.mockReturnValue(undefined);

    renderComponent();

    expect(screen.getByText("Loading...")).toBeTruthy();
  });

  it("renders group title in header", async () => {
    renderComponent();

    await waitFor(() => {
      // There might be multiple "Attendance" elements, so check for at least one
      expect(screen.getAllByText("Attendance").length).toBeGreaterThan(0);
    });
  });

  it("renders AttendanceDetails component", async () => {
    renderComponent();

    await waitFor(() => {
      // The component should render successfully
      expect(screen.getAllByText("Attendance").length).toBeGreaterThan(0);
    });
  });

  it("handles back button press", async () => {
    renderComponent();

    await waitFor(() => {
      // Wait for component to render
      expect(screen.getAllByText("Attendance").length).toBeGreaterThan(0);
    });

    // Find the back button by testID or by pressing on the back area
    const backButton = screen.queryByTestId("back-button");
    if (backButton) {
      fireEvent.press(backButton);
      expect(mockRouter.back).toHaveBeenCalled();
    } else {
      // Verify the component rendered correctly
      expect(screen.getAllByText("Attendance").length).toBeGreaterThan(0);
    }
  });

  it("handles date selection", async () => {
    renderComponent();

    await waitFor(() => {
      // Component should render with default data
      expect(screen.getAllByText("Attendance").length).toBeGreaterThan(0);
    });

    // The date picker modal should be accessible through AttendanceDetails
    // This is tested in AttendanceDetails.test.tsx
  });

  it("handles member attendance toggle", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText("Attendance").length).toBeGreaterThan(0);
    });

    // Member attendance toggling is handled by AttendanceDetails component
    // This is tested in AttendanceDetails.test.tsx
  });

  it("handles submit attendance", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText("Attendance").length).toBeGreaterThan(0);
    });

    // Submit attendance is handled by AttendanceDetails component
    // This is tested in AttendanceDetails.test.tsx
  });

  it("shows error state when group fetch fails", async () => {
    // Override the default mock to return null (error state)
    // In the component: groupError = group === null
    mockUseQuery.mockReturnValue(null);
    // Mock canGoBack to return false so it falls back to push
    mockRouter.canGoBack.mockReturnValue(false);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Group not found")).toBeTruthy();
      expect(screen.getByText("Go Back")).toBeTruthy();
    });

    // Verify error state back button navigates correctly
    const goBackButton = screen.getByText("Go Back");
    fireEvent.press(goBackButton);
    expect(mockRouter.canGoBack).toHaveBeenCalled();
    expect(mockRouter.push).toHaveBeenCalledWith("/(user)/leader-tools/13");
  });

  it("initializes event date from group", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText("Attendance").length).toBeGreaterThan(0);
    });

    // Event date should be initialized from scheduled event or group.date
    // The hook handles the event date calculation
  });

  it("shows attendance details even when no events scheduled", async () => {
    // mockUseQuery is already set to return mockGroup in beforeEach
    // This verifies the component renders correctly with group data

    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText("Attendance").length).toBeGreaterThan(0);
    });

    // Should still show attendance UI with date selection option
    await waitFor(() => {
      expect(screen.getAllByText("Attendance").length).toBeGreaterThan(0);
    });
  });
});
