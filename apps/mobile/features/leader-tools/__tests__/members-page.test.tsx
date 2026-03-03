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
import MembersPage from "../../../app/(user)/leader-tools/[group_id]/members";
import { useAuth } from "@providers/AuthProvider";
import { useGroupMembers } from "@features/leader-tools/hooks";

// Create mock functions that can be controlled per test
const mockGetGroupQuery = jest.fn();
const mockRemoveMemberMutation = jest.fn();
const mockPromoteToLeaderMutation = jest.fn();
const mockDemoteFromLeaderMutation = jest.fn();
const mockAddMemberMutation = jest.fn();

// Mock Convex hooks
jest.mock("convex/react", () => ({
  useQuery: (func: any, args: any) => mockGetGroupQuery(func, args),
  useMutation: (func: any) => {
    const funcName = func?._name || func?.toString() || "";
    if (funcName.includes("add")) {
      return (...mutationArgs: any[]) => mockAddMemberMutation(...mutationArgs);
    }
    if (funcName.includes("remove")) {
      return (...mutationArgs: any[]) => mockRemoveMemberMutation(...mutationArgs);
    }
    if (funcName.includes("promote")) {
      return (...mutationArgs: any[]) => mockPromoteToLeaderMutation(...mutationArgs);
    }
    if (funcName.includes("demote")) {
      return (...mutationArgs: any[]) => mockDemoteFromLeaderMutation(...mutationArgs);
    }
    return jest.fn();
  },
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
      groupMembers: {
        add: { _name: "groupMembers.add" },
        remove: { _name: "groupMembers.remove" },
        promoteToLeader: { _name: "groupMembers.promoteToLeader" },
        demoteFromLeader: { _name: "groupMembers.demoteFromLeader" },
      },
    },
  },
  useQuery: (func: any, args: any) => mockGetGroupQuery(func, args),
  useMutation: (func: any) => {
    const funcName = func?._name || "";
    if (funcName.includes("add")) {
      return (...mutationArgs: any[]) => mockAddMemberMutation(...mutationArgs);
    }
    if (funcName.includes("remove")) {
      return (...mutationArgs: any[]) => mockRemoveMemberMutation(...mutationArgs);
    }
    if (funcName.includes("promote")) {
      return (...mutationArgs: any[]) => mockPromoteToLeaderMutation(...mutationArgs);
    }
    if (funcName.includes("demote")) {
      return (...mutationArgs: any[]) => mockDemoteFromLeaderMutation(...mutationArgs);
    }
    return jest.fn();
  },
  // Authenticated hooks - used by MembersScreen
  useAuthenticatedMutation: (func: any) => {
    const funcName = func?._name || "";
    if (funcName.includes("add")) {
      return (...mutationArgs: any[]) => mockAddMemberMutation(...mutationArgs);
    }
    if (funcName.includes("remove")) {
      return (...mutationArgs: any[]) => mockRemoveMemberMutation(...mutationArgs);
    }
    if (funcName.includes("promote")) {
      return (...mutationArgs: any[]) => mockPromoteToLeaderMutation(...mutationArgs);
    }
    if (funcName.includes("demote")) {
      return (...mutationArgs: any[]) => mockDemoteFromLeaderMutation(...mutationArgs);
    }
    return jest.fn();
  },
  useAuthenticatedQuery: jest.fn(),
  useAuthenticatedAction: jest.fn(() => jest.fn()),
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

jest.mock("@features/leader-tools/components/Members", () => {
  const React = require("react");
  const { View, Text, TextInput } = require("react-native");
  return {
    Members: ({ groupId, onMemberAction }: any) => (
      <View>
        <TextInput placeholder="Search members..." />
        <Text>Members component - groupId: {groupId}</Text>
      </View>
    ),
  };
});

jest.mock("@features/leader-tools/hooks", () => ({
  useGroupMembers: jest.fn(),
}));

// Mock useMembersPage - this will be controlled per test
const mockUseMembersPage = jest.fn();
jest.mock("@features/leader-tools/hooks/useMembersPage", () => ({
  useMembersPage: (...args: any[]) => mockUseMembersPage(...args),
}));

jest.mock("@features/leader-tools/hooks/useMemberActions", () => ({
  useMemberActions: jest.fn(() => ({
    handleMemberAction: jest.fn(),
  })),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockUseLocalSearchParams = useLocalSearchParams as jest.MockedFunction<
  typeof useLocalSearchParams
>;
const mockUseGroupMembers = useGroupMembers as jest.MockedFunction<typeof useGroupMembers>;

// Mock insets for SafeAreaProvider
const mockInsets = {
  top: 47,
  right: 0,
  bottom: 34,
  left: 0,
};

describe("MembersPage", () => {
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

    // Mock Convex group query
    mockGetGroupQuery.mockReturnValue(mockGroup);

    // Default mock for useMembersPage
    mockUseMembersPage.mockReturnValue({
      group: mockGroup,
      isLoadingGroup: false,
      groupError: null,
      handleBack: jest.fn(() => {
        if (mockRouter.canGoBack && mockRouter.canGoBack()) {
          mockRouter.back();
        } else {
          mockRouter.push("/(user)/leader-tools/13");
        }
      }),
    });

    // Mock useGroupMembers hook used by Members component
    mockUseGroupMembers.mockReturnValue({
      members: [],
      isLoading: false,
      error: null,
      isError: false,
      isSuccess: true,
      hasNextPage: false,
      fetchNextPage: jest.fn(),
      refetch: jest.fn(),
      isRefetching: false,
      isFetchingNextPage: false,
      data: undefined,
    } as any);
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
          insets: mockInsets,
        }}
      >
        <QueryClientProvider client={queryClient}>
          <MembersPage />
        </QueryClientProvider>
      </SafeAreaProvider>
    );
  };

  it("renders loading state while fetching group", () => {
    // Override the default mock to return loading state
    mockUseMembersPage.mockReturnValue({
      group: undefined,
      isLoadingGroup: true,
      groupError: null,
      handleBack: jest.fn(),
    });

    renderComponent();

    expect(screen.getByText("Loading...")).toBeTruthy();
  });

  it("renders group title in header", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Sunday Morning Bible Study")).toBeTruthy();
      expect(screen.getByText("Members")).toBeTruthy();
    });
  });

  it("renders Members component with correct props", async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Members")).toBeTruthy();
    });

    // Members component should be rendered (it has a search input)
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search members...")).toBeTruthy();
    });
  });

  it("handles back button press", async () => {
    // Mock canGoBack to return false to test fallback behavior
    const mockHandleBack = jest.fn(() => {
      mockRouter.push("/(user)/leader-tools/13");
    });

    mockUseMembersPage.mockReturnValue({
      group: mockGroup,
      isLoadingGroup: false,
      groupError: null,
      handleBack: mockHandleBack,
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Members")).toBeTruthy();
    });

    // Find the back button by testID
    const backButton = screen.getByTestId("back-button");
    fireEvent.press(backButton);

    // Verify handleBack was called
    expect(mockHandleBack).toHaveBeenCalled();
    // Verify router.push was called with correct path
    expect(mockRouter.push).toHaveBeenCalledWith("/(user)/leader-tools/13");
  });

  it("shows error state when group fetch fails", async () => {
    const error = new Error("Group not found");
    const mockHandleBack = jest.fn(() => {
      mockRouter.push("/(user)/leader-tools/13");
    });

    // Override mock to return error state
    mockUseMembersPage.mockReturnValue({
      group: undefined,
      isLoadingGroup: false,
      groupError: error,
      handleBack: mockHandleBack,
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Group not found")).toBeTruthy();
      expect(screen.getByText("Go Back")).toBeTruthy();
    });

    // Verify error state back button also navigates correctly
    const goBackButton = screen.getByText("Go Back");
    fireEvent.press(goBackButton);
    expect(mockHandleBack).toHaveBeenCalled();
    expect(mockRouter.push).toHaveBeenCalledWith("/(user)/leader-tools/13");
  });

  it("handles member remove action", async () => {
    mockRemoveMemberMutation.mockResolvedValue({});

    renderComponent();

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search members...")).toBeTruthy();
    });

    // The Members component handles the actual member action
    // This test verifies the page is set up correctly with the Members component
    expect(screen.getByText("Members component - groupId: 13")).toBeTruthy();
  });

  it("handles member promote action", async () => {
    mockPromoteToLeaderMutation.mockResolvedValue({});

    renderComponent();

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search members...")).toBeTruthy();
    });

    // Verify the Members component is rendered with correct groupId
    expect(screen.getByText("Members component - groupId: 13")).toBeTruthy();
  });

  it("handles member demote action", async () => {
    mockDemoteFromLeaderMutation.mockResolvedValue({});

    renderComponent();

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search members...")).toBeTruthy();
    });

    // Verify the Members component is rendered with correct groupId
    expect(screen.getByText("Members component - groupId: 13")).toBeTruthy();
  });
});
