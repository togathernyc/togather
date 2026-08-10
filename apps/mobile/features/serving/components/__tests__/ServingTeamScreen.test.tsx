/**
 * ServingTeamScreen — the whatsapp-shell skin (WHATSAPP-DESIGN-SYSTEM.md §7).
 *
 * The team grid keeps its shape (a horizontally-scrolling column per team, a
 * row per volunteer) but stops speaking in bordered mini-cards, ALL-CAPS
 * column labels, per-role color dots and a `colors.warning` "Unconfirmed"
 * pill. Every test here has a flag-off twin, so the restyle can never silently
 * change today's rendering.
 */
import React from "react";
import { render } from "@testing-library/react-native";
import { ServingTeamScreen } from "../ServingTeamScreen";
import { useAuthenticatedQuery } from "@services/api/convex";

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      scheduling: {
        serving: { getServingTeamRoster: "getServingTeamRoster" },
      },
    },
  },
  useAuthenticatedQuery: jest.fn(),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: {
      background: "#fff",
      surface: "#fafafa",
      surfaceGrouped: "#fff",
      border: "#e5e5e5",
      separator: "#e5e5e5",
      text: "#000",
      textSecondary: "#666",
      textTertiary: "#999",
      warning: "#F5A623",
    },
    isDark: false,
  }),
}));

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({ primaryColor: "#25D366" }),
}));

// Default flag-OFF so the pre-redesign assertions below are the baseline.
let mockWhatsappShell = false;
jest.mock("@hooks/useWhatsappShell", () => ({
  useWhatsappShell: () => mockWhatsappShell,
}));

jest.mock("@/stores/eventModeStore", () => ({
  useEventModeStore: (sel: (s: { isServingMode: boolean }) => unknown) =>
    sel({ isServingMode: true }),
}));

jest.mock("@features/chat/hooks/useStartDirectMessage", () => ({
  useStartDirectMessage: () => ({ messageUser: jest.fn(), canMessage: true }),
}));

jest.mock("@components/ui/ActionMenuSheet", () => ({
  ActionMenuSheet: () => null,
}));

const ROSTER = {
  plans: [
    {
      planId: "plan-1",
      title: "Sunday Gathering",
      eventDate: 0,
      teams: [
        {
          teamId: "team-1",
          name: "Hospitality",
          people: [
            {
              userId: "u1",
              displayName: "Amy Chen",
              firstName: "Amy",
              roleName: "Greeter",
              roleColor: "#7C3AED",
              profilePhoto: null,
              phone: "+12025550123",
              isSelf: false,
              status: "unconfirmed" as const,
            },
          ],
        },
      ],
    },
  ],
};

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

beforeEach(() => {
  (useAuthenticatedQuery as jest.Mock).mockReturnValue(ROSTER);
});
afterEach(() => {
  mockWhatsappShell = false;
  jest.clearAllMocks();
});

describe("ServingTeamScreen — flag off (unchanged)", () => {
  it("keeps the ALL-CAPS letter-spaced team column label", () => {
    const { getByText } = render(<ServingTeamScreen />);
    const label = flatten(getByText("Hospitality").props.style);
    expect(label.textTransform).toBe("uppercase");
    expect(label.fontSize).toBe(11);
    expect(label.letterSpacing).toBe(0.5);
  });

  it("keeps the standalone 'Unconfirmed' chip and the bordered person card", () => {
    const { getByText } = render(<ServingTeamScreen />);
    expect(getByText("Unconfirmed")).toBeTruthy();
    expect(getByText("Greeter")).toBeTruthy();
    expect(flatten(getByText("Amy Chen").props.style).fontSize).toBe(14);
  });
});

describe("ServingTeamScreen — whatsapp-shell skin", () => {
  beforeEach(() => {
    mockWhatsappShell = true;
  });

  it("renders the column label sentence-case at 15pt, no letter-spacing (S3.5)", () => {
    const { getByText } = render(<ServingTeamScreen />);
    const label = flatten(getByText("Hospitality").props.style);
    expect(label.textTransform).toBe("none");
    expect(label.fontSize).toBe(15);
    expect(label.letterSpacing).toBe(0);
  });

  it("folds 'Unconfirmed' into the role line instead of a warning-colored pill (§7)", () => {
    const { getByText, queryByText } = render(<ServingTeamScreen />);
    expect(getByText("Greeter · Unconfirmed")).toBeTruthy();
    expect(queryByText("Unconfirmed")).toBeNull();
  });

  it("puts volunteer names on the 17pt row-title scale", () => {
    const { getByText } = render(<ServingTeamScreen />);
    expect(flatten(getByText("Amy Chen").props.style).fontSize).toBe(17);
  });

  it("keeps the plan title and date, on the section-header scale", () => {
    const { getByText } = render(<ServingTeamScreen />);
    expect(flatten(getByText("Sunday Gathering").props.style).fontSize).toBe(20);
  });

  it("keeps the volunteer actionable — the row is still a button", () => {
    const { getByLabelText } = render(<ServingTeamScreen />);
    expect(getByLabelText("Message Amy Chen, Greeter, unconfirmed")).toBeTruthy();
  });

  it("still exposes a back affordance", () => {
    const { getByLabelText } = render(<ServingTeamScreen />);
    expect(getByLabelText("Back")).toBeTruthy();
  });
});

/**
 * Two same-day plans used to stack as two sections headed by identical
 * strings ("Untitled event plan · Sun, Aug 3"), giving a volunteer no way to
 * tell which campus rostered them.
 */
describe("ServingTeamScreen — plan header provenance", () => {
  it("names the group under the plan title", () => {
    (useAuthenticatedQuery as jest.Mock).mockReturnValue({
      plans: [{ ...ROSTER.plans[0], groupName: "FOUNT Brooklyn" }],
    });
    const { getByText } = render(<ServingTeamScreen />);
    expect(getByText("FOUNT Brooklyn")).toBeTruthy();
  });

  it("tells two identically-titled same-day plans apart", () => {
    (useAuthenticatedQuery as jest.Mock).mockReturnValue({
      plans: [
        { ...ROSTER.plans[0], groupName: "FOUNT Brooklyn" },
        {
          ...ROSTER.plans[0],
          planId: "plan-2",
          groupName: "FOUNT Manhattan",
        },
      ],
    });
    const { getAllByText, getByText } = render(<ServingTeamScreen />);
    expect(getAllByText("Sunday Gathering")).toHaveLength(2);
    expect(getByText("FOUNT Brooklyn")).toBeTruthy();
    expect(getByText("FOUNT Manhattan")).toBeTruthy();
  });

  it("renders no subtitle when the plan carries no group name", () => {
    const { getByText, queryByText } = render(<ServingTeamScreen />);
    expect(getByText("Sunday Gathering")).toBeTruthy();
    expect(queryByText("undefined")).toBeNull();
  });
});
