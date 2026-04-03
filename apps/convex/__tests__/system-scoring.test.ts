/**
 * Tests for the system scoring engine (systemScoring.ts).
 *
 * Covers the three system scores:
 *   - sys_service: PCO serving frequency
 *   - sys_attendance: Weekly attendance percentage
 *   - sys_togather (Connection): Attendance base + follow-up fills remaining
 *
 * The connection score is the primary triage metric. Its formula:
 *   1. attendance_pct = max(0, 100 − consecutive_missed × 15)
 *      attendance_portion = round(70 × attendance_pct / 100)
 *   2. remaining = 100 − attendance_portion
 *   3. follow-up fills remaining: in-person 100%, call 75%, text 50% (decaying)
 *   Note: decayMultiplier still uses attended_weeks === 0 ? 0.5 : 1
 */

import { describe, expect, test } from "vitest";
import {
  calculateSystemScore,
  calculateAllSystemScores,
  extractSystemRawValues,
  evaluateSystemAlerts,
  type SystemRawValues,
} from "../functions/systemScoring";

// ============================================================================
// Helpers
// ============================================================================

/** Build a SystemRawValues with sensible defaults, overriding specific fields. */
function makeRaw(overrides: Partial<SystemRawValues> = {}): SystemRawValues {
  return {
    attendance_all_groups_pct: 0,
    consecutive_missed: 0,
    attended_weeks_in_window: 0,
    total_weeks_in_window: 0,
    meeting_weeks_in_window: 0,
    days_since_last_followup: 9999,
    days_since_last_in_person: 9999,
    days_since_last_call: 9999,
    days_since_last_text: 9999,
    pco_services_past_2mo: 0,
    ...overrides,
  };
}

// ============================================================================
// sys_service
// ============================================================================

describe("sys_service", () => {
  test("zero services = 0", () => {
    expect(calculateSystemScore("sys_service", makeRaw())).toBe(0);
  });

  test("each service adds 20 points", () => {
    expect(calculateSystemScore("sys_service", makeRaw({ pco_services_past_2mo: 1 }))).toBe(20);
    expect(calculateSystemScore("sys_service", makeRaw({ pco_services_past_2mo: 3 }))).toBe(60);
  });

  test("caps at 100 for 5+ services", () => {
    expect(calculateSystemScore("sys_service", makeRaw({ pco_services_past_2mo: 5 }))).toBe(100);
    expect(calculateSystemScore("sys_service", makeRaw({ pco_services_past_2mo: 10 }))).toBe(100);
  });
});

// ============================================================================
// sys_attendance
// ============================================================================

describe("sys_attendance", () => {
  test("zero total weeks = 0", () => {
    expect(calculateSystemScore("sys_attendance", makeRaw())).toBe(0);
  });

  test("all weeks attended = 100", () => {
    expect(
      calculateSystemScore(
        "sys_attendance",
        makeRaw({ attended_weeks_in_window: 8, total_weeks_in_window: 8 }),
      ),
    ).toBe(100);
  });

  test("half weeks attended = 50", () => {
    expect(
      calculateSystemScore(
        "sys_attendance",
        makeRaw({ attended_weeks_in_window: 4, total_weeks_in_window: 8 }),
      ),
    ).toBe(50);
  });

  test("rounds correctly", () => {
    // 3/7 = 42.857... → 43
    expect(
      calculateSystemScore(
        "sys_attendance",
        makeRaw({ attended_weeks_in_window: 3, total_weeks_in_window: 7 }),
      ),
    ).toBe(43);
  });
});

// ============================================================================
// sys_togather (Connection Score) — Core Formula
// ============================================================================

