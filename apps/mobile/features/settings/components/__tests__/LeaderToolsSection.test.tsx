import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { LeaderToolsSection } from "../LeaderToolsSection";
import { useAuth } from "@providers/AuthProvider";
import { useAuthenticatedQuery } from "@services/api/convex";
import { useRouter } from "expo-router";

jest.mock("@providers/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      tasks: {
        index: {
          hasLeaderAccess: "api.functions.tasks.index.hasLeaderAccess",
        },
      },
    },
  },
  useAuthenticatedQuery: jest.fn(),
}));

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: jest.fn(),
}));

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({
    primaryColor: "#007AFF",
  }),
}));

describe("LeaderToolsSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
  });

  test("does not render when user does not have leader access", () => {
    (useAuth as jest.Mock).mockReturnValue({
      community: { id: "community-1" },
    });
    (useAuthenticatedQuery as jest.Mock).mockReturnValue(false);

    const { queryByText } = render(<LeaderToolsSection />);
    expect(queryByText("Leader Tools")).toBeNull();
    expect(queryByText("Tasks")).toBeNull();
  });

  test("renders tasks row for leaders and navigates to tasks", () => {
    (useAuth as jest.Mock).mockReturnValue({
      community: { id: "community-1" },
    });
    (useAuthenticatedQuery as jest.Mock).mockReturnValue(true);

    const { getByText } = render(<LeaderToolsSection />);
    expect(getByText("Leader Tools")).toBeTruthy();
    const tasksRow = getByText("Tasks");
    expect(tasksRow).toBeTruthy();

    fireEvent.press(tasksRow);
    expect(mockPush).toHaveBeenCalledWith("/tasks");
  });
});
