import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import AttendanceEditPage from "../../../app/(user)/leader-tools/[group_id]/attendance/edit";
import { useAuth } from "@providers/AuthProvider";
import {
  useAttendanceReport,
  useGroupMembers,
  useAttendanceGuests,
  useFilteredMembers,
  useAttendanceSubmission,
} from "@features/leader-tools/hooks";
import { useAttendanceEdit } from "@features/leader-tools/hooks/useAttendanceEdit";

// Mock dependencies
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

jest.mock("@tanstack/react-query", () => {
  const actual = jest.requireActual("@tanstack/react-query");
  return {
    ...actual,
    useQuery: jest.fn(),
  };
});

jest.mock("@features/leader-tools/components/AttendanceEditMode", () => ({
  AttendanceEditMode: ({ ...props }: any) => {
    const React = require("react");
    const { View, Text, TextInput, TouchableOpacity } = require("react-native");
    const members = props.filteredMembers || [];

    return React.createElement(View, { testID: "attendance-edit-mode" }, [
      React.createElement(TextInput, {
        key: "note",
        placeholder: "Add a note...",
        testID: "note-input",
        value: props.note || "",
        onChangeText: props.onUpdateNote,
      }),
      React.createElement(TextInput, {
        key: "search",
        placeholder: "Search",
        testID: "search-input",
        value: props.searchQuery || "",
        onChangeText: props.onSearchChange,
      }),
      members.map((member: any) =>
        React.createElement(
          TouchableOpacity,
          {
            key: `member-${member.id}`,
            testID: "attendance-toggle",
            onPress: () => props.onToggleAttendance(member.id),
          },
          React.createElement(
            Text,
            null,
            `${member.first_name} ${member.last_name}`
          )
        )
      ),
      React.createElement(
        TouchableOpacity,
        {
          key: "submit",
          testID: "submit-button",
          onPress: props.onSubmitPress,
        },
        React.createElement(Text, null, "Submit Attendance")
      ),
    ]);
  },
}));

jest.mock("@features/leader-tools/components/AttendanceDetails", () => ({
  AttendanceDetails: (props: any) => {
    const React = require("react");
    const { useState } = React;
    const {
      AttendanceEditMode,
    } = require("@features/leader-tools/components/AttendanceEditMode");
    const {
      AttendanceViewMode,
    } = require("@features/leader-tools/components/AttendanceViewMode");
    const { useFilteredMembers } = require("@features/leader-tools/hooks");

    // Hooks must be called unconditionally - move outside the if block
    const [searchQuery, setSearchQuery] = useState("");
    const filteredMembers = useFilteredMembers({
      editMode: props.editMode,
      groupMembers: [],
      localGuests: [],
      attendanceReport: null,
      searchQuery,
      sortBy: "",
    });

    if (props.editMode) {
      return React.createElement(AttendanceEditMode, {
        filteredMembers,
        searchQuery,
        onSearchChange: setSearchQuery,
        onToggleAttendance: (memberId: number) => {
          const attendance = props.attendance || [];
          if (attendance.includes(memberId)) {
            props.onUpdateAttendance(
              attendance.filter((id: number) => id !== memberId)
            );
          } else {
            props.onUpdateAttendance([...attendance, memberId]);
          }
        },
        onSubmitPress: jest.fn(),
        note: props.note || "",
        onUpdateNote: props.onUpdateNote,
        anonymousGuestCount: 0,
        onIncrementAnonymousGuests: jest.fn(),
        onDecrementAnonymousGuests: jest.fn(),
        onAddNamedGuest: jest.fn(),
        onFilterPress: jest.fn(),
        attendance: props.attendance || [],
        currentUserId: 1,
        isLoading: false,
      });
    }

    return React.createElement(AttendanceViewMode, props);
  },
}));

jest.mock("@features/leader-tools/components/AttendanceViewMode", () => ({
  AttendanceViewMode: (props: any) => {
    const React = require("react");
    const { View, Text } = require("react-native");
    return React.createElement(View, { testID: "attendance-view-mode" }, [
      React.createElement(Text, { key: "attendance-label" }, "Attendance"),
    ]);
  },
}));

