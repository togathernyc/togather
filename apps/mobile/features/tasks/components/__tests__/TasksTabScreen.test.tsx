import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { TasksTabScreen } from "../TasksTabScreen";
import { useAuthenticatedMutation, useAuthenticatedQuery } from "@services/api/convex";

jest.mock("expo-router", () => ({
  useRouter: () => ({
    canGoBack: () => true,
    back: jest.fn(),
    push: jest.fn(),
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@components/guards/UserRoute", () => ({
  UserRoute: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({ primaryColor: "#2563EB" }),
}));

jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({ community: { id: "community-1" } }),
}));

jest.mock("../../../../hooks/useIsDesktopWeb", () => ({
  useIsDesktopWeb: () => false,
}));

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      tasks: {
        index: {
          listMine: "api.functions.tasks.index.listMine",
          listAll: "api.functions.tasks.index.listAll",
          listClaimable: "api.functions.tasks.index.listClaimable",
          listAssignableLeaders: "api.functions.tasks.index.listAssignableLeaders",
          listGroup: "api.functions.tasks.index.listGroup",
          claim: "api.functions.tasks.index.claim",
          markDone: "api.functions.tasks.index.markDone",
          snooze: "api.functions.tasks.index.snooze",
          cancel: "api.functions.tasks.index.cancel",
          assign: "api.functions.tasks.index.assign",
          create: "api.functions.tasks.index.create",
        },
      },
      groups: {
        queries: {
          listForUser: "api.functions.groups.queries.listForUser",
        },
      },
      groupMembers: {
        list: "api.functions.groupMembers.list",
      },
    },
  },
  useAuthenticatedQuery: jest.fn(),
  useAuthenticatedMutation: jest.fn(),
}));

describe("TasksTabScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (useAuthenticatedMutation as jest.Mock).mockReturnValue(jest.fn());

    (useAuthenticatedQuery as jest.Mock).mockImplementation((queryFn: string) => {
      if (queryFn === "api.functions.tasks.index.listMine") {
        return [
          {
            _id: "task-mine-1",
            title: "My Follow-up",
            status: "open",
            sourceType: "manual",
            groupId: "group-1",
            groupName: "Group A",
            assignedToId: "leader-me",
            assignedToName: "Me Leader",
            targetType: "none",
            tags: ["care"],
          },
        ];
      }

      if (queryFn === "api.functions.tasks.index.listAll") {
        return [
          {
            _id: "task-mine-1",
            title: "My Follow-up",
            status: "open",
            sourceType: "manual",
            groupId: "group-1",
            groupName: "Group A",
            assignedToId: "leader-me",
            assignedToName: "Me Leader",
            targetType: "none",
            tags: ["care"],
          },
          {
            _id: "task-other-1",
            title: "Other Leader Task",
            status: "open",
            sourceType: "followup",
            groupId: "group-1",
            groupName: "Group A",
            assignedToId: "leader-alex",
            assignedToName: "Alex Leader",
            targetType: "none",
            tags: ["followup"],
          },
          {
            _id: "task-unassigned-1",
            title: "Unassigned Task",
            status: "open",
            sourceType: "reach_out",
            groupId: "group-2",
            groupName: "Group B",
            targetType: "none",
            tags: ["reach_out"],
          },
        ];
      }

      if (queryFn === "api.functions.tasks.index.listClaimable") {
        return [
          {
            _id: "task-unassigned-1",
            title: "Unassigned Task",
            status: "open",
            sourceType: "reach_out",
            groupId: "group-2",
            groupName: "Group B",
            targetType: "none",
            tags: ["reach_out"],
          },
        ];
      }

      if (queryFn === "api.functions.groups.queries.listForUser") {
        return [{ _id: "group-1", name: "Group A", userRole: "leader" }];
      }

      if (queryFn === "api.functions.groupMembers.list") {
        return { items: [] };
      }

      if (queryFn === "api.functions.tasks.index.listGroup") {
        return [];
      }

      if (queryFn === "api.functions.tasks.index.listAssignableLeaders") {
        return [];
      }

      return undefined;
    });
  });

  it("shows My/All/Claimable tabs and filters all tasks by assignee", () => {
    const { getByText, queryByText } = render(<TasksTabScreen />);

    expect(getByText("My Tasks")).toBeTruthy();
    expect(getByText("All Tasks")).toBeTruthy();
    expect(getByText("Claimable")).toBeTruthy();

    expect(getByText("My Follow-up")).toBeTruthy();
    expect(queryByText("Other Leader Task")).toBeNull();

    fireEvent.press(getByText("All Tasks"));
    expect(getByText("Other Leader Task")).toBeTruthy();
    expect(getByText("Unassigned Task")).toBeTruthy();

    fireEvent.press(getByText("Alex Leader"));
    expect(getByText("Other Leader Task")).toBeTruthy();
    expect(queryByText("My Follow-up")).toBeNull();
    expect(queryByText("Unassigned Task")).toBeNull();

    fireEvent.press(getByText("Unassigned"));
    expect(getByText("Unassigned Task")).toBeTruthy();
    expect(queryByText("Other Leader Task")).toBeNull();
  });
});
