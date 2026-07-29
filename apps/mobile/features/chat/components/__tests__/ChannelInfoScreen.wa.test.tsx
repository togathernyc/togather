/**
 * ChannelInfoScreen — WA-VISUAL-DELTAS.md §3 (Group/Channel info).
 *
 * This screen is dual-flag: every WA change lives behind `useWhatsappShell()`
 * and the flag-off tree must stay byte-identical, so each delta is asserted
 * BOTH ways (flag-on shows the new anatomy; flag-off still shows the old one).
 */
import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { ChannelInfoScreen } from "../ChannelInfoScreen";
import { useWhatsappShell } from "@hooks/useWhatsappShell";
import { useQuery } from "@services/api/convex";
import {
  waAvatarPalette,
  WA_TYPE_HERO_NAME,
  WA_ACTION_CARD_HEIGHT,
} from "@components/wa";

// A path-recording proxy stands in for the generated `api` object: the screen
// reaches into a dozen nested function refs and only ever uses them as query
// identities, so recording the dotted path is enough to key `useQuery` off.
jest.mock("@services/api/convex", () => {
  const make = (path: string[]): any =>
    new Proxy(() => {}, {
      get: (_t, prop: any) =>
        prop === "toString" || prop === Symbol.toPrimitive
          ? () => path.join(".")
          : make([...path, String(prop)]),
      apply: () => path.join("."),
    });
  return {
    api: make([]),
    useQuery: jest.fn(() => undefined),
    useAuthenticatedMutation: jest.fn(() => jest.fn()),
  };
});

jest.mock("@hooks/useWhatsappShell", () => ({
  useWhatsappShell: jest.fn(() => true),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
}));

jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({ token: "token-1", user: { id: "user-1" } }),
}));

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({ primaryColor: "#25D366" }),
}));

jest.mock("@features/channels", () => ({ AutoChannelSettings: () => null }));

jest.mock("@features/scheduling", () => ({
  CrossTeamSelectorPicker: () => null,
  updateCrossTeamChannelRef: "updateCrossTeamChannelRef",
  getCrossTeamChannelMembershipRef: "getCrossTeamChannelMembershipRef",
  addPermanentMemberToChannelRef: "addPermanentMemberToChannelRef",
  removePermanentMemberFromChannelRef: "removePermanentMemberFromChannelRef",
}));

jest.mock("@components/ui/MemberSearch", () => ({ MemberSearch: () => null }));

const CHANNEL = {
  _id: "channel-1",
  slug: "general",
  name: "General",
  channelType: "main",
  memberCount: 3,
  isMember: true,
  isLeader: false,
  isMuted: false,
};

const MEMBERS = {
  totalCount: 2,
  members: [
    { id: "m1", userId: "user-1", displayName: "Ada Lovelace", profilePhoto: null },
    { id: "m2", userId: "user-2", displayName: "Grace Hopper", profilePhoto: null },
  ],
};

function mockQueries() {
  (useQuery as jest.Mock).mockImplementation((ref: any) => {
    const key = String(ref);
    if (key.endsWith("getChannelBySlug")) return CHANNEL;
    if (key.endsWith("getChannelMembers")) return MEMBERS;
    return undefined;
  });
}

function renderScreen() {
  return render(
    <ChannelInfoScreen groupId="group-1" channelSlug="general" />
  );
}

describe("ChannelInfoScreen — WA visual deltas (§3)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useWhatsappShell as jest.Mock).mockReturnValue(true);
    mockQueries();
  });

  it("§3.1: flag-on floats the back circle + centered title; flag-off keeps the bar", () => {
    renderScreen();
    expect(screen.getByText("Channel info")).toBeTruthy();
    expect(screen.getByLabelText("Back")).toBeTruthy();

    screen.unmount();
    (useWhatsappShell as jest.Mock).mockReturnValue(false);
    renderScreen();
    expect(screen.getByText("Channel info")).toBeTruthy();
    expect(screen.queryByLabelText("Back")).toBeNull();
  });

  it("§3.2: the hero disc is a muted pastel, not the pale brand tint", () => {
    renderScreen();
    const disc = screen.getByTestId("channel-hero-disc");
    const style = StyleSheet.flatten(disc.props.style);
    expect(style.backgroundColor).toBe(waAvatarPalette("General", false).background);

    screen.unmount();
    (useWhatsappShell as jest.Mock).mockReturnValue(false);
    renderScreen();
    // Flag-off keeps the per-type tint (`brand + "15"`), untouched.
    const offStyle = StyleSheet.flatten(screen.getByTestId("channel-hero-disc").props.style);
    expect(offStyle.backgroundColor).toBe("#25D36615");
  });

  it("§3.2: the hero name is 28pt bold flag-on and 22pt flag-off", () => {
    renderScreen();
    expect(StyleSheet.flatten(screen.getByText("General").props.style).fontSize).toBe(
      WA_TYPE_HERO_NAME
    );

    screen.unmount();
    (useWhatsappShell as jest.Mock).mockReturnValue(false);
    renderScreen();
    expect(StyleSheet.flatten(screen.getByText("General").props.style).fontSize).toBe(22);
  });

  it("§3.3: Open chat and Mute become 76pt action cards flag-on", () => {
    renderScreen();
    for (const label of ["Open chat", "Mute"]) {
      const card = screen.getByLabelText(label);
      expect(StyleSheet.flatten(card.props.style).height).toBe(WA_ACTION_CARD_HEIGHT);
    }
    // The old cell label is gone; "Mute" replaces "Mute channel".
    expect(screen.queryByText("Mute channel")).toBeNull();

    screen.unmount();
    (useWhatsappShell as jest.Mock).mockReturnValue(false);
    renderScreen();
    expect(screen.queryByLabelText("Open chat")).toBeNull();
    expect(screen.getByText("Open chat")).toBeTruthy();
  });

  it("§3.5: member rows keep their names and route the trailing chevron through the centered accessory slot", () => {
    renderScreen();
    expect(screen.getByText("Ada Lovelace (you)")).toBeTruthy();
    expect(screen.getByText("Grace Hopper")).toBeTruthy();
    // The chevron rides in the accessory cluster, which centers its children —
    // WaRow's default right column top-aligns, which is what left chevrons
    // hugging the row corner across the info screens (S3.3).
    const accessories = screen.getAllByTestId("member-role-accessory");
    expect(accessories).toHaveLength(2);
    expect(StyleSheet.flatten(accessories[0].props.style)).toMatchObject({
      alignItems: "center",
      flexDirection: "row",
    });
  });

  it("S3.5: section labels are sentence-case flag-on", () => {
    renderScreen();
    expect(screen.getByText("Members")).toBeTruthy();
    expect(screen.queryByText("MEMBERS")).toBeNull();

    screen.unmount();
    (useWhatsappShell as jest.Mock).mockReturnValue(false);
    renderScreen();
    // Flag-off still uses the screen's own uppercasing SectionHeader.
    expect(screen.getByText("MEMBERS")).toBeTruthy();
  });
});
