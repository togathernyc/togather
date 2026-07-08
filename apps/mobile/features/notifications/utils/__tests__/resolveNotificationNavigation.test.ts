/**
 * Tests for resolveNotificationNavigation — the shared mapping from a
 * notification `data` payload to an in-app navigation action.
 *
 * The regression these cover: volunteering-assignment notifications used to
 * store an ABSOLUTE app URL (`https://togather.nyc/scheduling/assignment/x`)
 * in `data.url`. expo-router treats an absolute `https://…` URL as an external
 * link and opens it in the browser (Safari, stuck on an infinite-loading
 * "Your assignment" web page) instead of routing in-app. The resolver now
 * normalizes our own origin down to a relative path so the tap opens the app.
 *
 * Run with: cd apps/mobile && pnpm test features/notifications/utils/__tests__/resolveNotificationNavigation.test.ts
 */

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));

import { router } from "expo-router";
import { DOMAIN_CONFIG } from "@togather/shared";
import { resolveNotificationNavigation } from "../resolveNotificationNavigation";

const mockPush = router.push as unknown as jest.Mock;

afterEach(() => {
  mockPush.mockClear();
});

describe("resolveNotificationNavigation — pre-computed url", () => {
  it("rewrites an absolute app URL to a relative in-app path (no browser)", async () => {
    await resolveNotificationNavigation({
      type: "scheduling_assignment_request",
      url: `${DOMAIN_CONFIG.appUrl}/scheduling/assignment/abc123`,
    });

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/scheduling/assignment/abc123");
    // The browser-opening absolute form must never reach the router.
    expect(mockPush.mock.calls[0][0]).not.toMatch(/^https?:\/\//);
  });

  it("handles an absolute app URL nested under data.data (iOS push shape)", async () => {
    await resolveNotificationNavigation({
      data: {
        type: "scheduling_assignment_request",
        url: `${DOMAIN_CONFIG.appUrl}/scheduling/assignment/nested1`,
      },
    });

    expect(mockPush).toHaveBeenCalledWith("/scheduling/assignment/nested1");
  });

  it("passes an already-relative path through unchanged", async () => {
    await resolveNotificationNavigation({
      type: "scheduling_assignment_request",
      url: "/scheduling/assignment/rel1",
    });

    expect(mockPush).toHaveBeenCalledWith("/scheduling/assignment/rel1");
  });

  it("leaves a genuinely external URL untouched", async () => {
    const external = "https://example.com/somewhere";
    await resolveNotificationNavigation({ url: external });

    expect(mockPush).toHaveBeenCalledWith(external);
  });
});

describe("resolveNotificationNavigation — type-based routing still works", () => {
  it("routes an event notification to its short link", async () => {
    await resolveNotificationNavigation({
      type: "event_rsvp_received",
      shortId: "evt99",
    });

    expect(mockPush).toHaveBeenCalledWith("/e/evt99?source=app");
  });

  it("routes a shared_channel_invite to the channel info screen of the invited group", async () => {
    await resolveNotificationNavigation({
      type: "shared_channel_invite",
      groupId: "groupB",
      channelSlug: "shared-events",
    });

    expect(mockPush).toHaveBeenCalledWith("/inbox/groupB/shared-events/info");
  });

  it("falls back to the group page for a shared_channel_invite without a channelSlug", async () => {
    await resolveNotificationNavigation({
      type: "shared_channel_invite",
      groupId: "groupB",
    });

    expect(mockPush).toHaveBeenCalledWith("/groups/groupB");
  });

  it("routes a dev_contribution_update to the contribution's conversation", async () => {
    await resolveNotificationNavigation({
      type: "dev_contribution_update",
      bugId: "bug123",
    });

    expect(mockPush).toHaveBeenCalledWith("/(user)/dev/bug123");
  });

  it("does nothing for a dev_contribution_update without a bugId", async () => {
    await resolveNotificationNavigation({
      type: "dev_contribution_update",
    });

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("includes channelId in the shared_channel_invite deep link to disambiguate same-slug invites", async () => {
    await resolveNotificationNavigation({
      type: "shared_channel_invite",
      groupId: "groupB",
      channelSlug: "shared-events",
      channelId: "chan_123",
    });

    expect(mockPush).toHaveBeenCalledWith(
      "/inbox/groupB/shared-events/info?channelId=chan_123",
    );
  });
});
