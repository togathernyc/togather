/**
 * "＋ Add date" and the quick-start fall-through, at the seam where a duplicate
 * date is resolved.
 *
 * The regression this guards: `nextSundayAtNine()` is deterministic, so two
 * taps used to write two byte-identical plans. Now the second create is
 * refused, and what happens next depends on which entry point asked.
 */
import React from "react";
import { Text } from "react-native";
import { render, waitFor } from "@testing-library/react-native";
import { renderHook } from "@testing-library/react-native";

const mockCreateEvent = jest.fn();
jest.mock("@services/api/convex", () => ({
  api: { functions: { scheduling: { events: { createEvent: "createEvent" } } } },
  useAuthenticatedMutation: () => mockCreateEvent,
}));

const mockPrompt = jest.fn();
jest.mock("../../utils/duplicatePlanDate", () => {
  const actual = jest.requireActual("../../utils/duplicatePlanDate");
  return {
    ...actual,
    promptDuplicatePlanDate: (...a: unknown[]) => mockPrompt(...a),
  };
});

import { useAddPlanDate, nextSundayAtNine } from "../useAddPlanDate";

const DUPLICATE = {
  data: {
    code: "DUPLICATE_PLAN_DATE",
    message: '"Sunday Service" is already scheduled on Sun, Aug 2.',
    dayLabel: "Sun, Aug 2",
    existingPlanId: "existing-plan",
    existingPlanTitle: "Sunday Service",
    existingEventDate: 1785675600000,
    existingCount: 1,
  },
};

function setup() {
  const onOpenPlan = jest.fn();
  const { result } = renderHook(() =>
    useAddPlanDate({ groupId: "group-1" as never, onOpenPlan }),
  );
  return { result, onOpenPlan };
}

beforeEach(() => {
  mockCreateEvent.mockReset();
  mockPrompt.mockReset();
});

describe("nextSundayAtNine", () => {
  it("returns a future Sunday at 9:00 local time", () => {
    const d = nextSundayAtNine();
    expect(d.getDay()).toBe(0);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(0);
    expect(d.getTime()).toBeGreaterThan(Date.now());
  });

  it("is deterministic — which is exactly why the backend guard is needed", () => {
    expect(nextSundayAtNine().getTime()).toBe(nextSundayAtNine().getTime());
  });
});

describe("useAddPlanDate", () => {
  it("creates a plan at the default date, letting the backend name it", async () => {
    mockCreateEvent.mockResolvedValue({ planId: "new-plan" });
    const { result, onOpenPlan } = setup();

    await expect(result.current.addPlanDate("ask")).resolves.toBe("created");

    expect(mockCreateEvent).toHaveBeenCalledTimes(1);
    const args = mockCreateEvent.mock.calls[0][0];
    expect(args.groupId).toBe("group-1");
    expect(args.times).toEqual([
      { label: "9:00 AM", startsAt: args.eventDate },
    ]);
    // No client-invented title, and no same-day opt-in unless asked for.
    expect(args.title).toBeUndefined();
    expect(args.allowSameDay).toBeUndefined();
    expect(onOpenPlan).not.toHaveBeenCalled();
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  it("asks the leader when the date is taken, and opens the plan they have", async () => {
    mockCreateEvent.mockRejectedValueOnce(DUPLICATE);
    mockPrompt.mockResolvedValue("open-existing");
    const { result, onOpenPlan } = setup();

    await expect(result.current.addPlanDate("ask")).resolves.toBe(
      "opened-existing",
    );

    expect(mockPrompt).toHaveBeenCalledTimes(1);
    expect(onOpenPlan).toHaveBeenCalledWith("existing-plan");
    // Crucially, no second plan was written.
    expect(mockCreateEvent).toHaveBeenCalledTimes(1);
  });

  it("still allows a deliberate second service on the same Sunday", async () => {
    mockCreateEvent
      .mockRejectedValueOnce(DUPLICATE)
      .mockResolvedValueOnce({ planId: "second-plan" });
    mockPrompt.mockResolvedValue("add-another");
    const { result, onOpenPlan } = setup();

    await expect(result.current.addPlanDate("ask")).resolves.toBe("created");

    expect(mockCreateEvent).toHaveBeenCalledTimes(2);
    expect(mockCreateEvent.mock.calls[1][0].allowSameDay).toBe(true);
    expect(onOpenPlan).not.toHaveBeenCalled();
  });

  it("writes nothing when the leader backs out", async () => {
    mockCreateEvent.mockRejectedValueOnce(DUPLICATE);
    mockPrompt.mockResolvedValue("cancel");
    const { result, onOpenPlan } = setup();

    await expect(result.current.addPlanDate("ask")).resolves.toBe("cancelled");
    expect(mockCreateEvent).toHaveBeenCalledTimes(1);
    expect(onOpenPlan).not.toHaveBeenCalled();
  });

  it('goes straight to the existing plan in "open" mode without prompting', async () => {
    // The quick-start fall-through: the leader asked to be set up, not for a
    // second service, so there is nothing to ask about.
    mockCreateEvent.mockRejectedValueOnce(DUPLICATE);
    const { result, onOpenPlan } = setup();

    await expect(result.current.addPlanDate("open")).resolves.toBe(
      "opened-existing",
    );
    expect(mockPrompt).not.toHaveBeenCalled();
    expect(onOpenPlan).toHaveBeenCalledWith("existing-plan");
    expect(mockCreateEvent).toHaveBeenCalledTimes(1);
  });

  it("rethrows anything that is not a duplicate-date collision", async () => {
    mockCreateEvent.mockRejectedValueOnce(new Error("offline"));
    const { result } = setup();

    await expect(result.current.addPlanDate("ask")).rejects.toThrow("offline");
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  it("is stable enough to be called from a rendered screen", async () => {
    mockCreateEvent.mockResolvedValue({ planId: "new-plan" });
    const Harness = () => {
      const { addPlanDate } = useAddPlanDate({
        groupId: "group-1" as never,
        onOpenPlan: jest.fn(),
      });
      React.useEffect(() => {
        void addPlanDate("ask");
      }, [addPlanDate]);
      return <Text>ready</Text>;
    };
    const { getByText } = render(<Harness />);
    expect(getByText("ready")).toBeTruthy();
    // The effect depends on `addPlanDate`; an unstable identity would loop.
    await waitFor(() => expect(mockCreateEvent).toHaveBeenCalledTimes(1));
  });
});
