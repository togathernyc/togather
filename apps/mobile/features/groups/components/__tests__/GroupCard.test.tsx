import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GroupCard } from "../GroupCard";
import { Group } from "../../types";

// Mock expo-router
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
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

describe("GroupCard", () => {
  const mockUser = {
    id: 1,
    first_name: "Test",
    last_name: "User",
  };

  beforeEach(() => {
    mockPush.mockClear();
  });

  describe("Navigation", () => {
    it("navigates to group detail page using Convex _id when available", () => {
      const groupWithConvexId: Group = {
        _id: "k17abc123def456" as any,
        id: 12345,
        title: "Test Group",
        type: 1,
      };

      renderWithProvider(<GroupCard group={groupWithConvexId} user={mockUser} />);

      const card = screen.getByText("TEST GROUP");
      fireEvent.press(card.parent!);

      expect(mockPush).toHaveBeenCalledWith("/groups/k17abc123def456");
    });

    it("uses Convex _id for navigation (legacy ID fallback removed)", () => {
      const groupWithBoth: Group = {
        _id: "k17abc123def456" as any,
        id: 12345,
        title: "Hybrid Group",
        type: 1,
      };

      renderWithProvider(<GroupCard group={groupWithBoth} user={mockUser} />);

      const card = screen.getByText("HYBRID GROUP");
      fireEvent.press(card.parent!);

      expect(mockPush).toHaveBeenCalledWith("/groups/k17abc123def456");
    });

    it("calls custom onPress handler when provided instead of navigating", () => {
      const mockOnPress = jest.fn();
      const group: Group = {
        _id: "group_custom",
        id: 12345,
        uuid: "550e8400-e29b-41d4-a716-446655440000",
        title: "Custom Handler Group",
        type: 1,
      };

      renderWithProvider(
        <GroupCard group={group} user={mockUser} onPress={mockOnPress} />
      );

      const card = screen.getByText("CUSTOM HANDLER GROUP");
      fireEvent.press(card.parent!);

      expect(mockOnPress).toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe("Display", () => {
    it("displays group location when available", () => {
      const group: Group = {
        _id: "group_1",
        id: 1,
        title: "Test Group",
        location: "San Francisco, CA",
        type: 1,
      };

      renderWithProvider(<GroupCard group={group} user={mockUser} />);

      expect(screen.getByText("SAN FRANCISCO, CA")).toBeTruthy();
    });

    it("displays group title when location is not available", () => {
      const group: Group = {
        _id: "group_2",
        id: 1,
        title: "Test Group",
        type: 1,
      };

      renderWithProvider(<GroupCard group={group} user={mockUser} />);

      expect(screen.getByText("TEST GROUP")).toBeTruthy();
    });

    it("displays group name when both title and location are not available", () => {
      const group: Group = {
        _id: "group_3",
        id: 1,
        name: "Fallback Name",
        type: 1,
      };

      renderWithProvider(<GroupCard group={group} user={mockUser} />);

      expect(screen.getByText("FALLBACK NAME")).toBeTruthy();
    });

    it("displays 'Untitled Group' when no name, title, or location available", () => {
      const group: Group = {
        _id: "group_4",
        id: 1,
        type: 1,
      };

      renderWithProvider(<GroupCard group={group} user={mockUser} />);

      expect(screen.getByText("UNTITLED GROUP")).toBeTruthy();
    });

    it("displays NEW label for new groups with images", () => {
      const group: Group = {
        _id: "group_5",
        id: 1,
        title: "New Group",
        type: 1,
        is_new: true,
        preview: "https://example.com/image.jpg",
      };

      renderWithProvider(<GroupCard group={group} user={mockUser} />);

      expect(screen.getByText("NEW")).toBeTruthy();
    });

    it("does not display NEW label for new groups without images", () => {
      const group: Group = {
        _id: "group_6",
        id: 1,
        title: "New Group",
        type: 1,
        is_new: true,
      };

      renderWithProvider(<GroupCard group={group} user={mockUser} />);

      expect(screen.queryByText("NEW")).toBeNull();
    });

    it("displays PENDING label for pending user groups (type 3, status 0)", () => {
      const group: Group = {
        _id: "group_7",
        id: 1,
        title: "Pending Group",
        type: 3,
        status: 0,
      };

      renderWithProvider(<GroupCard group={group} user={mockUser} />);

      expect(screen.getByText("PENDING")).toBeTruthy();
    });
  });
});
