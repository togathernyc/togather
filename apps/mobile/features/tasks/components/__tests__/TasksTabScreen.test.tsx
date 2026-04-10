import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { TasksTabScreen } from "../TasksTabScreen";
import { useAuthenticatedMutation, useAuthenticatedQuery } from "@services/api/convex";

let mockSearchParams: { group_id?: string; returnTo?: string } = {};
let mockPathname = "/tasks";
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;

jest.mock("expo-router", () => ({
  useRouter: () => ({
    canGoBack: () => mockCanGoBack,
    back: mockBack,
    push: mockPush,
    replace: mockReplace,
  }),
  useLocalSearchParams: () => mockSearchParams,
  usePathname: () => mockPathname,
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
          searchAssignableLeaders: "api.functions.tasks.index.searchAssignableLeaders",
          searchRelevantMembers: "api.functions.tasks.index.searchRelevantMembers",
          listGroup: "api.functions.tasks.index.listGroup",
          claim: "api.functions.tasks.index.claim",
          markDone: "api.functions.tasks.index.markDone",
          reopen: "api.functions.tasks.index.reopen",
          snooze: "api.functions.tasks.index.snooze",
          cancel: "api.functions.tasks.index.cancel",
          assign: "api.functions.tasks.index.assign",
          create: "api.functions.tasks.index.create",
          hasLeaderAccess: "api.functions.tasks.index.hasLeaderAccess",
          createFromTemplate: "api.functions.tasks.index.createFromTemplate",
        },
      },
      taskTemplates: {
        index: {
          list: "api.functions.taskTemplates.index.list",
          listAll: "api.functions.taskTemplates.index.listAll",
          create: "api.functions.taskTemplates.index.create",
          update: "api.functions.taskTemplates.index.update",
          remove: "api.functions.taskTemplates.index.remove",
        },
      },
      groups: {
        queries: {
          listForUser: "api.functions.groups.queries.listForUser",
        },
      },
    },
  },
  useAuthenticatedQuery: jest.fn(),
  useAuthenticatedMutation: jest.fn(),
}));