describe("sys_togather — attendance portion", () => {
  test("no meetings in window = 0 (new member, nothing to evaluate)", () => {
    expect(
      calculateSystemScore("sys_togather", makeRaw({ meeting_weeks_in_window: 0 })),
    ).toBe(0);
  });

  test("all meetings attended, no follow-up = 70", () => {
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({ meeting_weeks_in_window: 6, attended_weeks_in_window: 6 }),
      ),
    ).toBe(70);
  });

  test("1 consecutive miss = 60 (attendance_pct = 85)", () => {
    // attendance_pct = max(0, 100 - 1*15) = 85 → portion = round(70 * 0.85) = 60
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({ meeting_weeks_in_window: 6, attended_weeks_in_window: 5, consecutive_missed: 1 }),
      ),
    ).toBe(60);
  });

  test("4 consecutive misses = 28 (attendance_pct = 40)", () => {
    // attendance_pct = max(0, 100 - 4*15) = 40 → portion = round(70 * 0.40) = 28
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({ meeting_weeks_in_window: 8, attended_weeks_in_window: 4, consecutive_missed: 4 }),
      ),
    ).toBe(28);
  });

  test("7 consecutive misses = 0 (attendance_pct clamped to 0)", () => {
    // attendance_pct = max(0, 100 - 7*15) = max(0, -5) = 0 → portion = 0
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({ meeting_weeks_in_window: 8, attended_weeks_in_window: 1, consecutive_missed: 7 }),
      ),
    ).toBe(0);

    // 8 consecutive misses (all missed) = also 0
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({ meeting_weeks_in_window: 8, attended_weeks_in_window: 0, consecutive_missed: 8 }),
      ),
    ).toBe(0);
  });

  test("new member, 1 meeting week, zero attendance = 0 (not inflated)", () => {
    // Bug fix: previously scored 60 because consecutiveMissed=1 only deducted 15%
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({ meeting_weeks_in_window: 1, attended_weeks_in_window: 0 }),
      ),
    ).toBe(0);
    // Also with 2 meeting weeks
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({ meeting_weeks_in_window: 2, attended_weeks_in_window: 0 }),
      ),
    ).toBe(0);
  });

  test("member who joined recently with only 1 meeting week, attended = 70", () => {
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({ meeting_weeks_in_window: 1, attended_weeks_in_window: 1 }),
      ),
    ).toBe(70);
  });

  test("member who joined recently, 2 meeting weeks, 1 consecutive miss = 60", () => {
    // attendance_pct = max(0, 100 - 1*15) = 85 → portion = round(70 * 0.85) = 60
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({ meeting_weeks_in_window: 2, attended_weeks_in_window: 1, consecutive_missed: 1 }),
      ),
    ).toBe(60);
  });
});

// ============================================================================
// sys_togather — Follow-up portion
// ============================================================================

describe("sys_togather — follow-up fills remaining", () => {
  test("perfect attendance + in-person today = 100", () => {
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({
          meeting_weeks_in_window: 8,
          attended_weeks_in_window: 8,
          days_since_last_in_person: 0,
        }),
      ),
    ).toBe(100);
  });

  test("perfect attendance + call today = 93 (75% of 30 remaining)", () => {
    // attendance = 70, remaining = 30, call fill = 0.75 → 30 * 0.75 = 22.5 → 23
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({
          meeting_weeks_in_window: 8,
          attended_weeks_in_window: 8,
          days_since_last_call: 0,
        }),
      ),
    ).toBe(93);
  });

  test("perfect attendance + text today = 85 (50% of 30 remaining)", () => {
    // attendance = 70, remaining = 30, text fill = 0.50 → 30 * 0.50 = 15
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({
          meeting_weeks_in_window: 8,
          attended_weeks_in_window: 8,
          days_since_last_text: 0,
        }),
      ),
    ).toBe(85);
  });

  test("no attendance + in-person today = 100 (follow-up fills all 100)", () => {
    // consecutive_missed: 8 → attendancePct = 0, portion = 0, remaining = 100
    // in-person fill = 1.0, followup = 100. Total = 100
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({
          meeting_weeks_in_window: 8,
          attended_weeks_in_window: 0,
          consecutive_missed: 8,
          days_since_last_in_person: 0,
        }),
      ),
    ).toBe(100);
  });

  test("no attendance + call today = 75 (75% of 100 remaining)", () => {
    // consecutive_missed: 8 → attendancePct = 0, portion = 0, remaining = 100
    // call fill = 0.75, followup = round(100 * 0.75) = 75
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({
          meeting_weeks_in_window: 8,
          attended_weeks_in_window: 0,
          consecutive_missed: 8,
          days_since_last_call: 0,
        }),
      ),
    ).toBe(75);
  });

  test("no attendance + text today = 50 (50% of 100 remaining)", () => {
    // consecutive_missed: 8 → attendancePct = 0, portion = 0, remaining = 100
    // text fill = 0.50, followup = round(100 * 0.50) = 50
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({
          meeting_weeks_in_window: 8,
          attended_weeks_in_window: 0,
          consecutive_missed: 8,
          days_since_last_text: 0,
        }),
      ),
    ).toBe(50);
  });

  test("4 consecutive misses + in-person today = 100", () => {
    // consecutive_missed: 4 → attendancePct = 40, portion = 28, remaining = 72
    // in-person fill = 1.0, followup = 72. Total = 28 + 72 = 100
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({
          meeting_weeks_in_window: 8,
          attended_weeks_in_window: 4,
          consecutive_missed: 4,
          days_since_last_in_person: 0,
        }),
      ),
    ).toBe(100);
  });

  test("4 consecutive misses + call today = 82", () => {
    // consecutive_missed: 4 → attendancePct = 40, portion = round(70*0.40) = 28, remaining = 72
    // call fill = 0.75, followup = round(72 * 0.75) = 54. Total = 28 + 54 = 82
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({
          meeting_weeks_in_window: 8,
          attended_weeks_in_window: 4,
          consecutive_missed: 4,
          days_since_last_call: 0,
        }),
      ),
    ).toBe(82);
  });

  test("4 consecutive misses + text today = 64", () => {
    // consecutive_missed: 4 → attendancePct = 40, portion = round(70*0.40) = 28, remaining = 72
    // text fill = 0.50, followup = round(72 * 0.50) = 36. Total = 28 + 36 = 64
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({
          meeting_weeks_in_window: 8,
          attended_weeks_in_window: 4,
          consecutive_missed: 4,
          days_since_last_text: 0,
        }),
      ),
    ).toBe(64);
  });
});

