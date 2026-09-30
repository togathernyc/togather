/**
 * Tests for NotificationProvider's push-tap community switch.
 *
 * Tapping a notification from another community must open the app in THAT
 * community. The regression: on a cold start the tap is delivered before
 * AuthProvider has restored the user's profile, so `setCommunity` no-ops
 * (it has no user yet) and the profile fetch then lands the user in their
 * previous active community. The tap must wait for auth to be ready.
 */
import React from "react";
import { render, waitFor, act } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import { NotificationProvider } from "../NotificationProvider";

type Auth = {
  user: { id: string } | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  community: { id: string } | null;
  setCommunity: jest.Mock;
};

const mockSetCommunity = jest.fn(() => Promise.resolve());
let mockAuth: Auth;
jest.mock("../AuthProvider", () => ({
  useAuth: () => mockAuth,
}));

jest.mock("expo-device", () => ({ isDevice: false }));

jest.mock("@services/api/convex", () => ({
  convexVanilla: { mutation: jest.fn(() => Promise.resolve()) },
  api: {
    functions: {
      notifications: {
        queries: { unreadCount: "unreadCount" },
        tokens: { registerToken: "registerToken" },
        mutations: { recordClick: "recordClick", recordImpression: "recordImpression" },
      },
    },
  },
  useQuery: jest.fn(() => undefined),
  useMutation: jest.fn(() => jest.fn()),
}));

jest.mock("@features/chat/hooks/usePrefetchChannel", () => ({
  useAwaitPrefetch: () => jest.fn(),
}));

const mockResolveNavigation = jest.fn(() => Promise.resolve());
jest.mock("@features/notifications/utils/resolveNotificationNavigation", () => ({
  resolveNotificationNavigation: (...args: unknown[]) =>
    mockResolveNavigation(...(args as [])),
}));

let tapListener: ((response: unknown) => void) | null = null;

function tap(communityId: string, identifier = "notif-1") {
  act(() => {
    tapListener?.({
      notification: {
        request: {
          identifier,
          content: {
            data: { type: "new_message", communityId, groupId: "g1", channelId: "c1" },
          },
        },
      },
    });
  });
}

const loadingAuth = (): Auth => ({
  // Token restored, profile still loading — the cold-start window.
  user: null,
  isAuthenticated: true,
  isLoading: true,
  community: null,
  setCommunity: mockSetCommunity,
});

const readyAuth = (communityId: string): Auth => ({
  user: { id: "u1" },
  isAuthenticated: true,
  isLoading: false,
  community: { id: communityId },
  setCommunity: mockSetCommunity,
});

// A fresh element per render: re-rendering the same element object bails out,
// and useAuth is mocked rather than read from context.
const tree = () => (
  <NotificationProvider>
    <></>
  </NotificationProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  tapListener = null;
  (Notifications.addNotificationResponseReceivedListener as jest.Mock).mockImplementation(
    (cb: (response: unknown) => void) => {
      tapListener = cb;
      return { remove: jest.fn() };
    },
  );
});

describe("NotificationProvider community switch on tap", () => {
  it("waits for auth to load on a cold start, then switches to the notification's community", async () => {
    mockAuth = loadingAuth();
    const { rerender } = render(tree());
    await waitFor(() => expect(tapListener).not.toBeNull());

    tap("community-b");
    // Nothing happens while the profile is still loading.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(mockSetCommunity).not.toHaveBeenCalled();
    expect(mockResolveNavigation).not.toHaveBeenCalled();

    // Auth restores the user's previous active community.
    mockAuth = readyAuth("community-a");
    rerender(tree());

    await waitFor(() => expect(mockResolveNavigation).toHaveBeenCalledTimes(1));
    expect(mockSetCommunity).toHaveBeenCalledWith({ id: "community-b" });
    expect(mockSetCommunity.mock.invocationCallOrder[0]).toBeLessThan(
      mockResolveNavigation.mock.invocationCallOrder[0],
    );
  });

  it("switches community before navigating when the app is already running", async () => {
    mockAuth = readyAuth("community-a");
    render(tree());
    await waitFor(() => expect(tapListener).not.toBeNull());

    tap("community-b");

    await waitFor(() => expect(mockResolveNavigation).toHaveBeenCalledTimes(1));
    expect(mockSetCommunity).toHaveBeenCalledWith({ id: "community-b" });
    expect(mockSetCommunity.mock.invocationCallOrder[0]).toBeLessThan(
      mockResolveNavigation.mock.invocationCallOrder[0],
    );
  });

  it("does not switch when the notification is for the current community", async () => {
    mockAuth = readyAuth("community-a");
    render(tree());
    await waitFor(() => expect(tapListener).not.toBeNull());

    tap("community-a");

    await waitFor(() => expect(mockResolveNavigation).toHaveBeenCalledTimes(1));
    expect(mockSetCommunity).not.toHaveBeenCalled();
  });
});
