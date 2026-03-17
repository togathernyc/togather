import React from "react";
import { render } from "@testing-library/react-native";
import { FloatingGroupCard } from "../FloatingGroupCard";
import { Group } from "@features/groups/types";

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