// ============================================================================
// sys_togather — Follow-up decay over time
// ============================================================================

describe("sys_togather — follow-up decay", () => {
  test("in-person 25 days ago with no attendance decays to 50% (2× faster decay)", () => {
    // consecutive_missed: 8 → attendancePct = 0, portion = 0, remaining = 100
    // No attendance → decay window halved: 100 → 50 days
    // fill = 1.0 * (1 - 25/50) = 0.50
    // remaining = 100, followup = round(100 * 0.50) = 50
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({
          meeting_weeks_in_window: 8,
          attended_weeks_in_window: 0,
          consecutive_missed: 8,
          days_since_last_in_person: 25,
        }),
      ),
    ).toBe(50);
  });

  test("in-person 50 days ago with no attendance fully decayed (2× faster)", () => {
    // consecutive_missed: 8 → attendancePct = 0, portion = 0, remaining = 100
    // No attendance → decay window halved: 100 → 50 days
    // fill = 1.0 * (1 - 50/50) = 0
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({
          meeting_weeks_in_window: 8,
          attended_weeks_in_window: 0,
          consecutive_missed: 8,
          days_since_last_in_person: 50,
        }),
      ),
    ).toBe(0);
  });

  test("in-person 50 days ago WITH attendance decays to 50% (normal rate)", () => {
    // Has attendance → normal decay window: 100 days
    // fill = 1.0 * (1 - 50/100) = 0.50
    // attendance: 8/8 → portion = 70, remaining = 30
    // followup = round(30 * 0.50) = 15
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({
          meeting_weeks_in_window: 8,
          attended_weeks_in_window: 8,
          days_since_last_in_person: 50,
        }),
      ),
    ).toBe(85);
  });

  test("call 42 days ago with 2 consecutive misses", () => {
    // consecutive_missed: 2 → attendancePct = max(0, 100-30) = 70
    // portion = round(70*0.70) = 49, remaining = 51
    // Has attendance → normal decay: call fill = 0.75 * (1 - 42/85) ≈ 0.75 * 0.5059 ≈ 0.3794
    // followup = round(51 * 0.3794) = round(19.35) = 19
    // Total = 49 + 19 = 68
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({
          meeting_weeks_in_window: 8,
          attended_weeks_in_window: 6,
          consecutive_missed: 2,
          days_since_last_call: 42,
        }),
      ),
    ).toBe(68);
  });

  test("text 17 days ago, no attendance = 26 (2× faster decay)", () => {
    // consecutive_missed: 8 → attendancePct = 0, portion = 0, remaining = 100
    // No attendance → text decay window halved: 70 → 35 days
    // fill = 0.5 * (1 - 17/35) ≈ 0.5 * 0.514 ≈ 0.257
    // followup = round(100 * 0.257) = 26
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({
          meeting_weeks_in_window: 8,
          attended_weeks_in_window: 0,
          consecutive_missed: 8,
          days_since_last_text: 17,
        }),
      ),
    ).toBe(26);
  });

  test("text 35 days ago, no attendance fully decayed (2× faster)", () => {
    // consecutive_missed: 8 → attendancePct = 0, portion = 0, remaining = 100
    // No attendance → text decay window halved: 70 → 35 days
    // fill = 0.5 * (1 - 35/35) = 0
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({
          meeting_weeks_in_window: 8,
          attended_weeks_in_window: 0,
          consecutive_missed: 8,
          days_since_last_text: 35,
        }),
      ),
    ).toBe(0);
  });

  test("call 42.5 days ago, no attendance fully decayed (2× faster)", () => {
    // consecutive_missed: 8 → attendancePct = 0, portion = 0, remaining = 100
    // No attendance → call decay window halved: 85 → 42.5 days
    // fill = 0.75 * (1 - 42.5/42.5) = 0
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({
          meeting_weeks_in_window: 8,
          attended_weeks_in_window: 0,
          consecutive_missed: 8,
          days_since_last_call: 42.5,
        }),
      ),
    ).toBe(0);
  });
});

