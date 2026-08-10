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

  it("picks the service that is actually in progress", () => {
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

  it("a pre-roll selects its service once it opens", () => {
    // 30-min pre-roll → the 9:00 service's before block starts at 8:30.
    expect(pickActiveServiceIndex(times, at(8, 45), 30 * 60, DURING, 0)).toBe(0);
    // ...but 8:15 is still ahead of it → soonest upcoming (still index 0).
    expect(pickActiveServiceIndex(times, at(8, 15), 30 * 60, DURING, 0)).toBe(0);
  });

  it("a later service's pre-roll never steals the service in progress", () => {
    // THE REPORTED BUG. Two services 2h apart with a 2.5h pre-roll (call time,
    // set-up, line check, soundcheck, platform briefing — a real Sunday before
    // block). The noon service's pre-roll opens at 9:30 AM, i.e. BEFORE the
    // 10 AM service even starts, so both "windows" contain every instant of
    // the 10 AM service. The old rule handed overlaps to the later-starting
    // service, so from 10 AM onward the sheet showed 12 PM while the team was
    // standing in the 10 AM — and every row's clock time was re-based +2h.
    const sunday = [{ startsAt: at(10) }, { startsAt: at(12) }];
    const BEFORE = 150 * 60; // 2h30m of pre-roll
    const DURING_75 = 75 * 60; // 10:00–11:15

    // Prior to 10 AM, the 10 AM's own pre-roll is running → the 10 AM.
    expect(pickActiveServiceIndex(sunday, at(9, 30), BEFORE, DURING_75, 0)).toBe(0);
    // In the 10 AM service → the 10 AM, despite noon's pre-roll being "open".
    expect(pickActiveServiceIndex(sunday, at(10, 15), BEFORE, DURING_75, 0)).toBe(0);
    expect(pickActiveServiceIndex(sunday, at(11), BEFORE, DURING_75, 0)).toBe(0);
    // Once the 10 AM is over, the floor has moved on to the noon reset.
    expect(pickActiveServiceIndex(sunday, at(11, 30), BEFORE, DURING_75, 0)).toBe(1);
    expect(pickActiveServiceIndex(sunday, at(12, 30), BEFORE, DURING_75, 0)).toBe(1);
  });

  it("overlapping services in progress: the one that started most recently", () => {
    // 90-min "during" makes the 9:00 service run to 10:30, overlapping the
    // 10:00 service's [10:00, 11:30). At 10:15 BOTH are genuinely in progress
    // (a mis-entered plan), so pick the one you most recently rolled into.
    const overlapping = [{ startsAt: at(9) }, { startsAt: at(10) }];
    expect(pickActiveServiceIndex(overlapping, at(10, 15), 0, 90 * 60, 0)).toBe(1);
    // ...but before 10:00 only the 9:00 service is running.
    expect(pickActiveServiceIndex(overlapping, at(9, 30), 0, 90 * 60, 0)).toBe(0);
  });

  it("an after block keeps its own service until something newer opens", () => {
    // 9:00 service runs to 10:00 with a 20-min teardown, next service at 4 PM
    // with a 30-min pre-roll. At 10:10 we're still striking the 9:00.
    const spread = [{ startsAt: at(9) }, { startsAt: at(16) }];
    expect(pickActiveServiceIndex(spread, at(10, 10), 30 * 60, DURING, 20 * 60)).toBe(0);
    // Teardown done and the 4 PM's pre-roll hasn't opened → next up.
    expect(pickActiveServiceIndex(spread, at(10, 30), 30 * 60, DURING, 20 * 60)).toBe(1);
  });

  it("a single-service plan always resolves to that service", () => {
    const one = [{ startsAt: at(10) }];
    for (const t of [at(6), at(9, 30), at(10, 30), at(11, 30), at(23)]) {
      expect(pickActiveServiceIndex(one, t, 30 * 60, DURING, 15 * 60)).toBe(0);
    }
  });

  it("returns the array index even when times are unordered", () => {
    const unordered = [{ startsAt: at(11) }, { startsAt: at(9) }];
    // 9:30 is inside the second element's service.
    expect(pickActiveServiceIndex(unordered, at(9, 30), 0, DURING, 0)).toBe(1);
  });

  it("after all services with unordered times, picks the max-start index", () => {
    // Everything is over by 12:00; 13:00 is past all → the latest service
    // (11:00), which is index 0 in this unordered array.
    const unordered = [{ startsAt: at(11) }, { startsAt: at(9) }];
    expect(pickActiveServiceIndex(unordered, at(13), 0, DURING, 0)).toBe(0);
  });

  it("spans multiple days without leaking across them", () => {
    const day = (d: number, h: number) => new Date(2026, 5, d, h).getTime();
    const conference = [
      { startsAt: day(7, 10) },
      { startsAt: day(8, 10) },
      { startsAt: day(9, 10) },
    ];
    expect(pickActiveServiceIndex(conference, day(7, 10.5), 0, DURING, 0)).toBe(0);
    // Overnight between sessions → the next morning's.
    expect(pickActiveServiceIndex(conference, day(7, 20), 0, DURING, 0)).toBe(1);
    expect(pickActiveServiceIndex(conference, day(8, 10.5), 0, DURING, 0)).toBe(1);
    expect(pickActiveServiceIndex(conference, day(9, 23), 0, DURING, 0)).toBe(2);
  });

  it("is unaffected by a DST transition", () => {
    // US spring-forward 2026: 2 AM EST → 3 AM EDT on Mar 8. Selection compares
    // absolute instants, so the hour that never existed locally can't shift it.
    const springForward = [
      { startsAt: new Date("2026-03-08T14:00:00Z").getTime() }, // 10 AM EDT
      { startsAt: new Date("2026-03-08T16:00:00Z").getTime() }, // 12 PM EDT
    ];
    const BEFORE = 150 * 60;
    const nowIn10am = new Date("2026-03-08T14:30:00Z").getTime();
    expect(pickActiveServiceIndex(springForward, nowIn10am, BEFORE, 75 * 60, 0)).toBe(0);
    const nowIn12pm = new Date("2026-03-08T16:30:00Z").getTime();
    expect(pickActiveServiceIndex(springForward, nowIn12pm, BEFORE, 75 * 60, 0)).toBe(1);
  });

  it("handles empty times", () => {
    expect(pickActiveServiceIndex([], at(9), 0, DURING, 0)).toBe(0);
  });

  it("an untimed service still holds the sheet until the next one starts", () => {
    // No `during` durations entered yet. A zero-length core would make "is a
    // service in progress?" unanswerable and silently disable the in-progress
    // rule — so an untimed service runs until the next service starts.
    expect(pickActiveServiceIndex(times, at(8), 0, 0, 0)).toBe(0); // ahead of both
    expect(pickActiveServiceIndex(times, at(10), 0, 0, 0)).toBe(0); // in the 9:00
    expect(pickActiveServiceIndex(times, at(11, 30), 0, 0, 0)).toBe(1); // in the 11:00
    expect(pickActiveServiceIndex(times, at(13), 0, 0, 0)).toBe(1); // all over
  });

  it("an untimed service is not stolen by a long pre-roll either", () => {
    // The reported bug's twin: a plan that has its 2h30m before block filled in
    // but hasn't timed the service body. Without the untimed-core rule the
    // in-progress check can never fire and the noon pre-roll takes the sheet
    // from 9:30 AM — the original bug, unchanged.
    const sunday = [{ startsAt: at(10) }, { startsAt: at(12) }];
    const BEFORE = 150 * 60;
    expect(pickActiveServiceIndex(sunday, at(9, 30), BEFORE, 0, 0)).toBe(0);
    expect(pickActiveServiceIndex(sunday, at(10, 15), BEFORE, 0, 0)).toBe(0);
    expect(pickActiveServiceIndex(sunday, at(11, 30), BEFORE, 0, 0)).toBe(0);
    expect(pickActiveServiceIndex(sunday, at(12, 30), BEFORE, 0, 0)).toBe(1);
  });

  it("a single untimed service still resolves to itself", () => {
    const one = [{ startsAt: at(10) }];
    for (const t of [at(6), at(9, 30), at(10, 30), at(23)]) {
      expect(pickActiveServiceIndex(one, t, 30 * 60, 0, 0)).toBe(0);
    }
  });
});
