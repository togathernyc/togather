/**
 * Share-link group page — join vs. request-to-join routing.
 *
 * Regression test for the "[CONVEX M(functions/groups/mutations:join)] Server
 * Error" bug: the page rendered a "Request to Join" button for private groups
 * but wired it to `groups.mutations.join`, which rejects every private group
 * outright ("This is a private group. Please request to join."). In production
 * Convex hides plain `Error` messages, so the user only saw "Server Error" and
 * could never join a private group from a shared link.
 *
 * Private groups must go through `groupMembers.createJoinRequest` — the same
 * mutation every in-app join path uses (see `useJoinGroup`).
 */
import React from "react";
import { render, fireEvent, waitFor, act } from "@testing-library/react-native";
import { Alert } from "react-native";
import GroupPageClient from "../GroupPageClient";
import { useQuery, useAuthenticatedMutation } from "@services/api/convex";

const JOIN_REF = "groups.mutations.join";
const REQUEST_REF = "groupMembers.createJoinRequest";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue("test-token"),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      groups: {
        queries: { getByShortId: "groups.queries.getByShortId" },
        mutations: { join: "groups.mutations.join" },
      },
      groupMembers: { createJoinRequest: "groupMembers.createJoinRequest" },
    },
  },
  useQuery: jest.fn(),
  useAuthenticatedMutation: jest.fn(),
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => ({ shortId: "abc123" }),
  useSegments: () => ["(user)"],
}));

jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    refreshUser: jest.fn(),
    setCommunity: jest.fn(),
    community: { id: "community-1" },
    user: { id: "user-1" },
  }),
}));

jest.mock("@/features/auth/hooks/useAuth", () => ({
  useSelectCommunity: () => ({ mutateAsync: jest.fn() }),
}));

jest.mock("@/features/auth/hooks/useJoinIntent", () => ({
  useJoinIntent: () => ({ setJoinIntent: jest.fn() }),
}));

jest.mock("@/features/profile/hooks/useUserData", () => ({
  useUserData: () => ({
    data: {
      active_community_id: "community-1",
      community_memberships: [{ community_id: "community-1", is_admin: false }],
    },
    isLoading: false,
  }),
}));

jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: {
      text: "#000",
      textSecondary: "#555",
      textTertiary: "#999",
      surface: "#fff",
      surfaceSecondary: "#eee",
      background: "#fff",
      iconSecondary: "#999",
    },
    isDark: false,
  }),
}));

jest.mock("@components/ui", () => {
  const { View } = require("react-native");
  return { AppImage: View };
});

jest.mock("@/features/groups/components/MembersRow", () => {
  const { View } = require("react-native");
  return { MembersRow: View };
});

jest.mock("@/features/events/components/JoinCommunityCard", () => {
  const { View } = require("react-native");
  return { JoinCommunityCard: View };
});

jest.mock("@/features/events/components/SharedPageTabBar", () => {
  const { View } = require("react-native");
  return { SharedPageTabBar: View };
});

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));

let mockPendingLimit = { isAtLimit: false, isLoading: false };
const pendingLimitCommunityIds: unknown[] = [];
jest.mock("@/features/groups/hooks/useMyPendingJoinRequests", () => ({
  useMyPendingJoinRequests: (communityId?: unknown) => {
    pendingLimitCommunityIds.push(communityId);
    return mockPendingLimit;
  },
}));

jest.mock("@/features/groups/components/PendingRequestLimitModal", () => {
  const { Text } = require("react-native");
  return {
    PendingRequestLimitModal: ({ visible }: any) =>
      visible ? <Text>pending-limit-modal</Text> : null,
  };
});

const baseGroup = {
  id: "group-1",
  shortId: "abc123",
  name: "DP Connect Leaders",
  memberCount: 43,
  communityId: "community-1",
  communityName: "Demo Community",
  userRole: null,
  userRequestStatus: null,
};

