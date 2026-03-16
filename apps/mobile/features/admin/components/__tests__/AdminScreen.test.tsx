import React from "react";
import { render } from "@testing-library/react-native";
import { AdminScreen } from "../AdminScreen";
import { useAuth } from "@providers/AuthProvider";

jest.mock("@providers/AuthProvider", () => ({
  useAuth: jest.fn(),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("../PendingRequestsContent", () => ({
  PendingRequestsContent: () => null,
}));
jest.mock("../StatsContent", () => ({
  StatsContent: () => null,
}));
jest.mock("../PeopleContent", () => ({
  PeopleContent: () => null,
}));
jest.mock("../SettingsContent", () => ({
  SettingsContent: () => null,
}));
jest.mock("../LandingPageContent", () => ({
  LandingPageContent: () => null,
}));
jest.mock("../SuperAdminDashboardContent", () => ({
  SuperAdminDashboardContent: () => null,
}));

describe("AdminScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("shows Dashboard tab for Togather internal users", () => {
    (useAuth as jest.Mock).mockReturnValue({
      community: { id: "community-1" },
      user: { is_staff: true, is_superuser: false },
    });

    const { getByText } = render(<AdminScreen />);

    expect(getByText("Dashboard")).toBeTruthy();
    expect(getByText("Requests")).toBeTruthy();
  });

  test("hides Dashboard tab for non-internal users", () => {
    (useAuth as jest.Mock).mockReturnValue({
      community: { id: "community-1" },
      user: { is_staff: false, is_superuser: false },
    });

    const { queryByText, getByText } = render(<AdminScreen />);

    expect(queryByText("Dashboard")).toBeNull();
    expect(getByText("Requests")).toBeTruthy();
  });

  test("shows internal dashboard without requiring a selected community", () => {
    (useAuth as jest.Mock).mockReturnValue({
      community: null,
      user: { is_staff: true, is_superuser: false },
    });

    const { getByText, queryByText } = render(<AdminScreen />);

    expect(getByText("Dashboard")).toBeTruthy();
    expect(queryByText("No Community Selected")).toBeNull();
  });
});

