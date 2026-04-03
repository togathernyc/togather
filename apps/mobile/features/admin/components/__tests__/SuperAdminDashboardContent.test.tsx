import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { SuperAdminDashboardContent } from "../SuperAdminDashboardContent";
import { useAuth } from "@providers/AuthProvider";
import { useQuery } from "@services/api/convex";

jest.mock("@providers/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@services/api/convex", () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn(() => jest.fn()),
  api: {
    functions: {
      admin: {
        stats: {
          getDailySummary: "api.functions.admin.stats.getDailySummary",
        },
      },
    },
  },
}));

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({ primaryColor: "#6A4CFF" }),
}));

describe("SuperAdminDashboardContent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("renders locked state for non-internal users", () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { is_staff: false, is_superuser: false },
      token: "token",
    });
    (useQuery as jest.Mock).mockReturnValue(undefined);

    const { getByText } = render(<SuperAdminDashboardContent />);

    expect(getByText("Developers and owners only")).toBeTruthy();
  });

  test("renders daily summary metrics for internal users", () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { is_staff: true, is_superuser: false },
      token: "token",
    });
    (useQuery as jest.Mock).mockReturnValue({
      date: "2026-04-03",
      messages: { total: 42, uniqueSenders: 12 },
      totalReactions: 8,
      appOpens: 25,
      topChannels: [
        { channelId: "ch1", channelName: "General", groupName: "Team", groupPhoto: null, messages: 30, reactions: 5 },
      ],
      topSenders: [
        { userId: "u1", name: "Test User", profilePhoto: null, messages: 15, reactions: 3 },
      ],
    });

    const { getByText } = render(<SuperAdminDashboardContent />);

    expect(getByText("Today — Apr 3, 2026")).toBeTruthy();
    expect(getByText("42")).toBeTruthy(); // messages
    expect(getByText("12")).toBeTruthy(); // senders
    expect(getByText("8")).toBeTruthy();  // reactions
    expect(getByText("25")).toBeTruthy(); // app opens
    expect(getByText("General")).toBeTruthy();
    expect(getByText("Test User")).toBeTruthy();
  });

  test("navigates to previous day", () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { is_staff: true, is_superuser: false },
      token: "token",
    });
    (useQuery as jest.Mock).mockReturnValue({
      date: "2026-04-03",
      messages: { total: 0, uniqueSenders: 0 },
      totalReactions: 0,
      appOpens: 0,
      topChannels: [],
      topSenders: [],
    });

    const { getByText } = render(<SuperAdminDashboardContent />);

    // Navigate back one day
    const backButtons = getByText("Today — Apr 3, 2026");
    expect(backButtons).toBeTruthy();

    // Check query was called with daysAgo: 0 initially
    const calls = (useQuery as jest.Mock).mock.calls.filter(
      ([fn]: [string]) => fn === "api.functions.admin.stats.getDailySummary"
    );
    expect(calls[0][1]).toEqual({ token: "token", daysAgo: 0 });
  });
});
