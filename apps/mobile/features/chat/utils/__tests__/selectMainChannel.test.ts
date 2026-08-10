import { selectMainChannel, type MainSpotChannel } from "../selectMainChannel";

/**
 * The grouped inbox row shows one channel in the prominent "main spot" and the
 * rest as secondary sub-rows. These tests pin down which channel wins the main
 * spot now that selection follows updates instead of always being "General".
 */
type TestChannel = MainSpotChannel & { id: string };

const channel = (overrides: Partial<TestChannel> & { id: string }): TestChannel => ({
  channelType: "custom",
  unreadCount: 0,
  lastMessageAt: null,
  ...overrides,
});

describe("selectMainChannel", () => {
  it("returns undefined for an empty channel list", () => {
    expect(selectMainChannel([])).toBeUndefined();
  });

  it("falls back to the General channel when nothing has updates", () => {
    const general = channel({ id: "g", channelType: "main", lastMessageAt: 100 });
    const leaders = channel({ id: "l", channelType: "leaders", lastMessageAt: 200 });

    expect(selectMainChannel([general, leaders])?.id).toBe("g");
  });

  it("falls back to the first channel when there is no General channel and no updates", () => {
    const leaders = channel({ id: "l", channelType: "leaders" });
    const announcements = channel({ id: "a", channelType: "announcements" });

    expect(selectMainChannel([leaders, announcements])?.id).toBe("l");
  });

  it("gives the main spot to a secondary channel that has updates when General has none", () => {
    const general = channel({ id: "g", channelType: "main", unreadCount: 0, lastMessageAt: 500 });
    const leaders = channel({ id: "l", channelType: "leaders", unreadCount: 3, lastMessageAt: 100 });

    expect(selectMainChannel([general, leaders])?.id).toBe("l");
  });

  it("lets the General channel reclaim the main spot when it receives an update", () => {
    const general = channel({ id: "g", channelType: "main", unreadCount: 1, lastMessageAt: 100 });
    const leaders = channel({ id: "l", channelType: "leaders", unreadCount: 3, lastMessageAt: 999 });

    // Even though leaders is more recent and has more unread, General reclaims the spot.
    expect(selectMainChannel([general, leaders])?.id).toBe("g");
  });

  it("picks the most recently updated channel when several secondaries have updates", () => {
    const general = channel({ id: "g", channelType: "main", unreadCount: 0, lastMessageAt: 50 });
    const leaders = channel({ id: "l", channelType: "leaders", unreadCount: 2, lastMessageAt: 300 });
    const announcements = channel({ id: "a", channelType: "announcements", unreadCount: 5, lastMessageAt: 800 });

    expect(selectMainChannel([general, leaders, announcements])?.id).toBe("a");
  });

  it("does not mutate the input array order", () => {
    const general = channel({ id: "g", channelType: "main", unreadCount: 0, lastMessageAt: 50 });
    const leaders = channel({ id: "l", channelType: "leaders", unreadCount: 2, lastMessageAt: 300 });
    const announcements = channel({ id: "a", channelType: "announcements", unreadCount: 5, lastMessageAt: 800 });
    const input = [general, leaders, announcements];

    selectMainChannel(input);

    expect(input.map((ch) => ch.id)).toEqual(["g", "l", "a"]);
  });
});
