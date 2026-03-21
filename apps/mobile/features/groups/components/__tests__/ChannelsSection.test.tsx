/**
 * Tests for ChannelsSection Component
 *
 * Component: ChannelsSection
 * Location: /features/groups/components/ChannelsSection.tsx
 *
 * Tests the channels display on the group detail page including:
 * - Auto channels section (General, Leaders)
 * - Custom channels section
 * - Leader toggle for leaders channel
 * - Create channel button for leaders
 * - Leave channel functionality
 * - Unread badges
 * - Navigation
 */
import React from "react";
import { render, fireEvent, waitFor, act } from "@testing-library/react-native";
import { Alert } from "react-native";

// Mock Alert
jest.spyOn(Alert, "alert");

// Mock router
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock useCommunityTheme
jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({
    primaryColor: "#007AFF",
  }),
}));

// Mock channel data
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
  },
];

// Mock Convex hooks
let mockChannelsData: any[] | undefined = undefined;
const mockLeaveChannelMutation = jest.fn();
const mockToggleLeadersChannelMutation = jest.fn();

jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({ token: "test-token", user: { id: "test-user" }, community: null }),
}));

jest.mock("@services/api/convex", () => ({
  useAuthenticatedQuery: () => mockChannelsData,
  useAuthenticatedMutation: (fn: any) => {
    if (fn === "leaveChannel") return mockLeaveChannelMutation;
    if (fn === "toggleLeadersChannel") return mockToggleLeadersChannelMutation;
    return jest.fn();
  },
  useQuery: () => undefined,
  useMutation: () => jest.fn(),
  api: {
    functions: {
      messaging: {
        channels: {
          listGroupChannels: "listGroupChannels",
          leaveChannel: "leaveChannel",
          toggleLeadersChannel: "toggleLeadersChannel",
          toggleMainChannel: "toggleMainChannel",
          togglePcoChannel: "togglePcoChannel",
          archiveCustomChannel: "archiveCustomChannel",
          unarchiveCustomChannel: "unarchiveCustomChannel",
        },
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

// Import component AFTER mocks
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
    it("shows loading indicator when channels are undefined", () => {
      mockChannelsData = undefined;

      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(getByText("CHANNELS")).toBeTruthy();
      // ActivityIndicator should be present
    });
  });

  describe("Empty State", () => {
    it("returns null when no channels exist", () => {
      mockChannelsData = [];

      const { toJSON } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(toJSON()).toBeNull();
    });
  });

  describe("Auto Channels Section", () => {
    it("renders AUTO CHANNELS header", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(getByText("AUTO CHANNELS")).toBeTruthy();
    });

    it("renders General channel for all users", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(getByText("General")).toBeTruthy();
      expect(getByText("All members")).toBeTruthy();
    });

    it("renders Leaders channel for leaders", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(getByText("Leaders")).toBeTruthy();
      expect(getByText("5 leaders")).toBeTruthy();
    });

    it("shows leader note for leaders channel", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(getByText("You're here because you're a leader")).toBeTruthy();
    });

    it("shows singular leader count correctly", () => {
      mockChannelsData = [
        mockMainChannel,
        { ...mockLeadersChannel, memberCount: 1 },
      ];

      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(getByText("1 leader")).toBeTruthy();
    });
  });

  describe("Custom Channels Section", () => {
    it("renders CUSTOM CHANNELS header", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(getByText("CUSTOM CHANNELS")).toBeTruthy();
    });

    it("renders custom channel names", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(getByText("Directors")).toBeTruthy();
      expect(getByText("Volunteers")).toBeTruthy();
    });

    it("renders member counts for custom channels", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(getByText("8 members")).toBeTruthy();
      expect(getByText("15 members")).toBeTruthy();
    });

    it("shows singular member count correctly", () => {
      mockChannelsData = [
        mockMainChannel,
        { ...mockCustomChannels[0], memberCount: 1 },
      ];

      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(getByText("1 member")).toBeTruthy();
    });

    it("shows empty state for leaders with no custom channels", () => {
      mockChannelsData = [mockMainChannel, mockLeadersChannel];

      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(getByText("No custom channels yet")).toBeTruthy();
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

      // Should not have any numeric badges
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

  describe("Leaders Channel Toggle", () => {
    it("shows toggle switches for leaders (General + Leaders)", () => {
      const { getByTestId } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(getByTestId("channel-toggle-general")).toBeTruthy();
      expect(getByTestId("channel-toggle-leaders")).toBeTruthy();
    });

    it("leaders channel toggle is on when channel is enabled", () => {
      const { getByTestId } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      const leadersSwitch = getByTestId("channel-toggle-leaders");
      expect(leadersSwitch.props.value).toBe(true);
    });

    it("leaders channel toggle is off when channel is archived", () => {
      mockChannelsData = [
        mockMainChannel,
        { ...mockLeadersChannel, isArchived: true },
      ];

      const { getByTestId } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      const leadersSwitch = getByTestId("channel-toggle-leaders");
      expect(leadersSwitch.props.value).toBe(false);
    });

    it("calls toggleLeadersChannel mutation when leaders toggle is used", async () => {
      mockToggleLeadersChannelMutation.mockResolvedValueOnce(undefined);

      const { getByTestId } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      const toggle = getByTestId("channel-toggle-leaders");

      await act(async () => {
        fireEvent(toggle, "valueChange", false);
      });

      await waitFor(() => {
        expect(mockToggleLeadersChannelMutation).toHaveBeenCalledWith({
          groupId: "test-group",
          enabled: false,
        });
      });
    });

    it("shows error alert on leaders toggle failure", async () => {
      mockToggleLeadersChannelMutation.mockRejectedValueOnce(
        new Error("Toggle failed")
      );

      const { getByTestId } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      const toggle = getByTestId("channel-toggle-leaders");

      await act(async () => {
        fireEvent(toggle, "valueChange", false);
      });

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith("Error", "Toggle failed");
      });
    });

    it("hides channel toggles for non-leaders", () => {
      const { queryByTestId } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(queryByTestId("channel-toggle-general")).toBeNull();
      expect(queryByTestId("channel-toggle-leaders")).toBeNull();
    });

    it("shows disabled state for leaders channel name when archived", () => {
      mockChannelsData = [
        mockMainChannel,
        { ...mockLeadersChannel, isArchived: true },
      ];

      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      const leadersText = getByText("Leaders");
      // Check that the disabled style is applied (color: #999999)
      expect(leadersText.props.style).toContainEqual({ color: "#999999" });
    });
  });

  describe("Leader-Only Features", () => {
    it("shows manage members button for leaders on custom channels", () => {
      const { getAllByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      // people-outline icons for manage members
      const manageIcons = getAllByText("people-outline");
      expect(manageIcons.length).toBe(mockCustomChannels.length);
    });

    it("hides manage members button for non-leaders", () => {
      const { queryByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(queryByText("people-outline")).toBeNull();
    });

    it("shows create channel button for leaders", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(getByText("Create Channel")).toBeTruthy();
    });

    it("hides create channel button for non-leaders", () => {
      const { queryByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(queryByText("Create Channel")).toBeNull();
    });

    it("shows create button for admins", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="admin" />
      );

      expect(getByText("Create Channel")).toBeTruthy();
    });
  });

  describe("Leave Channel", () => {
    it("shows leave button for custom channels", () => {
      const { getAllByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      // exit-outline icons for leave
      const leaveIcons = getAllByText("exit-outline");
      expect(leaveIcons.length).toBe(mockCustomChannels.length);
    });

    it("shows confirmation dialog when leaving channel", () => {
      const { getAllByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      const leaveIcons = getAllByText("exit-outline");

      act(() => {
        fireEvent.press(leaveIcons[0].parent!.parent!);
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        "Leave Channel",
        expect.stringContaining("Directors"),
        expect.any(Array)
      );
    });

    it("calls leaveChannel mutation after confirmation", async () => {
      mockLeaveChannelMutation.mockResolvedValueOnce(undefined);

      const { getAllByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      const leaveIcons = getAllByText("exit-outline");

      act(() => {
        fireEvent.press(leaveIcons[0].parent!.parent!);
      });

      const alertCalls = (Alert.alert as jest.Mock).mock.calls;
      const alertButtons = alertCalls[0][2];
      const leaveButton = alertButtons.find((b: any) => b.text === "Leave");

      await act(async () => {
        await leaveButton.onPress();
      });

      expect(mockLeaveChannelMutation).toHaveBeenCalledWith({
        channelId: "channel-custom-1",
      });
    });

    it("shows error alert on leave failure", async () => {
      mockLeaveChannelMutation.mockRejectedValueOnce(
        new Error("Failed to leave channel")
      );

      const { getAllByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      const leaveIcons = getAllByText("exit-outline");

      act(() => {
        fireEvent.press(leaveIcons[0].parent!.parent!);
      });

      const alertCalls = (Alert.alert as jest.Mock).mock.calls;
      const leaveButton = alertCalls[0][2].find((b: any) => b.text === "Leave");

      await act(async () => {
        await leaveButton.onPress();
      });

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          "Error",
          "Failed to leave channel"
        );
      });
    });
  });

  describe("Navigation", () => {
    it("navigates to General channel on tap", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      const generalChannel = getByText("General");

      act(() => {
        fireEvent.press(generalChannel.parent!.parent!);
      });

      expect(mockPush).toHaveBeenCalledWith("/inbox/test-group/general");
    });

    it("navigates to Leaders channel on tap", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      const leadersChannel = getByText("Leaders");

      act(() => {
        fireEvent.press(leadersChannel.parent!.parent!);
      });

      expect(mockPush).toHaveBeenCalledWith("/inbox/test-group/leaders");
    });

    it("navigates to custom channel on tap", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      const directorsChannel = getByText("Directors");

      act(() => {
        fireEvent.press(directorsChannel.parent!.parent!);
      });

      expect(mockPush).toHaveBeenCalledWith("/inbox/test-group/directors");
    });

    it("navigates to create channel screen", () => {
      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      const createButton = getByText("Create Channel");

      act(() => {
        fireEvent.press(createButton.parent!);
      });

      expect(mockPush).toHaveBeenCalledWith("/inbox/test-group/create");
    });

    it("navigates to manage members for custom channel", () => {
      const { getAllByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      const manageIcons = getAllByText("people-outline");

      act(() => {
        fireEvent.press(manageIcons[0].parent!.parent!);
      });

      expect(mockPush).toHaveBeenCalledWith("/inbox/test-group/directors/members");
    });

    it("does not navigate to disabled Leaders channel", () => {
      mockChannelsData = [
        mockMainChannel,
        { ...mockLeadersChannel, isArchived: true },
      ];

      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      const leadersChannel = getByText("Leaders");

      act(() => {
        fireEvent.press(leadersChannel.parent!.parent!);
      });

      // Should not navigate when disabled
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

      // chatbubble (singular) for custom channels
      const chatIcons = getAllByText("chatbubble");
      expect(chatIcons.length).toBe(mockCustomChannels.length);
    });
  });

  describe("Visibility Rules", () => {
    it("hides custom channels section for non-leaders with no custom channels", () => {
      mockChannelsData = [mockMainChannel];

      const { queryByText } = render(
        <ChannelsSection groupId="test-group" userRole="member" />
      );

      expect(queryByText("CUSTOM CHANNELS")).toBeNull();
    });

    it("shows custom channels section for leaders even with no custom channels", () => {
      mockChannelsData = [mockMainChannel, mockLeadersChannel];

      const { getByText } = render(
        <ChannelsSection groupId="test-group" userRole="leader" />
      );

      expect(getByText("CUSTOM CHANNELS")).toBeTruthy();
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
});
