/**
 * NativeRunSheetView / PlanRunSheet — `whatsapp-shell` skin.
 *
 * The run sheet is shared by the leader-tools Run Sheet tool
 * (`RunSheetToolScreen`, `canEdit` true for leaders/admins) and serving mode's
 * Runsheet tab (`ServingRunsheetScreen`, `canEdit={false}`, embedded), so every
 * flag-on assertion below is checked against BOTH `canEdit` values wherever it
 * could plausibly differ.
 *
 * The suite defaults to flag-OFF so the parity assertions pin today's
 * rendering; the flag-on describe flips it per test.
 */
import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { NativeRunSheetView, PlanRunSheet } from "../NativeRunSheetView";
import { useAuthenticatedQuery } from "@services/api/convex";
import { waRoleInk } from "@components/wa";
import { DEFAULT_ROLE_COLOR } from "@features/scheduling/utils/format";

const REF = {
  listEvents: "api.functions.scheduling.events.listEvents",
  getEvent: "api.functions.scheduling.events.getEvent",
  listItems: "api.functions.scheduling.eventItems.listItems",
};

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      scheduling: {
        events: {
          listEvents: "api.functions.scheduling.events.listEvents",
          getEvent: "api.functions.scheduling.events.getEvent",
        },
        eventItems: {
          listItems: "api.functions.scheduling.eventItems.listItems",
        },
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

const PRIMARY = "#1E8449";
jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({ primaryColor: PRIMARY }),
}));

let mockWhatsappShell = false;
jest.mock("@hooks/useWhatsappShell", () => ({
  useWhatsappShell: () => mockWhatsappShell,
}));

jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "user-me" } }),
}));

jest.mock("@providers/ConnectionProvider", () => ({
  useConnectionStatus: () => ({ isNetworkAvailable: true }),
}));

// Online in every test, so the stale getters are never consulted — they only
// need to exist.
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

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), canDismiss: () => false, dismissAll: jest.fn() }),
}));

// Not under test here — it has its own pill treatment and would only add noise.
jest.mock("@features/scheduling/components/ServiceTimeSelector", () => ({
  ServiceTimeSelector: () => null,
}));

