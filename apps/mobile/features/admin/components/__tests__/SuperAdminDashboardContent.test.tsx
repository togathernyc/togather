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
  api: {
    functions: {
      admin: {
        stats: {
          getSuperAdminDashboard: "api.functions.admin.stats.getSuperAdminDashboard",
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

  test("renders locked state for non-primary admins", () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { is_primary_admin: false },
      community: { id: "community-1" },
      token: "token",
    });
    (useQuery as jest.Mock).mockReturnValue(undefined);

    const { getByText } = render(<SuperAdminDashboardContent />);

    expect(getByText("Super admin only")).toBeTruthy();
  });

  test("renders dashboard metrics for primary admins", () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { is_primary_admin: true },
      community: { id: "community-1" },
      token: "token",
    });
    (useQuery as jest.Mock).mockReturnValue({
      overview: {
        messagesSent: 42,
        dailyActiveUsers: 12,
        newMembers: 5,
        meetingsHeld: 3,
        attendanceCheckIns: 19,
        avgMessagesPerActiveDay: 14,
      },
      totals: {
        totalMembers: 100,
        activeMembers30d: 80,
        activeGroups: 8,
        activeChannels: 16,
      },
      trend: [
        { bucketStart: 1, label: "Jan 1", messagesSent: 10, dailyActiveUsers: 6, newMembers: 1 },
        { bucketStart: 2, label: "Jan 2", messagesSent: 32, dailyActiveUsers: 8, newMembers: 4 },
      ],
      topChannels: [{ channelId: "channel-1", channelName: "General", messagesSent: 25 }],
    });

    const { getByText } = render(<SuperAdminDashboardContent />);

    expect(getByText("Super Admin Dashboard")).toBeTruthy();
    expect(getByText("Messages sent")).toBeTruthy();
    expect(getByText("Top channels (30D)")).toBeTruthy();
    expect(getByText("General")).toBeTruthy();
  });

  test("changes range and re-queries with selected key", () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { is_primary_admin: true },
      community: { id: "community-1" },
      token: "token",
    });
    (useQuery as jest.Mock).mockReturnValue({
      overview: {
        messagesSent: 0,
        dailyActiveUsers: 0,
        newMembers: 0,
        meetingsHeld: 0,
        attendanceCheckIns: 0,
        avgMessagesPerActiveDay: 0,
      },
      totals: {
        totalMembers: 0,
        activeMembers30d: 0,
        activeGroups: 0,
        activeChannels: 0,
      },
      trend: [],
      topChannels: [],
    });

    const { getByText } = render(<SuperAdminDashboardContent />);
    fireEvent.press(getByText("7D"));

    const latestArgs = (useQuery as jest.Mock).mock.calls.at(-1)?.[1];
    expect(latestArgs.range).toBe("7d");
  });
});

