import React from "react";
import { render, screen } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GroupInfoScreen } from "../GroupInfoScreen";
import { useGroupDetails, useLeaveGroup, useJoinGroup, useArchiveGroup } from "../../hooks";
import { useAuth } from "@providers/AuthProvider";
import { useUserData } from "@features/profile/hooks/useUserData";
import { isGroupMember } from "../../utils";

// Mirrors the mocking pattern established in GroupDetailScreen.test.tsx —
// this screen reuses the same hooks/components, so the same doubles apply.
jest.mock("@services/api/convex", () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn(() => jest.fn()),
  useAuthenticatedQuery: jest.fn(() => undefined),
  useAuthenticatedMutation: jest.fn(() => jest.fn()),
  api: {
    functions: {
      groups: {
        index: {
          getById: "api.functions.groups.index.getById",
          getLeaders: "api.functions.groups.index.getLeaders",
          setHiddenFromDiscovery: "api.functions.groups.index.setHiddenFromDiscovery",
          setJoinApprovalMode: "api.functions.groups.index.setJoinApprovalMode",
        },
      },
      groupMembers: {
        list: "api.functions.groupMembers.list",
        getMemberPreview: "api.functions.groupMembers.getMemberPreview",
        getLeaderPreview: "api.functions.groupMembers.getLeaderPreview",
        countGroupJoinRequests: "api.functions.groupMembers.countGroupJoinRequests",
      },
      notifications: {
        preferences: {
          getGroupNotifications: "api.functions.notifications.preferences.getGroupNotifications",
          setGroupNotifications: "api.functions.notifications.preferences.setGroupNotifications",
        },
      },
    },
  },
}));

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
  useLeaveGroup: jest.fn(),
  useJoinGroup: jest.fn(),
  useArchiveGroup: jest.fn(),
}));