const joinMutation = jest.fn().mockResolvedValue("membership-1");
const requestMutation = jest.fn().mockResolvedValue({ status: "pending" });

async function renderPage(group: Record<string, unknown>) {
  (useQuery as jest.Mock).mockReturnValue(group);
  const utils = render(<GroupPageClient />);
  // The page reads the auth token from AsyncStorage in an effect and bails out
  // to the sign-in screen until it lands, so let that promise settle first.
  await act(async () => {});
  return utils;
}

describe("GroupPageClient join routing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPendingLimit = { isAtLimit: false, isLoading: false };
    pendingLimitCommunityIds.length = 0;
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
    (useAuthenticatedMutation as jest.Mock).mockImplementation((ref: string) => {
      if (ref === JOIN_REF) return joinMutation;
      if (ref === REQUEST_REF) return requestMutation;
      throw new Error(`Unexpected mutation ref: ${ref}`);
    });
  });

  it("submits a join request (not a direct join) for a private group", async () => {
    const { getByText } = await renderPage({ ...baseGroup, isPublic: false });

    fireEvent.press(getByText("Request to Join"));

    await waitFor(() => expect(requestMutation).toHaveBeenCalledWith({ groupId: "group-1" }));
    expect(joinMutation).not.toHaveBeenCalled();
  });

  it("joins directly for a public group", async () => {
    const { getByText } = await renderPage({ ...baseGroup, isPublic: true });

    fireEvent.press(getByText("Join Group"));

    await waitFor(() => expect(joinMutation).toHaveBeenCalledWith({ groupId: "group-1" }));
    expect(requestMutation).not.toHaveBeenCalled();
  });

  it("shows the pending state instead of a join button once a request exists", async () => {
    const { getByText, queryByText } = await renderPage({
      ...baseGroup,
      isPublic: false,
      userRequestStatus: "pending",
    });

    expect(getByText("Request Pending")).toBeTruthy();
    expect(queryByText("Request to Join")).toBeNull();
  });

  it("surfaces the ConvexError payload rather than a raw Convex error string", async () => {
    // What the Convex client actually throws: the readable reason lives on
    // `.data` (forwardData), while `.message` keeps the opaque server text.
    const convexError: Error & { data?: string } = new Error(
      "[CONVEX M(functions/groupMembers:createJoinRequest)] [Request ID: abc] Server Error"
    );
    convexError.data = "You already have a pending join request for this group";
    requestMutation.mockRejectedValueOnce(convexError);
    const { getByText } = await renderPage({ ...baseGroup, isPublic: false });

    fireEvent.press(getByText("Request to Join"));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        "Error",
        "You already have a pending join request for this group"
      )
    );
  });

  it("blocks a request at the pending-request cap instead of creating a third", async () => {
    mockPendingLimit = { isAtLimit: true, isLoading: false };
    const { getByText } = await renderPage({ ...baseGroup, isPublic: false });

    fireEvent.press(getByText("Request to Join"));

    await waitFor(() => expect(getByText("pending-limit-modal")).toBeTruthy());
    expect(requestMutation).not.toHaveBeenCalled();
  });

  it("counts the cap against the shared group's community, not the active one", async () => {
    // A share link routinely points at a community the viewer isn't in, so
    // counting against their active community gates the wrong ledger.
    await renderPage({ ...baseGroup, isPublic: false, communityId: "community-other" });

    expect(pendingLimitCommunityIds).toContain("community-other");
    expect(pendingLimitCommunityIds).not.toContain("community-1");
  });

  it("does not apply the pending-request cap to a direct public-group join", async () => {
    mockPendingLimit = { isAtLimit: true, isLoading: false };
    const { getByText } = await renderPage({ ...baseGroup, isPublic: true });

    fireEvent.press(getByText("Join Group"));

    await waitFor(() => expect(joinMutation).toHaveBeenCalledWith({ groupId: "group-1" }));
  });
});
