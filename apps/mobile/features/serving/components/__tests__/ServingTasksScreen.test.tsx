import React from "react";
import { render, fireEvent, within } from "@testing-library/react-native";
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
      textInverse: "#1a1a1a",
      textSecondary: "#666",
      textTertiary: "#999",
      error: "#c00",
      warning: "#FF9500",
      onAccent: "#ffffff",
    },
    isDark: false,
  }),
}));

// A community's brand color is arbitrary — the Edit surface's role pills use it
// as the SELECTED pill's background, so tests flip it to pin what happens when
// it collides with `colors.warning` (Knicks mode makes both `#F58426`).
let mockPrimaryColor = "#D9A441";
jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({ primaryColor: mockPrimaryColor }),
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

type EligiblePlan = {
  planId: string;
  title: string;
  startsAt: number;
  groupName?: string;
  teamNames?: string[];
};

const DEFAULT_PLANS: EligiblePlan[] = [
  { planId: "plan-1", title: "Sunday Gathering", startsAt: 0 },
];

/**
 * An `getAllTeamsTasks` row. `tasks[].taskId` feeds the plan-wide count and
 * `roleNames` decides the task's scope — EMPTY means team-level, exactly as the
 * backend returns it — which the empty-state copy splits on. Defaults to
 * role-scoped; pass `[]` for the all-team-level plan.
 */
function allTeamsRow(taskIds: string[], teamId = "team-1", roleNames = ["Camera"]) {
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
      roleNames,
      completed: false,
      howToType: "none",
    })),
  };
}

/** A `getCrewTasks` row for the viewer themself (they hold `roleName`). */
function myCrewRow(
  roleName: string,
  team: { teamId: string; teamName: string } = {
    teamId: "team-1",
    teamName: "Hospitality",
  },
) {
  return {
    userId: "user-1",
    name: "Alex",
    // Role ids are team-scoped, so two teams' same-named roles differ.
    roleId: `${team.teamId}:${roleName}`,
    roleName,
    teamId: team.teamId,
    teamName: team.teamName,
    isCurrentUser: true,
    status: "confirmed",
    done: 0,
    total: 0,
    tasks: [],
  };
}

/** The `roles` provenance `getMyServingTasks` now attaches to a role task. */
function rolePair(
  roleName: string,
  team: { teamId: string; teamName: string } = {
    teamId: "team-1",
    teamName: "Hospitality",
  },
) {
  return {
    roleId: `${team.teamId}:${roleName}`,
    roleName,
    teamId: team.teamId,
    teamName: team.teamName,
  };
}

