/**
 * Client half of the duplicate-plan-date guard.
 *
 * The backend throws a typed `DUPLICATE_PLAN_DATE` ConvexError rather than
 * silently creating a second plan on a date the group already has one on. These
 * helpers have to (a) recognise that error and nothing else, and (b) turn it
 * into a question the leader can answer — an accidental double-tap and a real
 * 9 AM/11 AM Sunday look identical from here, so we must ask.
 */
import fs from "fs";
import path from "path";

import { chooseAsync, confirmAsync } from "@/utils/platformAlert";
import {
  DUPLICATE_PLAN_DATE,
  parseDuplicatePlanDate,
  duplicatePlanMessage,
  promptDuplicatePlanDate,
  savePlanDate,
} from "../duplicatePlanDate";

jest.mock("@/utils/platformAlert", () => ({
  chooseAsync: jest.fn(),
  confirmAsync: jest.fn(),
}));

const mockChoose = chooseAsync as jest.MockedFunction<typeof chooseAsync>;
const mockConfirm = confirmAsync as jest.MockedFunction<typeof confirmAsync>;

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
  mockConfirm.mockReset();
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

describe("savePlanDate", () => {
  const onError = jest.fn();
  beforeEach(() => onError.mockReset());

  const aug = () => new Date(2026, 7, 2, 9, 0, 0, 0);

  it("saves a valid date straight through", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    await expect(savePlanDate({ date: aug(), save, onError })).resolves.toBe(
      "saved",
    );
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(aug().getTime());
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("ignores the values a web <input type=\"date\"> fires mid-keystroke", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    // Typing "2026" into the year emits 0002, 0020, 0202 on the way — each a
    // complete, valid Date. Persisting one strands the plan in the far past
    // (it drops out of the upcoming-only grid and reads as deleted), and if it
    // happens to collide it pops a blocking confirm while the leader types.
    for (const partial of [
      new Date(2, 7, 2),
      new Date(1999, 11, 31),
      new Date(3001, 0, 1),
      new Date(NaN),
    ]) {
      await expect(
        savePlanDate({ date: partial, save, onError }),
      ).resolves.toBe("ignored");
    }
    // A dismissed native picker hands back null.
    await expect(savePlanDate({ date: null, save, onError })).resolves.toBe(
      "ignored",
    );
    expect(save).not.toHaveBeenCalled();
  });

  it("asks, then retries with allowSameDay when the day is already planned", async () => {
    const save = jest
      .fn()
      .mockRejectedValueOnce({ data: PAYLOAD })
      .mockResolvedValueOnce(undefined);
    mockConfirm.mockResolvedValue(true);

    await expect(savePlanDate({ date: aug(), save, onError })).resolves.toBe(
      "saved",
    );
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Already a plan on Sun, Aug 2",
        confirmText: "Move it there",
      }),
    );
    expect(save).toHaveBeenNthCalledWith(2, aug().getTime(), true);
    expect(onError).not.toHaveBeenCalled();
  });

  it("leaves the date alone when the leader declines", async () => {
    const save = jest.fn().mockRejectedValue({ data: PAYLOAD });
    mockConfirm.mockResolvedValue(false);

    await expect(savePlanDate({ date: aug(), save, onError })).resolves.toBe(
      "cancelled",
    );
    expect(save).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("never surfaces the raw ConvexError message, which is a stacktrace", async () => {
    // A real client leaves the serialized payload embedded in `.message` and
    // puts the object on `.data` — surfacing `.message` showed the leader
    // "[CONVEX M(functions/scheduling/events:updateEvent)] … {\"code\":…}".
    const convexError = Object.assign(
      new Error(
        '[CONVEX M(functions/scheduling/events:updateEvent)] Uncaught ConvexError: {"code":"NOT_ALLOWED","message":"You are not a scheduler."}',
      ),
      { data: { code: "NOT_ALLOWED", message: "You are not a scheduler." } },
    );
    const save = jest.fn().mockRejectedValue(convexError);

    await expect(savePlanDate({ date: aug(), save, onError })).resolves.toBe(
      "failed",
    );
    expect(onError).toHaveBeenCalledWith("You are not a scheduler.");
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("reports a failed retry instead of swallowing it", async () => {
    const save = jest
      .fn()
      .mockRejectedValueOnce({ data: PAYLOAD })
      .mockRejectedValueOnce(new Error("Network request failed"));
    mockConfirm.mockResolvedValue(true);

    await expect(savePlanDate({ date: aug(), save, onError })).resolves.toBe(
      "failed",
    );
    expect(onError).toHaveBeenCalledWith("Network request failed");
  });
});

describe("DUPLICATE_PLAN_DATE", () => {
  it("matches the literal the backend actually throws", () => {
    // The constant is mirrored, not imported: `scheduling/events.ts` pulls in
    // `_generated/server`, and mobile never imports Convex runtime code. A
    // rename on either side would otherwise turn every date collision back
    // into an unhandled error with nothing failing, so pin it here.
    const backend = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../../convex/functions/scheduling/events.ts",
      ),
      "utf8",
    );
    const match = backend.match(
      /export const DUPLICATE_PLAN_DATE = "([^"]+)"/,
    );
    expect(match).not.toBeNull();
    expect(match![1]).toBe(DUPLICATE_PLAN_DATE);
  });
});
