/**
 * Client half of the duplicate-plan-date guard.
 *
 * The backend throws a typed `DUPLICATE_PLAN_DATE` ConvexError rather than
 * silently creating a second plan on a date the group already has one on. These
 * helpers have to (a) recognise that error and nothing else, and (b) turn it
 * into a question the leader can answer — an accidental double-tap and a real
 * 9 AM/11 AM Sunday look identical from here, so we must ask.
 */
import { chooseAsync } from "@/utils/platformAlert";
import {
  parseDuplicatePlanDate,
  duplicatePlanMessage,
  promptDuplicatePlanDate,
} from "../duplicatePlanDate";

jest.mock("@/utils/platformAlert", () => ({
  chooseAsync: jest.fn(),
}));

const mockChoose = chooseAsync as jest.MockedFunction<typeof chooseAsync>;

const PAYLOAD = {
  code: "DUPLICATE_PLAN_DATE",
  message: '"Sunday Service" is already scheduled on Sun, Aug 2.',
  dayLabel: "Sun, Aug 2",
  existingPlanId: "plan-1",
  existingPlanTitle: "Sunday Service",
  existingEventDate: 1785675600000,
  existingCount: 1,
};

beforeEach(() => {
  mockChoose.mockReset();
});

describe("parseDuplicatePlanDate", () => {
  it("reads the payload off a ConvexError-shaped throw", () => {
    expect(parseDuplicatePlanDate({ data: PAYLOAD })).toEqual({
      existingPlanId: "plan-1",
      existingPlanTitle: "Sunday Service",
      existingEventDate: 1785675600000,
      dayLabel: "Sun, Aug 2",
      existingCount: 1,
    });
  });

  it("accepts a payload that arrived as a JSON string", () => {
    const parsed = parseDuplicatePlanDate({ data: JSON.stringify(PAYLOAD) });
    expect(parsed?.existingPlanId).toBe("plan-1");
    expect(parsed?.dayLabel).toBe("Sun, Aug 2");
  });

  it("returns null for other errors so callers fall through to normal handling", () => {
    expect(parseDuplicatePlanDate(new Error("network"))).toBeNull();
    expect(parseDuplicatePlanDate(undefined)).toBeNull();
    expect(parseDuplicatePlanDate("nope")).toBeNull();
    expect(
      parseDuplicatePlanDate({ data: { code: "NOT_FOUND", message: "gone" } }),
    ).toBeNull();
    expect(parseDuplicatePlanDate({ data: "{not json" })).toBeNull();
  });

  it("returns null when the payload is missing what the prompt needs", () => {
    const { existingPlanId: _drop, ...incomplete } = PAYLOAD;
    expect(parseDuplicatePlanDate({ data: incomplete })).toBeNull();
  });

  it("defaults existingCount when the backend omits it", () => {
    const { existingCount: _drop, ...noCount } = PAYLOAD;
    expect(parseDuplicatePlanDate({ data: noCount })?.existingCount).toBe(1);
  });
});

describe("duplicatePlanMessage", () => {
  it("names the plan already there and offers the multi-service reading", () => {
    const info = parseDuplicatePlanDate({ data: PAYLOAD })!;
    const message = duplicatePlanMessage(info);
    expect(message).toContain("Sunday Service");
    expect(message).toContain("Sun, Aug 2");
    // The leader must be able to tell this is a choice, not a wall.
    expect(message).toContain("11 AM service");
  });

  it("says how many plans are already on the date when there are several", () => {
    const info = parseDuplicatePlanDate({
      data: { ...PAYLOAD, existingCount: 3 },
    })!;
    expect(duplicatePlanMessage(info)).toContain("3 plans are on that date");
  });
});

describe("promptDuplicatePlanDate", () => {
  const info = parseDuplicatePlanDate({ data: PAYLOAD })!;

  it("offers opening the existing plan as the primary action", async () => {
    mockChoose.mockResolvedValue("primary");
    await expect(promptDuplicatePlanDate(info)).resolves.toBe("open-existing");
    expect(mockChoose).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Already a plan on Sun, Aug 2",
        primaryText: "Open the existing plan",
        secondaryText: "Add another anyway",
      }),
    );
  });

  it("keeps a deliberate second service reachable", async () => {
    mockChoose.mockResolvedValue("secondary");
    await expect(promptDuplicatePlanDate(info)).resolves.toBe("add-another");
  });

  it("does nothing when dismissed", async () => {
    mockChoose.mockResolvedValue("cancel");
    await expect(promptDuplicatePlanDate(info)).resolves.toBe("cancel");
  });
});