const PRODUCTION = { teamId: "team-prod", teamName: "Production" };

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
    // The premise of this whole describe: every task on the plan is TEAM-level,
    // which is why Shared holds them all.
    mockQueries(EMPTY_MINE, DEFAULT_PLANS, {
      allTeams: [allTeamsRow(["task-1", "task-2"], "team-1", [])],
      crew: [myCrewRow("Greeter")],
      shared: [
        sharedRow("task-1", "Unlock the building"),
        sharedRow("task-2", "Set the thermostat"),
      ],
    });
    const { getByText, getByLabelText, queryByText } = render(<ServingTasksScreen />);

    expect(getByText(/Shared has 2 tasks for your whole team\./)).toBeTruthy();
    // …and the same notice must not call those very tasks somebody else's.
    expect(queryByText(/are for other roles/)).toBeNull();
    expect(
      getByText("This event's tasks are for whole teams, not roles."),
    ).toBeTruthy();

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

    fireEvent.press(
      getByLabelText("View and edit Hospitality Usher tasks, 0 tasks of its own"),
    );

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

    // Still visible after switching to a role that owns no tasks of its own —
    // and the pill says exactly that, rather than "no tasks yet", which the
    // list below would immediately contradict.
    fireEvent.press(
      getByLabelText(
        "View and edit Hospitality Usher tasks, 0 tasks of its own, 1 for the whole team",
      ),
    );
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

    fireEvent.press(
      getByLabelText(
        "View and edit Worship Sound tasks, 0 tasks of its own, 1 for the whole team",
      ),
    );

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
    fireEvent.press(
      getByLabelText(
        "View and edit Worship Sound tasks, 0 tasks of its own, 1 for the whole team",
      ),
    );
    expect(getByText("Clear the stage")).toBeTruthy();
  });

  // A leader had to tap every pill to find the role nobody had authored for.
  // The badge counts each role's OWN tasks, so a gap is visible without tapping.
  it("badges each role pill with its own task count", () => {
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
      {
        _id: "task-2",
        teamIds: ["team-1"],
        roleIds: ["role-greeter"],
        segment: "after",
        title: "Pack down",
        sortOrder: 1,
      },
    ]);
    const { getByLabelText } = render(<ServingTasksScreen />);
    fireEvent.press(getByLabelText("Edit"));

    expect(
      getByLabelText("View and edit Hospitality Greeter tasks, 2 tasks of its own"),
    ).toBeTruthy();
    expect(
      getByLabelText("View and edit Hospitality Usher tasks, 0 tasks of its own"),
    ).toBeTruthy();
  });

  // The badge must NOT reuse the body list's length. `tasksForRole` folds a
  // team's team-level tasks into every role on that team, so a count derived
  // from it would read "1" for Greeter AND Usher here — hiding the fact that
  // neither role has a single task of its own, which is the one thing the
  // badge exists to surface.
  it("does not count a team-level task towards any role's badge", () => {
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
    const { getByLabelText, getByText } = render(<ServingTasksScreen />);
    fireEvent.press(getByLabelText("Edit"));

    expect(
      getByLabelText(
        "View and edit Hospitality Greeter tasks, 0 tasks of its own, 1 for the whole team",
      ),
    ).toBeTruthy();
    expect(
      getByLabelText(
        "View and edit Hospitality Usher tasks, 0 tasks of its own, 1 for the whole team",
      ),
    ).toBeTruthy();
    // …while the body still shows it, captioned as whole-team.
    expect(getByText("Unlock the building")).toBeTruthy();
    expect(getByText("Whole team — not just this role")).toBeTruthy();
  });

  it("uses the singular in the badge label for exactly one task", () => {
    mockUser = { is_admin: true };
    mockAuthorQueries([
      {
        _id: "task-1",
        teamIds: ["team-1"],
        roleIds: ["role-usher"],
        segment: "during",
        title: "Count attendance",
        sortOrder: 0,
      },
    ]);
    const { getByLabelText } = render(<ServingTasksScreen />);
    fireEvent.press(getByLabelText("Edit"));

    expect(
      getByLabelText("View and edit Hospitality Usher tasks, 1 task of its own"),
    ).toBeTruthy();
  });

  /**
   * The pill badge's WARNING tint. It is an alarm, so it may only mean "nothing
   * reaches a volunteer in this role" — never merely "this role has no tasks of
   * its own", which is the normal shape of a plan authored at team level.
   */
  describe("role pill badge tint", () => {
    /** The badge `<View>` wrapping a pill's count, plus its `<Text>`. */
    const badgeOf = (pill: ReturnType<typeof within>, count: string) => {
      const text = within(pill as never).getByText(count);
      // `.parent` walks composite wrappers too (RN's `Text`), so climb to the
      // nearest host View — the badge itself.
      let view = text.parent;
      while (view && view.type !== "View") view = view.parent;
      return {
        text: flatten(text.props.style),
        view: flatten(view!.props.style),
      };
    };

    it("does NOT alarm for a role whose team authored everything at team level", () => {
      // The "Whole team" pattern: a Worship lead writes the entire plan as
      // team-level tasks. Every role's own count is 0, but the event is fully
      // authored — tinting the whole row told the leader the opposite.
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
      const { getByLabelText } = render(<ServingTasksScreen />);
      fireEvent.press(getByLabelText("Edit"));

      const usher = getByLabelText(
        "View and edit Hospitality Usher tasks, 0 tasks of its own, 1 for the whole team",
      );
      const badge = badgeOf(usher as never, "0");
      expect(badge.view.backgroundColor).not.toBe("#FF9500");
      expect(badge.view.borderWidth).toBeUndefined();
    });

    it("alarms for a role that nothing on the plan covers", () => {
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
      const { getByLabelText } = render(<ServingTasksScreen />);
      fireEvent.press(getByLabelText("Edit"));

      const usher = getByLabelText(
        "View and edit Hospitality Usher tasks, 0 tasks of its own",
      );
      const badge = badgeOf(usher as never, "0");
      expect(badge.view.backgroundColor).toBe("#FF9500");
      // White on mid-orange measures ~2.2:1 — under AA for this 11pt/700 text.
      expect(badge.text.color).not.toBe("#ffffff");
      expect(badge.text.color).toBe("#000");
    });

    // Knicks mode sets `primaryColor` to the SAME `#F58426` as `colors.warning`,
    // and any community may pick an orange brand color. The selected pill is
    // filled with `primaryColor`, so a solid warning badge dissolved into it and
    // left a bare floating number.
    it("keeps the badge visible when the brand color IS the warning color", () => {
      mockPrimaryColor = "#FF9500";
      mockUser = { is_admin: true };
      // Only Usher is authored, so the DEFAULT-selected first pill (Greeter) is
      // both active and uncovered — the exact collision.
      mockAuthorQueries([
        {
          _id: "task-1",
          teamIds: ["team-1"],
          roleIds: ["role-usher"],
          segment: "before",
          title: "Count attendance",
          sortOrder: 0,
        },
      ]);
      const { getByLabelText } = render(<ServingTasksScreen />);
      fireEvent.press(getByLabelText("Edit"));

      const greeter = getByLabelText(
        "View and edit Hospitality Greeter tasks, 0 tasks of its own",
      );
      const pill = flatten(greeter.props.style);
      const badge = badgeOf(greeter as never, "0");

      // The premise: fill and pill background have collapsed to one color.
      expect(pill.backgroundColor).toBe(badge.view.backgroundColor);
      // …so the chip's edge is what keeps it a chip.
      expect(badge.view.borderWidth).toBeGreaterThan(0);
      expect(badge.view.borderColor).not.toBe(badge.view.backgroundColor);
      expect(badge.view.borderColor).not.toBe(pill.backgroundColor);
      mockPrimaryColor = "#D9A441";
    });

    // `createEventDraftImpl` makes task-less plans and Edit is where a leader
    // lands to fix that — the empty-state notice and "Populate from template"
    // already say so, so a whole row of orange is noise, not information.
    it("leaves every pill quiet on a brand-new plan with no tasks at all", () => {
      mockUser = { is_admin: true };
      mockAuthorQueries([]);
      const { getByLabelText } = render(<ServingTasksScreen />);
      fireEvent.press(getByLabelText("Edit"));

      for (const role of ["Greeter", "Usher"]) {
        const pill = getByLabelText(
          `View and edit Hospitality ${role} tasks, 0 tasks of its own`,
        );
        expect(badgeOf(pill as never, "0").view.backgroundColor).not.toBe("#FF9500");
      }
    });
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

/**
 * Provenance: what rostered me, and which of my roles each task belongs to.
 *
 * Multi-plan / multi-role rendering already worked — the queries just threw
 * away WHICH role matched, so a volunteer holding two roles (or serving two
 * campuses on one morning) got a flat, unattributed list under headers that
 * read identically. These pin the labels AND — just as importantly — that the
 * single-role volunteer's list is untouched.
 */
describe("ServingTasksScreen — task provenance (Mine)", () => {
  beforeEach(() => {
    mockIsServingMode = true;
    mockWhatsappShell = false;
  });
  afterEach(() => jest.clearAllMocks());

  it("adds NO role chrome for a volunteer holding a single role", () => {
    mockQueries(
      {
        before: [templateTask({ roles: [rolePair("Greeter")] })],
        during: [],
        after: [],
      },
      DEFAULT_PLANS,
      { crew: [myCrewRow("Greeter")] },
    );
    const { getByText, queryByText } = render(<ServingTasksScreen />);

    expect(getByText("Set up chairs")).toBeTruthy();
    // The row's only meta line stays absent — nothing to disambiguate.
    expect(queryByText("Greeter")).toBeNull();
    expect(queryByText("Hospitality · Greeter")).toBeNull();
  });

  it("names the role once the viewer holds two on the SAME team", () => {
    mockQueries(
      {
        before: [
          templateTask({ roles: [rolePair("Greeter")] }),
          templateTask({
            key: "t2",
            taskId: "task-2",
            title: "Count the offering",
            roles: [rolePair("Usher")],
          }),
        ],
        during: [],
        after: [],
      },
      DEFAULT_PLANS,
      { crew: [myCrewRow("Greeter"), myCrewRow("Usher")] },
    );
    const { getByText, queryByText } = render(<ServingTasksScreen />);

    expect(getByText("Greeter")).toBeTruthy();
    expect(getByText("Usher")).toBeTruthy();
    // One team => naming it would be pure noise.
    expect(queryByText("Hospitality · Greeter")).toBeNull();
  });

  it("leads with the team once the viewer is on two teams", () => {
    mockQueries(
      {
        before: [
          templateTask({ roles: [rolePair("Camera", PRODUCTION)] }),
          templateTask({
            key: "t2",
            taskId: "task-2",
            title: "Greet at the door",
            roles: [rolePair("Greeter")],
          }),
        ],
        during: [],
        after: [],
      },
      DEFAULT_PLANS,
      {
        crew: [myCrewRow("Camera", PRODUCTION), myCrewRow("Greeter")],
      },
    );
    const { getByText } = render(<ServingTasksScreen />);

    expect(getByText("Production · Camera")).toBeTruthy();
    expect(getByText("Hospitality · Greeter")).toBeTruthy();
  });

  it("shows EVERY role a task matched, not just the first", () => {
    // A task carries several roleIds; a viewer can hold more than one of them.
    mockQueries(
      {
        before: [
          templateTask({
            roles: [rolePair("Camera", PRODUCTION), rolePair("Sound", PRODUCTION)],
          }),
          templateTask({
            key: "t2",
            taskId: "task-2",
            title: "Greet at the door",
            roles: [rolePair("Greeter")],
          }),
        ],
        during: [],
        after: [],
      },
      DEFAULT_PLANS,
      {
        crew: [
          myCrewRow("Camera", PRODUCTION),
          myCrewRow("Sound", PRODUCTION),
          myCrewRow("Greeter"),
        ],
      },
    );
    const { getByText } = render(<ServingTasksScreen />);

    expect(getByText("Production · Camera & Sound")).toBeTruthy();
  });

  it("leaves a personal task's 'Added by you' marker alone", () => {
    mockQueries(
      {
        before: [
          personalTask(),
          templateTask({ roles: [rolePair("Camera", PRODUCTION)] }),
        ],
        during: [],
        after: [],
      },
      DEFAULT_PLANS,
      { crew: [myCrewRow("Camera", PRODUCTION), myCrewRow("Greeter")] },
    );
    const { getByText } = render(<ServingTasksScreen />);

    // Nobody rostered a personal task, so it keeps its own marker only.
    expect(getByText("Added by you")).toBeTruthy();
    expect(getByText("Production · Camera")).toBeTruthy();
  });

  it("labels NOTHING until the crew section resolves", () => {
    // The two sections are independent subscriptions and the tasks usually win
    // the race. Deciding from them would render an unlabelled list and then
    // grow a meta line on EVERY row a beat later — a full-list reflow on a
    // checklist of toggle Pressables, where a tap already in flight lands on
    // the neighbouring task's checkbox.
    mockQueries(
      {
        before: [
          templateTask({ roles: [rolePair("Camera", PRODUCTION)] }),
          templateTask({
            key: "t2",
            taskId: "task-2",
            title: "Greet at the door",
            roles: [rolePair("Greeter")],
          }),
        ],
        during: [],
        after: [],
      },
      DEFAULT_PLANS,
      { crew: undefined },
    );
    const { getByText, queryByText } = render(<ServingTasksScreen />);

    expect(getByText("Set up chairs")).toBeTruthy();
    expect(queryByText("Production · Camera")).toBeNull();
    expect(queryByText("Hospitality · Greeter")).toBeNull();
  });

  it("labels rows for a role the plan has no tasks for", () => {
    // The viewer holds Camera AND Usher; the plan only has Camera tasks. Only
    // the crew rows know about Usher — the task roles are a strict subset — so
    // reading them would call this a single-role volunteer and drop the labels.
    // That degradation would bite hardest offline, at the venue, which is
    // exactly where "which roster is this from?" gets asked.
    mockQueries(
      {
        before: [templateTask({ roles: [rolePair("Camera", PRODUCTION)] })],
        during: [],
        after: [],
      },
      DEFAULT_PLANS,
      { crew: [myCrewRow("Camera", PRODUCTION), myCrewRow("Usher")] },
    );
    const { getByText } = render(<ServingTasksScreen />);

    expect(getByText("Production · Camera")).toBeTruthy();
  });

  it("adds no chrome for two DISTINCT roles that share a name on one team", () => {
    // Nothing stops a team defining "Camera" twice (`createRole` only rejects
    // an empty name). Both rows would be stamped with an identical bare
    // "Camera" — noise that resolves nothing — so the gate has to count role
    // NAMES per team, not raw pairs.
    mockQueries(
      {
        before: [templateTask({ roles: [rolePair("Camera", PRODUCTION)] })],
        during: [],
        after: [],
      },
      DEFAULT_PLANS,
      {
        crew: [
          { ...myCrewRow("Camera", PRODUCTION), roleId: "team-prod:camera-a" },
          { ...myCrewRow("Camera", PRODUCTION), roleId: "team-prod:camera-b" },
        ],
      },
    );
    const { getByText, queryByText } = render(<ServingTasksScreen />);

    expect(getByText("Set up chairs")).toBeTruthy();
    expect(queryByText("Camera")).toBeNull();
    expect(queryByText("Production · Camera")).toBeNull();
  });

  it("keeps the labels under the whatsapp-shell flag", () => {
    mockWhatsappShell = true;
    mockQueries(
      {
        before: [
          templateTask({ roles: [rolePair("Camera", PRODUCTION)] }),
          templateTask({
            key: "t2",
            taskId: "task-2",
            title: "Greet at the door",
            roles: [rolePair("Greeter")],
          }),
        ],
        during: [],
        after: [],
      },
      DEFAULT_PLANS,
      { crew: [myCrewRow("Camera", PRODUCTION), myCrewRow("Greeter")] },
    );
    const { getByText } = render(<ServingTasksScreen />);

    expect(getByText("Production · Camera")).toBeTruthy();
    expect(getByText("Hospitality · Greeter")).toBeTruthy();
  });
});

/**
 * The Shared tab already received `teamNames` from the backend and rendered the
 * literal string "Team task" instead. Same conditional rule as above: name the
 * team only when the viewer is on more than one.
 */
describe("ServingTasksScreen — shared task team names", () => {
  beforeEach(() => {
    mockIsServingMode = true;
    mockWhatsappShell = false;
  });
  afterEach(() => jest.clearAllMocks());

  it("keeps the plain 'Team task' cue for a viewer on one team", () => {
    mockQueries(EMPTY_MINE, DEFAULT_PLANS, {
      shared: [sharedRow("shared-1", "Stack the chairs")],
      crew: [myCrewRow("Greeter")],
    });
    const { getByText, getByLabelText, queryByText } = render(
      <ServingTasksScreen />,
    );
    fireEvent.press(getByLabelText("Shared"));

    expect(getByText("Team task")).toBeTruthy();
    expect(queryByText("Hospitality team task")).toBeNull();
  });

  it("names the task's team once the viewer is on more than one", () => {
    mockQueries(EMPTY_MINE, DEFAULT_PLANS, {
      shared: [sharedRow("shared-1", "Stack the chairs")],
      crew: [myCrewRow("Greeter"), myCrewRow("Camera", PRODUCTION)],
    });
    const { getByText, getByLabelText, queryByText } = render(
      <ServingTasksScreen />,
    );
    fireEvent.press(getByLabelText("Shared"));

    expect(getByText("Hospitality team task")).toBeTruthy();
    expect(queryByText("Team task")).toBeNull();
  });

  it("names every team a multi-team shared task spans", () => {
    mockQueries(EMPTY_MINE, DEFAULT_PLANS, {
      shared: [
        {
          ...sharedRow("shared-1", "Stack the chairs"),
          teamIds: ["team-1", "team-prod"],
          teamNames: ["Hospitality", "Production"],
        },
      ],
      crew: [myCrewRow("Greeter"), myCrewRow("Camera", PRODUCTION)],
    });
    const { getByText, getByLabelText } = render(<ServingTasksScreen />);
    fireEvent.press(getByLabelText("Shared"));

    expect(getByText("Hospitality, Production team task")).toBeTruthy();
  });
});

/**
 * Plan headers. Three same-day plans used to stack as three sections headed by
 * byte-identical strings, which is how a leader concluded their own authored
 * tasks had vanished: they authored on one plan and were rostered on another.
 */
describe("ServingTasksScreen — plan header provenance", () => {
  beforeEach(() => {
    mockIsServingMode = true;
    mockWhatsappShell = false;
  });
  afterEach(() => jest.clearAllMocks());

  it("names the group that rostered the viewer under the plan title", () => {
    mockQueries(EMPTY_MINE, [
      {
        planId: "plan-1",
        title: "Sunday Gathering",
        startsAt: 0,
        groupName: "FOUNT Brooklyn",
        teamNames: ["Production"],
      },
    ]);
    const { getByText } = render(<ServingTasksScreen />);

    expect(getByText("FOUNT Brooklyn · Production")).toBeTruthy();
  });

  it("tells two identically-titled same-day plans apart", () => {
    mockQueries(EMPTY_MINE, [
      {
        planId: "plan-1",
        title: "Sunday Gathering",
        startsAt: 0,
        groupName: "FOUNT Brooklyn",
      },
      {
        planId: "plan-2",
        title: "Sunday Gathering",
        startsAt: 0,
        groupName: "FOUNT Manhattan",
      },
    ]);
    const { getByText, getAllByText } = render(<ServingTasksScreen />);

    expect(getAllByText("Sunday Gathering")).toHaveLength(2);
    expect(getByText("FOUNT Brooklyn")).toBeTruthy();
    expect(getByText("FOUNT Manhattan")).toBeTruthy();
  });

  it("renders no subtitle when an older offline cache has no group name", () => {
    mockQueries(EMPTY_MINE, DEFAULT_PLANS);
    const { getByText, queryByText } = render(<ServingTasksScreen />);

    expect(getByText("Sunday Gathering")).toBeTruthy();
    expect(queryByText("undefined")).toBeNull();
    expect(queryByText("")).toBeNull();
  });
});
