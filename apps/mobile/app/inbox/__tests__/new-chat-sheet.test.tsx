/**
 * New chat sheet — WA-VISUAL-DELTAS.md §6.
 *
 * Two things are being pinned here:
 *  1. Flag ON: the sheet lists community members immediately, before any
 *     search input (§6.3 — "empty search-first screen is a structural miss"),
 *     under a sentence-case header, with an ×-in-a-circle dismiss (§6.1).
 *  2. Flag OFF: byte-for-byte the old iMessage behavior — nothing listed
 *     until you type, "Close" icon, and the browse query never fires.
 */
import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import StartChatScreenRoute from "../new";
import { useQuery } from "@services/api/convex";

let mockShellEnabled = true;
jest.mock("@hooks/useWhatsappShell", () => ({
  useWhatsappShell: () => mockShellEnabled,
}));

const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: mockReplace,
    back: mockBack,
    canGoBack: () => true,
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Warning: "warning" },
}));

jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: {
      text: "#000",
      textSecondary: "#555",
      textTertiary: "#999",
      surface: "#fff",
      surfaceGrouped: "#fff",
      surfaceSecondary: "#eee",
      backgroundGrouped: "#f2f2f7",
      border: "#ccc",
      separator: "#e5e5e5",
      error: "#FF3B30",
      shadow: "#000",
      textInverse: "#fff",
    },
    isDark: false,
  }),
}));

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({ primaryColor: "#25D366", accentLight: "#E7F8EF" }),
}));

jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({
    token: "test-token",
    community: { id: "community-1" },
    user: { profile_photo: "https://example.com/me.png" },
  }),
}));

const SEARCH_REF = "searchUsersInSharedCommunities";
const DIRECTORY_REF = "listCommunityMembersForNewChat";

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      messaging: {
        directMessages: {
          searchUsersInSharedCommunities: "searchUsersInSharedCommunities",
          listCommunityMembersForNewChat: "listCommunityMembersForNewChat",
          createOrGetDirectChannel: "createOrGetDirectChannel",
          createGroupChat: "createGroupChat",
        },
      },
    },
  },
  useQuery: jest.fn(),
  useMutation: () => jest.fn(),
}));

const DIRECTORY_ROWS = [
  {
    userId: "user-b",
    displayName: "Bob Brown",
    profilePhoto: null,
    sharedCommunityNames: ["Demo Community"],
  },
  {
    userId: "user-c",
    displayName: "Carol Coleman",
    profilePhoto: null,
    sharedCommunityNames: ["Demo Community"],
  },
];

/** Records which refs were queried with real args (i.e. not "skip"). */
let activeRefs: string[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  activeRefs = [];
  (useQuery as jest.Mock).mockImplementation((ref: string, args: unknown) => {
    if (args === "skip") return undefined;
    activeRefs.push(ref);
    if (ref === DIRECTORY_REF) return DIRECTORY_ROWS;
    if (ref === SEARCH_REF) return [];
    return undefined;
  });
});

describe("New chat sheet — flag on (§6)", () => {
  beforeEach(() => {
    mockShellEnabled = true;
  });

  it("lists community members immediately, before any search input (§6.3)", () => {
    const { getByText } = render(<StartChatScreenRoute />);
    expect(getByText("Bob Brown")).toBeTruthy();
    expect(getByText("Carol Coleman")).toBeTruthy();
    expect(activeRefs).toContain(DIRECTORY_REF);
    // Search stays idle until there's a term.
    expect(activeRefs).not.toContain(SEARCH_REF);
  });

  it("heads the directory with a sentence-case label, never ALL-CAPS (§6.3/S3.5)", () => {
    const { getByText, queryByText } = render(<StartChatScreenRoute />);
    expect(getByText("Community members")).toBeTruthy();
    expect(queryByText("COMMUNITY MEMBERS")).toBeNull();
  });

  it("dismisses via an × button, not a 'Cancel' text button (§6.1)", () => {
    const { getByLabelText, queryByText } = render(<StartChatScreenRoute />);
    expect(queryByText("Cancel")).toBeNull();
    fireEvent.press(getByLabelText("Close"));
    expect(mockBack).toHaveBeenCalled();
  });

  it("keeps the centered 'New chat' title", () => {
    const { getByText } = render(<StartChatScreenRoute />);
    expect(getByText("New chat")).toBeTruthy();
  });

  it("keeps recipient selection working from a directory row", () => {
    const { getByText, getByLabelText } = render(<StartChatScreenRoute />);
    fireEvent.press(getByText("Bob Brown"));
    // Selecting shows the recipient token (with its remove affordance) and
    // the CTA — the DM-request flow itself is unchanged.
    expect(getByLabelText("Remove Bob Brown")).toBeTruthy();
    expect(getByLabelText("Start chat")).toBeTruthy();
  });
});

describe("New chat sheet — flag off", () => {
  beforeEach(() => {
    mockShellEnabled = false;
  });

  it("shows nothing until the user types and never fires the browse query", () => {
    const { queryByText, getByText } = render(<StartChatScreenRoute />);
    expect(queryByText("Bob Brown")).toBeNull();
    expect(queryByText("Community members")).toBeNull();
    expect(activeRefs).not.toContain(DIRECTORY_REF);
    expect(
      getByText("Search for someone in your community\nto start a chat."),
    ).toBeTruthy();
  });
});
