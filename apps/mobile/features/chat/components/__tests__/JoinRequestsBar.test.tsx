import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: {
      surface: "#fff",
      surfaceSecondary: "#f5f5f5",
      border: "#e0e0e0",
      text: "#1a1a1a",
      textSecondary: "#666",
      buttonPrimary: "#222",
      buttonPrimaryText: "#fff",
    },
  }),
}));

jest.mock("@components/ui/Avatar", () => ({ Avatar: () => null }));

const mockReview = jest.fn();
jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      groupMembers: {
        countGroupJoinRequests: "countGroupJoinRequests",
        listGroupJoinRequests: "listGroupJoinRequests",
        reviewGroupJoinRequest: "reviewGroupJoinRequest",
      },
    },
  },
  useAuthenticatedQuery: jest.fn(),
  useAuthenticatedMutation: () => mockReview,
}));

import { useAuthenticatedQuery } from "@services/api/convex";
import { JoinRequestsBar } from "../JoinRequestsBar";

const request = (id: string, firstName: string) => ({
  membershipId: id,
  requestedAt: Date.now() - 60 * 60 * 1000,
  user: { firstName, lastName: "Doe", profilePhoto: null },
});

function mockQueries(count: number | undefined, list: unknown[] | undefined) {
  (useAuthenticatedQuery as jest.Mock).mockImplementation((fn: string) =>
    fn === "countGroupJoinRequests" ? count : list,
  );
}

describe("JoinRequestsBar", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockReview.mockReset();
  });

  it("renders nothing when the viewer has no requests to review", () => {
    mockQueries(0, undefined);
    const { toJSON } = render(<JoinRequestsBar groupId={"g1" as any} />);
    expect(toJSON()).toBeNull();
  });

  it("approves a single request inline", () => {
    mockQueries(1, [request("m1", "Maya")]);
    render(<JoinRequestsBar groupId={"g1" as any} />);

    expect(screen.getByText("Maya Doe wants to join")).toBeTruthy();
    fireEvent.press(screen.getByText("Approve"));
    expect(mockReview).toHaveBeenCalledWith({
      groupId: "g1",
      membershipId: "m1",
      action: "accept",
    });
  });

  it("summarizes several requests and opens the requests screen", () => {
    mockQueries(3, [
      request("m1", "Maya"),
      request("m2", "David"),
      request("m3", "Jasmine"),
    ]);
    render(<JoinRequestsBar groupId={"g1" as any} />);

    expect(screen.getByText("3 people want to join")).toBeTruthy();
    expect(screen.getByText("Maya, David and 1 more")).toBeTruthy();
    fireEvent.press(screen.getByText("Review"));
    expect(mockPush).toHaveBeenCalledWith("/groups/g1/requests");
  });
});
