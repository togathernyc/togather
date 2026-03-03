// Mock native modules BEFORE any imports
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock("@providers/AuthProvider", () => ({
  useAuth: jest.fn(() => ({
    user: { id: 1, first_name: "Test", last_name: "User" },
    isAuthenticated: true,
    isLoading: false,
    church: null,
    login: jest.fn(),
    logout: jest.fn(),
  })),
  AuthProvider: ({ children }: any) => children,
}));

jest.mock("expo-media-library", () => ({
  requestPermissionsAsync: jest.fn(),
  createAssetAsync: jest.fn(),
}));

jest.mock("expo-file-system", () => ({
  cacheDirectory: "file://cache/",
  downloadAsync: jest.fn(),
}));

jest.mock("react-native/Libraries/Alert/Alert", () => ({
  alert: jest.fn(),
}));

// Mock ImageViewerProvider and ImageViewerManager
jest.mock("@/providers/ImageViewerProvider", () => ({
  ImageViewerManager: {
    show: jest.fn(),
    hide: jest.fn(),
    setRef: jest.fn(),
  },
  ImageViewerProvider: ({ children }: any) => children,
}));

// Mock expo-router to avoid Jest transformation issues with @react-navigation/native
jest.mock("expo-router", () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
  })),
  useLocalSearchParams: jest.fn(() => ({})),
  Link: ({ children }: any) => children,
}));

// Mock useArchiveGroup hook
jest.mock("../../hooks/useArchiveGroup", () => ({
  useArchiveGroup: jest.fn(() => ({
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
    isPending: false,
  })),
}));

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { GroupNonMemberView } from "../GroupNonMemberView";

jest.mock("../GroupHeader", () => {
  const { View, Text } = require("react-native");
  return {
    GroupHeader: ({ group }: any) => <View testID="group-header"><Text>{group.title}</Text></View>,
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
    HighlightsGrid: ({ highlights }: any) => (
      <View testID="highlights-grid"><Text>Highlights: {highlights.length}</Text></View>
    ),
  };
});

jest.mock("../JoinGroupButton", () => {
  const { Text } = require("react-native");
  return {
    JoinGroupButton: ({ onPress, isPending, group }: any) => {
      const getLabel = (type: number) => {
        switch (type) {
          case 1: return "Dinner Party";
          case 2: return "Team";
          case 3: return "Public Group";
          case 4: return "Table";
          default: return "Dinner Party";
        }
      };
      const label = group?.type ? getLabel(group.type) : "Dinner Party";
      return (
        <Text testID="join-button" onPress={onPress} disabled={isPending}>
          {isPending ? "Joining..." : `Join ${label}`}
        </Text>
      );
    },
  };
});

const mockGroup = {
  _id: "group_1",
  id: 1,
  title: "Test Group",
  description: "Test description",
  members: [
    { id: "user_1", first_name: "John", last_name: "Doe" },
    { id: "user_2", first_name: "Jane", last_name: "Smith" },
  ],
  highlights: [
    { id: 1, image_url: "https://example.com/image1.jpg" },
    { id: 2, image_url: "https://example.com/image2.jpg" },
  ],
};

describe("GroupNonMemberView", () => {
  it("renders group information for non-admin non-members", () => {
    const onJoinPress = jest.fn();

    render(<GroupNonMemberView group={mockGroup} onJoinPress={onJoinPress} />);

    expect(screen.getByTestId("group-header")).toBeTruthy();
    expect(screen.getByText("Test description")).toBeTruthy();
    expect(screen.getByTestId("highlights-grid")).toBeTruthy();
    expect(screen.getByTestId("join-button")).toBeTruthy();
  });

  it("does NOT show members-row to non-admin non-members for privacy", () => {
    const onJoinPress = jest.fn();

    render(<GroupNonMemberView group={mockGroup} onJoinPress={onJoinPress} />);

    // Non-members should NOT see member list (privacy protection)
    expect(screen.queryByTestId("members-row")).toBeNull();
  });

  it("shows members-row to community admins", () => {
    const onJoinPress = jest.fn();

    // Mock user as admin
    const { useAuth } = require("@providers/AuthProvider");
    useAuth.mockReturnValue({
      user: { id: 1, first_name: "Admin", last_name: "User", is_admin: true },
      isAuthenticated: true,
      isLoading: false,
      church: null,
      login: jest.fn(),
      logout: jest.fn(),
    });

    render(<GroupNonMemberView group={mockGroup} onJoinPress={onJoinPress} />);

    // Admins CAN see member list even if not a member
    expect(screen.getByTestId("members-row")).toBeTruthy();

    // Reset mock to default non-admin user
    useAuth.mockReturnValue({
      user: { id: 1, first_name: "Test", last_name: "User" },
      isAuthenticated: true,
      isLoading: false,
      church: null,
      login: jest.fn(),
      logout: jest.fn(),
    });
  });

  it("calls onJoinPress when join button is pressed", () => {
    const onJoinPress = jest.fn();

    render(<GroupNonMemberView group={mockGroup} onJoinPress={onJoinPress} />);

    const joinButton = screen.getByTestId("join-button");
    fireEvent.press(joinButton);

    expect(onJoinPress).toHaveBeenCalledTimes(1);
  });

  it("shows loading state when isJoining is true", () => {
    const onJoinPress = jest.fn();

    render(
      <GroupNonMemberView
        group={mockGroup}
        onJoinPress={onJoinPress}
        isJoining={true}
      />
    );

    const joinButton = screen.getByTestId("join-button");
    expect(joinButton.props.disabled).toBe(true);
    expect(joinButton.props.children).toBe("Joining...");
  });

  it("does not show members-row to admins if members array is empty", () => {
    const onJoinPress = jest.fn();
    const groupWithoutMembers = { ...mockGroup, members: [], leaders: [] };

    // Mock user as admin to test the empty members case
    const { useAuth } = require("@providers/AuthProvider");
    useAuth.mockReturnValue({
      user: { id: 1, first_name: "Admin", last_name: "User", is_admin: true },
      isAuthenticated: true,
      isLoading: false,
      church: null,
      login: jest.fn(),
      logout: jest.fn(),
    });

    render(
      <GroupNonMemberView group={groupWithoutMembers} onJoinPress={onJoinPress} />
    );

    // Even admins don't see members-row when there are no members or leaders
    expect(screen.queryByTestId("members-row")).toBeNull();
    expect(screen.getByTestId("group-header")).toBeTruthy();

    // Reset mock to default non-admin user
    useAuth.mockReturnValue({
      user: { id: 1, first_name: "Test", last_name: "User" },
      isAuthenticated: true,
      isLoading: false,
      church: null,
      login: jest.fn(),
      logout: jest.fn(),
    });
  });

  it("renders without highlights if highlights array is empty", () => {
    const onJoinPress = jest.fn();
    const groupWithoutHighlights = { ...mockGroup, highlights: [] };

    render(
      <GroupNonMemberView
        group={groupWithoutHighlights}
        onJoinPress={onJoinPress}
      />
    );

    expect(screen.queryByTestId("highlights-grid")).toBeNull();
    expect(screen.getByTestId("group-header")).toBeTruthy();
  });

  it("shows default description when description is missing", () => {
    const onJoinPress = jest.fn();
    const groupWithoutDescription = { ...mockGroup, description: undefined };

    render(
      <GroupNonMemberView
        group={groupWithoutDescription}
        onJoinPress={onJoinPress}
      />
    );

    expect(screen.getByText("No description available.")).toBeTruthy();
  });
});

