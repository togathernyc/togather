/**
 * Tests for the redesigned ChannelsSection.
 *
 * The single CHANNELS card replaced the AUTO/CUSTOM split. Each row is
 * navigation-only — no toggles, no trailing icon clusters. Per-channel
 * configuration moved to /inbox/[groupId]/[channelSlug]/info, so tap
 * targets here just route there.
 *
 * Removed (covered by the new info screen tests once they exist):
 *   - Leaders Channel Toggle
 *   - Manage members button
 *   - Leave Channel from row
 *   - "AUTO CHANNELS" / "CUSTOM CHANNELS" headers
 */
import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";
import { Alert } from "react-native";

jest.spyOn(Alert, "alert");

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({ primaryColor: "#007AFF" }),
}));

jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: {
      background: "#fff",
      surface: "#fff",
      surfaceSecondary: "#f5f5f5",
      text: "#000",
      textSecondary: "#666",
      textTertiary: "#999",
      border: "#e5e5e5",
      iconSecondary: "#666",
      destructive: "#FF3B30",
      textInverse: "#fff",
    },
    isDark: false,
  }),
}));

const mockMainChannel = {
  _id: "channel-main",
  slug: "general",
  channelType: "main",
  name: "General",
  memberCount: 50,
  isArchived: false,
  isMember: true,
  unreadCount: 0,
  isPinned: false,
  isEnabled: true,
};

const mockLeadersChannel = {
  _id: "channel-leaders",
  slug: "leaders",
  channelType: "leaders",
  name: "Leaders",
  memberCount: 5,
  isArchived: false,
  isMember: true,
  unreadCount: 2,
  isPinned: false,
  isEnabled: true,
};

const mockCustomChannels = [
  {
    _id: "channel-custom-1",
    slug: "directors",
    channelType: "custom",
    name: "Directors",
    memberCount: 8,
    isArchived: false,
    isMember: true,
    unreadCount: 0,
    isPinned: false,
    isEnabled: true,
  },
  {
    _id: "channel-custom-2",
    slug: "volunteers",
    channelType: "custom",
    name: "Volunteers",
    memberCount: 15,
    isArchived: false,
    isMember: true,
    unreadCount: 5,
    isPinned: false,
    isEnabled: true,
  },
];

let mockChannelsData: any[] | undefined = undefined;

jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({ token: "test-token", user: { id: "test-user" }, community: null }),
}));

// Mock the useGroupChannels hook directly — that's the source of truth
// the component reads from, and this avoids us having to model the
// authenticated-query plumbing inside this test.
jest.mock("../../hooks/useGroupChannels", () => ({
  useGroupChannels: () => ({
    channels: mockChannelsData,
    isLoading: mockChannelsData === undefined,
    isStale: false,
  }),
}));

jest.mock("../../hooks/useRespondToChannelInvite", () => ({
  useRespondToChannelInvite: () => ({
    respondingTo: null,
    handleRespond: jest.fn(),
  }),
}));

jest.mock("@services/api/convex", () => ({
  useAuthenticatedMutation: () => jest.fn(),
  useQuery: () => undefined, // pendingInvites
  useMutation: () => jest.fn(),
  api: {
    functions: {
      messaging: {
        channels: { listGroupChannels: "listGroupChannels" },
        channelInvites: {
          enableInviteLink: "enableInviteLink",
          getPendingRequestCountByGroup: "getPendingRequestCountByGroup",
        },
        sharedChannels: {
          listPendingInvitesForGroup: "listPendingInvitesForGroup",
          respondToChannelInvite: "respondToChannelInvite",
        },
      },
    },
  },
}));

// Mock the join-requests banner so we don't have to set up its query
// dependencies for these tests.
jest.mock("../ChannelJoinRequestsBanner", () => ({
  ChannelJoinRequestsBanner: () => null,
}));

import { ChannelsSection } from "../ChannelsSection";

