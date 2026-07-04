/**
 * Tests for servingRunSheetCache Zustand store
 */
import { useServingRunSheetCache } from "../servingRunSheetCache";

describe("servingRunSheetCache", () => {
  beforeEach(() => {
    useServingRunSheetCache.getState().clearAll();
  });

  it("stores and retrieves plans by groupId", () => {
    const plans = [{ _id: "p1", title: "Sunday" }];
    useServingRunSheetCache.getState().setPlans("g1", plans);
    expect(useServingRunSheetCache.getState().getPlansStale("g1")).toEqual(
      plans,
    );
  });

  it("stores event and items independently by planId", () => {
    useServingRunSheetCache.getState().setEvent("p1", { title: "Service" });
    useServingRunSheetCache.getState().setItems("p1", [{ _id: "i1" }]);

    expect(useServingRunSheetCache.getState().getEventStale("p1")).toEqual({
      title: "Service",
    });
    expect(useServingRunSheetCache.getState().getItemsStale("p1")).toEqual([
      { _id: "i1" },
    ]);
  });

  it("returns null for missing entries", () => {
    expect(useServingRunSheetCache.getState().getPlansStale("nope")).toBeNull();
    expect(useServingRunSheetCache.getState().getEventStale("nope")).toBeNull();
    expect(useServingRunSheetCache.getState().getItemsStale("nope")).toBeNull();
  });

  it("returns cached data regardless of age (offline fallback, no TTL)", () => {
    useServingRunSheetCache.getState().setItems("p1", [{ _id: "i1" }]);

    const entries = { ...useServingRunSheetCache.getState().entries };
    entries["items:p1"] = {
      ...entries["items:p1"],
      timestamp: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
    };
    useServingRunSheetCache.setState({ entries });

    expect(useServingRunSheetCache.getState().getItemsStale("p1")).toEqual([
      { _id: "i1" },
    ]);
  });

  it("overwrites an existing entry for the same key", () => {
    useServingRunSheetCache.getState().setEvent("p1", { title: "Old" });
    useServingRunSheetCache.getState().setEvent("p1", { title: "New" });
    expect(useServingRunSheetCache.getState().getEventStale("p1")?.title).toBe(
      "New",
    );
  });

  it("clears everything", () => {
    useServingRunSheetCache.getState().setPlans("g1", [{ _id: "p1" }]);
    useServingRunSheetCache.getState().setItems("p1", [{ _id: "i1" }]);
    useServingRunSheetCache.getState().clearAll();
    expect(useServingRunSheetCache.getState().getPlansStale("g1")).toBeNull();
    expect(useServingRunSheetCache.getState().getItemsStale("p1")).toBeNull();
  });
});
