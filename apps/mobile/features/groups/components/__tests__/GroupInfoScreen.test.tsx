import React from "react";
import { StyleSheet } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GroupInfoScreen } from "../GroupInfoScreen";
import { waAvatarPalette, WA_AVATAR_PROFILE, WA_TYPE_HERO_NAME, WA_ACTION_CARD_HEIGHT } from "@components/wa";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useQuery, useAuthenticatedQuery } from "@services/api/convex";
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
      admin: {
        featureFlags: {
          getFeatureFlag: "api.functions.admin.featureFlags.getFeatureFlag",
        },
      },
      groups: {
        index: {
          getById: "api.functions.groups.index.getById",
          getLeaders: "api.functions.groups.index.getLeaders",
          setHiddenFromDiscovery: "api.functions.groups.index.setHiddenFromDiscovery",
          setJoinApprovalMode: "api.functions.groups.index.setJoinApprovalMode",
        },
      },
      finance: {
        giving: {
          getGivingContext: "api.functions.finance.giving.getGivingContext",
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

// Shared across renders so navigation targets are assertable (only read
// inside `useRouter`'s body, i.e. long after the hoisted factory runs).
const mockRouterPush = jest.fn();

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ group_id: "1" }),
  useRouter: () => ({
    push: mockRouterPush,
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

// GroupHeader is no longer used by this screen (WA-VISUAL-DELTAS.md §3.1/§3.2
// replaced its opaque bar + hero with WaSubScreenHeader and a local WA hero);
// it stays mocked only because GroupNonMemberView still renders it.
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

jest.mock("@/providers/ImageViewerProvider", () => ({
  ImageViewerManager: { show: jest.fn() },
}));

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
    expect(screen.getByText("Test Group")).toBeTruthy();
    // §3.3 promoted Mute out of its own card into the action-button row.
    expect(screen.getByLabelText("Mute")).toBeTruthy();
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

    // S3.5 killed the ALL-CAPS section labels — sentence case now.
    expect(screen.getByText("Leader tools")).toBeTruthy();
    expect(screen.queryByText("LEADER TOOLS")).toBeNull();
    expect(screen.getByText("People")).toBeTruthy();
    expect(screen.getByText("Rostering")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getAllByText("ADMIN").length).toBeGreaterThan(0);
    expect(screen.getByText("Archive Group")).toBeTruthy();
  });

  it("hides Leader Tools and Settings for a plain member", () => {
    (useGroupDetails as jest.Mock).mockReturnValue({ data: mockGroup, isLoading: false, error: null });
    (useAuth as jest.Mock).mockReturnValue({ user: { id: 1, is_admin: false } });
    (useUserData as jest.Mock).mockReturnValue({ data: { group_memberships: [] }, isLoading: false });
    (isGroupMember as jest.Mock).mockReturnValue(true);

    render(<GroupInfoScreen />, { wrapper: createWrapper() });

    expect(screen.queryByText("Leader tools")).toBeNull();
    expect(screen.queryByText("Settings")).toBeNull();
    expect(screen.queryByText("Archive Group")).toBeNull();
  });

  // --- ADR-032 §4: giving is a MEMBER capability -----------------------------

  describe("member Giving entry point (ADR-032 §4)", () => {
    const GIVING_CONTEXT = {
      fundId: "fund1",
      fundName: "Small Group Fund",
      communityLegalName: "Demo Community",
      suggestedAmountsCents: [1000, 2500, 5000],
      givingLive: true,
    };

    /**
     * The row hangs off two independent signals: the app-wide `group-giving`
     * flag (plain `useQuery`) and whether this group actually has a fund
     * (`getGivingContext` via `useAuthenticatedQuery`).
     */
    const setUpGiving = ({ flagOn, hasFund }: { flagOn: boolean; hasFund: boolean }) => {
      (useQuery as jest.Mock).mockImplementation((ref: any, args: any) =>
        ref === "api.functions.admin.featureFlags.getFeatureFlag" && args?.key === "group-giving"
          ? flagOn
          : undefined,
      );
      (useAuthenticatedQuery as jest.Mock).mockImplementation((ref: any) =>
        ref === "api.functions.finance.giving.getGivingContext"
          ? hasFund
            ? GIVING_CONTEXT
            : null
          : undefined,
      );
    };

    const renderAs = ({
      leader = false,
      admin = false,
    }: { leader?: boolean; admin?: boolean } = {}) => {
      (useGroupDetails as jest.Mock).mockReturnValue({
        data: leader ? { ...mockGroup, user_role: "leader" } : mockGroup,
        isLoading: false,
        error: null,
      });
      (useAuth as jest.Mock).mockReturnValue({ user: { id: 1, is_admin: admin } });
      (useUserData as jest.Mock).mockReturnValue({
        data: { group_memberships: [] },
        isLoading: false,
      });
      (isGroupMember as jest.Mock).mockReturnValue(true);
      return render(<GroupInfoScreen />, { wrapper: createWrapper() });
    };

    afterEach(() => {
      // Restore the file-wide defaults so later suites aren't inheriting
      // these per-query implementations.
      (useQuery as jest.Mock).mockImplementation(() => undefined);
      (useAuthenticatedQuery as jest.Mock).mockImplementation(() => undefined);
    });

    it("shows a plain member the group fund", () => {
      setUpGiving({ flagOn: true, hasFund: true });
      renderAs();

      expect(screen.getByText("Group fund")).toBeTruthy();
      // ...and it is genuinely outside the leader-gated block.
      expect(screen.queryByText("Leader tools")).toBeNull();
    });

    it("routes a member to their own fund screen, not the leader hub", () => {
      setUpGiving({ flagOn: true, hasFund: true });
      renderAs();

      fireEvent.press(screen.getByText("Group fund"));
      expect(mockRouterPush).toHaveBeenCalledWith("/groups/1/fund");
      expect(mockRouterPush).not.toHaveBeenCalledWith(
        expect.stringContaining("leader-tools"),
      );
    });

    it("hides the entry point when the group-giving flag is off", () => {
      setUpGiving({ flagOn: false, hasFund: true });
      renderAs();

      expect(screen.queryByText("Group fund")).toBeNull();
      expect(screen.queryByText("Giving")).toBeNull();
    });

    it("hides the entry point when the group has no fund", () => {
      setUpGiving({ flagOn: true, hasFund: false });
      renderAs();

      expect(screen.queryByText("Group fund")).toBeNull();
      expect(screen.queryByText("Giving")).toBeNull();
    });

    it("gives a leader both the Leader-tools row and the member entry point", () => {
      setUpGiving({ flagOn: true, hasFund: true });
      renderAs({ leader: true });

      expect(screen.getByText("Leader tools")).toBeTruthy();
      expect(screen.getByText("Group fund")).toBeTruthy();
      // "Giving" appears twice: the member card's section header and the
      // Leader-tools row that opens the management hub.
      expect(screen.getAllByText("Giving")).toHaveLength(2);

      fireEvent.press(screen.getByText("Group fund"));
      expect(mockRouterPush).toHaveBeenLastCalledWith("/groups/1/fund");
      fireEvent.press(screen.getAllByText("Giving")[1]);
      expect(mockRouterPush).toHaveBeenLastCalledWith("/(user)/leader-tools/1/giving");
    });

    // The tests above stub `isGroupMember` true and hand `getGivingContext` a
    // friendly value, so they can't see what a real non-member gets. This
    // route is reachable without membership (share link / Explore), and the
    // server's answer to a non-member used to be a THROWN error, which Convex
    // re-raises synchronously during render — i.e. the root ErrorBoundary
    // instead of the join CTA, for every non-member of any group with a fund.
    describe("as a genuine non-member", () => {
      const renderAsNonMember = () => {
        (useGroupDetails as jest.Mock).mockReturnValue({
          data: mockGroup,
          isLoading: false,
          error: null,
        });
        (useAuth as jest.Mock).mockReturnValue({ user: { id: 999, is_admin: false } });
        (useUserData as jest.Mock).mockReturnValue({
          data: { group_memberships: [] },
          isLoading: false,
        });
        (isGroupMember as jest.Mock).mockReturnValue(false);
        return render(<GroupInfoScreen />, { wrapper: createWrapper() });
      };

      it("skips the giving query entirely — it has no row to render", () => {
        (useQuery as jest.Mock).mockImplementation((ref: any, args: any) =>
          ref === "api.functions.admin.featureFlags.getFeatureFlag" && args?.key === "group-giving"
            ? true
            : undefined,
        );
        renderAsNonMember();

        const givingCalls = (useAuthenticatedQuery as jest.Mock).mock.calls.filter(
          ([ref]) => ref === "api.functions.finance.giving.getGivingContext",
        );
        expect(givingCalls.length).toBeGreaterThan(0);
        for (const [, args] of givingCalls) {
          expect(args).toBe("skip");
        }
        expect(screen.getByTestId("non-member-view")).toBeTruthy();
        expect(screen.queryByText("Group fund")).toBeNull();
      });

      it("still reaches the join CTA even if the giving query throws", () => {
        // Reproduces the crash directly: `useAuthenticatedQuery` throws the way
        // Convex re-throws a server error mid-render. If the screen ever fires
        // this query for a non-member again, this test dies with that error
        // instead of rendering GroupNonMemberView.
        (useQuery as jest.Mock).mockImplementation((ref: any, args: any) =>
          ref === "api.functions.admin.featureFlags.getFeatureFlag" && args?.key === "group-giving"
            ? true
            : undefined,
        );
        (useAuthenticatedQuery as jest.Mock).mockImplementation((ref: any, args: any) => {
          if (ref === "api.functions.finance.giving.getGivingContext" && args !== "skip") {
            throw new Error("You don't have access to this fund");
          }
          return undefined;
        });

        expect(() => renderAsNonMember()).not.toThrow();
        expect(screen.getByTestId("non-member-view")).toBeTruthy();
      });
    });
  });

  // --- WA-VISUAL-DELTAS.md §3 ------------------------------------------------

  describe("WA visual deltas (§3)", () => {
    beforeEach(() => {
      (useGroupDetails as jest.Mock).mockReturnValue({ data: mockGroup, isLoading: false, error: null });
      (useAuth as jest.Mock).mockReturnValue({ user: { id: 1 } });
      (useUserData as jest.Mock).mockReturnValue({ data: { group_memberships: [] }, isLoading: false });
      (isGroupMember as jest.Mock).mockReturnValue(true);
    });

    it("§3.1: renders a floating sub-screen header, not GroupHeader's opaque bar", () => {
      render(<GroupInfoScreen />, { wrapper: createWrapper() });
      expect(screen.getByText("Group info")).toBeTruthy();
      expect(screen.getByLabelText("Back")).toBeTruthy();
      expect(screen.queryByTestId("group-header")).toBeNull();
    });

    it("§3.2: hero avatar is a 100pt disc with a muted pastel (non-green) fallback", () => {
      render(<GroupInfoScreen />, { wrapper: createWrapper() });
      const avatar = screen.getByTestId("group-hero-avatar-placeholder");
      const style = StyleSheet.flatten(avatar.props.style);
      expect(style.width).toBe(WA_AVATAR_PROFILE);
      expect(style.borderRadius).toBe(WA_AVATAR_PROFILE / 2);
      expect(style.backgroundColor).toBe(waAvatarPalette("Test Group", false).background);
      expect(style.backgroundColor).not.toBe(DEFAULT_PRIMARY_COLOR);
    });

    it("§3.2: the hero name is 28pt bold and the subtitle is 15pt gray", () => {
      render(<GroupInfoScreen />, { wrapper: createWrapper() });
      const nameStyle = StyleSheet.flatten(screen.getByText("Test Group").props.style);
      expect(nameStyle.fontSize).toBe(WA_TYPE_HERO_NAME);
      expect(nameStyle.fontWeight).toBe("700");

      const subtitle = screen.getByText("2 members · Small Group");
      expect(StyleSheet.flatten(subtitle.props.style).fontSize).toBe(15);
    });

    it("§3.3: Share/Invite/Mute render as ~76pt white action cards", () => {
      render(<GroupInfoScreen />, { wrapper: createWrapper() });
      for (const label of ["Share", "Invite", "Mute"]) {
        const card = screen.getByLabelText(label);
        expect(StyleSheet.flatten(card.props.style).height).toBe(WA_ACTION_CARD_HEIGHT);
      }
    });
  });
});
