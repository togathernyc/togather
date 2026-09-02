import React from "react";
import { StyleSheet, View } from "react-native";
import { render } from "@testing-library/react-native";
import { FloatingGroupCard } from "../FloatingGroupCard";
import { Group } from "@features/groups/types";
import { waTabBarContentClearance } from "@components/wa";

jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: 1, email: "test@example.com" },
  }),
}));

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({
    primaryColor: "#D4A24E",
  }),
}));

jest.mock("@features/groups/utils", () => ({
  getGroupTypeLabel: jest.fn(() => "Dinner Party"),
}));

jest.mock("@components/ui", () => ({
  AppImage: () => null,
}));

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    _id: "group_123",
    id: 123,
    title: "Test Group",
    type: 1,
    city: "New York",
    state: "New York",
    ...overrides,
  };
}

describe("FloatingGroupCard - meeting type display", () => {
  const onClose = jest.fn();

  it('displays "In-person" for meeting_type=1', () => {
    const group = makeGroup({ meeting_type: 1 });
    const { getByText } = render(
      <FloatingGroupCard group={group} onClose={onClose} />
    );
    expect(getByText("In-person")).toBeTruthy();
  });

  it('displays "Online" for meeting_type=2', () => {
    const group = makeGroup({ meeting_type: 2 });
    const { getByText } = render(
      <FloatingGroupCard group={group} onClose={onClose} />
    );
    expect(getByText("Online")).toBeTruthy();
  });

  it("does not display meeting type when meeting_type is null", () => {
    const group = makeGroup({ meeting_type: null });
    const { queryByText } = render(
      <FloatingGroupCard group={group} onClose={onClose} />
    );
    expect(queryByText("Online")).toBeNull();
    expect(queryByText("In-person")).toBeNull();
  });

  it("does not display meeting type when meeting_type is undefined", () => {
    const group = makeGroup({ meeting_type: undefined });
    const { queryByText } = render(
      <FloatingGroupCard group={group} onClose={onClose} />
    );
    expect(queryByText("Online")).toBeNull();
    expect(queryByText("In-person")).toBeNull();
  });
});


/**
 * This card is shared: the flag-on `WaGroupsScreen` floats it over a map that
 * runs under the tab island, while the flag-off `GroupsScreen` floats it over
 * its own map with no island at all. The clearance is therefore a prop, and
 * the DEFAULT is the flag-off layout's long-standing 120 — flag-off must stay
 * byte-identical (an earlier cut derived it from the island metric, which
 * silently moved flag-off from 120 to 84).
 */
describe("FloatingGroupCard — bottom clearance", () => {
  function overlayOf(tree: ReturnType<typeof render>) {
    const overlays = tree.UNSAFE_getAllByType(View).filter((v: any) => {
      const st = StyleSheet.flatten(v.props.style) || {};
      return st.position === "absolute" && st.zIndex === 1000;
    });
    expect(overlays.length).toBeGreaterThan(0);
    return StyleSheet.flatten(overlays[0].props.style);
  }

  it("defaults to the flag-off 120 when no clearance is passed", () => {
    const tree = render(
      <FloatingGroupCard group={makeGroup()} onClose={() => {}} />
    );
    expect(overlayOf(tree).paddingBottom).toBe(120);
  });

  it("uses the caller's clearance when one is passed", () => {
    const tree = render(
      <FloatingGroupCard
        group={makeGroup()}
        onClose={() => {}}
        bottomClearance={waTabBarContentClearance(34)}
      />
    );
    expect(overlayOf(tree).paddingBottom).toBe(waTabBarContentClearance(34));
    expect(waTabBarContentClearance(34)).not.toBe(120);
  });
});
