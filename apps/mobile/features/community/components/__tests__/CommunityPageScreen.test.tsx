/**
 * CommunityPageScreen — WhatsApp community LANDING anatomy
 * (WA-VISUAL-DELTAS.md §5).
 *
 * The screen is reachable only behind the whatsapp-shell flag (the route
 * redirects when it's off), so there's no flag-off branch to assert here —
 * these tests pin the landing structure the delta list calls for and, just as
 * importantly, the info-screen furniture §5.6 says must NOT be here.
 */
import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { CommunityPageScreen } from "../CommunityPageScreen";
import { useAuthenticatedQuery } from "@services/api/convex";

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, canGoBack: () => true }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: {
      text: "#000",
      textSecondary: "#555",
      textTertiary: "#999",
      surface: "#fff",
      surfaceGrouped: "#fff",
      surfaceSecondary: "#eee",
      backgroundGrouped: "#f2f2f7",
      background: "#fff",
      border: "#ccc",
      borderLight: "#eee",
      separator: "#e5e5e5",
      overlay: "rgba(0,0,0,0.4)",
      destructive: "#FF3B30",
      textInverse: "#fff",
      shadow: "#000",
    },
    isDark: false,
  }),
}));

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({ primaryColor: "#25D366", accentLight: "#E7F8EF" }),
}));

jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({
    user: { is_admin: false, timezone: "America/New_York" },
    community: { id: "community-1", name: "Demo Community", logo: null },
  }),
}));

const ANNOUNCEMENT_GROUP = {
  group: {
    _id: "group-announce",
    name: "Announcements",
    isAnnouncementGroup: true,
    groupTypeName: "",
    groupTypeId: "gt-1",
    preview: null,
  },
  userRole: "member",
  channels: [
    {
      _id: "chan-announce",
      slug: "general",
      channelType: "main",
      isEnabled: true,
      unreadCount: 2,
      lastMessageAt: Date.now(),
      lastMessagePreview: "Service moved to 10am",
      lastMessageSenderName: "Pastor Dave",
      isMuted: false,
    },
  ],
};

const WORSHIP_GROUP = {
  group: {
    _id: "group-worship",
    name: "Worship Team",
    isAnnouncementGroup: false,
    groupTypeName: "Teams",
    groupTypeId: "gt-2",
    preview: null,
  },
  userRole: "member",
  channels: [
    {
      _id: "chan-worship",
      slug: "general",
      channelType: "main",
      isEnabled: true,
      unreadCount: 0,
      lastMessageAt: Date.now(),
      lastMessagePreview: "Rehearsal at 6",
      lastMessageSenderName: "Amy",
      isMuted: false,
    },
  ],
};

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      messaging: { channels: { getInboxChannels: "getInboxChannels" } },
      groups: { queries: { listForUser: "listForUser" } },
      admin: { settings: { getExploreDefaults: "getExploreDefaults" } },
    },
  },
  useAuthenticatedQuery: jest.fn(),
}));

jest.mock("@features/groups/hooks/useGroups", () => ({
  useGroupSearchQuery: () => ({
    data: [
      {
        id: "group-youth",
        name: "Youth Group",
        preview: null,
        isMember: false,
        memberCount: 12,
      },
    ],
    isLoading: false,
  }),
}));

jest.mock("@features/events/hooks/useCommunityEvents", () => ({
  useCommunityEvents: () => ({ data: { events: [] }, isLoading: false }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  (useAuthenticatedQuery as jest.Mock).mockImplementation((ref: string) => {
    if (ref === "getInboxChannels") return [ANNOUNCEMENT_GROUP, WORSHIP_GROUP];
    if (ref === "listForUser")
      return [
        {
          _id: "group-worship",
          name: "Worship Team",
          preview: null,
          isAnnouncementGroup: false,
          groupType: { name: "Teams" },
        },
      ];
    if (ref === "getExploreDefaults") return { groupTypes: [] };
    return undefined;
  });
});

describe("CommunityPageScreen — §5 landing anatomy", () => {
  it("renders the left-aligned identity block (name + 'Community' subtitle)", () => {
    const { getByText } = render(<CommunityPageScreen />);
    expect(getByText("Demo Community")).toBeTruthy();
    expect(getByText("Community")).toBeTruthy();
  });

  it("uses sentence-case section headers, not ALL-CAPS card labels (§5.3)", () => {
    const { getByText, queryByText } = render(<CommunityPageScreen />);
    expect(getByText("Groups you're in")).toBeTruthy();
    expect(getByText("Groups you can join")).toBeTruthy();
    expect(queryByText("GROUPS YOU'RE IN")).toBeNull();
    expect(queryByText("GROUPS YOU CAN JOIN")).toBeNull();
  });

  it("drops the segmented control and the quick-action row (§5.6/§5.7)", () => {
    const { queryByText } = render(<CommunityPageScreen />);
    // The quick-action circles' labels are gone — those destinations moved
    // into the ⋯ menu, which is closed at rest.
    expect(queryByText("Invite")).toBeNull();
    expect(queryByText("Search")).toBeNull();
  });

  it("keeps Invite and Search reachable from the ⋯ menu (§5.7)", () => {
    const { getByLabelText, getByText } = render(<CommunityPageScreen />);
    fireEvent.press(getByLabelText("More options"));
    fireEvent.press(getByText("Invite people"));
    expect(mockPush).toHaveBeenCalledWith("/(user)/invite");
  });

  it("shows the Announcements row with its latest preview (§5.2)", () => {
    const { getByText } = render(<CommunityPageScreen />);
    expect(getByText("Announcements")).toBeTruthy();
    expect(getByText("Pastor Dave: Service moved to 10am")).toBeTruthy();
  });

  it("shows a last-message preview on member rows and a member count on joinable rows (§5.4)", () => {
    const { getByText } = render(<CommunityPageScreen />);
    expect(getByText("Amy: Rehearsal at 6")).toBeTruthy();
    expect(getByText("Youth Group")).toBeTruthy();
    expect(getByText("12 members")).toBeTruthy();
  });

  it("renders one bottom green CTA pill that navigates to community search (§5.5)", () => {
    const { getByLabelText } = render(<CommunityPageScreen />);
    fireEvent.press(getByLabelText("Find your group"));
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/search");
  });

  it("navigates to the group page from a group row, unchanged", () => {
    const { getByText } = render(<CommunityPageScreen />);
    fireEvent.press(getByText("Worship Team"));
    expect(mockPush).toHaveBeenCalledWith("/groups/group-worship");
  });

  it("exposes a floating back button", () => {
    const { getByLabelText } = render(<CommunityPageScreen />);
    fireEvent.press(getByLabelText("Back"));
    expect(mockBack).toHaveBeenCalled();
  });
});
