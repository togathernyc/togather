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
import { render } from "@testing-library/react-native";
import { YouScreen } from "../YouScreen";
import { useAuth } from "@providers/AuthProvider";
import { useAuthenticatedQuery } from "@services/api/convex";
import { WA_AVATAR_PROFILE, WA_TYPE_HERO_NAME } from "@components/wa";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
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

describe("YouScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuthenticatedQuery as jest.Mock).mockReturnValue(undefined);
    (useAuth as jest.Mock).mockReturnValue({
      user: { id: "user-1", first_name: "Ada", last_name: "Lovelace" },
      community: { id: "community-1", name: "Demo Community" },
      logout: jest.fn(),
    });
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
      "Invite your church",
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
});
