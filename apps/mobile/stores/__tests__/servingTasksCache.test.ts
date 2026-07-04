/**
 * Tests for servingTasksCache Zustand store
 */
import { useServingTasksCache } from "../servingTasksCache";

describe("servingTasksCache", () => {
  beforeEach(() => {
    useServingTasksCache.getState().clearAll();
  });

  it("stores and retrieves a section by plan", () => {
    const mine = { before: [], during: [{ key: "t1" }], after: [] };
    useServingTasksCache.getState().setSection("mine", "plan1", mine);
    expect(
      useServingTasksCache.getState().getSectionStale("mine", "plan1"),
    ).toEqual(mine);
  });

  it("keeps sections and plans separate", () => {
    useServingTasksCache.getState().setSection("mine", "plan1", { a: 1 });
    useServingTasksCache.getState().setSection("shared", "plan1", [{ b: 2 }]);
    useServingTasksCache.getState().setSection("mine", "plan2", { a: 3 });

    expect(
      useServingTasksCache.getState().getSectionStale("mine", "plan1"),
    ).toEqual({ a: 1 });
    expect(
      useServingTasksCache.getState().getSectionStale("shared", "plan1"),
    ).toEqual([{ b: 2 }]);
    expect(
      useServingTasksCache.getState().getSectionStale("mine", "plan2"),
    ).toEqual({ a: 3 });
  });

  it("returns null for missing sections", () => {
    expect(
      useServingTasksCache.getState().getSectionStale("crew", "plan1"),
    ).toBeNull();
  });

  it("returns cached data regardless of age (offline fallback, no TTL)", () => {
    useServingTasksCache.getState().setSection("mine", "plan1", { a: 1 });

    const entries = { ...useServingTasksCache.getState().entries };
    entries["mine:plan1"] = {
      ...entries["mine:plan1"],
      timestamp: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
    };
    useServingTasksCache.setState({ entries });

    expect(
      useServingTasksCache.getState().getSectionStale("mine", "plan1"),
    ).toEqual({ a: 1 });
  });

  it("clears everything", () => {
    useServingTasksCache.getState().setSection("mine", "plan1", { a: 1 });
    useServingTasksCache.getState().clearAll();
    expect(
      useServingTasksCache.getState().getSectionStale("mine", "plan1"),
    ).toBeNull();
  });
});
