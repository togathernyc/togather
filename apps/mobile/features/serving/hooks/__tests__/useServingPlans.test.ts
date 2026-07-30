/**
 * Tests for useServingPlans — which plans the serving surfaces render.
 *
 * The critical invariant: with a preview plan active, serving scopes to THAT
 * ONE plan, never the union of upcoming plans (the serving inbox is filtered
 * server-side by these ids).
 */
import { renderHook } from "@testing-library/react-native";
import { useServingPlans } from "../useServingPlans";
import { useEventModeStore } from "@/stores/eventModeStore";

// The offline wrapper is covered by its own tests; here it just passes the live
// list through so this test isolates the preview scoping.
jest.mock("../useCachedServingPlans", () => ({
  useCachedServingPlans: (live: unknown[] | undefined) => live ?? [],
}));

const TODAY_PLAN = {
  planId: "plan_today",
  groupId: "group_a",
  title: "Sunday 9am",
  startsAt: 1_700_000_000_000,
  endsAt: 1_700_014_400_000,
};
const NEXT_WEEK = {
  planId: "plan_next_week",
  groupId: "group_a",
  title: "Next Sunday",
  startsAt: 1_700_600_000_000,
  endsAt: 1_700_614_400_000,
};
const NEXT_MONTH = {
  planId: "plan_next_month",
  groupId: "group_a",
  title: "Next Month",
  startsAt: 1_702_600_000_000,
  endsAt: 1_702_614_400_000,
};

const ELIGIBILITY = {
  plans: [TODAY_PLAN],
  upcomingPlans: [NEXT_WEEK, NEXT_MONTH],
};

describe("useServingPlans", () => {
  beforeEach(() => {
    useEventModeStore.setState({
      isServingMode: true,
      autoEnterBlocked: false,
      previewPlanId: null,
    });
  });

  it("returns today's plans when no preview is active", () => {
    const { result } = renderHook(() => useServingPlans(ELIGIBILITY));
    expect(result.current).toEqual([TODAY_PLAN]);
  });

  it("scopes to the single previewed plan, not the whole upcoming list", () => {
    useEventModeStore.setState({ previewPlanId: NEXT_WEEK.planId });
    const { result } = renderHook(() => useServingPlans(ELIGIBILITY));
    expect(result.current).toEqual([NEXT_WEEK]);
  });

  it("drops today's plans while previewing another event", () => {
    useEventModeStore.setState({ previewPlanId: NEXT_MONTH.planId });
    const { result } = renderHook(() => useServingPlans(ELIGIBILITY));
    expect(result.current.map((p) => p.planId)).toEqual([NEXT_MONTH.planId]);
  });

  it("returns nothing when the previewed plan is no longer offered", () => {
    useEventModeStore.setState({ previewPlanId: "plan_unassigned" });
    const { result } = renderHook(() => useServingPlans(ELIGIBILITY));
    expect(result.current).toEqual([]);
  });

  it("returns nothing while the query is still loading in preview", () => {
    useEventModeStore.setState({ previewPlanId: NEXT_WEEK.planId });
    const { result } = renderHook(() => useServingPlans(undefined));
    expect(result.current).toEqual([]);
  });
});
