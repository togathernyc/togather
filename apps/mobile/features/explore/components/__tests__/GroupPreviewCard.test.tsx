import React from "react";
import { render } from "@testing-library/react-native";
import { GroupPreviewCard } from "../GroupPreviewCard";
import { Group } from "@features/groups/types";

// Mock the dependencies
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: 1, email: "test@example.com" },
  }),
}));

jest.mock("@features/groups/utils", () => ({
  getGroupTypeLabel: jest.fn(() => "Dinner Party"),
}));

jest.mock("@services/api/convex", () => ({
  useAuthenticatedMutation: () => jest.fn(),
  api: {
    functions: {
      groupMembers: {
        createJoinRequest: "createJoinRequest",
      },
    },
  },
}));

describe("GroupPreviewCard", () => {
  const mockGroup: Group = {
    _id: "group_123",
    id: 123,
    title: "Test Group",
    type: 1,
    image_url: "https://example.com/image.jpg",
    city: "San Francisco",
    state: "CA",
    members_count: 5,
    members: [
      {
        id: "user_1",
        first_name: "John",
        last_name: "Doe",
        profile_photo: "https://example.com/john.jpg",
      },
      {
        id: "user_2",
        first_name: "Jane",
        last_name: "Smith",
      },
    ],
  };

  it("renders group name", () => {
    const { getByText } = render(<GroupPreviewCard group={mockGroup} />);
    expect(getByText("Test Group")).toBeTruthy();
  });

  it("renders location when city and state are provided", () => {
    const { getByText } = render(<GroupPreviewCard group={mockGroup} />);
    expect(getByText("San Francisco, CA")).toBeTruthy();
  });

  it("renders member count", () => {
    const { getByText } = render(<GroupPreviewCard group={mockGroup} />);
    expect(getByText("5 members")).toBeTruthy();
  });

  it("renders action buttons", () => {
    const { getByText } = render(<GroupPreviewCard group={mockGroup} />);
    expect(getByText("View Details")).toBeTruthy();
    expect(getByText("Join")).toBeTruthy();
  });

  it("renders placeholder image when no image URL provided", () => {
    const groupWithoutImage = { ...mockGroup, image_url: undefined, preview: undefined };
    const { getByText } = render(<GroupPreviewCard group={groupWithoutImage} />);
    // Should render initials "TG" for "Test Group"
    expect(getByText("TG")).toBeTruthy();
  });

  it("handles group with no members gracefully", () => {
    const groupWithoutMembers = {
      ...mockGroup,
      members: [],
      members_count: 0,
    };
    const { queryByText } = render(<GroupPreviewCard group={groupWithoutMembers} />);
    // Should not crash and should not show member count
    expect(queryByText(/members/)).toBeNull();
  });

  it("shows correct singular form for 1 member", () => {
    const groupWithOneMember = {
      ...mockGroup,
      members_count: 1,
      members: [mockGroup.members![0]],
    };
    const { getByText } = render(<GroupPreviewCard group={groupWithOneMember} />);
    expect(getByText("1 member")).toBeTruthy();
  });

  it("shows 'Member' badge when user is already a member", () => {
    const memberGroup = { ...mockGroup, is_member: true, user_role: "member" };
    const { getByText } = render(<GroupPreviewCard group={memberGroup} />);
    expect(getByText("Member")).toBeTruthy();
  });

  it("shows 'Requested' when user has a pending join request", () => {
    const requestedGroup = { ...mockGroup, has_pending_request: true };
    const { getByText } = render(<GroupPreviewCard group={requestedGroup} />);
    expect(getByText("Requested")).toBeTruthy();
  });

  it("updates join button when group membership props refresh after optimistic join", () => {
    const joiningGroup = { ...mockGroup, has_pending_request: true };
    const { getByText, rerender } = render(<GroupPreviewCard group={joiningGroup} />);
    expect(getByText("Requested")).toBeTruthy();

    rerender(
      <GroupPreviewCard
        group={{ ...mockGroup, is_member: true, user_role: "member", has_pending_request: false }}
      />,
    );
    expect(getByText("Member")).toBeTruthy();
  });

  it("resets to Join after server clears pending request (e.g. declined)", () => {
    const pendingGroup = { ...mockGroup, has_pending_request: true };
    const { getByText, rerender } = render(<GroupPreviewCard group={pendingGroup} />);
    expect(getByText("Requested")).toBeTruthy();

    rerender(
      <GroupPreviewCard
        group={{ ...mockGroup, is_member: false, user_role: undefined, has_pending_request: false }}
      />,
    );
    expect(getByText("Join")).toBeTruthy();
  });

  it("resets to Join when membership is revoked while card is mounted", () => {
    const memberGroup = { ...mockGroup, is_member: true, user_role: "member" };
    const { getByText, rerender } = render(<GroupPreviewCard group={memberGroup} />);
    expect(getByText("Member")).toBeTruthy();

    rerender(
      <GroupPreviewCard
        group={{ ...mockGroup, is_member: false, user_role: undefined, has_pending_request: false }}
      />,
    );
    expect(getByText("Join")).toBeTruthy();
  });
});
