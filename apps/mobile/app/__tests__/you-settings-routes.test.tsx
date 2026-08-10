/**
 * The `/(user)/you/*` leaf routes — the You tab's settings/admin IA regroup.
 *
 * Two claims to pin per route:
 *   1. Flag-off (or a failed role gate) redirects to `/(tabs)/profile` — these
 *      routes are WhatsApp-shell-only chrome, so a deep link must never strand a
 *      flag-off user on them, and an admin deep link must never render admin
 *      content for a non-admin.
 *   2. Flag-on renders the *legacy* component the route wraps, unmodified —
 *      the regroup is IA only; nothing about `SettingsScreen`'s sections or
 *      `AdminScreen`'s content components changed.
 *
 * The admin role gates run for real (only `AuthProvider` is doubled) so the
 * matrix below is checked against `useYouAdminAccess` itself rather than a mock
 * of it.
 */
import React from "react";
import { render } from "@testing-library/react-native";
import { useAuth } from "@providers/AuthProvider";

const mockShellState = jest.fn(() => ({ enabled: true, loaded: true }));
jest.mock("@hooks/useWhatsappShell", () => ({
  useWhatsappShellState: () => mockShellState(),
  useWhatsappShell: () => mockShellState().enabled,
}));

jest.mock("expo-router", () => {
  const { Text } = require("react-native");
  return {
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
    Redirect: ({ href }: { href: string }) => <Text>{`redirect:${href}`}</Text>,
    useLocalSearchParams: () => ({}),
    usePathname: () => "/you",
  };
});

jest.mock("@providers/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

/** Each wrapped legacy component stands in as a labelled leaf. */
function mockStub(label: string) {
  const { Text } = require("react-native");
  return () => <Text>{label}</Text>;
}

jest.mock("@features/settings/components/SettingsForm", () => ({
  SettingsForm: mockStub("settings-form"),
}));
jest.mock("@features/settings/components/DeleteAccountSection", () => ({
  DeleteAccountSection: mockStub("delete-account-section"),
}));
jest.mock("@features/settings/components/AppearanceSection", () => ({
  AppearanceSection: mockStub("appearance-section"),
}));
jest.mock("@features/settings/components/TimezoneSection", () => ({
  TimezoneSection: mockStub("timezone-section"),
}));
jest.mock("@features/settings/components/NotificationPreferencesSection", () => ({
  NotificationPreferencesSection: mockStub("notification-preferences-section"),
}));
jest.mock("@features/settings/components/AppInfoSection", () => ({
  AppInfoSection: mockStub("app-info-section"),
}));
jest.mock("@features/admin/components/PendingRequestsContent", () => ({
  PendingRequestsContent: mockStub("pending-requests-content"),
}));
jest.mock("@features/admin/components/StatsContent", () => ({
  StatsContent: mockStub("stats-content"),
}));
jest.mock("@features/admin/components/SettingsContent", () => ({
  SettingsContent: mockStub("settings-content"),
}));
jest.mock("@features/admin/components/SuperAdminDashboardContent", () => ({
  SuperAdminDashboardContent: mockStub("super-admin-dashboard-content"),
}));
jest.mock("@features/people/components/PeopleTabScreen", () => ({
  PeopleTabScreen: (props: { showAllMembers?: boolean; embedded?: boolean }) => {
    const { Text } = require("react-native");
    return (
      <Text>{`people-tab-screen:all=${String(!!props.showAllMembers)}:embedded=${String(!!props.embedded)}`}</Text>
    );
  },
}));

import AccountRoute from "../(user)/you/account";
import AppearanceRoute from "../(user)/you/appearance";
import NotificationsRoute from "../(user)/you/notifications";
import AppInfoRoute from "../(user)/you/app-info";
import AdminRequestsRoute from "../(user)/you/admin/requests";
import AdminMembersRoute from "../(user)/you/admin/members";
import AdminStatsRoute from "../(user)/you/admin/stats";
import AdminCommunityRoute from "../(user)/you/admin/community";
import AdminStaffRoute from "../(user)/you/admin/staff";

const REDIRECT = "redirect:/(tabs)/profile";

const communityAdmin = {
  user: { id: "u1", is_admin: true },
  community: { id: "c1", name: "Demo Community" },
  isLoading: false,
};
const staffOnly = {
  user: { id: "u2", is_admin: false, is_staff: true },
  community: { id: "c1", name: "Demo Community" },
  isLoading: false,
};
const plainMember = {
  user: { id: "u3", is_admin: false },
  community: { id: "c1", name: "Demo Community" },
  isLoading: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockShellState.mockReturnValue({ enabled: true, loaded: true });
  (useAuth as jest.Mock).mockReturnValue(communityAdmin);
});

