import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Alert } from "react-native";
import { GroupDetailScreen } from "../GroupDetailScreen";
import { useGroupDetails, useLeaveGroup, useJoinGroup, useArchiveGroup, useWithdrawJoinRequest } from "../../hooks";
import { useAuth } from "@providers/AuthProvider";
import { useUserData } from "@features/profile/hooks/useUserData";
import { isGroupMember } from "../../utils";

// Mock Convex
jest.mock("convex/react", () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn(() => jest.fn()),
}));

jest.mock("@services/api/convex", () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn(() => jest.fn()),
  api: {
    functions: {
      groups: {
        index: {
          getById: "api.functions.groups.index.getById",
          getLeaders: "api.functions.groups.index.getLeaders",
          join: "api.functions.groups.index.join",
          leave: "api.functions.groups.index.leave",
          update: "api.functions.groups.index.update",
        },
      },
      groupMembers: {
        list: "api.functions.groupMembers.list",
      },
      groupJoinRequests: {
        create: "api.functions.groupJoinRequests.create",
        cancel: "api.functions.groupJoinRequests.cancel",
      },
    },
  },
}));

// Mock dependencies
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ group_id: "1" }),
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: jest.fn(() => true),
  }),
}));

jest.mock("../../hooks", () => ({
  useGroupDetails: jest.fn(),
  // useRSVP has been deleted
  useLeaveGroup: jest.fn(),
  useJoinGroup: jest.fn(),
  useArchiveGroup: jest.fn(),
  useWithdrawJoinRequest: jest.fn(),
}));

const mockUseMyPendingJoinRequests = jest.fn();
jest.mock("../../hooks/useMyPendingJoinRequests", () => ({
  useMyPendingJoinRequests: () => mockUseMyPendingJoinRequests(),
  PENDING_JOIN_REQUEST_LIMIT: 2,
}));

jest.mock("../PendingRequestLimitModal", () => {
  const { View, Text, Pressable } = require("react-native");
  return {
    PendingRequestLimitModal: ({ visible, onDismiss, onViewRequests }: any) =>
      visible ? (
        <View testID="pending-limit-modal">
          <Text>You have pending requests</Text>
          <Pressable testID="pending-limit-dismiss" onPress={onDismiss}>
            <Text>Dismiss</Text>
          </Pressable>
          <Pressable
            testID="pending-limit-view-requests"
            onPress={onViewRequests}
          >
            <Text>View my requests</Text>
          </Pressable>
        </View>
      ) : null,
  };
});

jest.mock("@providers/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@features/profile/hooks/useUserData", () => ({
  useUserData: jest.fn(),
}));

jest.mock("../../utils", () => ({
  isGroupMember: jest.fn(),
  formatCadence: jest.fn(() => "Sundays at 11:00am"),
}));

jest.mock("@components/guards/UserRoute", () => ({
  UserRoute: ({ children }: any) => children,
}));

jest.mock("@components/ui", () => {
  const { View, Text } = require("react-native");
  return {
    SkeletonCard: () => <View testID="skeleton-card"><Text>Loading...</Text></View>,
    Skeleton: ({ children, ...props }: any) => <View testID="skeleton" {...props}>{children}</View>,
    SkeletonAvatar: (props: any) => <View testID="skeleton-avatar" {...props} />,
    SkeletonText: (props: any) => <View testID="skeleton-text" {...props} />,
  };
});

jest.mock("@expo/vector-icons", () => ({
  Ionicons: "Ionicons",
}));

jest.mock("../RSVPModal", () => {
  const { View, Text } = require("react-native");
  return {
    RSVPModal: ({ visible }: any) => (visible ? <View testID="rsvp-modal"><Text>RSVP Modal</Text></View> : null),
  };
});

jest.mock("../GroupOptionsModal", () => {
  const { View, Text } = require("react-native");
  return {
    GroupOptionsModal: ({ visible }: any) => (visible ? <View testID="options-modal"><Text>Options Modal</Text></View> : null),
  };
});

