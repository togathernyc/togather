/**
 * YouScreen — WA-VISUAL-DELTAS.md §4 (You tab).
 *
 * The delta this suite pins is structural: §4.2 replaces the in-card profile
 * ROW with a centered hero (100pt avatar, 28pt bold name, 15pt gray community
 * subtitle) that sits ABOVE the first card, while §4.3 keeps every existing
 * row/function inside the restyled S3 cards.
 */
import React from "react";
import { StyleSheet } from "react-native";
import { render, fireEvent } from "@testing-library/react-native";
import { YouScreen } from "../YouScreen";
import { useAuth } from "@providers/AuthProvider";
import { useAuthenticatedQuery } from "@services/api/convex";
import { WA_AVATAR_PROFILE, WA_TYPE_HERO_NAME } from "@components/wa";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

jest.mock("@providers/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      communities: { listForUser: "api.functions.communities.listForUser" },
      tasks: { index: { hasLeaderAccess: "api.functions.tasks.index.hasLeaderAccess" } },
    },
  },
  useAuthenticatedQuery: jest.fn(() => undefined),
}));

jest.mock("@features/contribute/hooks/useDevAccess", () => ({
  useDevAccess: () => ({ hasAccess: false }),
}));

jest.mock("@components/ui", () => {
  const { View } = require("react-native");
  return {
    Avatar: (props: any) => <View testID="you-avatar" {...props} />,
  };
});

/** Base auth double: a plain member of a community. */
const member = {
  user: { id: "user-1", first_name: "Ada", last_name: "Lovelace" },
  community: { id: "community-1", name: "Demo Community" },
  isLoading: false,
  logout: jest.fn(),
};
const asAuth = (overrides: Record<string, unknown>) => ({ ...member, ...overrides });

const COMMUNITY_ADMIN_ROWS = [
  "Join requests",
  "Members",
  "Attendance stats",
  "Community settings",
];