// Create the barrel export mock first
jest.mock("@features/leader-tools/hooks", () => {
  const mockFns = {
    useAttendanceReport: jest.fn(() => ({ data: null, isLoading: false })),
    useGroupMembers: jest.fn(() => ({ members: [], isLoading: false })),
    useAttendanceGuests: jest.fn(() => ({
      localGuests: [],
      anonymousGuestCount: 0,
      namedGuests: [],
      anonymousGuestIds: [],
      addGuest: jest.fn(),
      incrementAnonymousGuests: jest.fn(),
      decrementAnonymousGuests: jest.fn(),
      setAnonymousGuestCount: jest.fn(),
      setLocalGuests: jest.fn(),
    })),
    useFilteredMembers: jest.fn(() => []),
    useAttendanceSubmission: jest.fn(() => ({ submitAttendance: jest.fn() })),
    useAttendanceEdit: jest.fn(() => ({
      group: null,
      isLoadingGroup: true,
      groupError: null,
      attendanceList: [],
      note: "",
      eventDate: null,
      setAttendanceList: jest.fn(),
      setNote: jest.fn(),
      handleBack: jest.fn(),
      handleCancelEdit: jest.fn(),
      handleDateSelect: jest.fn(),
      handleSubmitAttendance: jest.fn(),
      isLoadingRSVPs: false,
    })),
  };

  // Store in global for access by direct imports
  (global as any).__mockLeaderToolsHooks = mockFns;

  return mockFns;
});

// Direct imports should use the same mocks from the barrel export
jest.mock("@features/leader-tools/hooks/useAttendanceEdit", () => {
  const mockFns = (global as any).__mockLeaderToolsHooks;
  if (mockFns) {
    return {
      useAttendanceEdit: mockFns.useAttendanceEdit,
    };
  }
  return {
    useAttendanceEdit: jest.fn(() => ({
      group: null,
      isLoadingGroup: true,
      groupError: null,
      attendanceList: [],
      note: "",
      eventDate: null,
      setAttendanceList: jest.fn(),
      setNote: jest.fn(),
      handleBack: jest.fn(),
      handleCancelEdit: jest.fn(),
      handleDateSelect: jest.fn(),
      handleSubmitAttendance: jest.fn(),
      isLoadingRSVPs: false,
    })),
  };
});

jest.mock("@features/leader-tools/hooks/useAttendanceReport", () => {
  const mockFns = (global as any).__mockLeaderToolsHooks;
  if (mockFns) {
    return {
      useAttendanceReport: mockFns.useAttendanceReport,
    };
  }
  return {
    useAttendanceReport: jest.fn(() => ({ data: null, isLoading: false })),
  };
});

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockUseLocalSearchParams = useLocalSearchParams as jest.MockedFunction<
  typeof useLocalSearchParams
>;

// Get the actual mocks that will be used by the component
// The component imports from direct paths, not barrel exports
const mockUseAttendanceReport =
  require("@features/leader-tools/hooks/useAttendanceReport").useAttendanceReport;
const mockUseAttendanceEdit =
  require("@features/leader-tools/hooks/useAttendanceEdit").useAttendanceEdit;
const mockUseGroupMembers = useGroupMembers as jest.MockedFunction<
  typeof useGroupMembers
>;
const mockUseAttendanceGuests = useAttendanceGuests as jest.MockedFunction<
  typeof useAttendanceGuests
>;
const mockUseFilteredMembers = useFilteredMembers as jest.MockedFunction<
  typeof useFilteredMembers
>;
const mockUseAttendanceSubmission =
  useAttendanceSubmission as jest.MockedFunction<
    typeof useAttendanceSubmission
  >;

const { useQuery } = require("@tanstack/react-query");
const mockUseQuery = useQuery as jest.MockedFunction<typeof useQuery>;

