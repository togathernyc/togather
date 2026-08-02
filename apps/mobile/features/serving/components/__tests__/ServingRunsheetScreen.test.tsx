/**
 * ServingRunsheetScreen — the serving-mode wrapper around `PlanRunSheet`.
 *
 * The run sheet's own suite never renders this wrapper, which is how a
 * duplicated plan title survived flag-on (both the wrapper's header and the
 * embedded sheet's own title mapped to 20pt/600, stacked directly on top of
 * each other, with the same string). Everything here renders the REAL
 * `PlanRunSheet` inside the real wrapper, so the two are checked together.
 */
import React from "react";
import { render } from "@testing-library/react-native";
import { ServingRunsheetScreen } from "../ServingRunsheetScreen";
import { useAuthenticatedQuery } from "@services/api/convex";

const REF = {
  eligibility: "api.functions.scheduling.serving.getServingEligibility",
  getEvent: "api.functions.scheduling.events.getEvent",
  listItems: "api.functions.scheduling.eventItems.listItems",
};

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      scheduling: {
        serving: {
          getServingEligibility:
            "api.functions.scheduling.serving.getServingEligibility",
        },
        events: { getEvent: "api.functions.scheduling.events.getEvent" },
        eventItems: { listItems: "api.functions.scheduling.eventItems.listItems" },
      },
    },
  },
  useAuthenticatedQuery: jest.fn(),
}));

const THEME = {
  background: "#ffffff",
  backgroundGrouped: "#F2F2F2",
  surface: "#ffffff",
  surfaceGrouped: "#FFFFFF",
  surfaceSecondary: "#f5f5f5",
  separator: "#E5E5E5",
  text: "#1a1a1a",
  textInverse: "#ffffff",
  textSecondary: "#666666",
  textTertiary: "#999999",
  link: "#007AFF",
  onAccent: "#ffffff",
  runSheetCurrentItem: "#FFF9E6",
  runSheetCurrentItemAccent: "#D4A017",
};

jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({ colors: THEME, isDark: false }),
}));
jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({ primaryColor: "#1E8449" }),
}));

let mockWhatsappShell = false;
jest.mock("@hooks/useWhatsappShell", () => ({
  useWhatsappShell: () => mockWhatsappShell,
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), canDismiss: () => false, dismissAll: jest.fn() }),
}));

jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "user-me" } }),
}));
jest.mock("@providers/ConnectionProvider", () => ({
  useConnectionStatus: () => ({ isNetworkAvailable: true }),
}));

const mockCacheStore = {
  getPlansStale: () => null,
  getEventStale: () => null,
  getItemsStale: () => null,
  setPlans: jest.fn(),
  setEvent: jest.fn(),
  setItems: jest.fn(),
};
jest.mock("@/stores/servingRunSheetCache", () => {
  const useServingRunSheetCache = () => mockCacheStore;
  useServingRunSheetCache.getState = () => mockCacheStore;
  return { useServingRunSheetCache };
});

jest.mock("@/stores/eventModeStore", () => ({
  useEventModeStore: (selector: (s: object) => unknown) =>
    selector({ isServingMode: true, previewPlanId: null }),
}));

// The hook layers caching/preview logic over the query result; this suite is
// about what the SCREEN renders, so hand it the plans directly.
jest.mock("../../hooks/useServingPlans", () => ({
  useServingPlans: (eligibility: { plans?: unknown[] } | null | undefined) =>
    eligibility?.plans ?? [],
}));

jest.mock("@features/scheduling/components/ServiceTimeSelector", () => ({
  ServiceTimeSelector: () => null,
}));

