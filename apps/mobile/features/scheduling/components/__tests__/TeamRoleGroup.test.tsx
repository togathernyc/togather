import React from "react";
import { render } from "@testing-library/react-native";

// TeamRoleGroup lives in EventEditorScreen, which pulls in Convex, the router
// and several heavy sibling components at import time. The group itself only
// needs RN + Ionicons + the shared styles, so the heavy modules are stubbed.
const mockUseAuthenticatedQuery = jest.fn();
jest.mock("@services/api/convex", () => ({
  api: { functions: { scheduling: { teams: { getTeam: "getTeam" } } } },
  useAuthenticatedQuery: (...args: unknown[]) => mockUseAuthenticatedQuery(...args),
  useAuthenticatedMutation: jest.fn(() => jest.fn()),
  useAuthenticatedAction: jest.fn(() => jest.fn()),
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => false }),
  useLocalSearchParams: () => ({ id: "plan-1" }),
}));
jest.mock("@hooks/useTheme", () => ({ useTheme: () => ({ colors: {} }) }));
jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({ primaryColor: "#2563EB" }),
}));
jest.mock("../NeededRolesModal", () => ({ NeededRolesModal: () => null }));
jest.mock("../AssignSheet", () => ({ AssignSheet: () => null }));
jest.mock("../TimesEditor", () => ({ TimesEditor: () => null }));
jest.mock("../TeamChannelToggle", () => ({ TeamChannelToggle: () => null }));

import { TeamRoleGroup } from "../EventEditorScreen";

const ROLES = [
  {
    roleId: "role-1",
    teamId: "team-1",
    roleName: "Greeter",
    needed: 2,
    filled: 0,
    open: 2,
    assignments: [],
  },
] as any;

function renderGroup() {
  return render(
    <TeamRoleGroup
      groupId={"group-1" as never}
      teamId={"team-1" as never}
      roles={ROLES}
      onAssign={jest.fn()}
      onUnassign={jest.fn()}
    />,
  );
}

describe("TeamRoleGroup header", () => {
  afterEach(() => {
    mockUseAuthenticatedQuery.mockReset();
  });

  it("shows a neutral placeholder while getTeam is loading", () => {
    mockUseAuthenticatedQuery.mockReturnValue(undefined);
    const { getByText, queryAllByText } = renderGroup();

    // Never the first role's name — that reads as if the team were called
    // "Greeter" for a frame (issue #403). The role card still shows it.
    expect(getByText("Team")).toBeTruthy();
    expect(queryAllByText("Greeter")).toHaveLength(1);
  });

  it("shows the real team name once getTeam resolves", () => {
    mockUseAuthenticatedQuery.mockReturnValue({
      _id: "team-1",
      name: "Hospitality",
      hasChannel: false,
      channelSlug: null,
    });
    const { getByText, queryByText } = renderGroup();

    expect(getByText("Hospitality")).toBeTruthy();
    expect(queryByText("Team")).toBeNull();
  });
});
