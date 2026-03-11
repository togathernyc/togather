import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { ProfileMenu } from "../ProfileMenu";
import { useRouter } from "expo-router";
import { useAuth } from "@providers/AuthProvider";
import { useAuthenticatedQuery } from "@services/api/convex";

jest.mock("expo-router", () => ({
  useRouter: jest.fn(),
}));

jest.mock("@providers/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({ primaryColor: "#7C3AED" }),
}));

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      communities: {
        listForUser: "api.functions.communities.listForUser",
      },
      tasks: {
        index: {
          hasLeaderAccess: "api.functions.tasks.index.hasLeaderAccess",
        },
      },
    },
  },
  useAuthenticatedQuery: jest.fn(),
}));

describe("ProfileMenu", () => {
  const mockPush = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
    (useAuth as jest.Mock).mockReturnValue({
      user: { id: "user-1" },
      community: { id: "community-1", name: "Demo Community" },
    });
  });

  it("shows tasks entry for leaders and navigates to tasks", () => {
    (useAuthenticatedQuery as jest.Mock).mockImplementation((queryFn: string) => {
      if (queryFn === "api.functions.communities.listForUser") return [];
      if (queryFn === "api.functions.tasks.index.hasLeaderAccess") return true;
      return undefined;
    });

    const { getByText } = render(<ProfileMenu />);
    fireEvent.press(getByText("Tasks"));

    expect(mockPush).toHaveBeenCalledWith("/tasks");
  });

  it("hides tasks entry for non-leaders", () => {
    (useAuthenticatedQuery as jest.Mock).mockImplementation((queryFn: string) => {
      if (queryFn === "api.functions.communities.listForUser") return [];
      if (queryFn === "api.functions.tasks.index.hasLeaderAccess") return false;
      return undefined;
    });

    const { queryByText } = render(<ProfileMenu />);
    expect(queryByText("Tasks")).toBeNull();
  });
});
