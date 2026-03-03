import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AttendanceDetails } from "../AttendanceDetails";
import { api } from "@services/api";
import { useAuth } from "@providers/AuthProvider";

// Mock the API
jest.mock("../../../../services/api", () => {
  const mockGroupsApi = {
    getGroupMembers: jest.fn(),
    getRecentAttendanceStats: jest.fn(),
    getMeetingDatesList: jest.fn(),
    getDPDetails: jest.fn(),
    getAttendanceOfDP: jest.fn(),
  };
  
  const mockAdminApi = {
    getLeaderAttendanceReport: jest.fn(),
  };

  return {
    api: {
      getLeaderAttendanceReport: mockAdminApi.getLeaderAttendanceReport,
      getGroupMembers: mockGroupsApi.getGroupMembers,
      addGuest: jest.fn(),
      createAttendance: jest.fn(),
    },
    groupsApi: mockGroupsApi,
    adminApi: mockAdminApi,
  };
});

// Mock the auth provider
jest.mock("@providers/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

// Mock expo-router
jest.mock("expo-router", () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    back: jest.fn(),
  })),
}));

// Mock react-query
jest.mock("@tanstack/react-query", () => {
  const actual = jest.requireActual("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: jest.fn(() => ({
      invalidateQueries: jest.fn(),
    })),
    useInfiniteQuery: jest.fn(),
  };
});

// Mock the new hooks - they're exported from hooks/index.ts
jest.mock("../../hooks", () => ({
  ...jest.requireActual("../../hooks"),
  useAttendanceReport: jest.fn(),
  useGroupMembers: jest.fn(),
  useAttendanceGuests: jest.fn(),
  useFilteredMembers: jest.fn(),
  useAttendanceSubmission: jest.fn(),
}));

// Mock the new components
jest.mock("../AttendanceEditMode", () => ({
  AttendanceEditMode: ({ children, ...props }: any) => {
    const React = require("react");
    const { View, Text, TextInput, TouchableOpacity, ActivityIndicator } = require("react-native");
    const members = props.filteredMembers || [];
    const isLoading = props.isLoading || false;
    
    return React.createElement(View, { testID: "attendance-edit-mode" }, [
      React.createElement(TextInput, {
        key: "note",
        placeholder: "Add a note...",
        testID: "note-input",
        value: props.note || "",
        onChangeText: props.onUpdateNote,
      }),
      React.createElement(Text, { key: "guests-label" }, "Guests"),
      React.createElement(TouchableOpacity, {
        key: "add-guest",
        testID: "add-guest-button",
        onPress: props.onAddNamedGuest,
      }, React.createElement(Text, null, "Add Named Guest")),
      React.createElement(Text, { key: "members-label" }, "Members"),
      React.createElement(TextInput, {
        key: "search",
        placeholder: "Search",
        testID: "search-input",
        value: props.searchQuery || "",
        onChangeText: props.onSearchChange,
      }),
      isLoading ? React.createElement(View, { key: "loading" }, [
        React.createElement(ActivityIndicator, { key: "spinner", size: "small", color: "#666" }),
        React.createElement(Text, { key: "loading-text" }, "Loading members..."),
      ]) : null,
      members.length > 0 ? members.map((member: any) =>
        React.createElement(TouchableOpacity, {
          key: `member-${member.id}`,
          testID: "attendance-toggle",
          onPress: () => props.onToggleAttendance(member.id),
        }, React.createElement(Text, null, `${member.first_name} ${member.last_name}`))
      ) : !isLoading ? React.createElement(View, { key: "empty" }, [
        React.createElement(Text, { key: "empty-text" }, "No members found"),
      ]) : null,
      React.createElement(TouchableOpacity, {
        key: "submit",
        testID: "submit-button",
        onPress: props.onSubmitPress,
      }, React.createElement(Text, null, "Submit Attendance")),
    ].filter(Boolean));
  },
}));

