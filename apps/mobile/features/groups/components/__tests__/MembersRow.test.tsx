import React from "react";
import { render, screen } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MembersRow } from "../MembersRow";

// Mock Avatar component
jest.mock("@components/ui", () => {
  const { View, Text } = require("react-native");
  return {
    Avatar: ({ name, imageUrl, size }: any) => (
      <View testID="avatar" data-name={name} data-size={size}>
        <Text>{name}</Text>
      </View>
    ),
  };
});

// Mock useTheme — MembersRow now uses theme tokens for the leader badge
// and the +N overflow circle. The header "MEMBERS" label moved out to the
// section header rendered by GroupDetailScreen, so these tests focus on
// avatar layout only.
jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: {
      text: "#1a1a1a",
      textSecondary: "#666666",
      border: "#e5e5e5",
      surfaceSecondary: "#f5f5f5",
    },
  }),
}));

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

const renderWithProvider = (component: React.ReactElement) => {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>{component}</QueryClientProvider>
  );
};

describe("MembersRow", () => {
  const mockMembers = [
    { id: "user_1", first_name: "John", last_name: "Doe", profile_photo: "photo1.jpg" },
    { id: "user_2", first_name: "Jane", last_name: "Smith", profile_photo: "photo2.jpg" },
    { id: "user_3", first_name: "Bob", last_name: "Johnson", profile_photo: "photo3.jpg" },
  ];

  const mockLeaders = [
    { id: "user_4", first_name: "Alice", last_name: "Leader", profile_photo: "photo4.jpg" },
    { id: "user_5", first_name: "Charlie", last_name: "Manager", profile_photo: "photo5.jpg" },
  ];

  it("renders members when provided", () => {
    renderWithProvider(<MembersRow members={mockMembers} />);

    expect(screen.getAllByTestId("avatar").length).toBe(3);
  });

  it("renders leaders when provided", () => {
    renderWithProvider(<MembersRow leaders={mockLeaders} />);

    expect(screen.getAllByTestId("avatar").length).toBe(2);
  });

  it("renders both members and leaders with leaders first", () => {
    renderWithProvider(<MembersRow members={mockMembers} leaders={mockLeaders} />);

    const avatars = screen.getAllByTestId("avatar");
    expect(avatars.length).toBe(5);
    // Leaders should appear first
    expect(avatars[0].props["data-name"]).toBe("Alice Leader");
    expect(avatars[1].props["data-name"]).toBe("Charlie Manager");
  });

  it("does not duplicate members who are also leaders", () => {
    const membersWithLeader = [
      ...mockMembers,
      { id: "user_4", first_name: "Alice", last_name: "Leader", profile_photo: "photo4.jpg" },
    ];

    renderWithProvider(<MembersRow members={membersWithLeader} leaders={mockLeaders} />);

    const avatars = screen.getAllByTestId("avatar");
    // Should have 5 unique members (3 regular + 2 leaders, with leader not duplicated)
    expect(avatars.length).toBe(5);
  });

  it("does not render when no members or leaders", () => {
    const { toJSON } = renderWithProvider(<MembersRow members={[]} leaders={[]} />);
    expect(toJSON()).toBeNull();
  });

  it("shows remaining count when members exceed maxVisible", () => {
    const manyMembers = Array.from({ length: 15 }, (_, i) => ({
      id: `user_${i + 1}`,
      first_name: `User${i + 1}`,
      last_name: "Test",
    }));

    renderWithProvider(<MembersRow members={manyMembers} maxVisible={10} />);

    expect(screen.getByText("+5")).toBeTruthy();
  });

  it("handles undefined members and leaders gracefully", () => {
    let result = renderWithProvider(<MembersRow />);
    expect(result.toJSON()).toBeNull();

    result = renderWithProvider(<MembersRow members={undefined} leaders={undefined} />);
    expect(result.toJSON()).toBeNull();
  });

  it("handles members with missing names", () => {
    const membersWithMissingNames = [
      { id: "user_1", first_name: "John", last_name: "" },
      { id: "user_2", first_name: "", last_name: "Smith" },
      { id: "user_3", first_name: "", last_name: "" },
    ];

    renderWithProvider(<MembersRow members={membersWithMissingNames} />);

    const avatars = screen.getAllByTestId("avatar");
    expect(avatars.length).toBe(3);
  });
});