describe("YouScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuthenticatedQuery as jest.Mock).mockReturnValue(undefined);
    (useAuth as jest.Mock).mockReturnValue(member);
  });

  it("§4.2: renders a centered hero with a 100pt avatar and 28pt bold name", () => {
    const { getByTestId, getByText } = render(<YouScreen />);

    const avatar = getByTestId("you-avatar");
    expect(avatar.props.size).toBe(WA_AVATAR_PROFILE);
    expect(WA_AVATAR_PROFILE).toBe(100);

    const name = getByText("Ada Lovelace");
    const nameStyle = StyleSheet.flatten(name.props.style);
    expect(nameStyle.fontSize).toBe(WA_TYPE_HERO_NAME);
    expect(nameStyle.fontWeight).toBe("700");
    expect(nameStyle.textAlign).toBe("center");

    const heroStyle = StyleSheet.flatten(getByTestId("you-hero").props.style);
    expect(heroStyle.alignItems).toBe("center");
  });

  it("§4.2: the community name is the 15pt gray hero subtitle", () => {
    const { getAllByText } = render(<YouScreen />);
    // Also appears as the "Switch community" cell's description sub-line; the
    // hero renders first in tree order.
    const subtitle = getAllByText("Demo Community")[0];
    expect(StyleSheet.flatten(subtitle.props.style).fontSize).toBe(15);
  });

  it("§4.3: every existing row survives the restyle", () => {
    const { getByText } = render(<YouScreen />);
    for (const label of [
      "Switch community",
      "Invite your community",
      "My events",
      "My schedule",
      "Notifications",
      "Privacy & blocked",
      "Help & feedback",
      "Log out",
    ]) {
      expect(getByText(label)).toBeTruthy();
    }
  });

  it("§4.1/S3.5: shows no 'You' large title and no ALL-CAPS section labels", () => {
    (useAuthenticatedQuery as jest.Mock).mockImplementation((queryFn: string) =>
      queryFn === "api.functions.tasks.index.hasLeaderAccess" ? true : undefined
    );
    const { queryByText, getByText } = render(<YouScreen />);
    expect(queryByText("You")).toBeNull();
    expect(getByText("Leader tools")).toBeTruthy();
    expect(queryByText("LEADER TOOLS")).toBeNull();
  });

  describe("Settings group (IA regroup)", () => {
    it("splits the old catch-all Notifications row into one row per destination", () => {
      const { getByText } = render(<YouScreen />);
      expect(getByText("Settings")).toBeTruthy();
      for (const label of ["Account", "Appearance", "Notifications", "Privacy & blocked"]) {
        expect(getByText(label)).toBeTruthy();
      }
    });

    it("routes each Settings row at its own /(user)/you/* leaf, not the legacy Settings screen", () => {
      const { getByText } = render(<YouScreen />);
      const expected: Array<[string, string]> = [
        ["Account", "/(user)/you/account"],
        ["Appearance", "/(user)/you/appearance"],
        ["Notifications", "/(user)/you/notifications"],
        // Unchanged — this row already had a dedicated route.
        ["Privacy & blocked", "/(user)/settings/blocked-users"],
      ];
      for (const [label, route] of expected) {
        mockPush.mockClear();
        fireEvent.press(getByText(label));
        expect(mockPush).toHaveBeenCalledWith(route);
      }
      // The 10-section legacy scroll is no longer a destination from this screen.
      expect(mockPush).not.toHaveBeenCalledWith("/(user)/settings");
    });

    it("moves App info out of the legacy Settings scroll into the App group", () => {
      const { getByText } = render(<YouScreen />);
      fireEvent.press(getByText("App info"));
      expect(mockPush).toHaveBeenCalledWith("/(user)/you/app-info");
    });
  });

  describe("Admin group gates (mirror AdminScreen's tab visibility)", () => {
    it("a plain member sees no Admin group at all", () => {
      const { queryByText } = render(<YouScreen />);
      expect(queryByText("Admin")).toBeNull();
      expect(queryByText("Admin tools")).toBeNull();
      for (const label of [...COMMUNITY_ADMIN_ROWS, "Staff dashboard"]) {
        expect(queryByText(label)).toBeNull();
      }
    });

    it("a community admin sees the four community rows and no staff dashboard", () => {
      (useAuth as jest.Mock).mockReturnValue(
        asAuth({ user: { ...member.user, is_admin: true } })
      );
      const { getByText, queryByText } = render(<YouScreen />);
      expect(getByText("Admin")).toBeTruthy();
      for (const label of COMMUNITY_ADMIN_ROWS) expect(getByText(label)).toBeTruthy();
      expect(queryByText("Staff dashboard")).toBeNull();
    });

    it("each community-admin row routes at its own /(user)/you/admin/* leaf", () => {
      (useAuth as jest.Mock).mockReturnValue(
        asAuth({ user: { ...member.user, is_admin: true } })
      );
      const { getByText } = render(<YouScreen />);
      const expected: Array<[string, string]> = [
        ["Join requests", "/(user)/you/admin/requests"],
        ["Members", "/(user)/you/admin/members"],
        ["Attendance stats", "/(user)/you/admin/stats"],
        ["Community settings", "/(user)/you/admin/community"],
      ];
      for (const [label, route] of expected) {
        mockPush.mockClear();
        fireEvent.press(getByText(label));
        expect(mockPush).toHaveBeenCalledWith(route);
      }
      // The segmented catch-all is no longer a destination from this screen
      // (the route itself stays live for deep links and flag-off).
      expect(mockPush).not.toHaveBeenCalledWith("/(tabs)/admin");
    });

    it("internal staff who are not community admins see ONLY the staff dashboard", () => {
      (useAuth as jest.Mock).mockReturnValue(
        asAuth({ user: { ...member.user, is_staff: true } })
      );
      const { getByText, queryByText } = render(<YouScreen />);
      expect(getByText("Admin")).toBeTruthy();
      fireEvent.press(getByText("Staff dashboard"));
      expect(mockPush).toHaveBeenCalledWith("/(user)/you/admin/staff");
      for (const label of COMMUNITY_ADMIN_ROWS) expect(queryByText(label)).toBeNull();
    });

    it("internal staff with no community still see the staff dashboard (AdminScreen's Dashboard-only case)", () => {
      (useAuth as jest.Mock).mockReturnValue(
        asAuth({ user: { ...member.user, is_superuser: true }, community: null })
      );
      const { getByText, queryByText } = render(<YouScreen />);
      expect(getByText("Staff dashboard")).toBeTruthy();
      for (const label of COMMUNITY_ADMIN_ROWS) expect(queryByText(label)).toBeNull();
    });

    it("an admin with no community sees no admin rows", () => {
      (useAuth as jest.Mock).mockReturnValue(
        asAuth({ user: { ...member.user, is_admin: true }, community: null })
      );
      const { queryByText } = render(<YouScreen />);
      expect(queryByText("Admin")).toBeNull();
      for (const label of [...COMMUNITY_ADMIN_ROWS, "Staff dashboard"]) {
        expect(queryByText(label)).toBeNull();
      }
    });

    it("a staff member who is also a community admin sees all five rows", () => {
      (useAuth as jest.Mock).mockReturnValue(
        asAuth({ user: { ...member.user, is_admin: true, is_staff: true } })
      );
      const { getByText } = render(<YouScreen />);
      for (const label of [...COMMUNITY_ADMIN_ROWS, "Staff dashboard"]) {
        expect(getByText(label)).toBeTruthy();
      }
    });
  });
});
