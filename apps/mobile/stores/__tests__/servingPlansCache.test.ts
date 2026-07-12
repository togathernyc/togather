/**
 * Tests for servingPlansCache Zustand store
 */
import { useServingPlansCache } from "../servingPlansCache";

const PLAN_A = {
  planId: "plan_a",
  groupId: "group_a",
  title: "Sunday 9am",
  startsAt: 1_700_000_000_000,
  endsAt: 1_700_014_400_000,
};
const PLAN_B = {
  planId: "plan_b",
  groupId: "group_b",
  title: "Sunday 11am",
  startsAt: 1_700_007_200_000,
  endsAt: 1_700_021_600_000,
};

describe("servingPlansCache", () => {
  beforeEach(() => {
    useServingPlansCache.getState().clearAll();
  });

  it("returns null before anything is stored", () => {
    expect(useServingPlansCache.getState().getPlansStale()).toBeNull();
  });

  it("stores and retrieves the full plans list", () => {
    useServingPlansCache.getState().setPlans([PLAN_A, PLAN_B]);
    expect(useServingPlansCache.getState().getPlansStale()).toEqual([
      PLAN_A,
      PLAN_B,
    ]);
  });

  it("overwrites on the next save (whole list, not merge)", () => {
    useServingPlansCache.getState().setPlans([PLAN_A, PLAN_B]);
    useServingPlansCache.getState().setPlans([PLAN_A]);
    expect(useServingPlansCache.getState().getPlansStale()).toEqual([PLAN_A]);
  });

  it("returns cached data regardless of age (offline fallback, no TTL)", () => {
    useServingPlansCache.getState().setPlans([PLAN_A]);
    // Backdate 30 days — the offline fallback must still surface it.
    useServingPlansCache.setState({
      timestamp: Date.now() - 30 * 24 * 60 * 60 * 1000,
    });
    expect(useServingPlansCache.getState().getPlansStale()).toEqual([PLAN_A]);
  });

  it("clears everything", () => {
    useServingPlansCache.getState().setPlans([PLAN_A]);
    useServingPlansCache.getState().clearAll();
    expect(useServingPlansCache.getState().getPlansStale()).toBeNull();
  });
});