// ============================================================================
// sys_togather — Best channel wins
// ============================================================================

describe("sys_togather — best channel selection", () => {
  test("in-person beats call when both recent", () => {
    // in-person today = fill 1.0, call today = fill 0.75 → in-person wins
    const withInPerson = calculateSystemScore(
      "sys_togather",
      makeRaw({
        meeting_weeks_in_window: 8,
        attended_weeks_in_window: 4,
        consecutive_missed: 4,
        days_since_last_in_person: 0,
        days_since_last_call: 0,
      }),
    );
    const callOnly = calculateSystemScore(
      "sys_togather",
      makeRaw({
        meeting_weeks_in_window: 8,
        attended_weeks_in_window: 4,
        consecutive_missed: 4,
        days_since_last_call: 0,
      }),
    );
    expect(withInPerson).toBeGreaterThan(callOnly);
  });

  test("stale in-person loses to recent call", () => {
    // consecutive_missed: 4 → attendancePct = 40, portion = 28, remaining = 72
    // in-person 90 days ago: fill = 1.0 * (1 - 90/100) = 0.10
    // call today: fill = 0.75 → call wins
    // call wins: 28 + round(72 * 0.75) = 28 + 54 = 82
    const result = calculateSystemScore(
      "sys_togather",
      makeRaw({
        meeting_weeks_in_window: 8,
        attended_weeks_in_window: 4,
        consecutive_missed: 4,
        days_since_last_in_person: 90,
        days_since_last_call: 0,
      }),
    );
    expect(result).toBe(82);
  });

  test("stale call loses to recent text", () => {
    // consecutive_missed: 8 → attendancePct = 0, portion = 0, remaining = 100
    // decayMultiplier = 0.5 (no attendance)
    // call 80 days ago: fill = 0.75 * max(0, 1 - 80/42.5) = 0 (fully decayed)
    // text today: fill = 0.50 → text wins
    // 0 + round(100 * 0.50) = 50
    const result = calculateSystemScore(
      "sys_togather",
      makeRaw({
        meeting_weeks_in_window: 8,
        attended_weeks_in_window: 0,
        consecutive_missed: 8,
        days_since_last_call: 80,
        days_since_last_text: 0,
      }),
    );
    expect(result).toBe(50);
  });
});

// ============================================================================
// sys_togather — Service is NOT included
// ============================================================================

describe("sys_togather — service excluded", () => {
  test("serving a lot does not change connection score", () => {
    const withServing = calculateSystemScore(
      "sys_togather",
      makeRaw({
        meeting_weeks_in_window: 8,
        attended_weeks_in_window: 4,
        consecutive_missed: 4,
        pco_services_past_2mo: 10,
      }),
    );
    const withoutServing = calculateSystemScore(
      "sys_togather",
      makeRaw({
        meeting_weeks_in_window: 8,
        attended_weeks_in_window: 4,
        consecutive_missed: 4,
        pco_services_past_2mo: 0,
      }),
    );
    expect(withServing).toBe(withoutServing);
  });
});

// ============================================================================
// sys_togather — No follow-up data (sentinel values)
// ============================================================================

