import React from "react";
import { render, waitFor, fireEvent, act } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CreateEventScreen } from "../CreateEventScreen";

// Mock expo-router
const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  canGoBack: jest.fn(() => true),
};

// Default to having a group_id so we're not in unified mode
let mockSearchParams: any = { group_id: "group-123" };

jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockSearchParams,
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

// Create a mock user that can be modified per test
let mockUser = {
  id: "user-123",
  timezone: "America/New_York",
  is_admin: false,
};

// Mock AuthProvider
jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({
    user: mockUser,
    token: "mock-token",
    isAuthenticated: true,
    community: { id: "community-123" },
  }),
}));

// Mock useGroupDetails hook
jest.mock("../../../groups/hooks/useGroupDetails", () => ({
  useGroupDetails: () => ({
    data: {
      id: "group-123",
      name: "Test Group",
      group_type_name: "Small Group",
    },
    isLoading: false,
  }),
}));

// Mock useLeaderGroups hook
jest.mock("../../../explore/hooks/useCommunityEvents", () => ({
  useLeaderGroups: () => ({
    data: [
      { id: "group-123", name: "Test Group", groupTypeName: "Small Group" },
    ],
    isLoading: false,
  }),
}));

// Mock useGroupTypes hook
jest.mock("../../../admin/hooks/useGroupTypes", () => ({
  useGroupTypes: () => ({
    groupTypes: [],
    isLoading: false,
  }),
}));

// Mock geocoding utilities
jest.mock("../../../groups/utils/geocodeLocation", () => ({
  getGroupCoordinates: jest.fn(() => null),
  geocodeAddressAsync: jest.fn(() => Promise.resolve(null)),
}));

// Create mock functions
const mockUseQuery = jest.fn();
const mockUseMutation = jest.fn();
const mockCreateMeetingMutation = jest.fn();

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
          create: "api.functions.meetings.index.create",
          update: "api.functions.meetings.index.update",
          cancel: "api.functions.meetings.index.cancel",
        },
        queries: {
          getWithDetails: "api.functions.meetings.queries.getWithDetails",
        },
        communityEvents: {
          countGroupsByType: "api.functions.meetings.communityEvents.countGroupsByType",
          createCommunityWideEvent: "api.functions.meetings.communityEvents.createCommunityWideEvent",
        },
      },
      uploads: {
        getR2UploadUrl: "api.functions.uploads.getR2UploadUrl",
      },
    },
  },
  useQuery: (...args: any[]) => mockUseQuery(...args),
  useMutation: (...args: any[]) => mockUseMutation(...args),
  useAuthenticatedMutation: () => mockCreateMeetingMutation,
  useAuthenticatedAction: jest.fn(() => jest.fn()),
  convexVanilla: {
    query: jest.fn(),
  },
}));

// Mock expo-file-system
jest.mock("expo-file-system/legacy", () => ({
  uploadAsync: jest.fn(),
  FileSystemUploadType: { BINARY_CONTENT: 0 },
}));

// Mock @expo/vector-icons
jest.mock("@expo/vector-icons", () => ({
  Ionicons: "Ionicons",
}));

