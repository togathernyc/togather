import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { ServingTasksScreen } from "../ServingTasksScreen";
import { useAuthenticatedQuery, useAuthenticatedMutation } from "@services/api/convex";

// --- Convex API refs used by the screen -------------------------------------
const REF = {
  mine: "api.functions.scheduling.eventTasks.getMyServingTasks",
  eligibility: "api.functions.scheduling.serving.getServingEligibility",
  shared: "api.functions.scheduling.eventTasks.getSharedTeamTasks",
  crew: "api.functions.scheduling.eventTasks.getCrewTasks",
  allTeams: "api.functions.scheduling.eventTasks.getAllTeamsTasks",
  groupById: "api.functions.groups.queries.getById",
  listPlanTasks: "api.functions.scheduling.eventTasks.listPlanTasks",
  listTeams: "api.functions.scheduling.teams.listTeams",
  listRoles: "api.functions.scheduling.roles.listRoles",
  listTaskTemplates: "api.functions.scheduling.taskTemplates.listTaskTemplates",
  templateState: "api.functions.scheduling.planTemplates.getPlanTemplateState",
};

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      groups: {
        queries: {
          getById: "api.functions.groups.queries.getById",
        },
      },
      scheduling: {
        eventTasks: {
          getMyServingTasks: "api.functions.scheduling.eventTasks.getMyServingTasks",
          getSharedTeamTasks: "api.functions.scheduling.eventTasks.getSharedTeamTasks",
          getCrewTasks: "api.functions.scheduling.eventTasks.getCrewTasks",
          getAllTeamsTasks: "api.functions.scheduling.eventTasks.getAllTeamsTasks",
          listPlanTasks: "api.functions.scheduling.eventTasks.listPlanTasks",
          toggleSharedTeamTask: "toggleSharedTeamTask",
          toggleTaskCompletion: "toggleTaskCompletion",
          togglePersonalTask: "togglePersonalTask",
          addPersonalTask: "addPersonalTask",
          updatePersonalTask: "updatePersonalTask",
          deletePersonalTask: "deletePersonalTask",
          createTask: "createTask",
          updateTask: "updateTask",
          deleteTask: "deleteTask",
        },
        serving: {
          getServingEligibility: "api.functions.scheduling.serving.getServingEligibility",
        },
        teams: {
          listTeams: "api.functions.scheduling.teams.listTeams",
        },
        roles: {
          listRoles: "api.functions.scheduling.roles.listRoles",
        },
        taskTemplates: {
          listTaskTemplates: "api.functions.scheduling.taskTemplates.listTaskTemplates",
        },
        planTemplates: {
          setPlanTaskTemplate: "setPlanTaskTemplate",
          getPlanTemplateState:
            "api.functions.scheduling.planTemplates.getPlanTemplateState",
        },
      },
    },
  },
  useAuthenticatedQuery: jest.fn(),
  useAuthenticatedMutation: jest.fn(() => jest.fn()),
}));

// Leader gate for the "Edit" surface (AuthorSection) — default every test to a
// plain, non-admin user so the pre-existing assertions (none of which expect
// an "Edit" pill) keep pinning today's rendering. The dedicated AuthorSection
// tests below override this per-test.
let mockUser: { is_admin?: boolean } | null = { is_admin: false };
jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({ user: mockUser }),
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

