/**
 * Tests for ChannelsSection Component
 *
 * Component: ChannelsSection
 * Location: /features/groups/components/ChannelsSection.tsx
 *
 * After the group-page DM-style refactor, this component is a single
 * "CHANNELS" card with one row per channel. Toggles, trailing icons, and the
 * separate AUTO/CUSTOM section split are gone. Tap behavior: General opens the
 * chat directly, every other channel opens the new channel info screen.
 */
import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";
import { Alert } from "react-native";

jest.spyOn(Alert, "alert");

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({
    primaryColor: "#007AFF",
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

jest.mock("@services/api/convex", () => ({
  useAuthenticatedQuery: () => mockChannelsData,
  useAuthenticatedMutation: () => jest.fn(),
  useQuery: () => undefined,
  useMutation: () => jest.fn(),
  api: {
    functions: {
      messaging: {
        channels: {
          listGroupChannels: "listGroupChannels",
        },
        channelInvites: {
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

import { ChannelsSection } from "../ChannelsSection";

describe("ChannelsSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockChannelsData = [
      mockMainChannel,
      mockLeadersChannel,
      ...mockCustomChannels,
    ];
  });

  describe("Loading State", () => {
    it("shows the CHANNELS header while loading", () => {
      mockChannelsData = undefined;

      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(getByText("CHANNELS")).toBeTruthy();
    });
  });

  describe("Empty State", () => {
    it("returns null when no channels exist for non-leaders", () => {
      mockChannelsData = [];

      const { toJSON } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(toJSON()).toBeNull();
    });
  });

  describe("Unified CHANNELS card", () => {
    it("renders a single CHANNELS section header", () => {
      const { getByText, queryByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(getByText("CHANNELS")).toBeTruthy();
      expect(queryByText("AUTO CHANNELS")).toBeNull();
      expect(queryByText("CUSTOM CHANNELS")).toBeNull();
    });

    it("renders General row for all users", () => {
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

    it("uses singular leader count when there is exactly one leader", () => {
      mockChannelsData = [
        mockMainChannel,
        { ...mockLeadersChannel, memberCount: 1 },
      ];

      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(getByText("1 leader")).toBeTruthy();
    });

    it("renders custom channel rows alongside auto channels", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(getByText("Directors")).toBeTruthy();
      expect(getByText("Volunteers")).toBeTruthy();
      expect(getByText("8 members")).toBeTruthy();
      expect(getByText("15 members")).toBeTruthy();
    });

    it("uses singular member count when there is exactly one member", () => {
      mockChannelsData = [
        mockMainChannel,
        { ...mockCustomChannels[0], memberCount: 1 },
      ];

      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(getByText("1 member")).toBeTruthy();
    });

    it("shows Leaders row for leaders even when channel doesn't exist yet", () => {
      mockChannelsData = [mockMainChannel];

      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(getByText("Leaders")).toBeTruthy();
      expect(getByText("Disabled")).toBeTruthy();
    });
  });

  describe("Unread Badges", () => {
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

  describe("Create Channel CTA", () => {
    it("shows the Create Channel card for leaders", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(getByText("Create Channel")).toBeTruthy();
    });

    it("shows the Create Channel card for admins", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="admin" />
      );

      expect(getByText("Create Channel")).toBeTruthy();
    });

    it("hides the Create Channel card for non-leaders", () => {
      const { queryByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(queryByText("Create Channel")).toBeNull();
    });
  });

  describe("Navigation", () => {
    it("opens the chat directly when General is tapped", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      act(() => {
        fireEvent.press(getByText("General").parent!.parent!);
      });

      expect(mockPush).toHaveBeenCalledWith("/inbox/test-group/general");
    });

    it("opens the channel info screen when Leaders is tapped", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      act(() => {
        fireEvent.press(getByText("Leaders").parent!.parent!);
      });

      expect(mockPush).toHaveBeenCalledWith("/inbox/test-group/leaders/info");
    });

    it("opens the channel info screen when a custom channel is tapped", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      act(() => {
        fireEvent.press(getByText("Directors").parent!.parent!);
      });

      expect(mockPush).toHaveBeenCalledWith("/inbox/test-group/directors/info");
    });

    it("navigates to the create channel screen when Create Channel is tapped", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      act(() => {
        fireEvent.press(getByText("Create Channel").parent!);
      });

      expect(mockPush).toHaveBeenCalledWith("/inbox/test-group/create");
    });

    it("does not navigate when Leaders channel is disabled", () => {
      mockChannelsData = [
        mockMainChannel,
        { ...mockLeadersChannel, isArchived: true },
      ];

      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      act(() => {
        fireEvent.press(getByText("Leaders").parent!.parent!);
      });

      expect(mockPush).not.toHaveBeenCalledWith(
        expect.stringContaining("leaders")
      );
    });
  });

  describe("Channel Icons", () => {
    it("renders chatbubbles icon for General channel", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(getByText("chatbubbles")).toBeTruthy();
    });

    it("renders star icon for Leaders channel", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(getByText("star")).toBeTruthy();
    });

    it("renders chatbubble icon for custom channels", () => {
      const { getAllByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      const chatIcons = getAllByText("chatbubble");
      expect(chatIcons.length).toBe(mockCustomChannels.length);
    });
  });
});