jest.mock("@features/leader-tools/utils/runSheetLinks", () => {
  const { Text } = require("react-native");
  return {
    renderTextWithLinks: (text: string, style: object) => (
      <Text style={style}>{text}</Text>
    ),
  };
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

const styleOfAncestorWith = (
  node: { props?: { style?: unknown }; parent?: unknown } | null | undefined,
  key: string,
): Record<string, unknown> => {
  let cur = node as { props?: { style?: unknown }; parent?: unknown } | null;
  while (cur) {
    const style = flatten(cur.props?.style);
    if (key in style) return style;
    cur = cur.parent as typeof cur;
  }
  return {};
};

const NOW = Date.UTC(2026, 4, 17, 14, 0, 0);

const PLAN = {
  planId: "plan-1",
  groupId: "group-1",
  groupName: "Brooklyn",
  title: "Sunday Gathering",
  startsAt: NOW,
  endsAt: NOW + 3_600_000,
  teamNames: ["Band"],
};

const EVENT = {
  title: "Sunday Gathering",
  eventDate: NOW,
  times: [{ label: "9am", startsAt: NOW }],
  roles: [],
};

const ITEMS = [
  {
    _id: "item-1",
    segment: "during",
    type: "song",
    title: "Opening Song",
    description: null,
    durationSec: 600,
    notes: [],
    songDetails: null,
    assignments: [],
  },
];

const mockQuery = useAuthenticatedQuery as jest.Mock;

function mockServing() {
  mockQuery.mockImplementation((ref: string) => {
    if (ref === REF.eligibility) return { plans: [PLAN], upcomingPlans: [] };
    if (ref === REF.getEvent) return EVENT;
    if (ref === REF.listItems) return ITEMS;
    return undefined;
  });
}

afterEach(() => {
  mockWhatsappShell = false;
  jest.clearAllMocks();
});

describe("ServingRunsheetScreen — flag-on", () => {
  beforeEach(() => {
    mockWhatsappShell = true;
  });

  it("shows the plan title exactly once, not twice at the same size", () => {
    mockServing();
    const { getAllByText } = render(<ServingRunsheetScreen />);

    // Flag-off the two titles differed (16/700 wrapper vs 20/700 sheet), so
    // the stack read as a header + a subheader. Flag-on both map to
    // WA_TYPE_SECTION_HEADER + WA_WEIGHT_SEMIBOLD — identical 20pt/600, the
    // same string, one directly above the other.
    expect(getAllByText("Sunday Gathering")).toHaveLength(1);
  });

  it("keeps the surviving title as the wrapper's section header", () => {
    mockServing();
    const { getByText } = render(<ServingRunsheetScreen />);

    // It's the WRAPPER's header that survives (it carries the date and the
    // campus/teams subtitle); the embedded sheet's own title is the one
    // suppressed.
    const title = flatten(getByText("Sunday Gathering").props.style);
    expect(title.fontSize).toBe(20);
    expect(title.fontWeight).toBe("600");
    expect(getByText("Brooklyn · Band")).toBeTruthy();
  });

  it("paints a bg.grouped canvas so the embedded bg.card rows are visible", () => {
    mockServing();
    const { getByText } = render(<ServingRunsheetScreen />);

    const scroll = styleOfAncestorWith(getByText("Sunday Gathering"), "flex");
    expect(scroll.backgroundColor).toBe(THEME.backgroundGrouped);

    const row = styleOfAncestorWith(getByText("Opening Song"), "borderRadius");
    expect(row.backgroundColor).toBe(THEME.surfaceGrouped);
  });
});

describe("ServingRunsheetScreen — flag-off is untouched", () => {
  it("keeps both titles, at their two distinct sizes", () => {
    mockServing();
    const { getAllByText } = render(<ServingRunsheetScreen />);

    const titles = getAllByText("Sunday Gathering");
    expect(titles).toHaveLength(2);
    expect(titles.map((t) => flatten(t.props.style).fontSize).sort()).toEqual([
      16, 20,
    ]);
  });

  it("keeps the flag-off canvas and row fill", () => {
    mockServing();
    const { getAllByText, getByText } = render(<ServingRunsheetScreen />);

    const scroll = styleOfAncestorWith(getAllByText("Sunday Gathering")[0], "flex");
    expect(scroll.backgroundColor).toBe(THEME.background);

    const row = styleOfAncestorWith(getByText("Opening Song"), "borderRadius");
    expect(row.backgroundColor).toBe(THEME.surfaceSecondary);
  });
});
