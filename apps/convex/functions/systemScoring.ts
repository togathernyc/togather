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
 * who need outreach. Recent 1:1 follow-up is the dominant factor.
 *
 * Formula:
 * - Base engagement (attendance 70% + service 30%) provides a foundation, capped at 70%.
 * - Follow-up recency (in-person=100, call=85, text=70, decaying 1pt/day) is the
 *   primary driver. A recent follow-up alone produces a high score.
 * - No follow-up data at all: score = base * 0.70 (max 70).
 * - With follow-up: score = followupRecency + up to 15pt bonus from base engagement.
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
      "How well leaders are connecting with this person. A recent follow-up alone produces a high score. Attendance and service provide a small bonus, but cap at 70% without follow-up. Use this to triage who needs outreach.",
    variables: [
      {
        variableId: "days_since_last_in_person",
        label: "Days since in-person",
        normHint: "In-person follow-up: starts at 100, -1/day",
        weight: 0.7,
      },
      {
        variableId: "days_since_last_call",
        label: "Days since call",
        normHint: "Phone call: starts at 85, -1/day",
        weight: 0.7,
      },
      {
        variableId: "days_since_last_text",
        label: "Days since text",
        normHint: "Text message: starts at 70, -1/day",
        weight: 0.7,
      },
      {
        variableId: "attendance_all_groups_pct",
        label: "Attendance %",
        normHint: "Cross-group attendance, 70% of base engagement",
        weight: 0.3,
      },
      {
        variableId: "pco_services_past_2mo",
        label: "Service (2 months)",
        normHint: "Serving frequency, 30% of base engagement",
        weight: 0.3,
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
 * - `sys_togather`: Composite of attendance consistency (consecutive misses penalty)
 *   and best followup recency (face-to-face > call > text), averaged equally.
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
      // Base engagement: attendance (70%) + service (30%), 0-100
      const attendancePct = Math.max(
        0,
        Math.min(100, rawValues.attendance_all_groups_pct),
      );
      const servicePct = Math.min(
        100,
        rawValues.pco_services_past_2mo * 20,
      );
      const baseEngagement = attendancePct * 0.7 + servicePct * 0.3;

      // Follow-up recency: best channel (each with different ceiling)
      // In-person=100, call=85, text=70, each decaying 1pt/day
      const NO_DATA_THRESHOLD = 1000;
      const hasFollowupData =
        rawValues.days_since_last_in_person < NO_DATA_THRESHOLD ||
        rawValues.days_since_last_call < NO_DATA_THRESHOLD ||
        rawValues.days_since_last_text < NO_DATA_THRESHOLD;

      if (!hasFollowupData) {
        // No follow-up data: score driven by base engagement, capped at 70
        return Math.round(Math.min(baseEngagement * 0.7, 70));
      }

      const faceToFace = Math.max(
        0,
        100 - rawValues.days_since_last_in_person,
      );
      const phoneCall = Math.max(0, 85 - rawValues.days_since_last_call);
      const text = Math.max(0, 70 - rawValues.days_since_last_text);
      const followupRecency = Math.max(faceToFace, phoneCall, text);

      if (followupRecency === 0) {
        // Follow-up data exists but all channels are stale: cap at 70
        return Math.round(Math.min(baseEngagement * 0.7, 70));
      }

      // Follow-up recency is the primary signal. A recent follow-up alone
      // should produce a high score even with zero attendance/service.
      // Base engagement adds a small bonus on top.
      // Floor: followupRecency itself (e.g. in-person today = 100)
      // Bonus: up to 15 points from base engagement
      const baseBonus = baseEngagement * 0.15;
      return Math.round(
        Math.min(Math.max(followupRecency, followupRecency + baseBonus), 100),
      );
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
