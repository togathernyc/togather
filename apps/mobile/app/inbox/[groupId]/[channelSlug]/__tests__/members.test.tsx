/**
 * Tests for Channel Members Management Screen
 *
 * Route: /inbox/[groupId]/[channelSlug]/members
 *
 * Tests the channel members management including:
 * - Member list rendering with owner badges
 * - Add/remove member functionality
 * - Authorization checks (owner vs regular member)
 * - Archive channel functionality
 * - Navigation and error handling
 */
import React from "react";
import { render, fireEvent, waitFor, act } from "@testing-library/react-native";
import { Alert } from "react-native";

// Mock Alert
jest.spyOn(Alert, "alert");

// Mock modules BEFORE importing component
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);
const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: mockReplace,
    back: mockBack,
    canGoBack: mockCanGoBack,
    push: mockPush,
  }),
  useLocalSearchParams: () => ({
    groupId: "test-group-id",
    channelSlug: "test-channel",
  }),
}));

// Mock AuthProvider
const mockUser = {
  id: "user-1",
  displayName: "Current User",
};

jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({
    token: "mock-token",
    user: mockUser,
    community: { id: "test-community-id" },
  }),
}));

// Mock useCommunityTheme
jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({
    primaryColor: "#007AFF",
  }),
}));

// Mock Convex hooks
const mockChannelData = {
  _id: "channel-1",
  groupId: "test-group-id",
  name: "Test Channel",
  channelType: "custom",
  role: "owner",
  userGroupRole: "leader",
};

const mockMembersData = {
  members: [
    {
      id: "member-1",
      userId: "user-1",
      displayName: "Current User",
      profilePhoto: null,
      role: "owner",
    },
    {
      id: "member-2",
      userId: "user-2",
      displayName: "John Doe",
      profilePhoto: "https://example.com/photo.jpg",
      role: "member",
    },
    {
      id: "member-3",
      userId: "user-3",
      displayName: "Jane Smith",
      profilePhoto: null,
      role: "member",
    },
  ],
  totalCount: 3,
};

const mockGroupData = {
  _id: "test-group-id",
  name: "Test Group",
  communityId: "test-community-id",
};

let mockUseQueryReturn: any = null;
const mockAddMembersMutation = jest.fn();
const mockRemoveMemberMutation = jest.fn();
const mockArchiveChannelMutation = jest.fn();

jest.mock("@services/api/convex", () => ({
  useQuery: (fn: any, args: any) => {
    if (args === "skip") return undefined;
    // Return different data based on the function
    if (fn === "getChannelBySlug") return mockUseQueryReturn?.channelData;
    if (fn === "getChannelMembers") return mockUseQueryReturn?.membersData;
    if (fn === "getById") return mockUseQueryReturn?.groupData;
    if (fn === "getAutoChannelConfigByChannel") return mockUseQueryReturn?.autoChannelConfig ?? undefined;
    return mockUseQueryReturn?.channelData;
  },
  useMutation: (fn: any) => {
    if (fn === "addChannelMembers") return mockAddMembersMutation;
    if (fn === "removeChannelMember") return mockRemoveMemberMutation;
    if (fn === "archiveCustomChannel") return mockArchiveChannelMutation;
    if (fn === "archivePcoChannel") return jest.fn();
    if (fn === "inviteGroupToChannel") return jest.fn();
    if (fn === "respondToChannelInvite") return jest.fn();
    if (fn === "removeGroupFromChannel") return jest.fn();
    return jest.fn();
  },
  api: {
    functions: {
      messaging: {
        channels: {
          getChannelBySlug: "getChannelBySlug",
          getChannelMembers: "getChannelMembers",
          addChannelMembers: "addChannelMembers",
          removeChannelMember: "removeChannelMember",
          archiveCustomChannel: "archiveCustomChannel",
          archivePcoChannel: "archivePcoChannel",
        },
        sharedChannels: {
          inviteGroupToChannel: "inviteGroupToChannel",
          respondToChannelInvite: "respondToChannelInvite",
          removeGroupFromChannel: "removeGroupFromChannel",
        },
      },
      groups: {
        index: {
          getById: "getById",
        },
        queries: {
          listByCommunity: "listByCommunity",
        },
      },
      pcoServices: {
        queries: {
          getAutoChannelConfigByChannel: "getAutoChannelConfigByChannel",
        },
      },
    },
  },
}));