jest.mock("../MembersRow", () => {
  const { View, Text } = require("react-native");
  return {
    MembersRow: ({ members, leaders }: any) => (
      <View testID="members-row">
        <Text>Members: {members?.length || 0}, Leaders: {leaders?.length || 0}</Text>
      </View>
    ),
  };
});

jest.mock("../GroupMapSection", () => {
  const { View, Text } = require("react-native");
  return {
    GroupMapSection: ({ group }: any) =>
      group.location ? (
        <View testID="map-section"><Text>Map: {group.location}</Text></View>
      ) : null,
  };
});

jest.mock("../HighlightsGrid", () => {
  const { View, Text } = require("react-native");
  return {
    HighlightsGrid: ({ highlights }: any) => <View testID="highlights-grid"><Text>Highlights: {highlights?.length || 0}</Text></View>,
  };
});

jest.mock("../NextEventSection", () => {
  const { View, Text } = require("react-native");
  return {
    NextEventSection: ({ group }: any) => <View testID="next-event-section"><Text>{group?.title}</Text></View>,
  };
});

jest.mock("@/providers/ImageViewerProvider", () => ({
  ImageViewerManager: {
    show: jest.fn(),
  },
}));

jest.mock("../GroupHeader", () => {
  const { View, Text, Pressable } = require("react-native");
  return {
    GroupHeader: ({ group, onMenuPress }: any) => (
      <View testID="group-header">
        <Text testID="group-header-title">{group?.title || group?.name}</Text>
        <Pressable testID="menu-button" onPress={onMenuPress}><Text>Menu</Text></Pressable>
      </View>
    ),
  };
});

jest.mock("../GroupNonMemberView", () => {
  const { View, Text } = require("react-native");
  return {
    GroupNonMemberView: ({ group, onJoinPress, isJoining }: any) => (
      <View testID="non-member-view">
        <Text testID="non-member-view-content">Non-Member View</Text>
        <Text testID="join-button" onPress={onJoinPress} disabled={isJoining}>
          {isJoining ? "Joining..." : "Join Dinner Party"}
        </Text>
      </View>
    ),
  };
});

// Mock Alert
jest.spyOn(Alert, "alert");