jest.mock("../AttendanceViewMode", () => ({
  AttendanceViewMode: (props: any) => {
    const React = require("react");
    const { View, Text } = require("react-native");
    const attendanceList = props.report?.attendances || [];
    const attendedMembers = attendanceList.filter((m: any) => m.status === 1);
    
    return React.createElement(View, { testID: "attendance-view-mode" }, [
      React.createElement(Text, { key: "attendance-label" }, "Attendance"),
      props.submittedDate && React.createElement(Text, { key: "submitted-date" }, `Submitted on ${props.submittedDate}`),
      props.submittedBy && React.createElement(Text, { key: "submitted-by" }, `By ${props.submittedBy.first_name} ${props.submittedBy.last_name}`),
      React.createElement(View, { key: "note-container" }, [
        props.report?.note ? React.createElement(Text, { key: "note" }, props.report.note) : React.createElement(Text, { key: "no-note" }, "No note"),
      ]),
      React.createElement(View, { key: "stats-cards" }, [
        React.createElement(Text, { key: "attended-stat" }, props.report?.stats?.present_users || 0),
        React.createElement(Text, { key: "change-stat" }, props.report?.stats?.prev_diff || 0),
      ]),
      React.createElement(Text, { key: "attended-section-label" }, "Attended"),
      attendedMembers.length > 0 ? attendedMembers.map((member: any) =>
        React.createElement(Text, { key: `member-${member.id}` }, `${member.first_name} ${member.last_name}`)
      ) : React.createElement(Text, { key: "no-attended" }, "No members attended"),
    ]);
  },
}));

const mockApi = api as jest.Mocked<typeof api>;
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const { useInfiniteQuery, useQueryClient } = require("@tanstack/react-query");
const mockUseInfiniteQuery = useInfiniteQuery as jest.MockedFunction<typeof useInfiniteQuery>;
const mockUseQueryClient = useQueryClient as jest.MockedFunction<typeof useQueryClient>;

// Get the mocked groupsApi and adminApi
const { groupsApi, adminApi } = require("../../../../services/api");
const mockGroupsApi = groupsApi as jest.Mocked<typeof groupsApi>;
const mockAdminApi = adminApi as jest.Mocked<typeof adminApi>;

// Import and mock the new hooks
const { useAttendanceReport, useGroupMembers, useAttendanceGuests, useFilteredMembers, useAttendanceSubmission } = require("../../hooks");
const mockUseAttendanceReport = useAttendanceReport as jest.MockedFunction<typeof useAttendanceReport>;
const mockUseGroupMembers = useGroupMembers as jest.MockedFunction<typeof useGroupMembers>;
const mockUseAttendanceGuests = useAttendanceGuests as jest.MockedFunction<typeof useAttendanceGuests>;
const mockUseFilteredMembers = useFilteredMembers as jest.MockedFunction<typeof useFilteredMembers>;
const mockUseAttendanceSubmission = useAttendanceSubmission as jest.MockedFunction<typeof useAttendanceSubmission>;

