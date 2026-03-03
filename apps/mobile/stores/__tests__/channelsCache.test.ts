/**
 * Tests for channelsCache Zustand store
 */
import { useChannelsCache } from "../channelsCache";

describe("channelsCache", () => {
  beforeEach(() => {
    useChannelsCache.getState().clearAll();
  });

  it("stores and retrieves group channels", () => {
    const mockChannels = [
      { _id: "ch1", slug: "general", name: "General", unreadCount: 5 },
      { _id: "ch2", slug: "leaders", name: "Leaders", unreadCount: 3 },
    ];

    useChannelsCache.getState().setGroupChannels("g1", mockChannels);

    const result = useChannelsCache.getState().getGroupChannels("g1");
    expect(result).toHaveLength(2);
    expect(result![0].slug).toBe("general");
    expect(result![1].slug).toBe("leaders");
  });

  it("zeros out unread counts when caching", () => {
    const mockChannels = [
      { _id: "ch1", slug: "general", unreadCount: 42 },
      { _id: "ch2", slug: "leaders", unreadCount: 7 },
    ];

    useChannelsCache.getState().setGroupChannels("g1", mockChannels);

    const result = useChannelsCache.getState().getGroupChannels("g1");
    expect(result![0].unreadCount).toBe(0);
    expect(result![1].unreadCount).toBe(0);
  });

  it("returns null for non-existent group", () => {
    const result = useChannelsCache.getState().getGroupChannels("nonexistent");
    expect(result).toBeNull();
  });

  it("returns null for expired cache (>24h)", () => {
    useChannelsCache.getState().setGroupChannels("g1", [{ _id: "ch1" }]);

    const groups = { ...useChannelsCache.getState().groups };
    groups["g1"] = {
      ...groups["g1"],
      timestamp: Date.now() - 25 * 60 * 60 * 1000,
    };
    useChannelsCache.setState({ groups });

    expect(useChannelsCache.getState().getGroupChannels("g1")).toBeNull();
  });

  it("supports multiple groups", () => {
    useChannelsCache
      .getState()
      .setGroupChannels("g1", [{ _id: "ch1", slug: "general" }]);
    useChannelsCache
      .getState()
      .setGroupChannels("g2", [{ _id: "ch2", slug: "leaders" }]);

    expect(useChannelsCache.getState().getGroupChannels("g1")![0].slug).toBe(
      "general"
    );
    expect(useChannelsCache.getState().getGroupChannels("g2")![0].slug).toBe(
      "leaders"
    );
  });

  it("evicts oldest entries when exceeding 50 groups", () => {
    for (let i = 0; i < 50; i++) {
      useChannelsCache
        .getState()
        .setGroupChannels(`g${i}`, [{ _id: `ch${i}` }]);
    }

    useChannelsCache
      .getState()
      .setGroupChannels("g50", [{ _id: "ch50" }]);

    expect(useChannelsCache.getState().getGroupChannels("g50")).not.toBeNull();
    expect(Object.keys(useChannelsCache.getState().groups).length).toBe(50);
  });

  it("clears all cached data", () => {
    useChannelsCache
      .getState()
      .setGroupChannels("g1", [{ _id: "ch1" }]);
    useChannelsCache
      .getState()
      .setGroupChannels("g2", [{ _id: "ch2" }]);

    useChannelsCache.getState().clearAll();

    expect(useChannelsCache.getState().getGroupChannels("g1")).toBeNull();
    expect(useChannelsCache.getState().getGroupChannels("g2")).toBeNull();
  });

  it("overwrites existing cache for same group", () => {
    useChannelsCache
      .getState()
      .setGroupChannels("g1", [{ _id: "ch1", slug: "old" }]);
    useChannelsCache
      .getState()
      .setGroupChannels("g1", [{ _id: "ch2", slug: "new" }]);

    const result = useChannelsCache.getState().getGroupChannels("g1");
    expect(result).toHaveLength(1);
    expect(result![0].slug).toBe("new");
  });

  it("preserves other channel properties while zeroing unread", () => {
    const channel = {
      _id: "ch1",
      slug: "general",
      name: "General",
      channelType: "main",
      memberCount: 10,
      isMember: true,
      isPinned: false,
      unreadCount: 99,
    };

    useChannelsCache.getState().setGroupChannels("g1", [channel]);

    const result = useChannelsCache.getState().getGroupChannels("g1")![0];
    expect(result.unreadCount).toBe(0);
    expect(result.name).toBe("General");
    expect(result.memberCount).toBe(10);
    expect(result.isMember).toBe(true);
  });
});