const mockGroup = {
  id: 1,
  title: "Test Group",
  name: "Test Group",
  description: "Test description",
  members: [
    { id: 1, first_name: "John", last_name: "Doe" },
    { id: 2, first_name: "Jane", last_name: "Smith" },
  ],
  highlights: [],
};

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: any) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("GroupDetailScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set up default mock implementations for all mutation hooks
    (useJoinGroup as jest.Mock).mockReturnValue({
      mutate: jest.fn(),
      mutateAsync: jest.fn().mockResolvedValue({}),
      isPending: false,
    });
    (useLeaveGroup as jest.Mock).mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
    });
    (useArchiveGroup as jest.Mock).mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
    });
    (useWithdrawJoinRequest as jest.Mock).mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
    });
    mockUseMyPendingJoinRequests.mockReturnValue({
      requests: [],
      count: 0,
      isAtLimit: false,
      isLoading: false,
    });
    // useRSVP has been deleted
  });

  it("renders loading state", () => {
    (useGroupDetails as jest.Mock).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });
    (useAuth as jest.Mock).mockReturnValue({ user: { id: 1 } });
    (useUserData as jest.Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
    });
    (isGroupMember as jest.Mock).mockReturnValue(false);

    render(<GroupDetailScreen />, { wrapper: createWrapper() });

    // New GroupDetailSkeleton uses individual skeleton components instead of SkeletonCard
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("renders error state", () => {
    (useGroupDetails as jest.Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Not found"),
    });
    (useAuth as jest.Mock).mockReturnValue({ user: { id: 1 } });
    (useUserData as jest.Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
    });
    (isGroupMember as jest.Mock).mockReturnValue(false);

    render(<GroupDetailScreen />, { wrapper: createWrapper() });

    expect(screen.getByText("Group not found")).toBeTruthy();
  });

  it("renders non-member view when user is not a member", () => {
    (useGroupDetails as jest.Mock).mockReturnValue({
      data: mockGroup,
      isLoading: false,
      error: null,
    });
    (useAuth as jest.Mock).mockReturnValue({ user: { id: 999 } });
    (useUserData as jest.Mock).mockReturnValue({
      data: { group_memberships: [] },
      isLoading: false,
    });
    (isGroupMember as jest.Mock).mockReturnValue(false);
    (useJoinGroup as jest.Mock).mockReturnValue({
      mutate: jest.fn(),
      mutateAsync: jest.fn().mockResolvedValue({}),
      isPending: false,
    });

    render(<GroupDetailScreen />, { wrapper: createWrapper() });

    expect(screen.getByTestId("non-member-view")).toBeTruthy();
    expect(screen.getByTestId("non-member-view-content")).toBeTruthy();
    expect(screen.getByTestId("join-button")).toBeTruthy();
  });

  it("renders member view when user is a member", () => {
    (useGroupDetails as jest.Mock).mockReturnValue({
      data: mockGroup,
      isLoading: false,
      error: null,
    });
    (useAuth as jest.Mock).mockReturnValue({ user: { id: 1 } });
    (useUserData as jest.Mock).mockReturnValue({
      data: { group_memberships: [] },
      isLoading: false,
    });
    (isGroupMember as jest.Mock).mockReturnValue(true);
    // useRSVP has been deleted
    (useLeaveGroup as jest.Mock).mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
    });

    render(<GroupDetailScreen />, { wrapper: createWrapper() });

    expect(screen.queryByTestId("non-member-view")).toBeNull();
    expect(screen.getByText("Test description")).toBeTruthy();
  });

  it("calls join group mutation when join button is pressed", async () => {
    const mockMutate = jest.fn();
    (useGroupDetails as jest.Mock).mockReturnValue({
      data: mockGroup,
      isLoading: false,
      error: null,
    });
    (useAuth as jest.Mock).mockReturnValue({ user: { id: 999 } });
    (useUserData as jest.Mock).mockReturnValue({
      data: { group_memberships: [] },
      isLoading: false,
    });
    (isGroupMember as jest.Mock).mockReturnValue(false);
    const mockMutateAsync = jest.fn().mockResolvedValue({});
    (useJoinGroup as jest.Mock).mockReturnValue({
      mutate: mockMutate,
      mutateAsync: mockMutateAsync,
      isPending: false,
    });

    render(<GroupDetailScreen />, { wrapper: createWrapper() });

    const joinButton = screen.getByTestId("join-button");
    // The mock uses onPress, so we need to trigger it
    fireEvent.press(joinButton);

    await waitFor(() => {
      // useJoinGroup mutation now uses mutateAsync
      expect(mockMutateAsync).toHaveBeenCalled();
    });
  });

  describe("pending join request limit", () => {
    it("shows the limit modal instead of joining when the user is at the cap", async () => {
      const mockMutateAsync = jest.fn().mockResolvedValue({});
      (useGroupDetails as jest.Mock).mockReturnValue({
        data: mockGroup,
        isLoading: false,
        error: null,
      });
      (useAuth as jest.Mock).mockReturnValue({ user: { id: 999 } });
      (useUserData as jest.Mock).mockReturnValue({
        data: { group_memberships: [] },
        isLoading: false,
      });
      (isGroupMember as jest.Mock).mockReturnValue(false);
      (useJoinGroup as jest.Mock).mockReturnValue({
        mutate: jest.fn(),
        mutateAsync: mockMutateAsync,
        isPending: false,
      });
      mockUseMyPendingJoinRequests.mockReturnValue({
        requests: [
          { id: "1", groupId: "g1", groupName: "A", groupTypeName: "DP", requestedAt: 1 },
          { id: "2", groupId: "g2", groupName: "B", groupTypeName: "DP", requestedAt: 2 },
        ],
        count: 2,
        isAtLimit: true,
        isLoading: false,
      });

      render(<GroupDetailScreen />, { wrapper: createWrapper() });

      expect(screen.queryByTestId("pending-limit-modal")).toBeNull();

      fireEvent.press(screen.getByTestId("join-button"));

      // Modal appears, mutation is NOT called.
      await waitFor(() => {
        expect(screen.getByTestId("pending-limit-modal")).toBeTruthy();
      });
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    it("dismisses the limit modal when Dismiss is pressed", async () => {
      (useGroupDetails as jest.Mock).mockReturnValue({
        data: mockGroup,
        isLoading: false,
        error: null,
      });
      (useAuth as jest.Mock).mockReturnValue({ user: { id: 999 } });
      (useUserData as jest.Mock).mockReturnValue({
        data: { group_memberships: [] },
        isLoading: false,
      });
      (isGroupMember as jest.Mock).mockReturnValue(false);
      (useJoinGroup as jest.Mock).mockReturnValue({
        mutate: jest.fn(),
        mutateAsync: jest.fn().mockResolvedValue({}),
        isPending: false,
      });
      mockUseMyPendingJoinRequests.mockReturnValue({
        requests: [],
        count: 2,
        isAtLimit: true,
        isLoading: false,
      });

      render(<GroupDetailScreen />, { wrapper: createWrapper() });

      fireEvent.press(screen.getByTestId("join-button"));
      await waitFor(() => {
        expect(screen.getByTestId("pending-limit-modal")).toBeTruthy();
      });

      fireEvent.press(screen.getByTestId("pending-limit-dismiss"));

      await waitFor(() => {
        expect(screen.queryByTestId("pending-limit-modal")).toBeNull();
      });
    });

    it("does NOT show the limit modal when the user is below the cap", async () => {
      const mockMutateAsync = jest.fn().mockResolvedValue({});
      (useGroupDetails as jest.Mock).mockReturnValue({
        data: mockGroup,
        isLoading: false,
        error: null,
      });
      (useAuth as jest.Mock).mockReturnValue({ user: { id: 999 } });
      (useUserData as jest.Mock).mockReturnValue({
        data: { group_memberships: [] },
        isLoading: false,
      });
      (isGroupMember as jest.Mock).mockReturnValue(false);
      (useJoinGroup as jest.Mock).mockReturnValue({
        mutate: jest.fn(),
        mutateAsync: mockMutateAsync,
        isPending: false,
      });
      mockUseMyPendingJoinRequests.mockReturnValue({
        requests: [
          { id: "1", groupId: "g1", groupName: "A", groupTypeName: "DP", requestedAt: 1 },
        ],
        count: 1,
        isAtLimit: false,
        isLoading: false,
      });

      render(<GroupDetailScreen />, { wrapper: createWrapper() });

      fireEvent.press(screen.getByTestId("join-button"));

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalled();
      });
      expect(screen.queryByTestId("pending-limit-modal")).toBeNull();
    });
  });

  it("shows error alert when join fails due to missing user or group", async () => {
    const mockMutate = jest.fn();
    const groupWithoutId = { ...mockGroup, id: undefined };
    (useGroupDetails as jest.Mock).mockReturnValue({
      data: groupWithoutId,
      isLoading: false,
      error: null,
    });
    (useAuth as jest.Mock).mockReturnValue({ user: null });
    (useUserData as jest.Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
    });
    (isGroupMember as jest.Mock).mockReturnValue(false);
    (useJoinGroup as jest.Mock).mockReturnValue({
      mutate: mockMutate,
      mutateAsync: jest.fn().mockResolvedValue({}),
      isPending: false,
    });

    render(<GroupDetailScreen />, { wrapper: createWrapper() });

    const joinButton = screen.getByTestId("join-button");
    fireEvent.press(joinButton);

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        "Error",
        "Please log in to join a group."
      );
    });
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("shows loading state when joining", () => {
    (useGroupDetails as jest.Mock).mockReturnValue({
      data: mockGroup,
      isLoading: false,
      error: null,
    });
    (useAuth as jest.Mock).mockReturnValue({ user: { id: 999 } });
    (useUserData as jest.Mock).mockReturnValue({
      data: { group_memberships: [] },
      isLoading: false,
    });
    (isGroupMember as jest.Mock).mockReturnValue(false);
    (useJoinGroup as jest.Mock).mockReturnValue({
      mutate: jest.fn(),
      mutateAsync: jest.fn().mockResolvedValue({}),
      isPending: true,
    });

    render(<GroupDetailScreen />, { wrapper: createWrapper() });

    const joinButton = screen.getByTestId("join-button");
    expect(joinButton.props.disabled).toBe(true);
    expect(joinButton.props.children).toBe("Joining...");
  });

  describe("Admin join button visibility", () => {
    it("shows non-member view with join button for non-member admins", () => {
      // Admin user who is NOT a member of the group
      (useGroupDetails as jest.Mock).mockReturnValue({
        data: mockGroup,
        isLoading: false,
        error: null,
      });
      (useAuth as jest.Mock).mockReturnValue({
        user: { id: 999, is_admin: true },
      });
      (useUserData as jest.Mock).mockReturnValue({
        data: { group_memberships: [] },
        isLoading: false,
      });
      (isGroupMember as jest.Mock).mockReturnValue(false);
      (useJoinGroup as jest.Mock).mockReturnValue({
        mutate: jest.fn(),
        mutateAsync: jest.fn().mockResolvedValue({}),
        isPending: false,
      });

      render(<GroupDetailScreen />, { wrapper: createWrapper() });

      // Admin who is not a member should see the non-member view with join button
      expect(screen.getByTestId("non-member-view")).toBeTruthy();
      expect(screen.getByTestId("join-button")).toBeTruthy();
    });

    it("shows non-member view with join button for regular non-member users", () => {
      // Regular user (not admin) who is NOT a member of the group
      (useGroupDetails as jest.Mock).mockReturnValue({
        data: mockGroup,
        isLoading: false,
        error: null,
      });
      (useAuth as jest.Mock).mockReturnValue({
        user: { id: 999, is_admin: false },
      });
      (useUserData as jest.Mock).mockReturnValue({
        data: { group_memberships: [] },
        isLoading: false,
      });
      (isGroupMember as jest.Mock).mockReturnValue(false);
      (useJoinGroup as jest.Mock).mockReturnValue({
        mutate: jest.fn(),
        mutateAsync: jest.fn().mockResolvedValue({}),
        isPending: false,
      });

      render(<GroupDetailScreen />, { wrapper: createWrapper() });

      // Regular non-member should see the non-member view with join button
      expect(screen.getByTestId("non-member-view")).toBeTruthy();
      expect(screen.getByTestId("join-button")).toBeTruthy();
    });

    it("shows member view (not non-member view) for members regardless of admin status", () => {
      // User who IS a member of the group
      (useGroupDetails as jest.Mock).mockReturnValue({
        data: mockGroup,
        isLoading: false,
        error: null,
      });
      (useAuth as jest.Mock).mockReturnValue({
        user: { id: 1, is_admin: true },
      });
      (useUserData as jest.Mock).mockReturnValue({
        data: { group_memberships: [] },
        isLoading: false,
      });
      (isGroupMember as jest.Mock).mockReturnValue(true);
      (useLeaveGroup as jest.Mock).mockReturnValue({
        mutate: jest.fn(),
        isPending: false,
      });

      render(<GroupDetailScreen />, { wrapper: createWrapper() });

      // Member (even if admin) should NOT see non-member view
      expect(screen.queryByTestId("non-member-view")).toBeNull();
      // Should see the member view content instead
      expect(screen.getByText("Test description")).toBeTruthy();
    });
  });
});
