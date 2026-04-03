/**
 * System Scores Engine
 *
 * Defines 3 fixed system-level scores that replace per-group custom score configurations.
 * These scores are computed at the community level (across all groups).
 *
 * Score slots:
 *   score1 = Service (PCO serving frequency)
 *   score2 = Attendance (cross-group attendance %)
 *   score3 = Connection (leader outreach effectiveness — the primary triage score)
 *
 * Connection Score Philosophy:
 * The connection score reflects how well leaders are connecting with each member,
 * NOT the member's own engagement. It's a triage tool: low scores surface people
 * who need outreach.
 *
 * Formula (0-100):
 *   1. attendance_pct = max(0, 100 − consecutive_missed × 15)
 *      (If no meetings exist in window → score is 0; nothing to evaluate)
 *      Attended last meeting → 0 consecutive misses → full 70 pts
 *      Missed 7+ in a row → 0 pts
 *   2. attendance_portion = 70 × (attendance_pct / 100)       → 0-70 points
 *   3. remaining = 100 − attendance_portion                   → 30-100 points
 *   4. Follow-up fills the remaining space based on channel + recency:
 *        In-person: 100% of remaining, decays over ~100 days (~50 days if 0 attendance)
 *        Call:       75% of remaining, decays over ~85 days  (~42 days if 0 attendance)
 *        Text:       50% of remaining, decays over ~70 days  (~35 days if 0 attendance)
 *   5. total = attendance_portion + followup_portion           → 0-100
 */

// ============================================================================
// Types
// ============================================================================

export interface SystemScoreVariable {
  variableId: string;
  label: string;
  normHint: string;
  weight: number;
}

export interface SystemScoreDefinition {
  id: string;
  slot: "score1" | "score2" | "score3";
  name: string;
  description: string;
  /** Variables that feed into this score, shown in the breakdown panel */
  variables?: SystemScoreVariable[];
}

export interface SystemRawValues {
  // Attendance
  attendance_all_groups_pct: number;
  consecutive_missed: number;
  attended_weeks_in_window: number;
  total_weeks_in_window: number;
  /** Weeks that actually had meetings (subset of total_weeks_in_window) */
  meeting_weeks_in_window: number;

  // Followup recency
  days_since_last_followup: number;
  days_since_last_in_person: number;
  days_since_last_call: number;
  days_since_last_text: number;

  // PCO Serving
  pco_services_past_2mo: number;
}

// ============================================================================
// Score Definitions
// ============================================================================

export const SYSTEM_SCORES: SystemScoreDefinition[] = [
  {
    id: "sys_service",
    slot: "score1",
    name: "Service",
    description:
      "PCO serving frequency in past 2 months (20pts per service, max 100)",
    variables: [
      {
        variableId: "pco_services_past_2mo",
        label: "Services (2 months)",
        normHint: "20 points per service, max 100 at 5+",
        weight: 1,
      },
    ],
  },
  {
    id: "sys_attendance",
    slot: "score2",
    name: "Attendance",
    description:
      "Percentage of weeks with at least one attendance in the last 60 days (adjusted for join date)",
    variables: [
      {
        variableId: "attended_weeks_in_window",
        label: "Weeks attended",
        normHint: "Number of weeks with at least one attendance",
        weight: 1,
      },
      {
        variableId: "total_weeks_in_window",
        label: "Total weeks",
        normHint: "Total weeks in 60-day window (adjusted for join date)",
        weight: 1,
      },
    ],
  },
  {
    id: "sys_togather",
    slot: "score3",
    name: "Connection",
    description:
      "How well leaders are connecting with this person. Attendance provides a base (max 70pts, -15 per missed week). Follow-up fills the rest: the lower the attendance, the more follow-up matters. Use this to triage who needs outreach.",
    variables: [
      {
        variableId: "meeting_weeks_in_window",
        label: "Weeks with meetings",
        normHint: "Weeks in the past 2 months that had meetings (adjusted for join date)",
        weight: 1,
      },
      {
        variableId: "attended_weeks_in_window",
        label: "Weeks attended",
        normHint: "Weeks where member had at least one attendance",
        weight: 1,
      },
      {
        variableId: "days_since_last_in_person",
        label: "Days since in-person",
        normHint: "In-person follow-up: fills 100% of remaining, decays over ~100 days (~50 if no attendance)",
        weight: 1,
      },
      {
        variableId: "days_since_last_call",
        label: "Days since call",
        normHint: "Phone call: fills 75% of remaining, decays over ~85 days (~42 if no attendance)",
        weight: 0.75,
      },
      {
        variableId: "days_since_last_text",
        label: "Days since text",
        normHint: "Text message: fills 50% of remaining, decays over ~70 days (~35 if no attendance)",
        weight: 0.5,
      },
    ],
  },
];

