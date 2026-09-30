import { describeNextRun, formatHour, formatSchedule } from "../schedule";

describe("formatHour", () => {
  test("formats morning, noon and afternoon hours", () => {
    expect(formatHour(9)).toBe("9am");
    expect(formatHour(12)).toBe("12pm");
    expect(formatHour(15)).toBe("3pm");
  });
});

describe("formatSchedule", () => {
  test("reads as a weekly cadence", () => {
    expect(formatSchedule(2, 10)).toBe("Tuesdays at 10am ET");
  });
});

describe("describeNextRun", () => {
  // Wednesday Sep 30 2026, 3pm ET
  const wedAfternoon = new Date("2026-09-30T19:00:00Z");

  test("finds the next matching weekday", () => {
    expect(describeNextRun(wedAfternoon, 2, 10)).toBe("Tue, Oct 6");
  });

  test("runs later today when the hour hasn't passed yet in ET", () => {
    // Tuesday Oct 6 2026, 9am ET
    expect(describeNextRun(new Date("2026-10-06T13:00:00Z"), 2, 10)).toBe("Tue, Oct 6");
  });

  test("skips to next week once today's hour has passed in ET", () => {
    // Tuesday Oct 6 2026, 10am ET exactly — the cron has already fired
    expect(describeNextRun(new Date("2026-10-06T14:00:00Z"), 2, 10)).toBe("Tue, Oct 13");
  });

  test("uses the ET calendar day, not the UTC one", () => {
    // Tuesday Oct 6 2026, 10pm ET is already Wednesday in UTC
    expect(describeNextRun(new Date("2026-10-07T02:00:00Z"), 2, 10)).toBe("Tue, Oct 13");
    // ...and a Wednesday schedule is still tomorrow, not today
    expect(describeNextRun(new Date("2026-10-07T02:00:00Z"), 3, 10)).toBe("Wed, Oct 7");
  });
});