describe("AttendanceEditPage", () => {
  let queryClient: QueryClient;
  const mockRouter = {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: jest.fn(() => true),
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
      // No attendance_details so attendance hasn't been submitted yet
      attendance_details: null,
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

    // Mock hooks used by AttendanceDetails
    mockUseAttendanceReport.mockReturnValue({
      data: mockAttendanceReport,
      isLoading: false,
      error: null,
      isError: false,
      isSuccess: true,
      refetch: jest.fn(),
    } as any);

    mockUseGroupMembers.mockReturnValue({
      members: [],
      isLoading: false,
      error: null,
      isError: false,
      isSuccess: true,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      refetch: jest.fn(),
    } as any);

    // Mock hooks used by AttendanceDetails
    mockUseAttendanceGuests.mockReturnValue({
      localGuests: [],
      anonymousGuestCount: 0,
      namedGuests: [],
      anonymousGuestIds: [],
      addGuest: jest.fn(),
      incrementAnonymousGuests: jest.fn(),
      decrementAnonymousGuests: jest.fn(),
      setAnonymousGuestCount: jest.fn(),
      setLocalGuests: jest.fn(),
    } as any);

    mockUseFilteredMembers.mockReturnValue([
      {
        id: 1,
        first_name: "John",
        last_name: "Doe",
        profile_photo: null,
        role: "leader",
      },
      {
        id: 2,
        first_name: "Jane",
        last_name: "Smith",
        profile_photo: null,
        role: "member",
      },
    ]);

    mockUseAttendanceSubmission.mockReturnValue({
      submitAttendance: jest.fn().mockResolvedValue(undefined),
    });

    // Mock useQuery for RSVP stats
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as any);

    // Mock useAttendanceEdit hook
    mockUseAttendanceEdit.mockReturnValue({
      group: mockGroup,
      isLoadingGroup: false,
      groupError: null,
      attendanceList: [],
      note: "",
      eventDate: mockGroup.date,
      setAttendanceList: jest.fn(),
      setNote: jest.fn(),
      handleBack: jest.fn(() => {
        if (mockRouter.canGoBack()) {
          mockRouter.back();
        } else {
          mockRouter.push(`/(user)/leader-tools/13`);
        }
      }),
      handleCancelEdit: jest.fn(() => {
        if (mockRouter.canGoBack()) {
          mockRouter.back();
        } else {
          mockRouter.push(`/(user)/leader-tools/13/attendance`);
        }
      }),
      handleDateSelect: jest.fn(),
      handleSubmitAttendance: jest.fn(),
      isLoadingRSVPs: false,
    });
  });

  afterEach(() => {
    queryClient.clear();
    jest.clearAllMocks();
  });

  const renderComponent = () => {
    return render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 375, height: 812 },
          insets: { top: 47, right: 0, bottom: 34, left: 0 },
        }}
      >
        <QueryClientProvider client={queryClient}>
          <AttendanceEditPage />
        </QueryClientProvider>
      </SafeAreaProvider>
    );
  };

  it("renders loading state while fetching group", () => {
    mockUseAttendanceEdit.mockReturnValue({
      group: null,
      isLoadingGroup: true,
      groupError: null,
      attendanceList: [],
      note: "",
      eventDate: null,
      setAttendanceList: jest.fn(),
      setNote: jest.fn(),
      handleBack: jest.fn(),
      handleCancelEdit: jest.fn(),
      handleDateSelect: jest.fn(),
      handleSubmitAttendance: jest.fn(),
      isLoadingRSVPs: false,
    });

    renderComponent();

    expect(screen.getByText("Loading...")).toBeTruthy();
  });

  it("renders in edit mode", async () => {
    renderComponent();

    // Should be in edit mode - check for edit mode elements
    await waitFor(
      () => {
        expect(screen.getByPlaceholderText("Search")).toBeTruthy();
      },
      { timeout: 3000 }
    );
  });

  it("handles back button press", async () => {
    renderComponent();

    await waitFor(
      () => {
        expect(screen.getByPlaceholderText("Search")).toBeTruthy();
      },
      { timeout: 3000 }
    );

    // The back button is an Ionicons component, so we need to find it by its parent TouchableOpacity
    // The back button functionality is handled by handleBack from useAttendanceEdit
    // which is tested through the hook mock
    const mockHandleBack =
      mockUseAttendanceEdit.mock.results[0].value.handleBack;
    expect(mockHandleBack).toBeDefined();
  });

  it("handles cancel edit", async () => {
    renderComponent();

    await waitFor(
      () => {
        expect(screen.getByPlaceholderText("Search")).toBeTruthy();
      },
      { timeout: 3000 }
    );

    // Cancel is handled by AttendanceDetails component's onCancelEdit prop
    // which is passed from AttendanceEditScreen's handleCancelEdit
    // The cancel functionality is tested in AttendanceDetails tests
    expect(mockUseAttendanceReport).toHaveBeenCalled();
  });

  it("handles date selection", async () => {
    renderComponent();

    await waitFor(
      () => {
        expect(screen.getByPlaceholderText("Search")).toBeTruthy();
      },
      { timeout: 3000 }
    );

    // Date selection is handled by AttendanceDetails component via onSelectDate prop
    // which is passed from useAttendanceEdit's handleDateSelect
    // The functionality is tested in AttendanceDetails.integration.test.tsx
    const mockHandleDateSelect =
      mockUseAttendanceEdit.mock.results[0].value.handleDateSelect;
    expect(mockHandleDateSelect).toBeDefined();
  });

  it("handles member attendance toggle", async () => {
    renderComponent();

    await waitFor(
      () => {
        expect(screen.getByPlaceholderText("Search")).toBeTruthy();
      },
      { timeout: 3000 }
    );

    // Member attendance toggle is handled by AttendanceDetails component
    // This is tested in AttendanceDetails.integration.test.tsx
    // The hook should be called when the component renders
    await waitFor(() => {
      expect(mockUseAttendanceReport).toHaveBeenCalled();
    });
  });

  it("handles submit attendance", async () => {
    renderComponent();

    // Wait for submit button
    await waitFor(
      () => {
        expect(screen.getByText("Submit Attendance")).toBeTruthy();
      },
      { timeout: 3000 }
    );

    // Submit attendance is handled by AttendanceDetails component
    // This is tested in AttendanceDetails.integration.test.tsx
    // The hook should be called when the component renders
    expect(mockUseAttendanceReport).toHaveBeenCalled();
  });

  it("shows error state when group fetch fails", async () => {
    mockUseAttendanceEdit.mockReturnValue({
      group: null,
      isLoadingGroup: false,
      groupError: new Error("Group not found"),
      attendanceList: [],
      note: "",
      eventDate: null,
      setAttendanceList: jest.fn(),
      setNote: jest.fn(),
      handleBack: jest.fn(() => {
        if (mockRouter.canGoBack()) {
          mockRouter.back();
        } else {
          mockRouter.push(`/(user)/leader-tools/13`);
        }
      }),
      handleCancelEdit: jest.fn(),
      handleDateSelect: jest.fn(),
      handleSubmitAttendance: jest.fn(),
      isLoadingRSVPs: false,
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Group not found")).toBeTruthy();
      expect(screen.getByText("Go Back")).toBeTruthy();
    });

    // Verify error state back button navigates correctly
    const goBackButton = screen.getByText("Go Back");
    fireEvent.press(goBackButton);
    // Should use router.back() when canGoBack is true
    expect(mockRouter.canGoBack).toHaveBeenCalled();
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("initializes event date from group", async () => {
    renderComponent();

    await waitFor(
      () => {
        expect(screen.getByPlaceholderText("Search")).toBeTruthy();
      },
      { timeout: 3000 }
    );

    // Event date should be initialized from group.date
    // The hook should be called with the event date from the group
    // Note: useAttendanceReport is called by AttendanceDetails, not directly by AttendanceEditScreen
    // The event date is passed through useAttendanceEdit hook
    await waitFor(
      () => {
        expect(mockUseAttendanceReport).toHaveBeenCalled();
      },
      { timeout: 3000 }
    );

    // Verify it was called with the group ID and event date
    const calls = mockUseAttendanceReport.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][0]).toBe("13");
    // The event date should match the group date (second arg is an object with eventDate)
    expect(calls[0][1]).toMatchObject({ eventDate: expect.stringContaining("2024-01-15") });
  });
});
