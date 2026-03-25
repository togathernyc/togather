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
          getInternalDashboard: "api.functions.admin.stats.getInternalDashboard",
        },
      },
      ee: {
        proposals: {
          list: "api.functions.ee.proposals.list",
          accept: "api.functions.ee.proposals.accept",
          reject: "api.functions.ee.proposals.reject",
        },
        billing: {
          getSubscriptionStatus: "api.functions.ee.billing.getSubscriptionStatus",
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
      user: { is_staff: false, is_superuser: false },
      token: "token",
    });
    (useQuery as jest.Mock).mockReturnValue(undefined);

    const { getByText } = render(<SuperAdminDashboardContent />);

    expect(getByText("Developers and owners only")).toBeTruthy();
  });

  test("renders dashboard metrics for primary admins", () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { is_staff: true, is_superuser: false },
      token: "token",
    });
    const dashboardData = {
      overview: {
        messagesSent: 42,
        uniqueActiveSenders: 12,
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
        totalCommunities: 4,
      },
      trend: [
        { bucketStart: 1, label: "Jan 1", messagesSent: 10, dailyActiveUsers: 6, newMembers: 1 },
        { bucketStart: 2, label: "Jan 2", messagesSent: 32, dailyActiveUsers: 8, newMembers: 4 },
      ],
      topChannels: [{ channelId: "channel-1", channelName: "General", messagesSent: 25 }],
    };
    (useQuery as jest.Mock).mockImplementation((queryFn: string) => {
      if (queryFn === "api.functions.ee.proposals.list") return [];
      return dashboardData;
    });

    const { getByText } = render(<SuperAdminDashboardContent />);

    expect(getByText("Togather Dashboard")).toBeTruthy();
    expect(getByText("Messages sent")).toBeTruthy();
    expect(getByText("Top channels (30D)")).toBeTruthy();
    expect(getByText("General")).toBeTruthy();
  });

  test("changes range and re-queries with selected key", () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { is_staff: true, is_superuser: false },
      token: "token",
    });
    const emptyDashboardData = {
      overview: {
        messagesSent: 0,
        uniqueActiveSenders: 0,
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
        totalCommunities: 0,
      },
      trend: [],
      topChannels: [],
    };
    (useQuery as jest.Mock).mockImplementation((queryFn: string) => {
      if (queryFn === "api.functions.ee.proposals.list") return [];
      return emptyDashboardData;
    });

    const { getByText } = render(<SuperAdminDashboardContent />);
    fireEvent.press(getByText("7D"));

    const dashboardCalls = (useQuery as jest.Mock).mock.calls.filter(
      ([fn]: [string]) => fn === "api.functions.admin.stats.getInternalDashboard"
    );
    const latestArgs = dashboardCalls.at(-1)?.[1];
    expect(latestArgs.range).toBe("7d");
  });
});