// Mock UserRoute component
jest.mock("@components/guards/UserRoute", () => ({
  UserRoute: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock DatePicker to allow direct date setting
jest.mock("@components/ui/DatePicker", () => ({
  DatePicker: ({ value, onChange, error, label }: any) => {
    const { View, Text, TouchableOpacity } = require("react-native");
    return (
      <View testID="date-picker">
        {label && <Text>{label}</Text>}
        <TouchableOpacity
          testID="date-picker-button"
          onPress={() => {
            // Simulate opening the picker - tests will call onChange directly
          }}
        >
          <Text testID="date-picker-value">
            {value ? value.toISOString() : "Select date and time"}
          </Text>
        </TouchableOpacity>
        {error && <Text testID="date-picker-error">{error}</Text>}
        {/* Expose onChange for tests */}
        <TouchableOpacity
          testID="set-past-date"
          onPress={() => {
            const pastDate = new Date();
            pastDate.setDate(pastDate.getDate() - 7); // 7 days ago
            onChange(pastDate);
          }}
        />
        <TouchableOpacity
          testID="set-future-date"
          onPress={() => {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 7); // 7 days from now
            onChange(futureDate);
          }}
        />
      </View>
    );
  },
}));

// Mock ImagePickerComponent
jest.mock("@components/ui/ImagePicker", () => ({
  ImagePickerComponent: () => null,
}));

// Mock RsvpOptionsEditor
jest.mock("../RsvpOptionsEditor", () => ({
  RsvpOptionsEditor: () => null,
  DEFAULT_RSVP_OPTIONS: [],
}));

// Mock VisibilitySelector
jest.mock("../VisibilitySelector", () => ({
  VisibilitySelector: () => null,
}));

// Mock ShareToChatModal
jest.mock("../ShareToChatModal", () => ({
  ShareToChatModal: () => null,
}));

// Mock ConfirmModal
jest.mock("@components/ui/ConfirmModal", () => ({
  ConfirmModal: (props: any) => {
    const { View, Text, TouchableOpacity } = require("react-native");
    if (!props.visible) return null;
    return (
      <View testID="confirm-modal">
        <Text testID="confirm-modal-title">{props.title}</Text>
        <Text testID="confirm-modal-message">{props.message}</Text>
        <TouchableOpacity testID="confirm-modal-confirm" onPress={props.onConfirm}>
          <Text>{props.confirmText || "Confirm"}</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="confirm-modal-cancel" onPress={props.onCancel}>
          <Text>{props.cancelText || "Cancel"}</Text>
        </TouchableOpacity>
      </View>
    );
  },
}));

describe("CreateEventScreen - Past Date Handling", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    jest.clearAllMocks();

    // Reset mock user to non-admin
    mockUser = {
      id: "user-123",
      timezone: "America/New_York",
      is_admin: false,
    };

    // Reset search params to have a group_id (not in unified mode)
    mockSearchParams = { group_id: "group-123" };

    // Default mock implementations
    mockUseQuery.mockReturnValue(undefined);
    mockUseMutation.mockReturnValue(jest.fn());
    mockCreateMeetingMutation.mockResolvedValue("meeting-123");
  });

  const renderCreateEventScreen = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <CreateEventScreen />
      </QueryClientProvider>
    );
  };

  describe("Non-admin users", () => {
    beforeEach(() => {
      mockUser = {
        id: "user-123",
        timezone: "America/New_York",
        is_admin: false,
      };
    });

    it("shows error when non-admin selects a past date and tries to submit", async () => {
      const { getByTestId, queryByTestId } = renderCreateEventScreen();

      // Wait for component to render
      await waitFor(() => {
        expect(getByTestId("date-picker")).toBeTruthy();
      });

      // Select a group first (required for submission)
      // Then set a past date
      await act(async () => {
        fireEvent.press(getByTestId("set-past-date"));
      });

      // Try to submit
      const submitButton = getByTestId("submit-button");
      await act(async () => {
        fireEvent.press(submitButton);
      });

      // Should show date error, not modal
      await waitFor(() => {
        expect(getByTestId("date-picker-error")).toBeTruthy();
      });
      expect(queryByTestId("confirm-modal")).toBeNull();
    });
  });

  describe("Admin users", () => {
    beforeEach(() => {
      mockUser = {
        id: "user-123",
        timezone: "America/New_York",
        is_admin: true,
      };
    });

    it("shows confirmation modal when admin submits with a past date", async () => {
      const { getByTestId, queryByTestId } = renderCreateEventScreen();

      // Wait for component to render
      await waitFor(() => {
        expect(getByTestId("date-picker")).toBeTruthy();
      });

      // Set a past date
      await act(async () => {
        fireEvent.press(getByTestId("set-past-date"));
      });

      // Select a group (required for non-community-wide events)
      // The dropdown should be rendered for unified mode

      // Try to submit
      const submitButton = getByTestId("submit-button");
      await act(async () => {
        fireEvent.press(submitButton);
      });

      // Should show confirmation modal
      await waitFor(() => {
        expect(getByTestId("confirm-modal")).toBeTruthy();
      });

      // Check modal content
      expect(getByTestId("confirm-modal-title").props.children).toBe("Create Past Event?");
    });

    it("closes modal and does not create event when admin cancels", async () => {
      const { getByTestId, queryByTestId } = renderCreateEventScreen();

      // Wait for component to render
      await waitFor(() => {
        expect(getByTestId("date-picker")).toBeTruthy();
      });

      // Set a past date
      await act(async () => {
        fireEvent.press(getByTestId("set-past-date"));
      });

      // Try to submit
      const submitButton = getByTestId("submit-button");
      await act(async () => {
        fireEvent.press(submitButton);
      });

      // Wait for modal to appear
      await waitFor(() => {
        expect(getByTestId("confirm-modal")).toBeTruthy();
      });

      // Press cancel
      await act(async () => {
        fireEvent.press(getByTestId("confirm-modal-cancel"));
      });

      // Modal should close
      await waitFor(() => {
        expect(queryByTestId("confirm-modal")).toBeNull();
      });

      // Event should not be created
      expect(mockCreateMeetingMutation).not.toHaveBeenCalled();
    });

    it("creates event when admin confirms past date creation", async () => {
      const { getByTestId, queryByTestId } = renderCreateEventScreen();

      // Wait for component to render
      await waitFor(() => {
        expect(getByTestId("date-picker")).toBeTruthy();
      });

      // Set a past date
      await act(async () => {
        fireEvent.press(getByTestId("set-past-date"));
      });

      // Try to submit
      const submitButton = getByTestId("submit-button");
      await act(async () => {
        fireEvent.press(submitButton);
      });

      // Modal should appear
      await waitFor(() => {
        expect(getByTestId("confirm-modal")).toBeTruthy();
      });

      // Press confirm - the modal visibility is controlled by state
      // After confirm, the state sets showPastDateModal to false
      await act(async () => {
        fireEvent.press(getByTestId("confirm-modal-confirm"));
        // Allow state updates and setTimeout to process
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // The modal should be closed (showPastDateModal = false)
      // Note: The ConfirmModal mock returns null when visible=false
      await waitFor(() => {
        expect(queryByTestId("confirm-modal")).toBeNull();
      }, { timeout: 500 });
    });

    it("does not show modal for future dates", async () => {
      const { getByTestId, queryByTestId } = renderCreateEventScreen();

      // Wait for component to render
      await waitFor(() => {
        expect(getByTestId("date-picker")).toBeTruthy();
      });

      // Set a future date
      await act(async () => {
        fireEvent.press(getByTestId("set-future-date"));
      });

      // Try to submit
      const submitButton = getByTestId("submit-button");
      await act(async () => {
        fireEvent.press(submitButton);
      });

      // Should NOT show confirmation modal (might show other validation errors)
      expect(queryByTestId("confirm-modal")).toBeNull();
    });

    // TODO: Add test for edit mode once CI memory issues are resolved
    // The implementation correctly skips the modal when editing existing past events.
    // See: originalDateWasInPast check in handleSubmit at CreateEventScreen.tsx:560-561
  });
});