// The screen is restyled behind `whatsapp-shell`. Default the suite to
// flag-OFF so every pre-existing assertion keeps pinning today's rendering;
// the flag-on describe below flips it per test.
let mockWhatsappShell = false;
jest.mock("@hooks/useWhatsappShell", () => ({
  useWhatsappShell: () => mockWhatsappShell,
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// Serving state is now driven by `isServingMode` (the store no longer pins a
// single `activePlanId`). A mutable flag lets individual tests flip it.
let mockIsServingMode = true;
jest.mock("@/stores/eventModeStore", () => ({
  useEventModeStore: (sel: (s: { isServingMode: boolean }) => unknown) =>
    sel({ isServingMode: mockIsServingMode }),
}));

// Connectivity is online by default; the Edit-surface offline tests flip
// `mockIsEffectivelyOffline` to pin the deliberate online-only authoring gate.
let mockIsNetworkAvailable = true;
let mockIsEffectivelyOffline = false;
jest.mock("@providers/ConnectionProvider", () => ({
  useConnectionStatus: () => ({
    isNetworkAvailable: mockIsNetworkAvailable,
    isEffectivelyOffline: mockIsEffectivelyOffline,
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

jest.mock("../HowToViewer", () => ({ HowToViewer: () => null }));
jest.mock("@components/ui/ProgressBar", () => ({ ProgressBar: () => null }));

const mockQuery = useAuthenticatedQuery as jest.Mock;
const mockMutation = useAuthenticatedMutation as jest.Mock;

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

type EligiblePlan = { planId: string; title: string; startsAt: number };

const DEFAULT_PLANS: EligiblePlan[] = [
  { planId: "plan-1", title: "Sunday Gathering", startsAt: 0 },
];

/** An `getAllTeamsTasks` row. Only `tasks[].taskId` is read for the count. */
function allTeamsRow(taskIds: string[], teamId = "team-1") {
  return {
    teamId,
    teamName: "Hospitality",
    taskCount: taskIds.length,
    done: 0,
    total: taskIds.length,
    tasks: taskIds.map((taskId) => ({
      taskId,
      title: taskId,
      segment: "before",
      roleNames: [],
      completed: false,
      howToType: "none",
    })),
  };
}

/** A `getCrewTasks` row for the viewer themself (they hold `roleName`). */
function myCrewRow(roleName: string) {
  return {
    userId: "user-1",
    name: "Alex",
    roleId: `role-${roleName}`,
    roleName,
    teamId: "team-1",
    teamName: "Hospitality",
    isCurrentUser: true,
    status: "confirmed",
    done: 0,
    total: 0,
    tasks: [],
  };
}

/** A `getSharedTeamTasks` row (team-level task, Shared pill only). */
function sharedRow(taskId: string, title: string) {
  return {
    taskId,
    teamIds: ["team-1"],
    teamNames: ["Hospitality"],
    title,
    segment: "before",
    howToType: "none",
    completed: false,
  };
}

/**
 * The empty-state discrimination needs more than "Mine" to tell its four
 * states apart, so the shared/crew/all-teams results are overridable.
 * Defaulting them all to `[]` reproduces the plan-has-no-tasks-at-all case.
 */
function mockQueries(
  mine: unknown,
  plans: EligiblePlan[] = DEFAULT_PLANS,
  extra: {
    shared?: unknown;
    crew?: unknown;
    allTeams?: unknown;
    taskTemplates?: unknown;
    templateState?: unknown;
  } = {},
) {
  mockQuery.mockImplementation((ref: string) => {
    switch (ref) {
      case REF.mine:
        return mine;
      case REF.eligibility:
        return { plans };
      case REF.shared:
        return extra.shared ?? [];
      case REF.crew:
        return extra.crew ?? [];
      case REF.allTeams:
        return extra.allTeams ?? [];
      case REF.listTaskTemplates:
        return extra.taskTemplates ?? [];
      case REF.templateState:
        // Upcoming plan by default — a PAST plan can't be re-linked at all.
        return extra.templateState ?? UPCOMING_PLAN;
      default:
        return undefined;
    }
  });
}

/** `getPlanTemplateState` — only `isPast` is read here. Hoisted for reference
 *  stability across renders (see `AUTHOR_TEAMS` below for why that matters). */
const UPCOMING_PLAN = { isPast: false };
const PAST_PLAN = { isPast: true };

const NO_PLAN_TASKS_MESSAGE = "This event has no tasks set up yet.";
const NOT_ROSTERED_MESSAGE = "You're not on the roster for this event.";

/**
 * The "Mine" tab's diagnostic empty state. One generic sentence ("No preloaded
 * task. Please contact your team lead to add tasks.") used to cover three
 * unrelated causes; these pin that each now gets its own honest message. The
 * discrimination itself is unit-tested in
 * `utils/__tests__/servingTaskEmptyState.test.ts` — these cover the wiring.
 */
describe("ServingTasksScreen — diagnostic empty state (Mine)", () => {
  beforeEach(() => {
    mockIsServingMode = true;
  });
  afterEach(() => jest.clearAllMocks());

  it("says the EVENT has no tasks when the plan has zero task rows", () => {
    mockQueries(EMPTY_MINE);
    const { getByText, queryByText, getAllByText } = render(<ServingTasksScreen />);

    expect(getByText(NO_PLAN_TASKS_MESSAGE)).toBeTruthy();
    // It must NOT imply tasks exist and are misconfigured.
    expect(queryByText(/contact your team lead/i)).toBeNull();
    // The generic per-segment empty text is suppressed in this state.
    expect(queryByText("Nothing here yet.")).toBeNull();
    // Users can still add their own tasks in every segment.
    expect(getAllByText("Add my own task")).toHaveLength(3);
  });

  it("still explains the empty state when only personal tasks exist", () => {
    mockQueries({ before: [personalTask()], during: [], after: [] });
    const { getByText } = render(<ServingTasksScreen />);

    expect(getByText(NO_PLAN_TASKS_MESSAGE)).toBeTruthy();
    // The personal task is still rendered.
    expect(getByText("Bring water bottle")).toBeTruthy();
  });

  it("names the rostering gap when the viewer holds no role on the plan", () => {
    mockQueries(EMPTY_MINE, DEFAULT_PLANS, {
      allTeams: [allTeamsRow(["task-1", "task-2"])],
      crew: [], // no non-declined assignment => getCrewTasks short-circuits
    });
    const { getByText } = render(<ServingTasksScreen />);

    expect(getByText(NOT_ROSTERED_MESSAGE)).toBeTruthy();
    // True whether the assignment was removed OR declined — the only two ways
    // to reach this state with the screen already open.
    expect(getByText(/your assignment was removed, or you declined it/)).toBeTruthy();
  });

  it("scopes the task count to all teams and names the viewer's actual roles on a role mismatch", () => {
    mockQueries(EMPTY_MINE, DEFAULT_PLANS, {
      allTeams: [allTeamsRow(["task-1", "task-2", "task-3"])],
      crew: [myCrewRow("Greeter"), myCrewRow("Usher")],
    });
    const { getByText } = render(<ServingTasksScreen />);

    expect(
      getByText("None of this event's tasks are assigned to your roles."),
    ).toBeTruthy();
    expect(getByText(/You're serving as Greeter and Usher\./)).toBeTruthy();
    // The count is plan-wide, so it must say so rather than implying the
    // viewer was singled out.
    expect(getByText(/across all teams/)).toBeTruthy();
    // …and the actionable instruction the old single-message copy had is back.
    expect(getByText(/Ask your team lead to add tasks for your roles\./)).toBeTruthy();
  });

  it("shows nothing until the plan-wide data has loaded, rather than guessing", () => {
    // `getAllTeamsTasks` unresolved: no honest statement is possible yet.
    mockQueries(EMPTY_MINE, DEFAULT_PLANS, { allTeams: undefined });
    mockQuery.mockImplementation((ref: string) => {
      if (ref === REF.mine) return EMPTY_MINE;
      if (ref === REF.eligibility) return { plans: DEFAULT_PLANS };
      if (ref === REF.crew || ref === REF.shared) return [];
      return undefined;
    });
    const { queryByText, getAllByText } = render(<ServingTasksScreen />);

    expect(queryByText(NO_PLAN_TASKS_MESSAGE)).toBeNull();
    expect(queryByText(NOT_ROSTERED_MESSAGE)).toBeNull();
    // The per-segment empty cards stay visible while we can't say anything.
    expect(getAllByText("Nothing here yet.")).toHaveLength(3);
  });

  it("hides the notice when the role has preloaded (template) tasks", () => {
    mockQueries({ before: [templateTask()], during: [], after: [] });
    const { queryByText, getByText, getAllByText } = render(<ServingTasksScreen />);

    expect(queryByText(NO_PLAN_TASKS_MESSAGE)).toBeNull();
    expect(getByText("Set up chairs")).toBeTruthy();
    // The other (empty) segments fall back to the generic empty text.
    expect(getAllByText("Nothing here yet.")).toHaveLength(2);
  });
});

/**
 * "Mine" omits team-level tasks by design (`getMyServingTasks` skips them) and
 * the screen opens on "Mine" — so a team whose tasks are ALL team-level saw an
 * empty tab with no hint that "Shared" held everything. The notice now says so
 * and jumps there in one tap.
 */
describe("ServingTasksScreen — Shared discoverability from an empty Mine", () => {
  beforeEach(() => {
    mockIsServingMode = true;
  });
  afterEach(() => jest.clearAllMocks());

  it("advertises Shared and jumps to it when Mine is empty but Shared has tasks", () => {
    mockQueries(EMPTY_MINE, DEFAULT_PLANS, {
      allTeams: [allTeamsRow(["task-1", "task-2"])],
      crew: [myCrewRow("Greeter")],
      shared: [
        sharedRow("task-1", "Unlock the building"),
        sharedRow("task-2", "Set the thermostat"),
      ],
    });
    const { getByText, getByLabelText } = render(<ServingTasksScreen />);

    expect(getByText(/Shared has 2 tasks for your whole team\./)).toBeTruthy();

    fireEvent.press(getByLabelText("Open the Shared tab"));

    // The Shared section is now showing its tasks.
    expect(getByText("Unlock the building")).toBeTruthy();
    expect(getByText("Set the thermostat")).toBeTruthy();
  });

  // `getSharedTeamTasks` was the one fact defaulted to 0 rather than treated as
  // unloaded, so the notice rendered a confident (wrong) shared hint and no
  // jump, which then popped in. Offline it never corrected itself at all: the
  // stale-cache read returns null when that section was never cached.
  it("says nothing until the shared count has resolved, rather than assuming zero", () => {
    mockQuery.mockImplementation((ref: string) => {
      if (ref === REF.mine) return EMPTY_MINE;
      if (ref === REF.eligibility) return { plans: DEFAULT_PLANS };
      if (ref === REF.allTeams) return [allTeamsRow(["task-1", "task-2"])];
      if (ref === REF.crew) return [myCrewRow("Greeter")];
      if (ref === REF.shared) return undefined; // unresolved
      return undefined;
    });
    const { queryByText, queryByLabelText, getAllByText } = render(
      <ServingTasksScreen />,
    );

    expect(queryByText(/Check All teams/)).toBeNull();
    expect(queryByLabelText("Open the Shared tab")).toBeNull();
    expect(queryByText(/none are assigned to your role/)).toBeNull();
    // The per-segment empty cards stay visible while we can't say anything.
    expect(getAllByText("Nothing here yet.")).toHaveLength(3);
  });

  // A stale-cache mix (an empty all-teams snapshot next to a cached shared
  // list) used to render "This event has no tasks set up yet." directly above
  // "Open Shared (2)" — two statements that contradict each other.
  it("never puts an Open Shared jump under 'this event has no tasks set up yet'", () => {
    mockQueries(EMPTY_MINE, DEFAULT_PLANS, {
      allTeams: [],
      crew: [myCrewRow("Greeter")],
      shared: [
        sharedRow("task-1", "Unlock the building"),
        sharedRow("task-2", "Set the thermostat"),
      ],
    });
    const { getByText, queryByLabelText } = render(<ServingTasksScreen />);

    expect(getByText(NO_PLAN_TASKS_MESSAGE)).toBeTruthy();
    expect(queryByLabelText("Open the Shared tab")).toBeNull();
  });

  it("offers no Shared jump when the team has no shared tasks", () => {
    mockQueries(EMPTY_MINE, DEFAULT_PLANS, {
      allTeams: [allTeamsRow(["task-1"])],
      crew: [myCrewRow("Greeter")],
      shared: [],
    });
    const { queryByLabelText, getByText } = render(<ServingTasksScreen />);

    expect(queryByLabelText("Open the Shared tab")).toBeNull();
    expect(getByText(/Check All teams/)).toBeTruthy();
  });
});

/**
 * A plan created by `createEventDraftImpl` has no tasks and nothing backfills
 * it — tasks only appear when someone links a task template from the rostering
 * grid. This lets a leader do that from serving mode, via the SAME existing
 * `setPlanTaskTemplate` mutation.
 */
describe("ServingTasksScreen — leader affordance on a task-less plan", () => {
  const mockSetPlanTaskTemplate = jest.fn().mockResolvedValue({});

  beforeEach(() => {
    mockIsServingMode = true;
    mockMutation.mockImplementation((ref: string) =>
      ref === "setPlanTaskTemplate" ? mockSetPlanTaskTemplate : jest.fn(),
    );
  });
  afterEach(() => {
    mockUser = { is_admin: false };
    mockIsEffectivelyOffline = false;
    mockMutation.mockImplementation(() => jest.fn());
    jest.clearAllMocks();
  });

  const TEMPLATES = [
    { _id: "tmpl-1", name: "Sunday Production", itemCount: 12 },
    { _id: "tmpl-2", name: "Midweek", itemCount: 1 },
    { _id: "tmpl-empty", name: "Draft", itemCount: 0 },
  ];

  it("links a saved task template via the existing setPlanTaskTemplate", async () => {
    mockUser = { is_admin: true };
    mockQueries(EMPTY_MINE, DEFAULT_PLANS, { taskTemplates: TEMPLATES });
    const { getByText, getByLabelText } = render(<ServingTasksScreen />);

    expect(getByText("Sunday Production · 12 tasks")).toBeTruthy();
    // A template with no items would link cleanly and still leave the plan
    // empty, so it isn't offered.
    expect(getByText("Midweek · 1 task")).toBeTruthy();

    await fireEvent.press(getByLabelText("Add tasks from Sunday Production"));

    expect(mockSetPlanTaskTemplate).toHaveBeenCalledWith({
      planId: "plan-1",
      templateId: "tmpl-1",
      carryover: "copy",
    });
  });

  // The backend defaults `carryover` to "discard", which DELETES every
  // pre-existing task on the plan and cascades its completions — and
  // `setPlanTaskTemplate` does no emptiness check of its own. The only guard is
  // this device's reactive "the plan has no tasks" snapshot, which is stale for
  // as long as it takes another leader's grid write to arrive. "copy" is a
  // no-op on a genuinely empty plan and preserves their rows in the race.
  it("passes carryover 'copy' so a concurrent write is never discarded", async () => {
    mockUser = { is_admin: true };
    mockQueries(EMPTY_MINE, DEFAULT_PLANS, { taskTemplates: TEMPLATES });
    const { getByLabelText } = render(<ServingTasksScreen />);

    await fireEvent.press(getByLabelText("Add tasks from Midweek"));

    expect(mockSetPlanTaskTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ carryover: "copy" }),
    );
  });

  it("omits an item-less template rather than offering a no-op", () => {
    mockUser = { is_admin: true };
    mockQueries(EMPTY_MINE, DEFAULT_PLANS, { taskTemplates: TEMPLATES });
    const { queryByLabelText } = render(<ServingTasksScreen />);

    expect(queryByLabelText("Add tasks from Draft")).toBeNull();
  });

  it("points at the manual path instead of dead-ending when there are no templates", () => {
    mockUser = { is_admin: true };
    mockQueries(EMPTY_MINE, DEFAULT_PLANS, { taskTemplates: [] });
    const { getByText } = render(<ServingTasksScreen />);

    expect(getByText(/no saved task lists yet/)).toBeTruthy();
    expect(getByText(/Use the Edit tab above/)).toBeTruthy();
  });

  // `setPlanTaskTemplate` throws "Past events are frozen and cannot be
  // re-linked." once `plan.eventDate` has passed — and `eventDate` is the FIRST
  // SERVICE's start time, not a day bucket, while serving mode stays open until
  // 4h after the last service. So for a 9:00 service every one of these rows
  // failed with a raw ConvexError for the whole 09:00–13:00 at-the-venue window
  // this affordance exists for. `createTask` has no such freeze, so the Edit tab
  // really is the way through — say so instead of offering a guaranteed error.
  it("offers the Edit tab instead of a guaranteed failure once the event has started", () => {
    mockUser = { is_admin: true };
    mockQueries(EMPTY_MINE, DEFAULT_PLANS, {
      taskTemplates: TEMPLATES,
      templateState: PAST_PLAN,
    });
    const { queryByLabelText, queryByText, getByText } = render(
      <ServingTasksScreen />,
    );

    expect(queryByLabelText("Add tasks from Sunday Production")).toBeNull();
    expect(queryByText("Sunday Production · 12 tasks")).toBeNull();
    expect(getByText(/already started/)).toBeTruthy();
    expect(getByText(/Use the Edit tab above/)).toBeTruthy();
  });

  it("still offers the templates while the event is upcoming", () => {
    mockUser = { is_admin: true };
    mockQueries(EMPTY_MINE, DEFAULT_PLANS, {
      taskTemplates: TEMPLATES,
      templateState: UPCOMING_PLAN,
    });
    const { getByLabelText } = render(<ServingTasksScreen />);

    expect(getByLabelText("Add tasks from Sunday Production")).toBeTruthy();
  });

  it("hides the affordance from a non-leader", () => {
    mockUser = { is_admin: false };
    mockQueries(EMPTY_MINE, DEFAULT_PLANS, { taskTemplates: TEMPLATES });
    const { queryByLabelText, getByText } = render(<ServingTasksScreen />);

    expect(queryByLabelText("Add tasks from Sunday Production")).toBeNull();
    // …but the diagnosis itself is still shown.
    expect(getByText(NO_PLAN_TASKS_MESSAGE)).toBeTruthy();
  });

  it("hides the affordance offline (a plan-wide write with no dedupe key)", () => {
    mockUser = { is_admin: true };
    mockIsEffectivelyOffline = true;
    mockQueries(EMPTY_MINE, DEFAULT_PLANS, { taskTemplates: TEMPLATES });
    const { queryByLabelText } = render(<ServingTasksScreen />);

    expect(queryByLabelText("Add tasks from Sunday Production")).toBeNull();
  });

  it("is not offered when the plan already has tasks", () => {
    mockUser = { is_admin: true };
    mockQueries(EMPTY_MINE, DEFAULT_PLANS, {
      allTeams: [allTeamsRow(["task-1"])],
      crew: [myCrewRow("Greeter")],
      taskTemplates: TEMPLATES,
    });
    const { queryByLabelText } = render(<ServingTasksScreen />);

    expect(queryByLabelText("Add tasks from Sunday Production")).toBeNull();
  });
});

describe("ServingTasksScreen — plan sections", () => {
  beforeEach(() => {
    mockIsServingMode = true;
  });
  afterEach(() => jest.clearAllMocks());

  it("renders one section per eligible plan, each with the plan's header", () => {
    mockQueries({ before: [templateTask()], during: [], after: [] }, [
      { planId: "plan-1", title: "Sunday Morning", startsAt: 0 },
      { planId: "plan-2", title: "Sunday Evening", startsAt: 0 },
    ]);
    const { getByText, getAllByText } = render(<ServingTasksScreen />);

    // Each plan gets its own header (ServingHeader shows plan.title).
    expect(getByText("Sunday Morning")).toBeTruthy();
    expect(getByText("Sunday Evening")).toBeTruthy();
    // Both plan sections render their (mocked, identical) tasks — two copies.
    expect(getAllByText("Set up chairs")).toHaveLength(2);
  });

  it("renders a single section for a single plan", () => {
    mockQueries({ before: [templateTask()], during: [], after: [] });
    const { getByText, getAllByText } = render(<ServingTasksScreen />);

    expect(getByText("Sunday Gathering")).toBeTruthy();
    expect(getAllByText("Set up chairs")).toHaveLength(1);
  });

  it("shows the not-serving empty state when not in serving mode", () => {
    mockIsServingMode = false;
    mockQueries(EMPTY_MINE);
    const { getByText } = render(<ServingTasksScreen />);

    expect(getByText("Not currently serving on an event.")).toBeTruthy();
  });

  it("shows an empty state when serving with zero eligible plans", () => {
    mockQueries(EMPTY_MINE, []);
    const { getByText } = render(<ServingTasksScreen />);

    expect(getByText("Not currently serving on an event.")).toBeTruthy();
  });
});

/**
 * The leader "Edit" surface (`AuthorSection`) — lets a leader add/edit/delete
 * a role's shared serving tasks in place. Gated by `canAuthorPlanTasks`
 * (mirroring the backend's `isGroupScheduler`), so most of these tests set
 * `mockUser.is_admin = true` to get past the gate; the role catalog comes
 * from one `listTeams` + one `listRoles` call per team.
 */
describe("ServingTasksScreen — Edit surface (leader authoring)", () => {
  const mockCreateTask = jest.fn().mockResolvedValue({ taskId: "task-new" });
  const mockUpdateTask = jest.fn().mockResolvedValue({ taskId: "task-1" });
  const mockDeleteTask = jest.fn().mockResolvedValue({ taskId: "task-1" });

  // Hoisted so every call returns the SAME array/object reference — real
  // Convex queries only produce a new reference when the underlying data
  // actually changes, and `RoleLoader`'s effect (like `EventTasksScreen`'s)
  // depends on that stability; a mock that hands back a fresh literal on
  // every render would fire the effect (and its `setRolesForTeam` state
  // update) every render, forever.
  const AUTHOR_TEAMS = [{ _id: "team-1", name: "Hospitality" }];
  const AUTHOR_ROLES = [
    { _id: "role-greeter", name: "Greeter" },
    { _id: "role-usher", name: "Usher" },
  ];
  const NO_SHARED_TASKS: unknown[] = [];

  // A second team, for the cross-team leakage regression below. `listPlanTasks`
  // is PLAN-wide and the role catalog spans every team in the group, so these
  // two teams' tasks arrive in the same array.
  const MULTI_TEAMS = [
    { _id: "team-kids", name: "Kids" },
    { _id: "team-worship", name: "Worship" },
  ];
  const KIDS_ROLES = [{ _id: "role-checkin", name: "Check-in" }];
  const WORSHIP_ROLES = [{ _id: "role-sound", name: "Sound" }];

  function mockAuthorQueries(
    planTasks: unknown[] = [],
    teams: unknown = AUTHOR_TEAMS,
    rolesFor: (teamId?: string) => unknown = () => AUTHOR_ROLES,
  ) {
    mockQuery.mockImplementation((ref: string, args?: { teamId?: string }) => {
      switch (ref) {
        case REF.mine:
          return EMPTY_MINE;
        case REF.eligibility:
          return { plans: DEFAULT_PLANS };
        case REF.shared:
        case REF.crew:
        case REF.allTeams:
          return NO_SHARED_TASKS;
        case REF.groupById:
          return { userRole: undefined };
        case REF.listTeams:
          return teams;
        case REF.listRoles:
          return rolesFor(args?.teamId);
        case REF.listPlanTasks:
          return planTasks;
        case REF.listTaskTemplates:
          // These tests are about the Edit surface, not the empty-state
          // template affordance — leave the group with no saved templates.
          return [];
        case REF.templateState:
          return UPCOMING_PLAN;
        default:
          return undefined;
      }
    });
  }

  function mockMultiTeamAuthorQueries(planTasks: unknown[]) {
    mockAuthorQueries(planTasks, MULTI_TEAMS, (teamId) =>
      teamId === "team-kids" ? KIDS_ROLES : WORSHIP_ROLES,
    );
  }

  beforeEach(() => {
    mockIsServingMode = true;
    mockMutation.mockImplementation((ref: string) => {
      if (ref === "createTask") return mockCreateTask;
      if (ref === "updateTask") return mockUpdateTask;
      if (ref === "deleteTask") return mockDeleteTask;
      return jest.fn();
    });
  });
  afterEach(() => {
    mockUser = { is_admin: false };
    mockIsNetworkAvailable = true;
    mockIsEffectivelyOffline = false;
    mockMutation.mockImplementation(() => jest.fn());
    jest.clearAllMocks();
  });

  it("hides the Edit pill for a plain member", () => {
    mockUser = { is_admin: false };
    mockQueries(EMPTY_MINE);
    const { queryByText } = render(<ServingTasksScreen />);

    expect(queryByText("Edit")).toBeNull();
  });

  it("shows the Edit pill for a community admin, defaulting to the first role", () => {
    mockUser = { is_admin: true };
    mockAuthorQueries([
      {
        _id: "task-1",
        teamIds: ["team-1"],
        roleIds: ["role-greeter"],
        segment: "before",
        title: "Set up welcome table",
        sortOrder: 0,
      },
    ]);
    const { getByText, getByLabelText } = render(<ServingTasksScreen />);
    fireEvent.press(getByLabelText("Edit"));

    expect(getByText("Hospitality · Greeter")).toBeTruthy();
    expect(getByText("Set up welcome table")).toBeTruthy();
  });

  it("switches to another role's task list without showing the previous role's tasks", () => {
    mockUser = { is_admin: true };
    mockAuthorQueries([
      {
        _id: "task-1",
        teamIds: ["team-1"],
        roleIds: ["role-greeter"],
        segment: "before",
        title: "Set up welcome table",
        sortOrder: 0,
      },
    ]);
    const { getByText, getByLabelText, queryByText, getAllByText } = render(
      <ServingTasksScreen />,
    );
    fireEvent.press(getByLabelText("Edit"));
    expect(getByText("Set up welcome table")).toBeTruthy();

    fireEvent.press(getByLabelText("View and edit Hospitality Usher tasks"));

    expect(queryByText("Set up welcome table")).toBeNull();
    // All three segments (Before/During/After) are empty for the Usher role.
    expect(getAllByText("No tasks yet for this role.")).toHaveLength(3);
  });

  // Team-level tasks used to be hidden here, which left the Edit surface — a
  // leader's only authoring surface inside serving mode — blind to them: they
  // are excluded from "Mine" by design and appear only under the read-only
  // Shared pill. They now show under every role, captioned as whole-team.
  it("shows a team-level (no-role) task under every role, labelled whole-team", () => {
    mockUser = { is_admin: true };
    mockAuthorQueries([
      {
        _id: "task-shared",
        teamIds: ["team-1"],
        roleIds: [],
        segment: "before",
        title: "Unlock the building",
        sortOrder: 0,
      },
    ]);
    const { getByText, getByLabelText, getAllByText } = render(<ServingTasksScreen />);
    fireEvent.press(getByLabelText("Edit"));

    expect(getByText("Unlock the building")).toBeTruthy();
    expect(getByText("Whole team — not just this role")).toBeTruthy();
    // Only Before has the task; During/After stay empty.
    expect(getAllByText("No tasks yet for this role.")).toHaveLength(2);

    // Still visible after switching to a role that owns no tasks of its own.
    fireEvent.press(getByLabelText("View and edit Hospitality Usher tasks"));
    expect(getByText("Unlock the building")).toBeTruthy();
  });

  // REGRESSION: `listPlanTasks` returns EVERY task on the plan (all teams) and
  // the role catalog spans every team in the group, so team-level tasks used to
  // appear under other teams' roles — captioned "Whole team — not just this
  // role" (false) and one tap from an unconfirmed Delete that cascades
  // completions and permanently detaches the row from its template.
  it("never shows another team's team-level task", () => {
    mockUser = { is_admin: true };
    mockMultiTeamAuthorQueries([
      {
        _id: "task-worship",
        teamIds: ["team-worship"],
        roleIds: [],
        segment: "before",
        title: "Sound check",
        sortOrder: 0,
      },
      {
        _id: "task-kids",
        teamIds: ["team-kids"],
        roleIds: [],
        segment: "before",
        title: "Check-in table setup",
        sortOrder: 1,
      },
    ]);
    const { getByText, getByLabelText, queryByText } = render(<ServingTasksScreen />);
    fireEvent.press(getByLabelText("Edit"));

    // Kids sorts before Worship, so Kids · Check-in is selected by default.
    expect(getByText("Kids · Check-in")).toBeTruthy();
    expect(getByText("Check-in table setup")).toBeTruthy();
    expect(queryByText("Sound check")).toBeNull();

    fireEvent.press(getByLabelText("View and edit Worship Sound tasks"));

    expect(getByText("Sound check")).toBeTruthy();
    expect(queryByText("Check-in table setup")).toBeNull();
  });

  it("shows a task spanning both teams under each team's roles", () => {
    mockUser = { is_admin: true };
    mockMultiTeamAuthorQueries([
      {
        _id: "task-both",
        teamIds: ["team-kids", "team-worship"],
        roleIds: [],
        segment: "before",
        title: "Clear the stage",
        sortOrder: 0,
      },
    ]);
    const { getByText, getByLabelText } = render(<ServingTasksScreen />);
    fireEvent.press(getByLabelText("Edit"));

    expect(getByText("Clear the stage")).toBeTruthy();
    fireEvent.press(getByLabelText("View and edit Worship Sound tasks"));
    expect(getByText("Clear the stage")).toBeTruthy();
  });

  it("adds a task for the selected role via createTask", async () => {
    mockUser = { is_admin: true };
    mockAuthorQueries([]);
    const { getByLabelText, getByPlaceholderText, getByText } = render(
      <ServingTasksScreen />,
    );
    fireEvent.press(getByLabelText("Edit"));
    fireEvent.press(getByLabelText("Add a Before task for Greeter"));
    fireEvent.changeText(getByPlaceholderText("Task title"), "Count the offering");
    await fireEvent.press(getByText("Add"));

    expect(mockCreateTask).toHaveBeenCalledWith({
      planId: "plan-1",
      teamIds: ["team-1"],
      roleIds: ["role-greeter"],
      segment: "before",
      title: "Count the offering",
      howToType: "none",
    });
  });

  it("edits an existing task's title via updateTask", async () => {
    mockUser = { is_admin: true };
    mockAuthorQueries([
      {
        _id: "task-1",
        teamIds: ["team-1"],
        roleIds: ["role-greeter"],
        segment: "before",
        title: "Set up welcome table",
        sortOrder: 0,
      },
    ]);
    const { getByText, getByLabelText, getByPlaceholderText } = render(
      <ServingTasksScreen />,
    );
    fireEvent.press(getByLabelText("Edit"));
    fireEvent.press(getByLabelText("Edit Set up welcome table"));
    fireEvent.changeText(getByPlaceholderText("Task title"), "Set up welcome tables x2");
    await fireEvent.press(getByText("Save"));

    expect(mockUpdateTask).toHaveBeenCalledWith({
      taskId: "task-1",
      title: "Set up welcome tables x2",
    });
  });

  it("deletes a task via deleteTask", async () => {
    mockUser = { is_admin: true };
    mockAuthorQueries([
      {
        _id: "task-1",
        teamIds: ["team-1"],
        roleIds: ["role-greeter"],
        segment: "before",
        title: "Set up welcome table",
        sortOrder: 0,
      },
    ]);
    const { getByLabelText, getByText } = render(<ServingTasksScreen />);
    fireEvent.press(getByLabelText("Edit"));
    fireEvent.press(getByLabelText("Edit Set up welcome table"));
    await fireEvent.press(getByText("Delete"));

    expect(mockDeleteTask).toHaveBeenCalledWith({ taskId: "task-1" });
  });

  it("hides add/edit controls and explains why when offline", () => {
    mockUser = { is_admin: true };
    mockIsNetworkAvailable = false;
    mockIsEffectivelyOffline = true;
    mockAuthorQueries([
      {
        _id: "task-1",
        teamIds: ["team-1"],
        roleIds: ["role-greeter"],
        segment: "before",
        title: "Set up welcome table",
        sortOrder: 0,
      },
    ]);
    const { getByLabelText, getByText, queryByText, queryByLabelText } = render(
      <ServingTasksScreen />,
    );
    fireEvent.press(getByLabelText("Edit"));

    // The existing task is still visible (read-only) …
    expect(getByText("Set up welcome table")).toBeTruthy();
    // … but every write affordance is gone, replaced by an explanation.
    expect(queryByText("Add task")).toBeNull();
    expect(queryByLabelText("Edit Set up welcome table")).toBeNull();
    expect(getByText("You're offline")).toBeTruthy();
    expect(
      getByText("Adding or changing shared tasks needs a connection. Reconnect to make changes."),
    ).toBeTruthy();
  });
});

/**
 * Flag-on restyle (WHATSAPP-DESIGN-SYSTEM.md §3.2/§7). These pin the SKIN,
 * not the structure: the last test re-asserts every flag-off affordance and
 * string with the flag ON, so a restyle can never quietly drop one.
 */
describe("ServingTasksScreen — whatsapp-shell skin", () => {
  beforeEach(() => {
    mockIsServingMode = true;
    mockWhatsappShell = true;
  });
  afterEach(() => {
    mockWhatsappShell = false;
    jest.clearAllMocks();
  });

  /** Flattens a possibly-nested RN style prop into one object. */
  const flatten = (style: unknown): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    const walk = (node: unknown) => {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node === "object") Object.assign(out, node);
    };
    walk(style);
    return out;
  };

  const mockCrew = () => {
    mockQuery.mockImplementation((ref: string) => {
      if (ref === REF.eligibility) return { plans: DEFAULT_PLANS };
      if (ref === REF.mine) return EMPTY_MINE;
      if (ref === REF.crew)
        return [
          {
            userId: "u1",
            name: "Amy Chen",
            roleId: "r1",
            roleName: "Greeter",
            teamId: "team-1",
            teamName: "Hospitality",
            isCurrentUser: true,
            status: "unconfirmed",
            done: 0,
            total: 2,
            tasks: [],
          },
        ];
      return [];
    });
  };

  it("uses sentence-case segment labels, not ALL-CAPS (S3.5)", () => {
    mockQueries({ before: [templateTask()], during: [], after: [] });
    const { getByText, queryByText } = render(<ServingTasksScreen />);

    expect(getByText("Before")).toBeTruthy();
    expect(queryByText("BEFORE")).toBeNull();
    expect(queryByText("DURING")).toBeNull();
    expect(queryByText("AFTER")).toBeNull();
  });

  it("keeps ALL-CAPS segment labels when the flag is off", () => {
    mockWhatsappShell = false;
    mockQueries({ before: [templateTask()], during: [], after: [] });
    const { getByText, queryByText } = render(<ServingTasksScreen />);

    expect(getByText("BEFORE")).toBeTruthy();
    expect(queryByText("Before")).toBeNull();
  });

  it("drops the letter-spaced 12pt section-label treatment", () => {
    mockQueries({ before: [templateTask()], during: [], after: [] });
    const { getByText } = render(<ServingTasksScreen />);

    const label = flatten(getByText("Before").props.style);
    expect(label.fontSize).toBe(15);
    expect(label.letterSpacing).toBe(0);
    expect(label.fontWeight).toBe("400");
  });

  it("puts task titles on the 17pt row-title scale", () => {
    mockQueries({ before: [templateTask()], during: [], after: [] });
    const { getByText } = render(<ServingTasksScreen />);

    expect(flatten(getByText("Set up chairs").props.style).fontSize).toBe(17);
  });

  it("keeps the pre-redesign 15pt task title when the flag is off", () => {
    mockWhatsappShell = false;
    mockQueries({ before: [templateTask()], during: [], after: [] });
    const { getByText } = render(<ServingTasksScreen />);

    expect(flatten(getByText("Set up chairs").props.style).fontSize).toBe(15);
  });

  it("renders the plan header on the 22pt header-block scale", () => {
    mockQueries({ before: [templateTask()], during: [], after: [] });
    const { getByText } = render(<ServingTasksScreen />);

    const title = flatten(getByText("Sunday Gathering").props.style);
    expect(title.fontSize).toBe(22);
    expect(title.fontWeight).toBe("700");
  });

  it("replaces the Crew 'You' / 'Unconfirmed' colored chips with subtitle text (§7)", () => {
    mockCrew();
    const { getByText, queryByText, getByLabelText } = render(
      <ServingTasksScreen />,
    );
    fireEvent.press(getByLabelText("Crew"));

    // The signals survive — as plain text on the row's subtitle line, which
    // is what §7 prescribes instead of a colored pill.
    expect(getByText("Greeter · You · Unconfirmed")).toBeTruthy();
    // …and not as their own standalone chips.
    expect(queryByText("You")).toBeNull();
    expect(queryByText("Unconfirmed")).toBeNull();
  });

  it("keeps the colored chips when the flag is off", () => {
    mockWhatsappShell = false;
    mockCrew();
    const { getByText, getByLabelText } = render(<ServingTasksScreen />);
    fireEvent.press(getByLabelText("Crew"));

    expect(getByText("You")).toBeTruthy();
    expect(getByText("Unconfirmed")).toBeTruthy();
    expect(getByText("Greeter")).toBeTruthy();
  });

  it("keeps every affordance and string from the flag-off render", () => {
    mockQueries({ before: [personalTask()], during: [], after: [] });
    const { getByText, getAllByText } = render(<ServingTasksScreen />);

    expect(getByText(NO_PLAN_TASKS_MESSAGE)).toBeTruthy();
    expect(getByText("Bring water bottle")).toBeTruthy();
    expect(getAllByText("Add my own task")).toHaveLength(3);
    expect(getByText("Mine")).toBeTruthy();
    expect(getByText("Shared")).toBeTruthy();
    expect(getByText("Crew")).toBeTruthy();
    expect(getByText("All teams")).toBeTruthy();
  });
});