jest.mock("../../hooks/useWithdrawJoinRequest", () => ({
  useWithdrawJoinRequest: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock("../../hooks/useMyPendingJoinRequests", () => ({
  useMyPendingJoinRequests: () => ({
    requests: [],
    count: 0,
    isAtLimit: false,
    isLoading: false,
  }),
  PENDING_JOIN_REQUEST_LIMIT: 2,
}));

jest.mock("../PendingRequestLimitModal", () => ({
  PendingRequestLimitModal: () => null,
}));

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

jest.mock("@expo/vector-icons", () => ({
  Ionicons: "Ionicons",
}));

jest.mock("@components/ui", () => {
  const { View } = require("react-native");
  return {
    Skeleton: (props: any) => <View testID="skeleton" {...props} />,
    SkeletonAvatar: (props: any) => <View testID="skeleton-avatar" {...props} />,
    SkeletonText: (props: any) => <View testID="skeleton-text" {...props} />,
  };
});

jest.mock("../GroupHeader", () => {
  const { View, Text } = require("react-native");
  return {
    GroupHeader: ({ group }: any) => (
      <View testID="group-header">
        <Text testID="group-header-title">{group?.title || group?.name}</Text>
      </View>
    ),
  };
});

jest.mock("../GroupNonMemberView", () => {
  const { View, Text } = require("react-native");
  return {
    GroupNonMemberView: () => (
      <View testID="non-member-view">
        <Text>Non-Member View</Text>
      </View>
    ),
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

jest.mock("../ChannelsSection", () => {
  const { View } = require("react-native");
  return { ChannelsSection: () => <View testID="channels-section" /> };
});

jest.mock("../GroupBotsSection", () => {
  const { View } = require("react-native");
  return { GroupBotsSection: () => <View testID="bots-section" /> };
});

const mockGroup = {
  _id: "1",
  id: 1,
  title: "Test Group",
  name: "Test Group",
  description: "Test description",
  shortId: "abc123",
  members_count: 2,
  group_type_name: "Small Group",
  members: [
    { id: 1, first_name: "John", last_name: "Doe" },
    { id: 2, first_name: "Jane", last_name: "Smith" },
  ],
  leaders: [],
  highlights: [],
};

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: any) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("GroupInfoScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useLeaveGroup as jest.Mock).mockReturnValue({ mutate: jest.fn(), isPending: false });
    (useJoinGroup as jest.Mock).mockReturnValue({
      mutate: jest.fn(),
      mutateAsync: jest.fn().mockResolvedValue({}),
      isPending: false,
    });
    (useArchiveGroup as jest.Mock).mockReturnValue({ mutate: jest.fn(), isPending: false });
  });

  it("renders loading state", () => {
    (useGroupDetails as jest.Mock).mockReturnValue({ data: undefined, isLoading: true, error: null });
    (useAuth as jest.Mock).mockReturnValue({ user: { id: 1 } });
    (useUserData as jest.Mock).mockReturnValue({ data: undefined, isLoading: false });
    (isGroupMember as jest.Mock).mockReturnValue(false);

    render(<GroupInfoScreen />, { wrapper: createWrapper() });

    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("renders error state", () => {
    (useGroupDetails as jest.Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Not found"),
    });
    (useAuth as jest.Mock).mockReturnValue({ user: { id: 1 } });
    (useUserData as jest.Mock).mockReturnValue({ data: undefined, isLoading: false });
    (isGroupMember as jest.Mock).mockReturnValue(false);

    render(<GroupInfoScreen />, { wrapper: createWrapper() });

    expect(screen.getByText("Group not found")).toBeTruthy();
  });

  it("renders the existing non-member view (unmodified) for non-members", () => {
    (useGroupDetails as jest.Mock).mockReturnValue({ data: mockGroup, isLoading: false, error: null });
    (useAuth as jest.Mock).mockReturnValue({ user: { id: 999 } });
    (useUserData as jest.Mock).mockReturnValue({ data: { group_memberships: [] }, isLoading: false });
    (isGroupMember as jest.Mock).mockReturnValue(false);

    render(<GroupInfoScreen />, { wrapper: createWrapper() });

    expect(screen.getByTestId("non-member-view")).toBeTruthy();
  });

  it("renders the W13 group-info layout for members", () => {
    (useGroupDetails as jest.Mock).mockReturnValue({ data: mockGroup, isLoading: false, error: null });
    (useAuth as jest.Mock).mockReturnValue({ user: { id: 1 } });
    (useUserData as jest.Mock).mockReturnValue({ data: { group_memberships: [] }, isLoading: false });
    (isGroupMember as jest.Mock).mockReturnValue(true);

    render(<GroupInfoScreen />, { wrapper: createWrapper() });

    expect(screen.queryByTestId("non-member-view")).toBeNull();
    expect(screen.getByTestId("group-header-title")).toBeTruthy();
    expect(screen.getByText("Mute group")).toBeTruthy();
    expect(screen.getByTestId("members-row")).toBeTruthy();
    expect(screen.getByTestId("channels-section")).toBeTruthy();
    expect(screen.getByTestId("bots-section")).toBeTruthy();
    expect(screen.getByText("Leave Group")).toBeTruthy();
  });

  it("hides Leave Group for the announcement group", () => {
    (useGroupDetails as jest.Mock).mockReturnValue({
      data: { ...mockGroup, is_announcement_group: true },
      isLoading: false,
      error: null,
    });
    (useAuth as jest.Mock).mockReturnValue({ user: { id: 1 } });
    (useUserData as jest.Mock).mockReturnValue({ data: { group_memberships: [] }, isLoading: false });
    (isGroupMember as jest.Mock).mockReturnValue(true);

    render(<GroupInfoScreen />, { wrapper: createWrapper() });

    expect(screen.queryByText("Leave Group")).toBeNull();
  });

  it("shows Leader Tools and admin Settings rows for a community admin", () => {
    (useGroupDetails as jest.Mock).mockReturnValue({ data: mockGroup, isLoading: false, error: null });
    (useAuth as jest.Mock).mockReturnValue({ user: { id: 1, is_admin: true } });
    (useUserData as jest.Mock).mockReturnValue({ data: { group_memberships: [] }, isLoading: false });
    (isGroupMember as jest.Mock).mockReturnValue(true);

    render(<GroupInfoScreen />, { wrapper: createWrapper() });

    expect(screen.getByText("LEADER TOOLS")).toBeTruthy();
    expect(screen.getByText("People")).toBeTruthy();
    expect(screen.getByText("Rostering")).toBeTruthy();
    expect(screen.getByText("SETTINGS")).toBeTruthy();
    expect(screen.getAllByText("ADMIN").length).toBeGreaterThan(0);
    expect(screen.getByText("Archive Group")).toBeTruthy();
  });

  it("hides Leader Tools and Settings for a plain member", () => {
    (useGroupDetails as jest.Mock).mockReturnValue({ data: mockGroup, isLoading: false, error: null });
    (useAuth as jest.Mock).mockReturnValue({ user: { id: 1, is_admin: false } });
    (useUserData as jest.Mock).mockReturnValue({ data: { group_memberships: [] }, isLoading: false });
    (isGroupMember as jest.Mock).mockReturnValue(true);

    render(<GroupInfoScreen />, { wrapper: createWrapper() });

    expect(screen.queryByText("LEADER TOOLS")).toBeNull();
    expect(screen.queryByText("SETTINGS")).toBeNull();
    expect(screen.queryByText("Archive Group")).toBeNull();
  });
});