describe("sys_togather — no follow-up data", () => {
  test("all follow-up fields at sentinel value = attendance only", () => {
    const result = calculateSystemScore(
      "sys_togather",
      makeRaw({
        meeting_weeks_in_window: 8,
        attended_weeks_in_window: 8,
        days_since_last_in_person: 9999,
        days_since_last_call: 9999,
        days_since_last_text: 9999,
      }),
    );
    expect(result).toBe(70);
  });

  test("no attendance + no follow-up = 0", () => {
    // consecutive_missed: 8 → attendancePct = 0, portion = 0
    // All follow-up at sentinel → 0
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({
          meeting_weeks_in_window: 8,
          attended_weeks_in_window: 0,
          consecutive_missed: 8,
          days_since_last_in_person: 9999,
          days_since_last_call: 9999,
          days_since_last_text: 9999,
        }),
      ),
    ).toBe(0);
  });
});

// ============================================================================
// sys_togather — The follow-up space scales with missed attendance
// ============================================================================

describe("sys_togather — follow-up space scales inversely with attendance", () => {
  test("lower attendance gives follow-up more room to fill", () => {
    const perfectAttendInPersonToday = calculateSystemScore(
      "sys_togather",
      makeRaw({
        meeting_weeks_in_window: 8,
        attended_weeks_in_window: 8,
        consecutive_missed: 0,
        days_since_last_in_person: 0,
      }),
    );
    const poorAttendInPersonToday = calculateSystemScore(
      "sys_togather",
      makeRaw({
        meeting_weeks_in_window: 8,
        attended_weeks_in_window: 0,
        consecutive_missed: 8,
        days_since_last_in_person: 0,
      }),
    );
    // Both should be 100 — in-person today fills all remaining space
    expect(perfectAttendInPersonToday).toBe(100);
    expect(poorAttendInPersonToday).toBe(100);

    // But with a decayed follow-up, attendance matters more
    const perfectAttendStaleCall = calculateSystemScore(
      "sys_togather",
      makeRaw({
        meeting_weeks_in_window: 8,
        attended_weeks_in_window: 8,
        consecutive_missed: 0,
        days_since_last_call: 50,
      }),
    );
    const poorAttendStaleCall = calculateSystemScore(
      "sys_togather",
      makeRaw({
        meeting_weeks_in_window: 8,
        attended_weeks_in_window: 0,
        consecutive_missed: 8,
        days_since_last_call: 50,
      }),
    );
    // Perfect attend has higher base but less room for call
    // Poor attend has no base but more room for call (but 2x faster decay)
    expect(perfectAttendStaleCall).toBeGreaterThan(poorAttendStaleCall);
  });
});

// ============================================================================
// sys_togather — Edge cases
// ============================================================================

describe("sys_togather — edge cases", () => {
  test("attended more weeks than meeting weeks (data anomaly) = 70", () => {
    // Should not happen, but be resilient — missedWeeks clamped to 0
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({ meeting_weeks_in_window: 3, attended_weeks_in_window: 5 }),
      ),
    ).toBe(70);
  });

  test("score never exceeds 100", () => {
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({
          meeting_weeks_in_window: 8,
          attended_weeks_in_window: 8,
          days_since_last_in_person: 0,
          days_since_last_call: 0,
          days_since_last_text: 0,
        }),
      ),
    ).toBeLessThanOrEqual(100);
  });

  test("score never goes below 0", () => {
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({
          meeting_weeks_in_window: 8,
          attended_weeks_in_window: 0,
          consecutive_missed: 8,
          days_since_last_in_person: 200,
          days_since_last_call: 200,
          days_since_last_text: 200,
        }),
      ),
    ).toBeGreaterThanOrEqual(0);
  });

  test("negative meeting weeks treated as 0 → score 0", () => {
    expect(
      calculateSystemScore(
        "sys_togather",
        makeRaw({ meeting_weeks_in_window: -1 }),
      ),
    ).toBe(0);
  });
});

// ============================================================================
// calculateAllSystemScores
// ============================================================================

describe("calculateAllSystemScores", () => {
  test("returns all three scores keyed by slot", () => {
    const raw = makeRaw({
      pco_services_past_2mo: 3,
      attended_weeks_in_window: 6,
      total_weeks_in_window: 8,
      meeting_weeks_in_window: 8,
      consecutive_missed: 2,
      days_since_last_in_person: 0,
    });
    const scores = calculateAllSystemScores(raw);

    expect(scores.score1).toBe(60); // 3 * 20
    expect(scores.score2).toBe(75); // 6/8 * 100
    expect(scores.score3).toBe(100); // consecutive_missed=2 → portion=49, remaining=51, in-person today fills all
  });
});