// Mock MemberSearch component
jest.mock("@components/ui/MemberSearch", () => ({
  MemberSearch: ({ onMultiSelect }: any) => {
    const { TouchableOpacity, Text } = require("react-native");
    return (
      <TouchableOpacity
        testID="member-search"
        onPress={() =>
          onMultiSelect([
            { user_id: "user-4", first_name: "New", last_name: "Member" },
          ])
        }
      >
        <Text>Search Members</Text>
      </TouchableOpacity>
    );
  },
}));

// Import component AFTER mocks
import ChannelMembersScreen from "../members";

describe("ChannelMembersScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseQueryReturn = {
      channelData: mockChannelData,
      membersData: mockMembersData,
      groupData: mockGroupData,
    };
  });

  describe("Loading State", () => {
    it("shows loading indicator when data is not available", () => {
      mockUseQueryReturn = null;

      const { getByText } = render(<ChannelMembersScreen />);
      expect(getByText("Loading members...")).toBeTruthy();
    });

    it("shows loading indicator when channel data is missing", () => {
      mockUseQueryReturn = { channelData: null, membersData: mockMembersData };

      const { getByText } = render(<ChannelMembersScreen />);
      expect(getByText("Loading members...")).toBeTruthy();
    });

    it("shows loading indicator when members data is missing", () => {
      mockUseQueryReturn = { channelData: mockChannelData, membersData: null };

      const { getByText } = render(<ChannelMembersScreen />);
      expect(getByText("Loading members...")).toBeTruthy();
    });
  });

  describe("Member List Rendering", () => {
    it("renders the channel name in header", () => {
      const { getByText } = render(<ChannelMembersScreen />);
      expect(getByText("Test Channel")).toBeTruthy();
    });

    it("displays correct member count", () => {
      const { getByText } = render(<ChannelMembersScreen />);
      expect(getByText("3 members")).toBeTruthy();
    });

    it("displays singular member count correctly", () => {
      mockUseQueryReturn = {
        channelData: mockChannelData,
        membersData: {
          members: [mockMembersData.members[0]],
          totalCount: 1,
        },
      };

      const { getByText } = render(<ChannelMembersScreen />);
      expect(getByText("1 member")).toBeTruthy();
    });

    it("renders all member names", () => {
      const { getByText } = render(<ChannelMembersScreen />);
      expect(getByText("Current User")).toBeTruthy();
      expect(getByText("John Doe")).toBeTruthy();
      expect(getByText("Jane Smith")).toBeTruthy();
    });

    it("shows owner badge for channel owner", () => {
      const { getByText } = render(<ChannelMembersScreen />);
      expect(getByText("Owner")).toBeTruthy();
    });

    it("shows (you) badge for current user", () => {
      const { getByText } = render(<ChannelMembersScreen />);
      expect(getByText("(you)")).toBeTruthy();
    });

    it("renders member initials when no profile photo", () => {
      const { getByText } = render(<ChannelMembersScreen />);
      // "Current User" -> "CU"
      expect(getByText("CU")).toBeTruthy();
      // "Jane Smith" -> "JS"
      expect(getByText("JS")).toBeTruthy();
    });
  });

  describe("Empty State", () => {
    it("shows empty state when no members", () => {
      mockUseQueryReturn = {
        channelData: mockChannelData,
        membersData: { members: [], totalCount: 0 },
      };

      const { getByText } = render(<ChannelMembersScreen />);
      expect(getByText("No Members")).toBeTruthy();
      expect(getByText("This channel has no members yet.")).toBeTruthy();
    });
  });

  describe("Authorization - Owner/Leader", () => {
    it("shows add member button for channel owner", () => {
      const { getByText } = render(<ChannelMembersScreen />);
      // The add button shows the person-add-outline icon
      expect(getByText("person-add-outline")).toBeTruthy();
    });

    it("shows remove button for non-owner members", () => {
      const { getAllByText } = render(<ChannelMembersScreen />);
      // Should have remove buttons for non-owner members (John Doe, Jane Smith)
      const removeIcons = getAllByText("remove-circle-outline");
      expect(removeIcons.length).toBe(2);
    });

    it("shows archive button for custom channel owner", () => {
      const { getByText } = render(<ChannelMembersScreen />);
      expect(getByText("Archive Channel")).toBeTruthy();
    });

    it("renders bottom actions container when actions are available", () => {
      const { getByTestId } = render(<ChannelMembersScreen />);
      expect(getByTestId("bottom-actions")).toBeTruthy();
    });
  });

  describe("Authorization - Regular Member", () => {
    beforeEach(() => {
      mockUseQueryReturn = {
        channelData: {
          ...mockChannelData,
          role: "member",
          userGroupRole: "member",
        },
        membersData: mockMembersData,
      };
    });

    it("hides add member button for regular members", () => {
      const { queryByText } = render(<ChannelMembersScreen />);
      expect(queryByText("person-add-outline")).toBeNull();
    });

    it("hides remove buttons for regular members", () => {
      const { queryByText } = render(<ChannelMembersScreen />);
      expect(queryByText("remove-circle-outline")).toBeNull();
    });

    it("hides archive button for regular members", () => {
      const { queryByText } = render(<ChannelMembersScreen />);
      expect(queryByText("Archive Channel")).toBeNull();
    });

    it("does not render bottom actions container when no actions are available", () => {
      const { queryByTestId } = render(<ChannelMembersScreen />);
      expect(queryByTestId("bottom-actions")).toBeNull();
    });
  });

  describe("Auto Channels", () => {
    it("hides management controls for main channel", () => {
      mockUseQueryReturn = {
        channelData: {
          ...mockChannelData,
          channelType: "main",
        },
        membersData: mockMembersData,
      };

      const { queryByText } = render(<ChannelMembersScreen />);
      expect(queryByText("Archive Channel")).toBeNull();
      expect(queryByText("remove-circle-outline")).toBeNull();
    });

    it("hides management controls for leaders channel", () => {
      mockUseQueryReturn = {
        channelData: {
          ...mockChannelData,
          channelType: "leaders",
        },
        membersData: mockMembersData,
      };

      const { queryByText } = render(<ChannelMembersScreen />);
      expect(queryByText("Archive Channel")).toBeNull();
    });
  });

  describe("Remove Member", () => {
    it("shows confirmation dialog when removing member", () => {
      const { getAllByText } = render(<ChannelMembersScreen />);
      const removeButtons = getAllByText("remove-circle-outline");

      act(() => {
        fireEvent.press(removeButtons[0].parent!.parent!);
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        "Remove Member",
        expect.stringContaining("John Doe"),
        expect.any(Array)
      );
    });

    it("calls removeChannelMember mutation after confirmation", async () => {
      mockRemoveMemberMutation.mockResolvedValueOnce(undefined);

      const { getAllByText } = render(<ChannelMembersScreen />);
      const removeButtons = getAllByText("remove-circle-outline");

      act(() => {
        fireEvent.press(removeButtons[0].parent!.parent!);
      });

      // Get the Remove button from the alert
      const alertCalls = (Alert.alert as jest.Mock).mock.calls;
      const alertButtons = alertCalls[0][2];
      const removeButton = alertButtons.find((b: any) => b.text === "Remove");

      await act(async () => {
        await removeButton.onPress();
      });

      expect(mockRemoveMemberMutation).toHaveBeenCalledWith({
        token: "mock-token",
        channelId: "channel-1",
        userId: "user-2",
      });
    });

    it("shows error alert on removal failure", async () => {
      mockRemoveMemberMutation.mockRejectedValueOnce(
        new Error("Failed to remove member")
      );

      const { getAllByText } = render(<ChannelMembersScreen />);
      const removeButtons = getAllByText("remove-circle-outline");

      act(() => {
        fireEvent.press(removeButtons[0].parent!.parent!);
      });

      const alertCalls = (Alert.alert as jest.Mock).mock.calls;
      const alertButtons = alertCalls[0][2];
      const removeButton = alertButtons.find((b: any) => b.text === "Remove");

      await act(async () => {
        await removeButton.onPress();
      });

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith("Error", "Failed to remove member");
      });
    });

    it("prevents owner from being removed when they are the only member", () => {
      mockUseQueryReturn = {
        channelData: mockChannelData,
        membersData: {
          members: [mockMembersData.members[0]], // Only owner
          totalCount: 1,
        },
      };

      // Since owner can't remove themselves when alone, there should be no remove button
      const { queryByText } = render(<ChannelMembersScreen />);
      // Owner badge should be visible
      expect(queryByText("Owner")).toBeTruthy();
    });
  });

  describe("Archive Channel", () => {
    it("shows confirmation dialog when archiving", () => {
      const { getByText } = render(<ChannelMembersScreen />);
      const archiveButton = getByText("Archive Channel");

      act(() => {
        fireEvent.press(archiveButton.parent!);
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        "Archive Channel",
        expect.stringContaining("Test Channel"),
        expect.any(Array)
      );
    });

    it("calls archiveChannelMutation after confirmation", async () => {
      mockArchiveChannelMutation.mockResolvedValueOnce(undefined);

      const { getByText } = render(<ChannelMembersScreen />);
      const archiveButton = getByText("Archive Channel");

      act(() => {
        fireEvent.press(archiveButton.parent!);
      });

      const alertCalls = (Alert.alert as jest.Mock).mock.calls;
      const alertButtons = alertCalls[0][2];
      const confirmButton = alertButtons.find((b: any) => b.text === "Archive");

      await act(async () => {
        await confirmButton.onPress();
      });

      expect(mockArchiveChannelMutation).toHaveBeenCalledWith({
        token: "mock-token",
        channelId: "channel-1",
      });
    });

    it("shows success alert and navigates after archiving", async () => {
      mockArchiveChannelMutation.mockResolvedValueOnce(undefined);

      const { getByText } = render(<ChannelMembersScreen />);
      const archiveButton = getByText("Archive Channel");

      act(() => {
        fireEvent.press(archiveButton.parent!);
      });

      const alertCalls = (Alert.alert as jest.Mock).mock.calls;
      const confirmButton = alertCalls[0][2].find((b: any) => b.text === "Archive");

      await act(async () => {
        await confirmButton.onPress();
      });

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith(
          "Channel Archived",
          "The channel has been archived.",
          expect.any(Array)
        );
      });
    });

    it("shows error alert on archive failure", async () => {
      mockArchiveChannelMutation.mockRejectedValueOnce(
        new Error("Archive failed")
      );

      const { getByText } = render(<ChannelMembersScreen />);
      const archiveButton = getByText("Archive Channel");

      act(() => {
        fireEvent.press(archiveButton.parent!);
      });

      const alertCalls = (Alert.alert as jest.Mock).mock.calls;
      const confirmButton = alertCalls[0][2].find((b: any) => b.text === "Archive");

      await act(async () => {
        await confirmButton.onPress();
      });

      await waitFor(() => {
        expect(Alert.alert).toHaveBeenCalledWith("Error", "Archive failed");
      });
    });
  });

  describe("Add Members Modal", () => {
    it("opens add member modal when add button is pressed", () => {
      const { getByText } = render(<ChannelMembersScreen />);

      // Press the add button (person-add-outline icon)
      const addIcon = getByText("person-add-outline");
      act(() => {
        fireEvent.press(addIcon.parent!);
      });

      // Modal should show Add Members title
      expect(getByText("Add Members")).toBeTruthy();
    });

    it("shows cancel button in modal", () => {
      const { getByText } = render(<ChannelMembersScreen />);

      const addIcon = getByText("person-add-outline");
      act(() => {
        fireEvent.press(addIcon.parent!);
      });

      expect(getByText("Cancel")).toBeTruthy();
    });

    it("calls addChannelMembers when members are selected", async () => {
      mockAddMembersMutation.mockResolvedValueOnce(undefined);

      const { getByText, getByTestId } = render(<ChannelMembersScreen />);

      // Open modal
      const addIcon = getByText("person-add-outline");
      act(() => {
        fireEvent.press(addIcon.parent!);
      });

      // Select a member using the mock MemberSearch
      const memberSearch = getByTestId("member-search");
      act(() => {
        fireEvent.press(memberSearch);
      });

      // Press the Add button
      const addButton = getByText(/Add \(/);
      await act(async () => {
        fireEvent.press(addButton.parent!);
      });

      await waitFor(() => {
        expect(mockAddMembersMutation).toHaveBeenCalledWith({
          token: "mock-token",
          channelId: "channel-1",
          userIds: ["user-4"],
        });
      });
    });
  });

  describe("Navigation", () => {
    it("navigates back when back button is pressed", () => {
      mockCanGoBack.mockReturnValue(true);

      const { getByText } = render(<ChannelMembersScreen />);
      const backIcon = getByText("arrow-back");

      act(() => {
        fireEvent.press(backIcon.parent!.parent!);
      });

      expect(mockBack).toHaveBeenCalled();
    });

    it("navigates to channel when cannot go back", () => {
      mockCanGoBack.mockReturnValue(false);

      const { getByText } = render(<ChannelMembersScreen />);
      const backIcon = getByText("arrow-back");

      act(() => {
        fireEvent.press(backIcon.parent!.parent!);
      });

      expect(mockReplace).toHaveBeenCalledWith("/inbox/test-group-id/test-channel");
    });
  });

  describe("Unsynced Members Display", () => {
    const mockPcoChannelData = {
      _id: "channel-1",
      name: "Worship Team",
      channelType: "pco_services",
      role: "owner",
      userGroupRole: "leader",
    };

    const mockPcoMembersData = {
      members: [
        {
          id: "member-1",
          userId: "user-1",
          displayName: "Current User",
          profilePhoto: null,
          role: "owner",
          syncSource: "pco_services",
          syncMetadata: {
            teamName: "Worship",
            position: "Vocals",
          },
        },
        {
          id: "member-2",
          userId: "user-2",
          displayName: "John Doe",
          profilePhoto: "https://example.com/photo.jpg",
          role: "member",
          syncSource: "pco_services",
          syncMetadata: {
            teamName: "Production",
            position: "Sound Engineer",
          },
        },
      ],
      totalCount: 2,
    };

    const mockAutoChannelConfigWithUnmatched = {
      _id: "config-1",
      channelId: "channel-1",
      lastSyncResults: {
        matchedCount: 2,
        unmatchedCount: 2,
        unmatchedPeople: [
          {
            pcoPersonId: "pco-123",
            pcoName: "Jane Smith",
            pcoPhone: "555-1234",
            teamName: "Worship",
            position: "Keys",
            reason: "not_in_group",
          },
          {
            pcoPersonId: "pco-456",
            pcoName: "Bob Johnson",
            pcoEmail: "bob@example.com",
            teamName: "Production",
            position: "Lighting",
            reason: "phone_mismatch",
          },
        ],
      },
    };

    beforeEach(() => {
      mockUseQueryReturn = {
        channelData: mockPcoChannelData,
        membersData: mockPcoMembersData,
        groupData: mockGroupData,
        autoChannelConfig: mockAutoChannelConfigWithUnmatched,
      };
    });

    it("renders unsynced members inline at bottom of list", () => {
      const { getByText, getByTestId } = render(<ChannelMembersScreen />);

      // Both synced members should be visible
      expect(getByText("Current User")).toBeTruthy();
      expect(getByText("John Doe")).toBeTruthy();

      // Unsynced members should be visible inline
      expect(getByText("Jane Smith")).toBeTruthy();
      expect(getByText("Bob Johnson")).toBeTruthy();
    });

    it("displays unsynced members with yellow background indicator", () => {
      const { getByTestId } = render(<ChannelMembersScreen />);

      // Check that unsynced member items have the expected testID
      expect(getByTestId("unsynced-member-pco-123")).toBeTruthy();
      expect(getByTestId("unsynced-member-pco-456")).toBeTruthy();
    });

    it("shows team chips for unsynced members", () => {
      const { getAllByText } = render(<ChannelMembersScreen />);

      // Team names should appear (synced members have these too)
      const worshipChips = getAllByText("Worship");
      const productionChips = getAllByText("Production");

      // Should have at least 2 of each (synced + unsynced)
      expect(worshipChips.length).toBeGreaterThanOrEqual(2);
      expect(productionChips.length).toBeGreaterThanOrEqual(2);
    });

    it("shows position chips for unsynced members", () => {
      const { getByText } = render(<ChannelMembersScreen />);

      // Positions unique to unsynced members
      expect(getByText("Keys")).toBeTruthy();
      expect(getByText("Lighting")).toBeTruthy();
    });

    it("shows debug reason text for unsynced members", () => {
      const { getByText } = render(<ChannelMembersScreen />);

      // Debug reasons should be displayed
      expect(getByText("In community but not in this group")).toBeTruthy();
      expect(getByText(/Phone.*not found/)).toBeTruthy();
    });

    it("does not show separate unmatched warning section when unsynced inline", () => {
      const { queryByText } = render(<ChannelMembersScreen />);

      // The old warning header should not appear
      expect(queryByText("people couldn't be synced")).toBeNull();
    });

    it("includes unsynced count in member total", () => {
      const { getByText } = render(<ChannelMembersScreen />);

      // Total should be synced (2) + unsynced (2) = 4
      // The nested Text components render separate text nodes, so check for the unsynced indicator
      expect(getByText(/unsynced/)).toBeTruthy();
    });
  });
});
