/**
 * Tests for dismissChannelNotifications — the OS-tray sweep that removes a
 * chat channel's stacked push notifications when the channel is opened.
 *
 * The native tray behavior itself can't be unit-tested, so these tests cover
 * the filter logic: only notifications whose payload channel id matches are
 * dismissed, the nested `data.data.channelId` shape is supported, and errors
 * never escape (tray cleanup is best-effort).
 *
 * Run with: cd apps/mobile && pnpm test features/notifications/utils/__tests__/dismissChannelNotifications.test.ts
 */

import { dismissChannelNotifications } from "../dismissChannelNotifications";

jest.mock("expo-notifications", () => ({
  getPresentedNotificationsAsync: jest.fn(),
  dismissNotificationAsync: jest.fn(),
}));

import * as Notifications from "expo-notifications";

const mockGetPresented =
  Notifications.getPresentedNotificationsAsync as unknown as jest.Mock;
const mockDismiss =
  Notifications.dismissNotificationAsync as unknown as jest.Mock;

/** Build a minimal presented-notification shape with the given data payload. */
function makePresented(identifier: string, data: Record<string, unknown>) {
  return {
    request: {
      identifier,
      content: { data },
    },
  };
}

describe("dismissChannelNotifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDismiss.mockResolvedValue(undefined);
  });

  it("dismisses only notifications matching the channel id (top-level and nested)", async () => {
    mockGetPresented.mockResolvedValue([
      makePresented("match-top", { channelId: "chan_1" }),
      makePresented("match-nested", { data: { channelId: "chan_1" } }),
      makePresented("other-channel", { channelId: "chan_2" }),
      makePresented("no-channel", { type: "new_message" }),
    ]);

    await dismissChannelNotifications("chan_1");

    expect(mockDismiss).toHaveBeenCalledTimes(2);
    expect(mockDismiss).toHaveBeenCalledWith("match-top");
    expect(mockDismiss).toHaveBeenCalledWith("match-nested");
    expect(mockDismiss).not.toHaveBeenCalledWith("other-channel");
    expect(mockDismiss).not.toHaveBeenCalledWith("no-channel");
  });

  it("does nothing when channelId is empty", async () => {
    await dismissChannelNotifications("");

    expect(mockGetPresented).not.toHaveBeenCalled();
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it("swallows errors from getPresentedNotificationsAsync without throwing", async () => {
    mockGetPresented.mockRejectedValue(new Error("native bridge unavailable"));

    await expect(dismissChannelNotifications("chan_1")).resolves.toBeUndefined();
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it("swallows errors from an individual dismiss without throwing", async () => {
    mockGetPresented.mockResolvedValue([
      makePresented("match-top", { channelId: "chan_1" }),
    ]);
    mockDismiss.mockRejectedValue(new Error("already dismissed"));

    await expect(dismissChannelNotifications("chan_1")).resolves.toBeUndefined();
    expect(mockDismiss).toHaveBeenCalledWith("match-top");
  });
});
