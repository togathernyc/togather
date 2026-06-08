import {
  computeItemClockTimes,
  formatDuration,
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

describe("formatDuration", () => {
  it("formats minutes, hours, and seconds; empty for zero", () => {
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(45)).toBe("45 sec");
    expect(formatDuration(300)).toBe("5 min");
    expect(formatDuration(3900)).toBe("1 hr 5 min");
  });
});
