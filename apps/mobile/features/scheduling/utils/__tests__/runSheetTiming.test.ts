import {
  computeItemClockTimes,
  formatDuration,
  formatServiceRanges,
  pickActiveServiceIndex,
  type TimingItem,
} from "../runSheetTiming";

describe("computeItemClockTimes", () => {
  const start = new Date("2026-06-07T10:00:00").getTime();

  it("cascades durations forward from the service start", () => {
    const items: TimingItem[] = [
      { _id: "a", type: "item", durationSec: 120 }, // 10:00, +2min
      { _id: "b", type: "song", durationSec: 300 }, // 10:02, +5min
      { _id: "c", type: "item", durationSec: 0 }, // 10:07
    ];
    const times = computeItemClockTimes(items, start);
    expect(times.a).toBe(start);
    expect(times.b).toBe(start + 120_000);
    expect(times.c).toBe(start + 420_000);
  });

  it("a header inherits the next non-header item's time", () => {
    const items: TimingItem[] = [
      { _id: "a", type: "item", durationSec: 120 },
      { _id: "h", type: "header", durationSec: 0 },
      { _id: "b", type: "song", durationSec: 300 },
    ];
    const times = computeItemClockTimes(items, start);
    // Header 'h' sits between a (ends 10:02) and b (starts 10:02).
    expect(times.h).toBe(times.b);
    expect(times.b).toBe(start + 120_000);
  });

  it("a trailing header with no following item maps to null", () => {
    const items: TimingItem[] = [
      { _id: "a", type: "item", durationSec: 120 },
      { _id: "h", type: "header", durationSec: 0 },
    ];
    const times = computeItemClockTimes(items, start);
    expect(times.h).toBeNull();
  });

  it("re-bases the whole sheet when the service start changes", () => {
    const items: TimingItem[] = [
      { _id: "a", type: "item", durationSec: 120 },
      { _id: "b", type: "song", durationSec: 300 },
    ];
    const noon = new Date("2026-06-07T12:00:00").getTime();
    const times = computeItemClockTimes(items, noon);
    expect(times.a).toBe(noon);
    expect(times.b).toBe(noon + 120_000);
  });
});

describe("formatServiceRanges", () => {
  it("shows each service as a start–end range spanning the total", () => {
    const ten = new Date("2026-06-07T10:00:00").getTime();
    const noon = new Date("2026-06-07T12:00:00").getTime();
    // 37 minutes total.
    const label = formatServiceRanges([{ startsAt: ten }, { startsAt: noon }], 37 * 60);
    expect(label).toBe("10:00 AM – 10:37 AM  ·  12:00 PM – 12:37 PM");
  });
});

describe("formatDuration", () => {
  it("formats minutes, hours, and seconds; empty for zero", () => {
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(45)).toBe("45 sec");
    expect(formatDuration(300)).toBe("5 min");
    expect(formatDuration(3900)).toBe("1 hr 5 min");
  });
});

describe("pickActiveServiceIndex", () => {
  const at = (h: number, m = 0) => new Date(2026, 5, 7, h, m).getTime();
  // Two services: 9:00 AM and 11:00 AM; 60-min "during", no before/after.
  const times = [{ startsAt: at(9) }, { startsAt: at(11) }];
  const DURING = 60 * 60; // 1 hr in seconds

  it("picks the service whose window contains now", () => {
    expect(pickActiveServiceIndex(times, at(9, 30), 0, DURING, 0)).toBe(0);
    expect(pickActiveServiceIndex(times, at(11, 30), 0, DURING, 0)).toBe(1);
  });

  it("before any service, picks the soonest upcoming", () => {
    expect(pickActiveServiceIndex(times, at(8), 0, DURING, 0)).toBe(0);
  });

  it("between services, picks the next upcoming", () => {
    // 10:30 is past the 9:00 window (ends 10:00) and before 11:00.
    expect(pickActiveServiceIndex(times, at(10, 30), 0, DURING, 0)).toBe(1);
  });

  it("after all services, picks the last", () => {
    expect(pickActiveServiceIndex(times, at(13), 0, DURING, 0)).toBe(1);
  });

  it("counts a before pre-roll as part of the service window", () => {
    // 30-min pre-roll → the 9:00 window opens at 8:30.
    expect(pickActiveServiceIndex(times, at(8, 45), 30 * 60, DURING, 0)).toBe(0);
    // ...but 8:15 is still ahead of it → soonest upcoming (still index 0).
    expect(pickActiveServiceIndex(times, at(8, 15), 30 * 60, DURING, 0)).toBe(0);
  });

  it("returns the array index even when times are unordered", () => {
    const unordered = [{ startsAt: at(11) }, { startsAt: at(9) }];
    // 9:30 is inside the second element's window.
    expect(pickActiveServiceIndex(unordered, at(9, 30), 0, DURING, 0)).toBe(1);
  });

  it("handles empty times", () => {
    expect(pickActiveServiceIndex([], at(9), 0, DURING, 0)).toBe(0);
  });
});