describe("/(user)/you/* — personal settings leaves", () => {
  const cases: Array<[string, React.ComponentType, string, string[]]> = [
    ["account", AccountRoute, "Account", ["settings-form", "delete-account-section"]],
    ["appearance", AppearanceRoute, "Appearance", ["appearance-section", "timezone-section"]],
    [
      "notifications",
      NotificationsRoute,
      "Notifications",
      ["notification-preferences-section"],
    ],
    ["app-info", AppInfoRoute, "App info", ["app-info-section"]],
  ];

  for (const [name, Route, title, leaves] of cases) {
    it(`${name}: renders the wrapped legacy section(s) under a "${title}" header when the flag is on`, () => {
      const { getByText } = render(<Route />);
      expect(getByText(title)).toBeTruthy();
      for (const leaf of leaves) expect(getByText(leaf)).toBeTruthy();
    });

    it(`${name}: redirects to the legacy profile tab when the flag is off`, () => {
      mockShellState.mockReturnValue({ enabled: false, loaded: true });
      const { getByText, queryByText } = render(<Route />);
      expect(getByText(REDIRECT)).toBeTruthy();
      for (const leaf of leaves) expect(queryByText(leaf)).toBeNull();
    });

    it(`${name}: renders nothing while the flag is still loading`, () => {
      mockShellState.mockReturnValue({ enabled: false, loaded: false });
      const { queryByText } = render(<Route />);
      expect(queryByText(REDIRECT)).toBeNull();
      for (const leaf of leaves) expect(queryByText(leaf)).toBeNull();
    });
  }

  it("account: the delete-account danger zone sits below the profile form", () => {
    const { getByText } = render(<AccountRoute />);
    // A single ScrollView child order check — the danger zone is last per the IA.
    const form = getByText("settings-form");
    const danger = getByText("delete-account-section");
    const siblings = danger.parent?.children ?? [];
    expect(siblings.indexOf(form as never)).toBeLessThan(siblings.indexOf(danger as never));
  });

  it("notifications: hosts ONLY the preferences section, not the rest of legacy Settings", () => {
    const { queryByText } = render(<NotificationsRoute />);
    expect(queryByText("notification-preferences-section")).toBeTruthy();
    for (const leaked of [
      "settings-form",
      "timezone-section",
      "appearance-section",
      "app-info-section",
      "delete-account-section",
    ]) {
      expect(queryByText(leaked)).toBeNull();
    }
  });
});

describe("/(user)/you/admin/* — community-admin leaves", () => {
  const cases: Array<[string, React.ComponentType, string, string]> = [
    ["requests", AdminRequestsRoute, "Join requests", "pending-requests-content"],
    ["stats", AdminStatsRoute, "Attendance", "stats-content"],
    ["community", AdminCommunityRoute, "Community settings", "settings-content"],
  ];

  for (const [name, Route, title, leaf] of cases) {
    it(`${name}: a community admin sees "${title}"`, () => {
      const { getByText } = render(<Route />);
      expect(getByText(title)).toBeTruthy();
      expect(getByText(leaf)).toBeTruthy();
    });

    it(`${name}: a plain member is redirected`, () => {
      (useAuth as jest.Mock).mockReturnValue(plainMember);
      const { getByText, queryByText } = render(<Route />);
      expect(getByText(REDIRECT)).toBeTruthy();
      expect(queryByText(leaf)).toBeNull();
    });

    it(`${name}: internal staff who are NOT community admins are redirected (AdminScreen shows them Dashboard only)`, () => {
      (useAuth as jest.Mock).mockReturnValue(staffOnly);
      const { getByText } = render(<Route />);
      expect(getByText(REDIRECT)).toBeTruthy();
    });

    it(`${name}: an admin with no community is redirected`, () => {
      (useAuth as jest.Mock).mockReturnValue({
        user: { id: "u1", is_admin: true },
        community: null,
        isLoading: false,
      });
      const { getByText } = render(<Route />);
      expect(getByText(REDIRECT)).toBeTruthy();
    });

    it(`${name}: renders nothing while auth is still loading`, () => {
      (useAuth as jest.Mock).mockReturnValue({ user: null, community: null, isLoading: true });
      const { queryByText } = render(<Route />);
      expect(queryByText(REDIRECT)).toBeNull();
      expect(queryByText(leaf)).toBeNull();
    });

    it(`${name}: redirects when the shell flag is off, even for an admin`, () => {
      mockShellState.mockReturnValue({ enabled: false, loaded: true });
      const { getByText } = render(<Route />);
      expect(getByText(REDIRECT)).toBeTruthy();
    });
  }

  it("members: renders the admin roster with AdminScreen's exact PeopleTabScreen props", () => {
    const { getByText } = render(<AdminMembersRoute />);
    expect(getByText("Members")).toBeTruthy();
    expect(getByText("people-tab-screen:all=true:embedded=true")).toBeTruthy();
  });

  it("members: a plain member is redirected", () => {
    (useAuth as jest.Mock).mockReturnValue(plainMember);
    const { getByText } = render(<AdminMembersRoute />);
    expect(getByText(REDIRECT)).toBeTruthy();
  });
});

describe("/(user)/you/admin/staff — staff dashboard leaf", () => {
  it("internal staff see it even without being a community admin", () => {
    (useAuth as jest.Mock).mockReturnValue(staffOnly);
    const { getByText } = render(<AdminStaffRoute />);
    expect(getByText("Staff dashboard")).toBeTruthy();
    expect(getByText("super-admin-dashboard-content")).toBeTruthy();
  });

  it("internal staff see it even with no community (AdminScreen's no-community staff case)", () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { id: "u2", is_superuser: true },
      community: null,
      isLoading: false,
    });
    const { getByText } = render(<AdminStaffRoute />);
    expect(getByText("super-admin-dashboard-content")).toBeTruthy();
  });

  it("a community admin who is NOT internal staff is redirected", () => {
    const { getByText, queryByText } = render(<AdminStaffRoute />);
    expect(getByText(REDIRECT)).toBeTruthy();
    expect(queryByText("super-admin-dashboard-content")).toBeNull();
  });

  it("a plain member is redirected", () => {
    (useAuth as jest.Mock).mockReturnValue(plainMember);
    const { getByText } = render(<AdminStaffRoute />);
    expect(getByText(REDIRECT)).toBeTruthy();
  });

  it("redirects when the shell flag is off", () => {
    (useAuth as jest.Mock).mockReturnValue(staffOnly);
    mockShellState.mockReturnValue({ enabled: false, loaded: true });
    const { getByText } = render(<AdminStaffRoute />);
    expect(getByText(REDIRECT)).toBeTruthy();
  });
});