// The real one renders link previews (network hooks, WebBrowser); the skin only
// cares that the text lands with the right style.
jest.mock("../../utils/runSheetLinks", () => {
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

/**
 * Flattened style of the nearest ancestor (self included) that defines `key`.
 * `.parent` walks composite nodes too, so this is how you get from a Text to
 * the host View that actually carries the pill/row styling.
 */
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

const VOCALS_COLOR = "#12A594";
const SERVICE_START = Date.now();

function item(overrides: Record<string, unknown> = {}) {
  return {
    _id: "item-1",
    segment: "during",
    type: "song",
    title: "Opening Song",
    description: null,
    durationSec: 600,
    notes: [],
    songDetails: null,
    assignments: [],
    ...overrides,
  };
}

const EVENT = {
  title: "Sunday Gathering",
  eventDate: SERVICE_START,
  times: [{ label: "9am", startsAt: SERVICE_START }],
  roles: [
    {
      roleId: "role-vocals",
      assignments: [{ userId: "user-me", userName: "Sam Lee", status: "confirmed" }],
    },
  ],
};

const PLANS = [
  { _id: "plan-1", title: "Sunday Gathering", eventDate: SERVICE_START, times: EVENT.times },
  { _id: "plan-2", title: "Evening", eventDate: SERVICE_START, times: [] },
];

const mockQuery = useAuthenticatedQuery as jest.Mock;

function mockSheet(
  items: Array<Record<string, unknown>>,
  event: Record<string, unknown> | null = EVENT,
) {
  mockQuery.mockImplementation((ref: string) => {
    if (ref === REF.listEvents) return PLANS;
    if (ref === REF.getEvent) return event;
    if (ref === REF.listItems) return items;
    return undefined;
  });
}

const renderSheet = (canEdit = false) =>
  render(
    <PlanRunSheet
      planId={"plan-1" as never}
      groupId={"group-1" as never}
      canEdit={canEdit}
      onEdit={jest.fn()}
      onRehearse={jest.fn()}
    />,
  );

const ASSIGNED_ITEM = item({
  assignments: [
    { roleId: "role-vocals", roleName: "Vocals", roleColor: VOCALS_COLOR },
  ],
});

afterEach(() => {
  mockWhatsappShell = false;
  jest.clearAllMocks();
});

describe("PlanRunSheet — flag-off rendering is untouched", () => {
  it("keeps the colored role chip (translucent fill + swatch)", () => {
    mockSheet([ASSIGNED_ITEM]);
    const { getByText, UNSAFE_root } = renderSheet();

    // The chip's label is one Text carrying role + people.
    const label = getByText("Vocals: Sam Lee");
    expect(flatten(label.props.style).color).toBe(THEME.text);

    // …inside a translucent `roleColor` fill, next to a full-strength swatch.
    const fills = UNSAFE_root
      .findAllByType(require("react-native").View)
      .map((v: { props: { style?: unknown } }) => flatten(v.props.style).backgroundColor);
    expect(fills).toContain(VOCALS_COLOR + "22");
    expect(fills).toContain(VOCALS_COLOR);
  });

  it("keeps ALL-CAPS segment and item-header labels", () => {
    mockSheet([item({ type: "header", title: "Worship Set" }), ASSIGNED_ITEM]);
    const { getByText, queryByText } = renderSheet();

    expect(getByText("DURING EVENT")).toBeTruthy();
    expect(getByText("WORSHIP SET")).toBeTruthy();
    expect(queryByText("During event")).toBeNull();
    expect(queryByText("Worship Set")).toBeNull();
  });

  it("keeps the happening-now row on its 4pt left border", () => {
    mockSheet([ASSIGNED_ITEM]);
    const { getByText, UNSAFE_root } = renderSheet();

    const row = styleOfAncestorWith(getByText("Opening Song"), "borderLeftWidth");
    expect(row.backgroundColor).toBe(THEME.runSheetCurrentItem);
    expect(row.borderLeftColor).toBe(THEME.runSheetCurrentItemAccent);
    expect(row.borderLeftWidth).toBe(4);

    // …and no strip view is introduced flag-off.
    const strip = UNSAFE_root
      .findAllByType(require("react-native").View)
      .map((v: { props: { style?: unknown } }) => flatten(v.props.style))
      .find((st: Record<string, unknown>) => st.position === "absolute");
    expect(strip).toBeUndefined();
  });

  it("keeps the pre-redesign type scale and borderless pills", () => {
    mockSheet([ASSIGNED_ITEM]);
    const { getByText } = renderSheet();

    expect(flatten(getByText("Opening Song").props.style).fontSize).toBe(15);
    expect(flatten(getByText("DURING EVENT").props.style).fontSize).toBe(12);
    expect(flatten(getByText("DURING EVENT").props.style).letterSpacing).toBe(0.8);

    const all = styleOfAncestorWith(getByText("All"), "backgroundColor");
    expect(all.borderWidth).toBeUndefined();
    expect(all.backgroundColor).toBe(PRIMARY);
  });
});

describe("PlanRunSheet — whatsapp-shell skin", () => {
  beforeEach(() => {
    mockWhatsappShell = true;
  });

  it("drops the colored role chip for a plain subtitle line (§7)", () => {
    mockSheet([ASSIGNED_ITEM]);
    const { UNSAFE_root } = renderSheet();

    // Neither the translucent fill nor the swatch survives — §7 bans a colored
    // pill as a taxonomy device.
    const fills = UNSAFE_root
      .findAllByType(require("react-native").View)
      .map((v: { props: { style?: unknown } }) => flatten(v.props.style).backgroundColor);
    expect(fills).not.toContain(VOCALS_COLOR + "22");
    expect(fills).not.toContain(VOCALS_COLOR);
  });

  it("keeps the role legible: role name in its own hue, people in gray", () => {
    mockSheet([ASSIGNED_ITEM]);
    const { getByText } = renderSheet();

    // The role name is its own nested Text carrying the role's HUE as INK
    // (§5/§1.3's sender-name device), semibold — re-lit for the theme so it
    // clears WCAG AA, which the raw swatch hex does not (see waRoleInk).
    const roleName = getByText("Vocals");
    expect(flatten(roleName.props.style).color).toBe(waRoleInk(VOCALS_COLOR, false));
    expect(flatten(roleName.props.style).color).not.toBe(VOCALS_COLOR);
    expect(flatten(roleName.props.style).fontWeight).toBe("600");

    // The people stay on the quiet subtitle ink, at the 15pt subtitle size.
    const line = styleOfAncestorWith(roleName, "fontSize");
    expect(line.color).toBe(THEME.textSecondary);
    expect(line.fontSize).toBe(15);
    // …and the whole line still reads the same as the flag-off chip did.
    expect(getByText("Vocals: Sam Lee")).toBeTruthy();
  });

  it("still names a role that has nobody assigned to it", () => {
    mockSheet([
      item({
        assignments: [{ roleId: "role-sound", roleName: "Sound", roleColor: null }],
      }),
    ]);
    const { getByText } = renderSheet();

    // No `roleColor` falls back to the neutral default rather than vanishing.
    expect(flatten(getByText("Sound").props.style).color).toBe(
      waRoleInk(DEFAULT_ROLE_COLOR, false),
    );
  });

  it("uses sentence-case segment labels, not ALL-CAPS (§3.2/S3.5)", () => {
    mockSheet([ASSIGNED_ITEM]);
    const { getByText, queryByText } = renderSheet();

    expect(getByText("During event")).toBeTruthy();
    expect(queryByText("DURING EVENT")).toBeNull();

    const label = flatten(getByText("During event").props.style);
    expect(label.fontSize).toBe(15);
    expect(label.fontWeight).toBe("400");
    expect(label.letterSpacing).toBe(0);
  });

  it("uses sentence-case item-header rows, not ALL-CAPS", () => {
    mockSheet([item({ type: "header", title: "Worship Set" }), ASSIGNED_ITEM]);
    const { getByText, queryByText } = renderSheet();

    expect(getByText("Worship Set")).toBeTruthy();
    expect(queryByText("WORSHIP SET")).toBeNull();

    const header = flatten(getByText("Worship Set").props.style);
    expect(header.fontSize).toBe(15);
    expect(header.letterSpacing).toBe(0);
  });

  it("drops the ALL-CAPS transform from expanded note categories", () => {
    mockSheet([item({ notes: [{ category: "Sound", content: "Track 4" }] })]);
    const { getByText } = renderSheet();

    // The standalone category Text only renders once the row is expanded.
    fireEvent.press(getByText("Opening Song"));

    const category = flatten(getByText("Sound").props.style);
    expect(category.textTransform).toBe("none");
    expect(category.letterSpacing).toBe(0);
    expect(category.fontSize).toBe(13);
  });

  it("puts All/Mine on the §7 pill vocabulary", () => {
    mockSheet([ASSIGNED_ITEM]);
    const { getByText } = renderSheet();

    const selected = styleOfAncestorWith(getByText("All"), "backgroundColor");
    expect(selected.backgroundColor).toBe(PRIMARY);
    expect(selected.borderColor).toBe(PRIMARY);
    expect(selected.borderWidth).toBe(1);
    expect(flatten(getByText("All").props.style).color).toBe(THEME.onAccent);

    const unselected = styleOfAncestorWith(getByText("Mine"), "backgroundColor");
    expect(unselected.backgroundColor).toBe(THEME.surface);
    expect(unselected.borderColor).toBe(THEME.separator);
    expect(unselected.borderWidth).toBe(1);
    expect(flatten(getByText("Mine").props.style).color).toBe(THEME.text);
  });

  it("moves rows onto §3.2 cell anatomy and the S7 type scale", () => {
    mockSheet([ASSIGNED_ITEM]);
    const { getByText } = renderSheet();

    const title = flatten(getByText("Opening Song").props.style);
    expect(title.fontSize).toBe(17);
    expect(title.fontWeight).toBe("400");

    // The row shell: 24pt radius, 16pt padding, 54pt minimum height.
    const row = styleOfAncestorWith(getByText("Opening Song"), "borderRadius");
    expect(row.borderRadius).toBe(24);
    expect(row.padding).toBe(16);
    expect(row.minHeight).toBe(54);
  });

  it("makes the row a real card: bg.card fill, not the invisible one", () => {
    // No service times ⇒ no happening-now row, so this reads the RESTING fill
    // rather than the amber state override.
    mockSheet([ASSIGNED_ITEM], { ...EVENT, times: [] });
    const { getByText } = renderSheet();

    // `surfaceSecondary` on the flag-off canvas was 1.09:1 (1.03 in Knicks
    // light) — a 24pt-radius card you cannot see. `bg.card` on the
    // `bg.grouped` canvas the container now paints reads at 1.12–1.47:1.
    const row = styleOfAncestorWith(getByText("Opening Song"), "borderRadius");
    expect(row.backgroundColor).toBe(THEME.surfaceGrouped);
    expect(row.backgroundColor).not.toBe(THEME.surfaceSecondary);
  });

  it("marks the happening-now row with an inset strip, not a clipped border", () => {
    mockSheet([ASSIGNED_ITEM]);
    const { getByText, UNSAFE_root } = renderSheet();

    const row = styleOfAncestorWith(getByText("Opening Song"), "borderRadius");
    expect(row.backgroundColor).toBe(THEME.runSheetCurrentItem);

    // A 4pt `borderLeftWidth` on a 24pt radius renders as a crescent, because
    // RN clips borders to the corner arc. The strip is its own absolutely
    // positioned child instead, inset clear of both arcs.
    expect(row.borderLeftWidth).toBeUndefined();
    const strip = UNSAFE_root
      .findAllByType(require("react-native").View)
      .map((v: { props: { style?: unknown } }) => flatten(v.props.style))
      .find((st: Record<string, unknown>) =>
        st.backgroundColor === THEME.runSheetCurrentItemAccent);
    expect(strip).toBeDefined();
    expect(strip?.position).toBe("absolute");
    expect(strip?.width).toBe(4);
    // Inset past the radius arc: at r=24 the row's left edge is at x≈2.2 when
    // y=14, so a strip at x=6 is fully inside the card without needing
    // `overflow: "hidden"` to hide an overhang.
    expect(Number(strip?.left)).toBeGreaterThan(2.2);
    expect(Number(strip?.top)).toBeGreaterThanOrEqual(12);
    expect(Number(strip?.bottom)).toBeGreaterThanOrEqual(12);
  });

  it("keeps the leader-tools editing affordances (canEdit=true)", () => {
    mockSheet([item({ type: "song", songDetails: { key: "G" } })]);
    const { getByText, getByLabelText } = renderSheet(true);

    expect(getByText("Edit")).toBeTruthy();
    expect(getByLabelText("Rehearse songs")).toBeTruthy();
    expect(getByText("Rehearse")).toBeTruthy();
  });

  it("still hides Edit for the serving consumer (canEdit=false)", () => {
    mockSheet([item({ type: "song", songDetails: { key: "G" } })]);
    const { queryByText } = renderSheet(false);

    expect(queryByText("Edit")).toBeNull();
  });

  it("keeps every affordance and string from the flag-off render", () => {
    mockSheet([
      item({ type: "header", title: "Worship Set" }),
      item({
        _id: "item-2",
        title: "Opening Song",
        songDetails: { key: "G", bpm: 72 },
        description: "Band enters from stage left",
        notes: [{ category: "Sound", content: "Track 4" }],
        assignments: [
          { roleId: "role-vocals", roleName: "Vocals", roleColor: VOCALS_COLOR },
        ],
      }),
    ]);
    const { getByText, getByLabelText } = renderSheet(true);

    expect(getByText("Sunday Gathering")).toBeTruthy();
    expect(getByText("Worship Set")).toBeTruthy();
    expect(getByText("Opening Song")).toBeTruthy();
    expect(getByText("Vocals")).toBeTruthy();
    expect(getByText("Vocals: Sam Lee")).toBeTruthy();
    expect(getByText("Band enters from stage left")).toBeTruthy();
    expect(getByText("All")).toBeTruthy();
    expect(getByText("Mine")).toBeTruthy();
    expect(getByText("Edit")).toBeTruthy();
    expect(getByLabelText("Show all run sheet items")).toBeTruthy();
    expect(getByLabelText("Show mine run sheet items")).toBeTruthy();
    // Song key/BPM meta and the collapsed note preview both survive.
    expect(getByText("Key G · 72 BPM")).toBeTruthy();
    expect(getByText("Sound: Track 4")).toBeTruthy();
  });

  it("puts the standalone plan title on §2's screen-header-block role", () => {
    mockSheet([ASSIGNED_ITEM]);
    const { getByText } = renderSheet();

    // 22 Bold, not 20 semibold: this names the whole sheet, once, at the top.
    // 20/600 is the "section header (landing screens)" role — which is what
    // `ServingRunsheetScreen`'s own per-plan header is — and it also made the
    // title LIGHTER than flag-off's 20/700, the opposite of S7's finding.
    const title = flatten(getByText("Sunday Gathering").props.style);
    expect(title.fontSize).toBe(22);
    expect(title.fontWeight).toBe("700");
  });

  it("keeps the empty and unavailable states, restyled", () => {
    mockSheet([]);
    const { getByText } = renderSheet();

    const empty = getByText("This event plan's run sheet is empty.");
    expect(flatten(empty.props.style).fontSize).toBe(15);
  });
});

describe("NativeRunSheetView — plan tabs", () => {
  it("puts the plan tabs on the §7 pill vocabulary flag-on", () => {
    mockWhatsappShell = true;
    mockSheet([ASSIGNED_ITEM]);
    const { getByText } = render(
      <NativeRunSheetView groupId={"group-1" as never} canEdit={false} />,
    );

    const selected = getByText(/^Sunday Gathering ·/);
    expect(flatten(selected.props.style).color).toBe(THEME.onAccent);
    expect(styleOfAncestorWith(selected, "backgroundColor").borderColor).toBe(PRIMARY);

    const other = getByText(/^Evening ·/);
    const otherPill = styleOfAncestorWith(other, "backgroundColor");
    expect(flatten(other.props.style).color).toBe(THEME.text);
    expect(otherPill.backgroundColor).toBe(THEME.surface);
    expect(otherPill.borderColor).toBe(THEME.separator);
    expect(otherPill.borderWidth).toBe(1);
  });

  it("lifts the tab max width by the chrome the pill treatment adds", () => {
    mockWhatsappShell = true;
    mockSheet([ASSIGNED_ITEM]);
    const { getByText } = render(
      <NativeRunSheetView groupId={"group-1" as never} canEdit={false} />,
    );

    // maxWidth is border-box in RN, so the +2 padding and 1px border per side
    // would otherwise truncate `{title} · {date}` ~6pt sooner than flag-off.
    const pill = styleOfAncestorWith(getByText(/^Evening ·/), "maxWidth");
    expect(pill.maxWidth).toBe(
      220 + 2 * (Number(pill.paddingHorizontal) - 14) + 2 * Number(pill.borderWidth),
    );
    expect(pill.maxWidth).toBe(226);
  });

  it("paints a bg.grouped canvas so the pills and rows are visible at all", () => {
    mockWhatsappShell = true;
    mockSheet([ASSIGNED_ITEM]);
    const { getByText } = render(
      <NativeRunSheetView groupId={"group-1" as never} canEdit={false} />,
    );

    // The unselected pill's `surface` fill is #ffffff, and so is `background`
    // — flag-on it was white-on-white, 1.00:1, with only a 1.26:1 hairline.
    const canvas = styleOfAncestorWith(getByText(/^Evening ·/), "flex");
    expect(canvas.backgroundColor).toBe(THEME.backgroundGrouped);
    expect(canvas.backgroundColor).not.toBe(
      styleOfAncestorWith(getByText(/^Evening ·/), "backgroundColor")
        .backgroundColor,
    );
  });

  it("keeps the flag-off canvas on `background`", () => {
    mockSheet([ASSIGNED_ITEM]);
    const { getByText } = render(
      <NativeRunSheetView groupId={"group-1" as never} canEdit={false} />,
    );

    expect(
      styleOfAncestorWith(getByText(/^Evening ·/), "flex").backgroundColor,
    ).toBe(THEME.background);
  });

  it("keeps the borderless gray tabs flag-off", () => {
    mockSheet([ASSIGNED_ITEM]);
    const { getByText } = render(
      <NativeRunSheetView groupId={"group-1" as never} canEdit={false} />,
    );

    const otherPill = styleOfAncestorWith(getByText(/^Evening ·/), "backgroundColor");
    expect(otherPill.backgroundColor).toBe(THEME.surfaceSecondary);
    expect(otherPill.borderWidth).toBeUndefined();
    expect(flatten(getByText(/^Evening ·/).props.style).color).toBe(
      THEME.textSecondary,
    );
  });
});

/* ---------------------------------------------------------------------------
 * Flag-off structural parity harness
 *
 * The assertions above spot-check flag-off: the chip, `toUpperCase()`, three
 * font sizes, one pill, the happening-now fill. That leaves flag-off row
 * geometry, sheet padding, `planTitle`/`ranges`/`editText`, header-row margins,
 * `assignWrap` direction and `notePreview` italics unpinned — any of which a
 * "flag-on only" edit could silently take with it.
 *
 * These snapshots pin the WHOLE flag-off tree instead. They are normalized so
 * they compare structurally rather than incidentally: style arrays are
 * flattened (`[styles.x, false, {…}]` ≡ `[styles.x, {…}]`, which is exactly the
 * shape every `wa && waStyles.x` entry produces), handlers collapse to a marker,
 * and wall-clock strings are scrubbed so the snapshot doesn't depend on when or
 * where it runs.
 * ------------------------------------------------------------------------- */

/** Wall-clock strings vary by run and timezone; the structure doesn't. */
const scrubText = (text: string) =>
  text
    .replace(/\b\d{1,2}:\d{2}\s?[AP]M\b/g, "<TIME>")
    .replace(/\b(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat), \w{3} \d{1,2}\b/g, "<DATE>");

const normalize = (node: unknown): unknown => {
  if (typeof node === "string") return scrubText(node);
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(normalize);
  const { type, props, children } = node as {
    type: string;
    props?: Record<string, unknown>;
    children?: unknown[] | null;
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props ?? {})) {
    if (typeof value === "function") out[key] = "[fn]";
    else if (key === "style" || key === "contentContainerStyle")
      out[key] = flatten(value);
    else out[key] = normalize(value);
  }
  return { type, props: out, children: children ? children.map(normalize) : null };
};

/** Everything a run sheet row can carry, so no branch goes unpinned. */
const RICH_ITEMS = [
  item({ _id: "hdr-1", type: "header", title: "Worship Set", durationSec: 0 }),
  item({
    _id: "item-1",
    title: "Opening Song",
    songDetails: { key: "G", bpm: 72 },
    description: "Band enters from stage left",
    notes: [{ category: "Sound", content: "Track 4" }],
    assignments: [
      { roleId: "role-vocals", roleName: "Vocals", roleColor: VOCALS_COLOR },
      { roleId: "role-sound", roleName: "Sound", roleColor: null },
    ],
  }),
  item({ _id: "item-2", segment: "before", type: "note", title: "Doors open" }),
];

describe("PlanRunSheet / NativeRunSheetView — flag-off parity is pinned structurally", () => {
  // `SERVICE_START` is `Date.now()`, so item-1's [start, start+600s) window
  // contains now and the isCurrent branch fires in every case below.
  it.each([true, false])("standalone sheet, canEdit=%s", (canEdit) => {
    mockSheet(RICH_ITEMS);
    expect(normalize(renderSheet(canEdit).toJSON())).toMatchSnapshot();
  });

  it.each([true, false])("embedded sheet, canEdit=%s", (canEdit) => {
    mockSheet(RICH_ITEMS);
    const tree = render(
      <PlanRunSheet
        embedded
        planId={"plan-1" as never}
        groupId={"group-1" as never}
        canEdit={canEdit}
        onEdit={jest.fn()}
        onRehearse={jest.fn()}
      />,
    ).toJSON();
    expect(normalize(tree)).toMatchSnapshot();
  });

  it("expanded row", () => {
    mockSheet(RICH_ITEMS);
    const view = renderSheet();
    fireEvent.press(view.getByText("Opening Song"));
    expect(normalize(view.toJSON())).toMatchSnapshot();
  });

  it("Mine view", () => {
    mockSheet(RICH_ITEMS);
    const view = renderSheet();
    fireEvent.press(view.getByLabelText("Show mine run sheet items"));
    expect(normalize(view.toJSON())).toMatchSnapshot();
  });

  it("collapsed header", () => {
    mockSheet(RICH_ITEMS);
    const view = renderSheet();
    fireEvent.press(view.getByText("WORSHIP SET"));
    expect(normalize(view.toJSON())).toMatchSnapshot();
  });

  it("plan tabs + sheet, via NativeRunSheetView", () => {
    mockSheet(RICH_ITEMS);
    const tree = render(
      <NativeRunSheetView groupId={"group-1" as never} canEdit />,
    ).toJSON();
    expect(normalize(tree)).toMatchSnapshot();
  });
});
