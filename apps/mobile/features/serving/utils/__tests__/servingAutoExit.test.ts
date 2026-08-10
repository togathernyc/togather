/**
 * Tests for shouldAutoExitServing — when serving mode releases the user.
 *
 * The invariant that matters: exit only on a GENUINELY resolved empty plan
 * list. Exiting while the query is loading (or on a transient offline cache
 * miss) would bounce a volunteer out of serving mode at the venue.
 */
import { shouldAutoExitServing } from "../servingAutoExit";

const BASE = {
  inServingMode: true,
  previewPlanId: null as string | null,
  eligibilityResolved: true,
  planCount: 0,
};

describe("shouldAutoExitServing", () => {
  it("exits when serving mode resolved with zero plans", () => {
    // Regression: an empty servingPlanIds now means "empty serving inbox", so a
    // volunteer who never tapped Exit was left with an empty Chats list,
    // Runsheet and Tasks once the day's plans aged out.
    expect(shouldAutoExitServing(BASE)).toBe(true);
  });

  it("stays in serving mode while the eligibility query is still loading", () => {
    expect(
      shouldAutoExitServing({ ...BASE, eligibilityResolved: false }),
    ).toBe(false);
  });

  it("stays in serving mode while any plan is renderable", () => {
    expect(shouldAutoExitServing({ ...BASE, planCount: 2 })).toBe(false);
  });

  it("stays in serving mode on an offline cache hit with the query unresolved", () => {
    expect(
      shouldAutoExitServing({
        ...BASE,
        eligibilityResolved: false,
        planCount: 1,
      }),
    ).toBe(false);
  });

  it("leaves a preview alone — it has its own explanatory empty state", () => {
    expect(
      shouldAutoExitServing({ ...BASE, previewPlanId: "plan_next_week" }),
    ).toBe(false);
  });

  it("does nothing when the user isn't in serving mode", () => {
    expect(shouldAutoExitServing({ ...BASE, inServingMode: false })).toBe(false);
  });
});