describe("ChannelsSection (redesigned)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockChannelsData = [
      mockMainChannel,
      mockLeadersChannel,
      ...mockCustomChannels,
    ];
  });

  describe("Loading state", () => {
    it("shows loading indicator when channels are undefined", () => {
      mockChannelsData = undefined;

      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(getByText("CHANNELS")).toBeTruthy();
    });
  });

  describe("Empty state", () => {
    it("returns null when no channels exist", () => {
      mockChannelsData = [];

      const { toJSON } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(toJSON()).toBeNull();
    });
  });

  describe("Single CHANNELS section", () => {
    it("renders one CHANNELS header (no AUTO/CUSTOM split)", () => {
      const { getByText, queryByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(getByText("CHANNELS")).toBeTruthy();
      expect(queryByText("AUTO CHANNELS")).toBeNull();
      expect(queryByText("CUSTOM CHANNELS")).toBeNull();
    });

    it("renders General row with 'All members' subtitle", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(getByText("General")).toBeTruthy();
      expect(getByText("All members")).toBeTruthy();
    });

    it("renders Leaders row for leaders", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(getByText("Leaders")).toBeTruthy();
      expect(getByText("5 leaders")).toBeTruthy();
    });

    it("renders custom channel names and member counts", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(getByText("Directors")).toBeTruthy();
      expect(getByText("Volunteers")).toBeTruthy();
      expect(getByText("8 members")).toBeTruthy();
      expect(getByText("15 members")).toBeTruthy();
    });
  });

  describe("No toggles, no trailing icon clusters", () => {
    it("does not render any channel toggle switches for leaders", () => {
      const { queryByTestId } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(queryByTestId("channel-toggle-general")).toBeNull();
      expect(queryByTestId("channel-toggle-leaders")).toBeNull();
      expect(queryByTestId("channel-toggle-reach-out")).toBeNull();
    });

    it("does not render leave (exit) icons on custom channel rows", () => {
      const { queryAllByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(queryAllByText("exit-outline")).toHaveLength(0);
    });

    it("does not render manage-members (people-outline) icons", () => {
      const { queryAllByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(queryAllByText("people-outline")).toHaveLength(0);
    });
  });

  describe("Navigation", () => {
    it("navigates to General /info on tap (where Active state lives)", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      act(() => {
        fireEvent.press(getByText("General").parent!.parent!.parent!);
      });

      expect(mockPush).toHaveBeenCalledWith("/inbox/test-group/general/info");
    });

    it("navigates to Leaders /info on tap", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      act(() => {
        fireEvent.press(getByText("Leaders").parent!.parent!.parent!);
      });

      expect(mockPush).toHaveBeenCalledWith("/inbox/test-group/leaders/info");
    });

    it("navigates to custom channel /info on tap", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      act(() => {
        fireEvent.press(getByText("Directors").parent!.parent!.parent!);
      });

      expect(mockPush).toHaveBeenCalledWith("/inbox/test-group/directors/info");
    });

    it("navigates to create channel screen", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      act(() => {
        fireEvent.press(getByText("Create Channel").parent!);
      });

      expect(mockPush).toHaveBeenCalledWith("/inbox/test-group/create");
    });
  });

  describe("Unread badges", () => {
    it("displays unread badge on Leaders channel", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(getByText("2")).toBeTruthy();
    });

    it("displays unread badge on custom channel", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(getByText("5")).toBeTruthy();
    });

    it("does not display badge when unread count is 0", () => {
      mockChannelsData = [
        { ...mockMainChannel, unreadCount: 0 },
        { ...mockLeadersChannel, unreadCount: 0 },
      ];

      const { queryByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(queryByText("0")).toBeNull();
    });

    it("displays 99+ for high unread counts", () => {
      mockChannelsData = [{ ...mockMainChannel, unreadCount: 150 }];

      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(getByText("99+")).toBeTruthy();
    });
  });

  describe("Leader-only affordances", () => {
    it("shows Create Channel for leaders", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(getByText("Create Channel")).toBeTruthy();
    });

    it("hides Create Channel for non-leaders", () => {
      const { queryByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(queryByText("Create Channel")).toBeNull();
    });

    it("shows Leaders row for leaders even when channel does not exist yet", () => {
      mockChannelsData = [mockMainChannel];

      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(getByText("Leaders")).toBeTruthy();
      expect(getByText("Disabled")).toBeTruthy();
    });
  });

  describe("Archived channels fold into one collapsible section", () => {
    const disabledCustomChannel = {
      _id: "channel-custom-archived",
      slug: "old-team",
      channelType: "custom",
      name: "Old Team",
      memberCount: 0,
      isArchived: false,
      isMember: false,
      unreadCount: 0,
      isPinned: false,
      isEnabled: false, // leader hid it → "Hidden — visible to leaders"
    };

    it("hides archived/disabled channels behind a single 'Archived' toggle for leaders", () => {
      mockChannelsData = [
        mockMainChannel,
        mockLeadersChannel,
        ...mockCustomChannels,
        disabledCustomChannel,
      ];

      const { getByText, queryByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      // The disabled channel is folded away — not shown directly…
      expect(queryByText("Old Team")).toBeNull();
      // …but a single Archived toggle summarizes it.
      expect(getByText("Archived")).toBeTruthy();
      expect(getByText(/1 channel/)).toBeTruthy();
    });

    it("expands the archived channel when the toggle is pressed", () => {
      mockChannelsData = [
        mockMainChannel,
        mockLeadersChannel,
        disabledCustomChannel,
      ];

      const { getByText, queryByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(queryByText("Old Team")).toBeNull();

      act(() => {
        fireEvent.press(getByText("Archived").parent!.parent!);
      });

      expect(getByText("Old Team")).toBeTruthy();
    });

    it("does not show an Archived toggle when there are no archived channels", () => {
      mockChannelsData = [mockMainChannel, mockLeadersChannel];

      const { queryByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(queryByText("Archived")).toBeNull();
    });

    it("folds a General channel hidden via isEnabled=false (not just isArchived)", () => {
      // Regression: a disabled General (isEnabled: false, isArchived: false)
      // must read as Disabled and fold under Archived, not show as active
      // "All members".
      mockChannelsData = [
        { ...mockMainChannel, isEnabled: false, isArchived: false },
        mockLeadersChannel,
      ];

      const { getByText, queryByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(queryByText("All members")).toBeNull();
      expect(getByText("Archived")).toBeTruthy();

      act(() => {
        fireEvent.press(getByText("Archived").parent!.parent!);
      });

      expect(getByText("General")).toBeTruthy();
    });

    it("does not show an Archived toggle to members (they never receive disabled channels)", () => {
      // Members are filtered to enabled channels before rows are built, so
      // there is nothing to fold and no toggle appears.
      mockChannelsData = [mockMainChannel, ...mockCustomChannels];

      const { queryByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(queryByText("Archived")).toBeNull();
    });
  });
});