describe("TasksTabScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = {};
    mockPathname = "/tasks";
    mockCanGoBack = true;

    (useAuthenticatedMutation as jest.Mock).mockReturnValue(jest.fn());

    (useAuthenticatedQuery as jest.Mock).mockImplementation((queryFn: string, args?: unknown) => {
      if (args === "skip") return undefined;

      if (queryFn === "api.functions.tasks.index.listMine") {
        const scope =
          args && typeof args === "object" && args !== null && "listScope" in args
            ? (args as { listScope?: string }).listScope
            : "active";
        if (scope === "completed") {
          return [
            {
              _id: "task-done-1",
              title: "Finished follow-up",
              status: "done",
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

      if (queryFn === "api.functions.tasks.index.hasLeaderAccess") {
        return true;
      }

      if (queryFn === "api.functions.taskTemplates.index.listAll") {
        return [];
      }

      if (queryFn === "api.functions.taskTemplates.index.list") {
        return [];
      }

      if (
        queryFn === "api.functions.tasks.index.listGroup" ||
        queryFn === "api.functions.tasks.index.listAssignableLeaders" ||
        queryFn === "api.functions.tasks.index.searchAssignableLeaders" ||
        queryFn === "api.functions.tasks.index.searchRelevantMembers"
      ) {
        return [];
      }

      return undefined;
    });
  });

  it("filters all tasks by assignee using filter modal controls", () => {
    const { getByText, getByTestId, queryByText } = render(<TasksTabScreen />);

    expect(getByText("My Follow-up")).toBeTruthy();
    expect(queryByText("Other Leader Task")).toBeNull();

    fireEvent.press(getByText("All Tasks"));
    expect(getByText("Other Leader Task")).toBeTruthy();
    expect(getByText("Unassigned Task")).toBeTruthy();

    fireEvent.press(getByTestId("tasks-filter-button"));
    fireEvent.press(getByTestId("tasks-filter-assignee-leader-alex"));
    fireEvent.press(getByTestId("tasks-filter-apply"));
    expect(getByText("Other Leader Task")).toBeTruthy();
    expect(queryByText("My Follow-up")).toBeNull();
    expect(queryByText("Unassigned Task")).toBeNull();

    fireEvent.press(getByTestId("tasks-filter-button"));
    fireEvent.press(getByTestId("tasks-filter-assignee-unassigned"));
    fireEvent.press(getByTestId("tasks-filter-apply"));
    expect(getByText("Unassigned Task")).toBeTruthy();
    expect(queryByText("Other Leader Task")).toBeNull();
  });

  it("defaults to current group filter when opened from a group route", () => {
    mockSearchParams = { group_id: "group-1" };
    const { getByText, queryByText } = render(<TasksTabScreen />);

    fireEvent.press(getByText("All Tasks"));
    expect(getByText("My Follow-up")).toBeTruthy();
    expect(getByText("Other Leader Task")).toBeTruthy();
    expect(queryByText("Unassigned Task")).toBeNull();
  });

  it("navigates to explicit returnTo route when provided", () => {
    mockSearchParams = { returnTo: encodeURIComponent("/(tabs)/profile") };
    const { getByTestId } = render(<TasksTabScreen />);
    fireEvent.press(getByTestId("tasks-back-button"));

    expect(mockPush).toHaveBeenCalledWith("/(tabs)/profile");
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("uses replace to profile when no history is available", () => {
    mockCanGoBack = false;
    const { getByTestId } = render(<TasksTabScreen />);
    fireEvent.press(getByTestId("tasks-back-button"));

    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/profile");
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("uses router.back when opened from group tasks route", () => {
    mockSearchParams = { group_id: "group-1" };
    mockPathname = "/leader-tools/group-1/tasks";
    const { getByTestId } = render(<TasksTabScreen />);
    fireEvent.press(getByTestId("tasks-back-button"));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows Reopen on completed tasks when Show completed is pressed", () => {
    const { getByText } = render(<TasksTabScreen />);
    fireEvent.press(getByText("Show completed tasks"));
    expect(getByText("Finished follow-up")).toBeTruthy();
    expect(getByText("Reopen")).toBeTruthy();
  });

  it("scopes workflows to the current group using list when group_id is set", () => {
    mockSearchParams = { group_id: "group-1" };
    const groupWorkflowRows = [
      {
        _id: "tpl-group",
        title: "Onboarding",
        groupId: "group-1",
        isActive: true,
        steps: [{ title: "Step 1", orderIndex: 0 }],
      },
    ];
    const listSpy = jest.fn();
    (useAuthenticatedQuery as jest.Mock).mockImplementation((queryFn: string, args?: unknown) => {
      if (args === "skip") return undefined;
      if (queryFn === "api.functions.tasks.index.hasLeaderAccess") return true;
      if (queryFn === "api.functions.taskTemplates.index.list") {
        listSpy(args);
        return groupWorkflowRows;
      }
      if (queryFn === "api.functions.taskTemplates.index.listAll") {
        throw new Error("listAll should not run when group_id is set");
      }
      if (queryFn === "api.functions.groups.queries.listForUser") {
        return [{ _id: "group-1", name: "Group A", userRole: "leader" }];
      }
      if (queryFn === "api.functions.tasks.index.listMine") {
        const scope =
          args && typeof args === "object" && args !== null && "listScope" in args
            ? (args as { listScope?: string }).listScope
            : "active";
        if (scope === "completed") return [];
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
      if (queryFn === "api.functions.tasks.index.listAll") return [];
      if (queryFn === "api.functions.tasks.index.listClaimable") return [];
      if (
        queryFn === "api.functions.tasks.index.listGroup" ||
        queryFn === "api.functions.tasks.index.listAssignableLeaders" ||
        queryFn === "api.functions.tasks.index.searchAssignableLeaders" ||
        queryFn === "api.functions.tasks.index.searchRelevantMembers"
      ) {
        return [];
      }
      return undefined;
    });

    const { getByText } = render(<TasksTabScreen />);
    fireEvent.press(getByText("Workflows"));
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: "group-1" }),
    );
    expect(getByText("Onboarding")).toBeTruthy();
    expect(getByText("Edit")).toBeTruthy();
  });

  it("shows Workflows tab for leaders and switches to workflow list", () => {
    (useAuthenticatedQuery as jest.Mock).mockImplementation((queryFn: string, args?: unknown) => {
      if (args === "skip") return undefined;
      if (queryFn === "api.functions.tasks.index.hasLeaderAccess") return true;
      if (queryFn === "api.functions.taskTemplates.index.listAll") {
        return [
          {
            _id: "tpl-1",
            title: "Demo workflow",
            groupId: "group-1",
            groupName: "Group A",
            isActive: true,
            steps: [{ title: "Step 1", orderIndex: 0 }],
          },
        ];
      }
      if (queryFn === "api.functions.groups.queries.listForUser") {
        return [{ _id: "group-1", name: "Group A", userRole: "leader" }];
      }
      if (queryFn === "api.functions.taskTemplates.index.list") return [];
      if (queryFn === "api.functions.tasks.index.listMine") return [];
      if (queryFn === "api.functions.tasks.index.listAll") return [];
      if (queryFn === "api.functions.tasks.index.listClaimable") return [];
      if (
        queryFn === "api.functions.tasks.index.listGroup" ||
        queryFn === "api.functions.tasks.index.listAssignableLeaders" ||
        queryFn === "api.functions.tasks.index.searchAssignableLeaders" ||
        queryFn === "api.functions.tasks.index.searchRelevantMembers"
      ) {
        return [];
      }
      return undefined;
    });

    const { getByText } = render(<TasksTabScreen />);
    fireEvent.press(getByText("Workflows"));
    expect(getByText("Demo workflow")).toBeTruthy();
    expect(getByText("Apply Workflow")).toBeTruthy();
  });
});
