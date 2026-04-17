import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter, useLocalSearchParams } from "expo-router";
import EventDetailsPage from "../../../app/(user)/leader-tools/[group_id]/events/[event_id]/index";
import { api } from "@services/api";
import { useAuth } from "@providers/AuthProvider";

// Create mock function for Convex
const mockGroupByIdQuery = jest.fn();

// Mock Convex hooks
jest.mock("convex/react", () => ({
  useQuery: (func: any, args: any) => mockGroupByIdQuery(func, args),
  useMutation: jest.fn(() => jest.fn()),
}));

// Mock the api object with nested path structure
jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      groups: {
        queries: {
          getByIdWithRole: { _name: "groups.queries.getByIdWithRole" },
        },
      },
    },
  },
  useQuery: (func: any, args: any) => mockGroupByIdQuery(func, args),
  useMutation: jest.fn(() => jest.fn()),
  Id: String,
}));

// Mock dependencies
jest.mock("@services/api", () => {
  const mockGroupsApi = {
    getRSVPStats: jest.fn(),
    getUserByToken: jest.fn(),
  };

  return {
    api: {
      getRSVPStats: mockGroupsApi.getRSVPStats,
      getUserByToken: mockGroupsApi.getUserByToken,
    },
    groupsApi: mockGroupsApi,
  };
});

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

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue("mock-auth-token"),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@features/leader-tools/components/EventDetails", () => {
  const React = require("react");
  const { TouchableOpacity, Text, View } = require("react-native");
  return {
    EventDetails: ({
      groupId,
      eventDate,
      meetingId,
      isLeader,
      onBack,
      onGroupChat,
    }: any) => {
      return (
        <View testID="event-details">
          <Text testID="group-id">{groupId}</Text>
          <Text testID="event-date">{eventDate}</Text>
          <Text testID="meeting-id">{meetingId}</Text>
          <Text testID="is-leader">{isLeader ? "true" : "false"}</Text>
          <TouchableOpacity onPress={onBack} testID="back-button">
            <Text>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onGroupChat} testID="group-chat-button">
            <Text>Group Chat</Text>
          </TouchableOpacity>
        </View>
      );
    },
  };
});

const mockApi = api as jest.Mocked<typeof api>;
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockUseLocalSearchParams = useLocalSearchParams as jest.MockedFunction<
  typeof useLocalSearchParams
>;

describe("EventDetailsPage", () => {
  let queryClient: QueryClient;
  const mockRouter = {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: jest.fn(() => true),
  };

  const eventDate = "2025-11-26T10:00:00Z";
  const encodedEventDate = encodeURIComponent(eventDate);
  const meetingUuid = "abc-123-def-456";
  // Use ID-based identifier format: "id-{uuid}|{encoded-date}"
  const eventIdentifier = `id-${meetingUuid}|${encodedEventDate}`;

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
    mockUseLocalSearchParams.mockReturnValue({
      group_id: "13",
      event_id: eventIdentifier,
    });
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

    // Mock Convex group query
    mockGroupByIdQuery.mockReturnValue({
      id: "13",
      name: "Test Dinner Party",
      userRole: "leader",
    });
  });

  afterEach(() => {
    queryClient.clear();
    jest.clearAllMocks();
  });

  const renderComponent = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <EventDetailsPage />
      </QueryClientProvider>
    );
  };

  it("renders event details page with correct props", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId("event-details")).toBeTruthy();
      expect(screen.getByTestId("back-button")).toBeTruthy();
      expect(screen.getByTestId("group-chat-button")).toBeTruthy();
    });

    expect(screen.getByTestId("group-id").props.children).toBe("13");
    expect(screen.getByTestId("meeting-id").props.children).toBe(meetingUuid);
  });

  it("handles back navigation when canGoBack is true", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId("back-button")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("back-button"));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("handles back navigation when canGoBack is false", async () => {
    mockRouter.canGoBack.mockReturnValue(false);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId("back-button")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("back-button"));
    expect(mockRouter.push).toHaveBeenCalledWith(
      "/(tabs)/events"
    );
  });

  it("handles group chat navigation", async () => {
    // Pre-populate query cache with group data (key format: ['groups', groupId])
    queryClient.setQueryData(["groups", "13"], {
      id: 13,
      title: "Test Dinner Party",
      name: "Test Dinner Party",
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId("group-chat-button")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("group-chat-button"));
    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith(
        `/inbox?dp_id=13&dp_name=${encodeURIComponent("Test Dinner Party")}`
      );
    });
  });

  it("returns null when event_id parameter is missing", () => {
    mockUseLocalSearchParams.mockReturnValue({
      group_id: "13",
    } as any);

    renderComponent();

    // Should not render anything if event_id is missing
    expect(screen.queryByTestId("event-details")).toBeNull();
  });

  it("returns null when event_id format is date-only (no meetingId)", () => {
    // date-only format is no longer supported - all events need meetingId
    mockUseLocalSearchParams.mockReturnValue({
      group_id: "13",
      event_id: `date-${encodedEventDate}`,
    });

    renderComponent();

    // Should redirect/return null since meetingId is required
    expect(screen.queryByTestId("event-details")).toBeNull();
  });

  it("parses event identifier correctly", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId("event-details")).toBeTruthy();
    });

    // Verify the eventDate is parsed correctly (should be decoded)
    const eventDateText = screen.getByTestId("event-date").props.children;
    expect(eventDateText).toBe(eventDate);
  });
});
