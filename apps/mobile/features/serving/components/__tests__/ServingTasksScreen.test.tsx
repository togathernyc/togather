import React from "react";
import { render } from "@testing-library/react-native";
import { ServingTasksScreen } from "../ServingTasksScreen";
import { useAuthenticatedQuery } from "@services/api/convex";

// --- Convex API refs used by the screen -------------------------------------
const REF = {
  mine: "api.functions.scheduling.eventTasks.getMyServingTasks",
  eligibility: "api.functions.scheduling.serving.getServingEligibility",
  shared: "api.functions.scheduling.eventTasks.getSharedTeamTasks",
  crew: "api.functions.scheduling.eventTasks.getCrewTasks",
  allTeams: "api.functions.scheduling.eventTasks.getAllTeamsTasks",
};

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      scheduling: {
        eventTasks: {
          getMyServingTasks: "api.functions.scheduling.eventTasks.getMyServingTasks",
          getSharedTeamTasks: "api.functions.scheduling.eventTasks.getSharedTeamTasks",
          getCrewTasks: "api.functions.scheduling.eventTasks.getCrewTasks",
          getAllTeamsTasks: "api.functions.scheduling.eventTasks.getAllTeamsTasks",
          toggleSharedTeamTask: "toggleSharedTeamTask",
          toggleTaskCompletion: "toggleTaskCompletion",
          togglePersonalTask: "togglePersonalTask",
          addPersonalTask: "addPersonalTask",
          updatePersonalTask: "updatePersonalTask",
          deletePersonalTask: "deletePersonalTask",
        },
        serving: {
          getServingEligibility: "api.functions.scheduling.serving.getServingEligibility",
        },
      },
    },
  },
  useAuthenticatedQuery: jest.fn(),
  useAuthenticatedMutation: () => jest.fn(),
}));

jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: {
      background: "#fff",
      surface: "#fafafa",
      border: "#e5e5e5",
      text: "#000",
      textSecondary: "#666",
      textTertiary: "#999",
      error: "#c00",
    },
    isDark: false,
  }),
}));

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({ primaryColor: "#D9A441" }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@/stores/eventModeStore", () => ({
  useEventModeStore: (sel: (s: { activePlanId: string }) => unknown) =>
    sel({ activePlanId: "plan-1" }),
}));

jest.mock("@providers/ConnectionProvider", () => ({
  useConnectionStatus: () => ({
    isNetworkAvailable: true,
    isEffectivelyOffline: false,
  }),
}));

const mockCacheState = { getSectionStale: () => null, setSection: jest.fn() };
jest.mock("@/stores/servingTasksCache", () => {
  const hook = () => mockCacheState;
  (hook as unknown as { getState: () => typeof mockCacheState }).getState = () =>
    mockCacheState;
  return { useServingTasksCache: hook };
});

const mockQueueState = {
  pending: {} as Record<string, unknown>,
  enqueue: jest.fn(),
  dequeue: jest.fn(),
  all: () => [] as unknown[],
};
jest.mock("@/stores/servingTaskQueue", () => {
  const hook = (sel: (s: typeof mockQueueState) => unknown) => sel(mockQueueState);
  (hook as unknown as { getState: () => typeof mockQueueState }).getState = () =>
    mockQueueState;
  return {
    useServingTaskQueue: hook,
    completionId: (kind: string, taskId: string, timeLabel?: string | null) =>
      `${kind}:${taskId}:${timeLabel ?? ""}`,
  };
});

jest.mock("../ServingPlanSwitcher", () => ({ ServingPlanSwitcher: () => null }));
jest.mock("../HowToViewer", () => ({ HowToViewer: () => null }));
jest.mock("@components/ui/ProgressBar", () => ({ ProgressBar: () => null }));

const mockQuery = useAuthenticatedQuery as jest.Mock;

const EMPTY_MINE = { before: [], during: [], after: [] };

function templateTask(overrides: Record<string, unknown> = {}) {
  return {
    key: "t1",
    taskId: "task-1",
    title: "Set up chairs",
    segment: "before",
    isPersonal: false,
    completed: false,
    ...overrides,
  };
}

function personalTask(overrides: Record<string, unknown> = {}) {
  return {
    key: "p1",
    taskId: "personal-1",
    title: "Bring water bottle",
    segment: "before",
    isPersonal: true,
    completed: false,
    ...overrides,
  };
}

function mockQueries(mine: unknown) {
  mockQuery.mockImplementation((ref: string) => {
    switch (ref) {
      case REF.mine:
        return mine;
      case REF.eligibility:
        return {
          plans: [{ planId: "plan-1", title: "Sunday Gathering", startsAt: 0 }],
        };
      case REF.shared:
      case REF.crew:
      case REF.allTeams:
        return [];
      default:
        return undefined;
    }
  });
}

const NO_PRELOAD_MESSAGE =
  "No preloaded task. Please contact your team lead to add tasks.";

describe("ServingTasksScreen — no preloaded tasks", () => {
  afterEach(() => jest.clearAllMocks());

  it("shows the no-preloaded-task notice when the role has no template tasks", () => {
    mockQueries(EMPTY_MINE);
    const { getByText, queryByText, getAllByText } = render(<ServingTasksScreen />);

    // The exact guidance message is shown.
    expect(getByText(NO_PRELOAD_MESSAGE)).toBeTruthy();
    // The generic per-segment empty text is suppressed in this state.
    expect(queryByText("Nothing here yet.")).toBeNull();
    // Users can still add their own tasks in every segment.
    expect(getAllByText("Add my own task")).toHaveLength(3);
  });

  it("still shows the notice when only personal (user-added) tasks exist", () => {
    mockQueries({ before: [personalTask()], during: [], after: [] });
    const { getByText } = render(<ServingTasksScreen />);

    expect(getByText(NO_PRELOAD_MESSAGE)).toBeTruthy();
    // The personal task is still rendered.
    expect(getByText("Bring water bottle")).toBeTruthy();
  });

  it("hides the notice when the role has preloaded (template) tasks", () => {
    mockQueries({ before: [templateTask()], during: [], after: [] });
    const { queryByText, getByText, getAllByText } = render(<ServingTasksScreen />);

    expect(queryByText(NO_PRELOAD_MESSAGE)).toBeNull();
    expect(getByText("Set up chairs")).toBeTruthy();
    // The other (empty) segments fall back to the generic empty text.
    expect(getAllByText("Nothing here yet.")).toHaveLength(2);
  });
});
