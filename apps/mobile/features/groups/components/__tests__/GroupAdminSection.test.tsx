import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: {
      surfaceSecondary: "#f5f5f5",
      border: "#e0e0e0",
      text: "#1a1a1a",
      textSecondary: "#666",
      textTertiary: "#999",
      icon: "#666",
      warning: "#ff9500",
      onAccent: "#fff",
    },
  }),
}));

jest.mock("@components/ui/AdminViewNote", () => ({ AdminViewNote: () => null }));

const mockSetMode = jest.fn(() => Promise.resolve());
jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      groupMembers: { countGroupJoinRequests: "countGroupJoinRequests" },
      groups: { index: { setJoinApprovalMode: "setJoinApprovalMode" } },
    },
  },
  useAuthenticatedQuery: () => 2,
  useAuthenticatedMutation: () => mockSetMode,
}));

import { GroupAdminSection } from "../GroupAdminSection";

const group = { _id: "g1", join_approval_mode: "admins" } as any;

describe("GroupAdminSection", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockSetMode.mockClear();
  });

  it("opens the edit screen without requiring membership", () => {
    render(<GroupAdminSection group={group} />);
    fireEvent.press(screen.getByText("Edit group"));
    expect(mockPush).toHaveBeenCalledWith("/groups/g1/edit");
  });

  it("hands approvals to group leaders", () => {
    render(<GroupAdminSection group={group} />);
    fireEvent(
      screen.getByLabelText("Let group leaders approve requests"),
      "valueChange",
      true,
    );
    expect(mockSetMode).toHaveBeenCalledWith({ groupId: "g1", mode: "leaders" });
  });

  it("shows the pending count and opens the requests screen", () => {
    render(<GroupAdminSection group={group} />);
    expect(screen.getByText("2")).toBeTruthy();
    fireEvent.press(screen.getByText("Requests to join"));
    expect(mockPush).toHaveBeenCalledWith("/groups/g1/requests");
  });
});