export const SYSTEM_SCORE_BY_ID = Object.fromEntries(
  SYSTEM_SCORES.map((s) => [s.id, s]),
) as Record<string, SystemScoreDefinition>;

export const SYSTEM_SCORE_BY_SLOT = Object.fromEntries(
  SYSTEM_SCORES.map((s) => [s.slot, s]),
) as Record<string, SystemScoreDefinition>;

/**
 * Set of variable IDs valid for community-level alerts.
 * These must match the keys of SystemRawValues.
 */
export const SYSTEM_VARIABLE_IDS: ReadonlySet<string> = new Set([
  "attendance_all_groups_pct",
  "consecutive_missed",
  "attended_weeks_in_window",
  "total_weeks_in_window",
  "meeting_weeks_in_window",
  "days_since_last_followup",
  "days_since_last_in_person",
  "days_since_last_call",
  "days_since_last_text",
  "pco_services_past_2mo",
]);

// ============================================================================
// Score Calculation
// ============================================================================

/**
 * Calculate the 0-100 score for a single system score by ID.
 *
 * - `sys_service`: 20 points per PCO service in the past 2 months, max 100 at 5+.
 * - `sys_attendance`: Percentage of weeks (in a join-date-adjusted 60-day window) with ≥1 attendance.
 * - `sys_togather`: Consecutive misses (0-70pts, -15 per consecutive missed meeting)
 *   + Follow-up (fills remaining: in-person=100%, call=75%, text=50%, decaying over time).
 *
 * @param scoreId - One of "sys_service", "sys_attendance", or "sys_togather"
 * @param rawValues - The raw metric values for the member
 * @returns Score from 0 to 100, or 0 if the scoreId is unrecognized
 */
export function calculateSystemScore(
  scoreId: string,
  rawValues: SystemRawValues,
): number {
  switch (scoreId) {
    case "sys_service":
      return Math.min(100, rawValues.pco_services_past_2mo * 20);

    case "sys_attendance": {
      const totalWeeks = rawValues.total_weeks_in_window;
      if (totalWeeks <= 0) return 0;
      return Math.round(
        Math.max(
          0,
          Math.min(
            100,
            (rawValues.attended_weeks_in_window / totalWeeks) * 100,
          ),
        ),
      );
    }

    case "sys_togather": {
      // ── Attendance portion: 0-70 points ──
      // Based on consecutive missed meetings from the most recent one.
      // Attending the latest meeting resets to full credit (70 pts).
      // Each consecutive miss deducts 15 pct-points; 7+ misses → 0.
      // If no meetings existed in the window, score is 0 — nothing to evaluate.
      const meetingWeeks = rawValues.meeting_weeks_in_window;
      const attendedWeeks = rawValues.attended_weeks_in_window;
      if (meetingWeeks <= 0) return 0;
      // If zero attendance, attendance portion is 0 — score depends entirely on follow-up.
      // Consecutive-miss decay only applies when the member has attended at least once.
      let attendancePortion: number;
      if (attendedWeeks === 0) {
        attendancePortion = 0;
      } else {
        const consecutiveMissed = rawValues.consecutive_missed;
        const attendancePct = Math.max(0, 100 - consecutiveMissed * 15);
        attendancePortion = Math.round(70 * (attendancePct / 100));
      }

      // ── Follow-up portion: fills remaining space (100 - attendancePortion) ──
      // Channel fill rate (decaying over time):
      //   In-person: 100% of remaining, decays over ~100 days
      //   Call:       75% of remaining, decays over ~85 days
      //   Text:       50% of remaining, decays over ~70 days
      // When the member has ZERO attendance, decay is 2× faster (halved windows)
      // to reflect urgency — no attendance + stale follow-up = needs outreach soon.
      const remaining = 100 - attendancePortion;
      const NO_DATA_THRESHOLD = 1000;
      const decayMultiplier = attendedWeeks === 0 ? 0.5 : 1;

      const inPersonFill =
        rawValues.days_since_last_in_person < NO_DATA_THRESHOLD
          ? 1.0 * Math.max(0, 1 - rawValues.days_since_last_in_person / (100 * decayMultiplier))
          : 0;
      const callFill =
        rawValues.days_since_last_call < NO_DATA_THRESHOLD
          ? 0.75 * Math.max(0, 1 - rawValues.days_since_last_call / (85 * decayMultiplier))
          : 0;
      const textFill =
        rawValues.days_since_last_text < NO_DATA_THRESHOLD
          ? 0.5 * Math.max(0, 1 - rawValues.days_since_last_text / (70 * decayMultiplier))
          : 0;

      const bestFill = Math.max(inPersonFill, callFill, textFill);
      const followupPortion = Math.round(remaining * bestFill);

      return Math.min(attendancePortion + followupPortion, 100);
    }

    default:
      return 0;
  }
}