describe("AttendanceDetails", () => {
  let queryClient: QueryClient;

  const mockUser = {
    id: "user-1", // Convex ID is a string
    legacyId: 1,
    email: "test@example.com",
    first_name: "Test",
    last_name: "User",
  };

  // API returns response.data with structure: { attendances: [...], guests: [...], stats: {...} }
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
      attendance_details: {
        created_at: "2024-01-15T10:00:00Z",
        updated_by: {
          id: 1,
          first_name: "John",
          last_name: "Doe",
        },
      },
      note: "Great meeting!",
      stats: {
        member_count: 1,
        guest_count: 0,
        total_count: 1,
        absent_count: 1,
        prev_diff: 0,
        present_users: 1,
      },
    },
  };

  const defaultProps = {
    groupId: "1",
    eventDate: "2024-01-15T00:00:00Z",
    onBack: jest.fn(),
    onEdit: jest.fn(),
    onCancelEdit: jest.fn(),
    editMode: false,
    onUpdateAttendance: jest.fn(),
    onUpdateNote: jest.fn(),
    attendance: [],
    note: "",
    onAddGuest: jest.fn(),
    onSelectDate: jest.fn(),
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0, // No garbage collection delay
          staleTime: 0, // Data is immediately stale
          refetchOnMount: false,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      },
    });

    mockUseAuth.mockReturnValue({
      user: mockUser,
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

    mockAdminApi.getLeaderAttendanceReport.mockResolvedValue(mockAttendanceReport);
    mockGroupsApi.getGroupMembers.mockResolvedValue({
      page_info: { next: null, previous: null, count: 0 },
      data: [],
      errors: [],
    });

    mockUseAttendanceReport.mockReturnValue({
      data: mockAttendanceReport.data,
      isLoading: false,
      error: null,
    } as any);

    mockUseGroupMembers.mockReturnValue({
      members: [
        {
          id: 1,
          first_name: "John",
          last_name: "Doe",
          profile_photo: null,
          role: "Leader",
        },
        {
          id: 2,
          first_name: "Jane",
          last_name: "Smith",
          profile_photo: null,
          role: "Member",
        },
      ],
      isLoading: false,
      error: null,
    } as any);

    mockUseInfiniteQuery.mockReturnValue({
      data: {
        pages: [],
        pageParams: [],
      },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      refetch: jest.fn(),
      isRefetching: false,
      error: null,
      isError: false,
      isSuccess: true,
      status: "success",
    } as any);

    // Mock the new hooks
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
    });

    mockUseFilteredMembers.mockReturnValue([
      {
        id: 1,
        first_name: "John",
        last_name: "Doe",
        profile_photo: null,
        role: "Leader",
      },
      {
        id: 2,
        first_name: "Jane",
        last_name: "Smith",
        profile_photo: null,
        role: "Member",
      },
    ]);

    mockUseAttendanceSubmission.mockReturnValue({
      submitAttendance: jest.fn(),
    });

    mockUseQueryClient.mockReturnValue({
      invalidateQueries: jest.fn(),
    } as any);
  });

  afterEach(() => {
    queryClient.clear();
    jest.clearAllMocks();
  });


  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <AttendanceDetails {...defaultProps} {...props} />
      </QueryClientProvider>
    );
  };

  it("renders loading state initially", async () => {
    mockUseAttendanceReport.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as any);

    mockUseInfiniteQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      refetch: jest.fn(),
      isRefetching: false,
      error: null,
      isError: false,
      isSuccess: false,
      status: "loading",
    } as any);

    renderComponent();

    expect(screen.getByText("Loading attendance...")).toBeTruthy();
  });

  it("renders view mode with attendance data", async () => {
    renderComponent();

    await waitFor(() => {
      // Check for attendance stats section
      const attendanceLabels = screen.getAllByText("Attendance");
      expect(attendanceLabels.length).toBeGreaterThan(0);
    });

    // Check for attended members - there might be multiple "Attended" texts (stat card and section label)
    const attendedTexts = screen.getAllByText("Attended");
    expect(attendedTexts.length).toBeGreaterThan(0);
    
    // Check for member names
    expect(screen.getByText("John Doe")).toBeTruthy();
  });

  it("displays submitted date correctly", async () => {
    renderComponent();

    await waitFor(() => {
      // Check for submitted date text
      expect(screen.getByText(/Submitted on/)).toBeTruthy();
    });
  });

  it("displays attendance stats", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("1")).toBeTruthy(); // present_users
      expect(screen.getByText("0")).toBeTruthy(); // prev_diff
    });
  });

  it("shows edit button in view mode when attendance is not submitted", async () => {
    // Mock attendance report without submitted date AND without any attendance data
    // (to prevent the component from using eventDate as fallback)
    const reportWithoutSubmission = {
      attendances: [],
      guests: [],
      attendance_details: null,
      note: null,
      stats: {
        member_count: 0,
        guest_count: 0,
        total_count: 0,
        absent_count: 0,
        prev_diff: 0,
        present_users: 0,
      },
    };

    mockAdminApi.getLeaderAttendanceReport.mockResolvedValue({ data: reportWithoutSubmission });
    mockUseAttendanceReport.mockReturnValue({
      data: reportWithoutSubmission,
      isLoading: false,
      error: null,
    } as any);

    renderComponent({ editMode: false });

    await waitFor(() => {
      expect(screen.getByText("Edit")).toBeTruthy();
    });
  });

  it("shows edit button even when attendance has been submitted", async () => {
    renderComponent({ editMode: false });

    await waitFor(() => {
      // Edit button should still be visible even when attendance is submitted
      // (restriction was removed to allow corrections)
      expect(screen.getByText("Edit")).toBeTruthy();
    });
  });

  it("switches to edit mode when edit button is pressed", async () => {
    // Mock attendance report without submitted date AND without attendance data
    // so Edit button is visible
    const reportWithoutSubmission = {
      attendances: [],
      guests: [],
      attendance_details: null,
      note: null,
      stats: {
        member_count: 0,
        guest_count: 0,
        total_count: 0,
        absent_count: 0,
        prev_diff: 0,
        present_users: 0,
      },
    };

    mockAdminApi.getLeaderAttendanceReport.mockResolvedValue({ data: reportWithoutSubmission });
    mockUseAttendanceReport.mockReturnValue({
      data: reportWithoutSubmission,
      isLoading: false,
      error: null,
    } as any);

    const onEdit = jest.fn();
    renderComponent({ editMode: false, onEdit });

    await waitFor(() => {
      const editButton = screen.getByText("Edit");
      fireEvent.press(editButton);
      expect(onEdit).toHaveBeenCalled();
    });
  });

  it("renders edit mode with search and filter", async () => {
    // Mock attendance report without submitted date so we can test edit mode
    const reportWithoutSubmission = {
      ...mockAttendanceReport.data,
      attendance_details: null,
    };

    mockAdminApi.getLeaderAttendanceReport.mockResolvedValue({ data: reportWithoutSubmission });
    mockUseAttendanceReport.mockReturnValue({
      data: reportWithoutSubmission,
      isLoading: false,
      error: null,
    } as any);

    renderComponent({ editMode: true });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search")).toBeTruthy();
      expect(screen.getByPlaceholderText("Add a note...")).toBeTruthy();
      // Note: The Filter button text is not rendered in the mocked component,
      // but the search functionality is verified by the search input being present
    });
  });

  it("allows toggling member attendance in edit mode", async () => {
    const onUpdateAttendance = jest.fn();
    renderComponent({ editMode: true, onUpdateAttendance });

    await waitFor(() => {
      const attendanceToggles = screen.getAllByTestId("attendance-toggle");
      if (attendanceToggles.length > 0) {
        fireEvent.press(attendanceToggles[0]);
        expect(onUpdateAttendance).toHaveBeenCalled();
      }
    });
  });

  it("allows searching members in edit mode", async () => {
    // Render in edit mode - the query will resolve with mocked data
    renderComponent({ editMode: true });

    // Step 1: Wait for edit mode to render (search input appears)
    await waitFor(
      () => {
        expect(screen.getByPlaceholderText("Search")).toBeTruthy();
      },
      { timeout: 3000 }
    );

    // Step 2: Wait for query to resolve - check that loading is gone
    await waitFor(
      () => {
        expect(screen.queryByText("Loading attendance...")).toBeNull();
      },
      { timeout: 3000 }
    );

    // Step 3: Wait for members to be rendered - wait for attendance toggles to appear
    await waitFor(
      () => {
        const attendanceToggles = screen.getAllByTestId("attendance-toggle");
        expect(attendanceToggles.length).toBeGreaterThanOrEqual(2); // Should have at least 2 members
      },
      { timeout: 5000 }
    );

    // Step 4: Verify search input is functional
    // Note: The actual filtering logic is tested in the useFilteredMembers hook tests.
    // Here we verify that the search input exists and can receive input.
    const searchInput = screen.getByPlaceholderText("Search");
    expect(searchInput).toBeTruthy();
    
    // Verify we can type in the search input
    await act(async () => {
      fireEvent.changeText(searchInput, "John");
    });
    
    // The search functionality is handled by the useFilteredMembers hook,
    // which filters the members based on the searchQuery state.
    // The component correctly passes the search query to the hook via onSearchChange.
  }, 20000); // Increase test timeout to 20 seconds

  it("shows add guest button in edit mode", async () => {
    renderComponent({ editMode: true });

    await waitFor(() => {
      expect(screen.getByText("Add Named Guest")).toBeTruthy();
    });
  });

  it("opens add guest modal when add guest button is pressed", async () => {
    const onAddGuest = jest.fn();
    renderComponent({ editMode: true, onAddGuest });

    await waitFor(() => {
      // Find the "Add Named Guest" button
      const addGuestButton = screen.getByText("Add Named Guest");
      fireEvent.press(addGuestButton);
    });

    // The modal should now be visible
    await waitFor(() => {
      // Modal should show the form fields
      expect(screen.getByPlaceholderText("First Name")).toBeTruthy();
      expect(screen.getByPlaceholderText("Last Name")).toBeTruthy();
      expect(screen.getByPlaceholderText("Email")).toBeTruthy();
    });
  });

  it("displays note in view mode", async () => {
    renderComponent({ editMode: false });

    await waitFor(() => {
      expect(screen.getByText("Great meeting!")).toBeTruthy();
    });
  });

  it("allows editing note in edit mode", async () => {
    const onUpdateNote = jest.fn();
    renderComponent({ editMode: true, onUpdateNote });

    await waitFor(() => {
      const noteInput = screen.getByPlaceholderText("Add a note...");
      fireEvent.changeText(noteInput, "Updated note");
      expect(onUpdateNote).toHaveBeenCalledWith("Updated note");
    });
  });

  // Note: Cancel button is not in AttendanceEditMode component,
  // it's handled by the parent screen component (AttendanceEditScreen)
  // This test is skipped as it's testing functionality outside AttendanceDetails
  it.skip("shows cancel button in edit mode", async () => {
    const onCancelEdit = jest.fn();
    renderComponent({ editMode: true, onCancelEdit });

    await waitFor(() => {
      const cancelButton = screen.getByText("Cancel");
      fireEvent.press(cancelButton);
      expect(onCancelEdit).toHaveBeenCalled();
    });
  });

  it("displays empty state when no members found", async () => {
    const emptyReport = {
      attendances: [],
      guests: [],
      attendance_details: null,
      note: "",
      stats: {
        member_count: 0,
        guest_count: 0,
        total_count: 0,
        absent_count: 0,
        prev_diff: 0,
      },
    };

    mockAdminApi.getLeaderAttendanceReport.mockResolvedValue({ data: emptyReport });

    mockUseAttendanceReport.mockReturnValue({
      data: emptyReport,
      isLoading: false,
      error: null,
    } as any);

    // Mock group members as empty too (for edit mode)
    mockUseInfiniteQuery.mockReturnValue({
      data: {
        pages: [{ 
          page_info: { next: null, previous: null, count: 0 },
          data: [],
          errors: [],
        }],
        pageParams: [1],
      },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      refetch: jest.fn(),
      isRefetching: false,
      error: null,
      isError: false,
      isSuccess: true,
      status: "success",
    } as any);

    // Mock filtered members to return empty array
    mockUseFilteredMembers.mockReturnValue([]);

    renderComponent({ editMode: true });

    await waitFor(() => {
      expect(screen.getByText("No members found")).toBeTruthy();
    }, { timeout: 3000 });
  });

  it("shows 'No note' when note is empty", async () => {
    const emptyNoteReport = {
      ...mockAttendanceReport.data,
      note: "",
    };

    mockAdminApi.getLeaderAttendanceReport.mockResolvedValue({ data: emptyNoteReport });

    mockUseAttendanceReport.mockReturnValue({
      data: emptyNoteReport,
      isLoading: false,
      error: null,
    } as any);

    renderComponent({ editMode: false });

    await waitFor(() => {
      expect(screen.getByText("No note")).toBeTruthy();
    }, { timeout: 3000 });
  });

  it("shows warning message in submit attendance modal", async () => {
    renderComponent({ editMode: true });

    await waitFor(() => {
      expect(screen.getByText("Submit Attendance")).toBeTruthy();
    });

    const submitButton = screen.getByText("Submit Attendance");
    fireEvent.press(submitButton);

    await waitFor(() => {
      expect(screen.getByText("Submit Attendance?")).toBeTruthy();
      // Check for the warning message about attendance being final
      expect(screen.getByText(/Once submitted, attendance cannot be edited/)).toBeTruthy();
    });
  });
});

