/**
 * System Scores Engine
 *
 * Defines 3 fixed system-level scores that replace per-group custom score configurations.
 * These scores are computed at the community level (across all groups).
 *
 * Score slots:
 *   score1 = Service (PCO serving frequency)
 *   score2 = Attendance (cross-group attendance %)
 *   score3 = Togather (composite engagement score)
 */

// ============================================================================
// Types
// ============================================================================

export interface SystemScoreDefinition {
  id: string;
  slot: "score1" | "score2" | "score3";
  name: string;
  description: string;
}

export interface SystemRawValues {
  // Attendance
  attendance_all_groups_pct: number;
  consecutive_missed: number;

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
  },
  {
    id: "sys_attendance",
    slot: "score2",
    name: "Attendance",
    description: "Attendance percentage across all groups in the community",
  },
  {
    id: "sys_togather",
    slot: "score3",
    name: "Togather",
    description:
      "Composite engagement score combining attendance consistency and followup recency",
  },
];

export const SYSTEM_SCORE_BY_ID = Object.fromEntries(
  SYSTEM_SCORES.map((s) => [s.id, s])
) as Record<string, SystemScoreDefinition>;

export const SYSTEM_SCORE_BY_SLOT = Object.fromEntries(
  SYSTEM_SCORES.map((s) => [s.slot, s])
) as Record<string, SystemScoreDefinition>;

// ============================================================================
// Score Calculation
// ============================================================================

/**
 * Calculate the 0-100 score for a single system score by ID.
 *
 * - `sys_service`: 20 points per PCO service in the past 2 months, max 100 at 5+.
 * - `sys_attendance`: Direct attendance percentage across all groups, clamped 0-100.
 * - `sys_togather`: Composite of attendance consistency (consecutive misses penalty)
 *   and best followup recency (face-to-face > call > text), averaged equally.
 *
 * @param scoreId - One of "sys_service", "sys_attendance", or "sys_togather"
 * @param rawValues - The raw metric values for the member
 * @returns Score from 0 to 100, or 0 if the scoreId is unrecognized
 */
export function calculateSystemScore(
  scoreId: string,
  rawValues: SystemRawValues
): number {
  switch (scoreId) {
    case "sys_service":
      return Math.min(100, rawValues.pco_services_past_2mo * 20);

    case "sys_attendance":
      return Math.round(
        Math.max(0, Math.min(100, rawValues.attendance_all_groups_pct))
      );

    case "sys_togather": {
      // Attendance component: penalize consecutive misses at -15 per miss
      const attendanceComponent = Math.max(
        0,
        100 - 15 * rawValues.consecutive_missed
      );

      // Followup component: best of face-to-face, call, or text recency
      // Each channel has a different ceiling reflecting its engagement value
      const NO_DATA_THRESHOLD = 1000;
      const hasFollowupData =
        rawValues.days_since_last_in_person < NO_DATA_THRESHOLD ||
        rawValues.days_since_last_call < NO_DATA_THRESHOLD ||
        rawValues.days_since_last_text < NO_DATA_THRESHOLD;

      let followupComponent = 0;
      if (hasFollowupData) {
        const faceToFace = Math.max(
          0,
          100 - rawValues.days_since_last_in_person
        );
        const phoneCall = Math.max(0, 85 - rawValues.days_since_last_call);
        const text = Math.max(0, 70 - rawValues.days_since_last_text);
        followupComponent = Math.max(faceToFace, phoneCall, text);
      }

      return Math.round((attendanceComponent + followupComponent) / 2);
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
 * Evaluate hardcoded alert thresholds against raw values.
 *
 * Returns human-readable alert labels for any triggered conditions:
 * - `"3+ missed"` — 3 or more consecutive meetings missed
 * - `"No followup 14d+"` — no followup action in 14+ days (but not if never followed up)
 * - `"Low service"` — zero PCO services in the past 2 months
 * - `"Inactive"` — attendance below 10% AND no followup in 30+ days
 *
 * @param rawValues - The raw metric values for the member
 * @returns Array of triggered alert label strings (may be empty)
 */
export function evaluateSystemAlerts(rawValues: SystemRawValues): string[] {
  const alerts: string[] = [];

  if (rawValues.consecutive_missed >= 3) {
    alerts.push("3+ missed");
  }

  if (
    rawValues.days_since_last_followup >= 14 &&
    rawValues.days_since_last_followup < 9999
  ) {
    alerts.push("No followup 14d+");
  }

  if (rawValues.pco_services_past_2mo === 0) {
    alerts.push("Low service");
  }

  if (
    rawValues.attendance_all_groups_pct < 10 &&
    rawValues.days_since_last_followup >= 30
  ) {
    alerts.push("Inactive");
  }

  return alerts;
}
