/**
 * Tests for groupCache Zustand store
 */
import { useGroupCache } from "../groupCache";

describe("groupCache", () => {
  beforeEach(() => {
    useGroupCache.getState().clearAll();
  });

  it("stores and retrieves group details", () => {
    const mockDetails = { _id: "g1", name: "Test Group", userRole: "member" };

    useGroupCache.getState().setGroupDetails("g1", mockDetails);

    const result = useGroupCache.getState().getGroupDetails("g1");
    expect(result).toEqual(mockDetails);
  });

  it("returns null for non-existent group", () => {
    const result = useGroupCache.getState().getGroupDetails("nonexistent");
    expect(result).toBeNull();
  });

  it("returns null for expired cache (>24h)", () => {
    const mockDetails = { _id: "g1", name: "Test" };
    useGroupCache.getState().setGroupDetails("g1", mockDetails);

    // Manually set timestamp to 25 hours ago
    const state = useGroupCache.getState();
    const groups = { ...state.groups };
    groups["g1"] = {
      ...groups["g1"],
      timestamp: Date.now() - 25 * 60 * 60 * 1000,
    };
    useGroupCache.setState({ groups });

    expect(useGroupCache.getState().getGroupDetails("g1")).toBeNull();
  });

  it("stores and retrieves full group data", () => {
    const data = {
      details: { _id: "g1", name: "Test" },
      members: [{ user: { firstName: "Alice" } }],
      leaders: [{ firstName: "Bob" }],
      memberPreview: { totalCount: 5 },
    };

    useGroupCache.getState().setFullGroupData("g1", data);

    const result = useGroupCache.getState().getFullGroupData("g1");
    expect(result).not.toBeNull();
    expect(result!.details).toEqual(data.details);
    expect(result!.members).toEqual(data.members);
    expect(result!.leaders).toEqual(data.leaders);
    expect(result!.memberPreview).toEqual(data.memberPreview);
  });

  it("setGroupDetails preserves existing members/leaders", () => {
    const fullData = {
      details: { _id: "g1", name: "Original" },
      members: [{ user: { firstName: "Alice" } }],
      leaders: [{ firstName: "Bob" }],
    };
    useGroupCache.getState().setFullGroupData("g1", fullData);

    // Update just details (e.g., from chat room)
    useGroupCache
      .getState()
      .setGroupDetails("g1", { _id: "g1", name: "Updated" });

    const result = useGroupCache.getState().getFullGroupData("g1");
    expect(result!.details.name).toBe("Updated");
    expect(result!.members).toEqual(fullData.members);
    expect(result!.leaders).toEqual(fullData.leaders);
  });

  it("evicts oldest entries when exceeding 50 groups", () => {
    // Fill with 50 groups
    for (let i = 0; i < 50; i++) {
      useGroupCache
        .getState()
        .setGroupDetails(`g${i}`, { name: `Group ${i}` });
    }

    // Add one more
    useGroupCache.getState().setGroupDetails("g50", { name: "Group 50" });

    // Newest should exist
    expect(useGroupCache.getState().getGroupDetails("g50")).not.toBeNull();

    // Total should be 50 (not 51)
    expect(Object.keys(useGroupCache.getState().groups).length).toBe(50);
  });

  it("clears all cached data", () => {
    useGroupCache
      .getState()
      .setGroupDetails("g1", { name: "Group 1" });
    useGroupCache
      .getState()
      .setGroupDetails("g2", { name: "Group 2" });

    useGroupCache.getState().clearAll();

    expect(useGroupCache.getState().getGroupDetails("g1")).toBeNull();
    expect(useGroupCache.getState().getGroupDetails("g2")).toBeNull();
  });

  it("overwrites existing cache for same group", () => {
    useGroupCache.getState().setGroupDetails("g1", { name: "Old" });
    useGroupCache.getState().setGroupDetails("g1", { name: "New" });

    const result = useGroupCache.getState().getGroupDetails("g1");
    expect(result.name).toBe("New");
  });

  it("getFullGroupData returns null for expired entries", () => {
    useGroupCache.getState().setFullGroupData("g1", {
      details: { name: "Test" },
      members: [],
    });

    const groups = { ...useGroupCache.getState().groups };
    groups["g1"] = {
      ...groups["g1"],
      timestamp: Date.now() - 25 * 60 * 60 * 1000,
    };
    useGroupCache.setState({ groups });

    expect(useGroupCache.getState().getFullGroupData("g1")).toBeNull();
  });
});