// ============================================================================
// extractSystemRawValues
// ============================================================================

describe("extractSystemRawValues", () => {
  test("maps parameter names correctly", () => {
    const raw = extractSystemRawValues({
      crossGroupAttendancePct: 75,
      consecutiveMissed: 2,
      attendedWeeksInWindow: 6,
      totalWeeksInWindow: 8,
      meetingWeeksInWindow: 7,
      daysSinceLastFollowup: 5,
      daysSinceLastInPerson: 10,
      daysSinceLastCall: 20,
      daysSinceLastText: 3,
      pcoServicesCount: 4,
    });

    expect(raw.attendance_all_groups_pct).toBe(75);
    expect(raw.consecutive_missed).toBe(2);
    expect(raw.attended_weeks_in_window).toBe(6);
    expect(raw.total_weeks_in_window).toBe(8);
    expect(raw.meeting_weeks_in_window).toBe(7);
    expect(raw.days_since_last_followup).toBe(5);
    expect(raw.days_since_last_in_person).toBe(10);
    expect(raw.days_since_last_call).toBe(20);
    expect(raw.days_since_last_text).toBe(3);
    expect(raw.pco_services_past_2mo).toBe(4);
  });

  test("caps Infinity values to 9999", () => {
    const raw = extractSystemRawValues({
      crossGroupAttendancePct: 0,
      consecutiveMissed: 0,
      attendedWeeksInWindow: 0,
      totalWeeksInWindow: 0,
      meetingWeeksInWindow: 0,
      daysSinceLastFollowup: Infinity,
      daysSinceLastInPerson: Infinity,
      daysSinceLastCall: Infinity,
      daysSinceLastText: Infinity,
      pcoServicesCount: 0,
    });

    expect(raw.days_since_last_followup).toBe(9999);
    expect(raw.days_since_last_in_person).toBe(9999);
    expect(raw.days_since_last_call).toBe(9999);
    expect(raw.days_since_last_text).toBe(9999);
  });
});

// ============================================================================
// evaluateSystemAlerts
// ============================================================================

describe("evaluateSystemAlerts", () => {
  test("no alerts configured = empty array", () => {
    expect(evaluateSystemAlerts(makeRaw())).toEqual([]);
    expect(evaluateSystemAlerts(makeRaw(), [])).toEqual([]);
  });

  test("fires 'below' alert when value is under threshold", () => {
    const alerts = evaluateSystemAlerts(
      makeRaw({ attendance_all_groups_pct: 20 }),
      [{ id: "a1", variableId: "attendance_all_groups_pct", operator: "below", threshold: 50 }],
    );
    expect(alerts).toHaveLength(1);
  });

  test("does not fire 'below' alert when value meets threshold", () => {
    const alerts = evaluateSystemAlerts(
      makeRaw({ attendance_all_groups_pct: 60 }),
      [{ id: "a1", variableId: "attendance_all_groups_pct", operator: "below", threshold: 50 }],
    );
    expect(alerts).toHaveLength(0);
  });

  test("fires 'above' alert when value exceeds threshold", () => {
    const alerts = evaluateSystemAlerts(
      makeRaw({ consecutive_missed: 5 }),
      [{ id: "a1", variableId: "consecutive_missed", operator: "above", threshold: 3 }],
    );
    expect(alerts).toHaveLength(1);
  });

  test("uses custom label when provided", () => {
    const alerts = evaluateSystemAlerts(
      makeRaw({ consecutive_missed: 5 }),
      [{ id: "a1", variableId: "consecutive_missed", operator: "above", threshold: 3, label: "Needs visit" }],
    );
    expect(alerts[0]).toBe("Needs visit");
  });

  test("unknown variable is skipped", () => {
    const alerts = evaluateSystemAlerts(
      makeRaw(),
      [{ id: "a1", variableId: "nonexistent_var", operator: "above", threshold: 0 }],
    );
    expect(alerts).toHaveLength(0);
  });
});

// ============================================================================
// Unknown score ID
// ============================================================================

describe("unknown score ID", () => {
  test("returns 0 for unrecognized score ID", () => {
    expect(calculateSystemScore("sys_unknown", makeRaw())).toBe(0);
  });
});
