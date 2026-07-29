import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
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

type EligiblePlan = { planId: string; title: string; startsAt: number };

const DEFAULT_PLANS: EligiblePlan[] = [
  { planId: "plan-1", title: "Sunday Gathering", startsAt: 0 },
];

function mockQueries(mine: unknown, plans: EligiblePlan[] = DEFAULT_PLANS) {
  mockQuery.mockImplementation((ref: string) => {
    switch (ref) {
      case REF.mine:
        return mine;
      case REF.eligibility:
        return { plans };
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
  beforeEach(() => {
    mockIsServingMode = true;
  });
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

    expect(getByText(NO_PRELOAD_MESSAGE)).toBeTruthy();
    expect(getByText("Bring water bottle")).toBeTruthy();
    expect(getAllByText("Add my own task")).toHaveLength(3);
    expect(getByText("Mine")).toBeTruthy();
    expect(getByText("Shared")).toBeTruthy();
    expect(getByText("Crew")).toBeTruthy();
    expect(getByText("All teams")).toBeTruthy();
  });
});