/**
 * Calculate all 3 system scores at once.
 *
 * Returns an object keyed by slot name (score1, score2, score3) ready for
 * direct use in a `communityPeople` upsert.
 *
 * @param rawValues - The raw metric values for the member
 * @returns Object with score1, score2, score3 values (each 0-100)
 */
export function calculateAllSystemScores(rawValues: SystemRawValues): {
  score1: number;
  score2: number;
  score3: number;
} {
  return {
    score1: calculateSystemScore("sys_service", rawValues),
    score2: calculateSystemScore("sys_attendance", rawValues),
    score3: calculateSystemScore("sys_togather", rawValues),
  };
}

// ============================================================================
// Raw Value Extraction
// ============================================================================

/**
 * Map external parameter names into a `SystemRawValues` object.
 *
 * Converts `Infinity` values to 9999 for safe JSON serialization (Convex
 * documents cannot store `Infinity`).
 *
 * @param params - Named parameters from the scoring pipeline
 * @returns A `SystemRawValues` object ready for score calculation
 */
export function extractSystemRawValues(params: {
  crossGroupAttendancePct: number;
  consecutiveMissed: number;
  attendedWeeksInWindow: number;
  totalWeeksInWindow: number;
  meetingWeeksInWindow: number;
  daysSinceLastFollowup: number;
  daysSinceLastInPerson: number;
  daysSinceLastCall: number;
  daysSinceLastText: number;
  pcoServicesCount: number;
}): SystemRawValues {
  const cap = (v: number) => (Number.isFinite(v) ? v : 9999);

  return {
    attendance_all_groups_pct: params.crossGroupAttendancePct,
    consecutive_missed: params.consecutiveMissed,
    attended_weeks_in_window: params.attendedWeeksInWindow,
    total_weeks_in_window: params.totalWeeksInWindow,
    meeting_weeks_in_window: params.meetingWeeksInWindow,
    days_since_last_followup: cap(params.daysSinceLastFollowup),
    days_since_last_in_person: cap(params.daysSinceLastInPerson),
    days_since_last_call: cap(params.daysSinceLastCall),
    days_since_last_text: cap(params.daysSinceLastText),
    pco_services_past_2mo: params.pcoServicesCount,
  };
}

// ============================================================================
// Alert Evaluation
// ============================================================================

/**
 * Evaluate custom community alert thresholds against raw values.
 *
 * @param rawValues - The raw metric values for the member
 * @param customAlerts - Community-configured alert rules
 * @returns Array of triggered alert label strings (may be empty)
 */
export function evaluateSystemAlerts(
  rawValues: SystemRawValues,
  customAlerts?: Array<{
    id: string;
    variableId: string;
    operator: string;
    threshold: number;
    label?: string;
  }>,
): string[] {
  const alerts: string[] = [];

  if (customAlerts && customAlerts.length > 0) {
    const rawMap = rawValues as unknown as Record<string, number>;
    for (const alert of customAlerts) {
      const raw = rawMap[alert.variableId];
      if (raw === undefined) continue;
      const fired =
        alert.operator === "above"
          ? raw > alert.threshold
          : raw < alert.threshold;
      if (fired) {
        alerts.push(
          alert.label ||
            `${alert.variableId} ${alert.operator === "above" ? "high" : "low"}`,
        );
      }
    }
  }

  return alerts;
}
