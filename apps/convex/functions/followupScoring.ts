/**
 * Configurable Follow-up Scoring Engine
 *
 * Provides a variable registry with built-in normalization and a generic
 * weighted-average score calculator. Group admins can define up to 4 custom
 * scores using any combination of available variables.
 *
 * When no custom config exists, the default behavior matches the original
 * hardcoded Attendance + Connection scores exactly.
 */

import { v } from "convex/values";
import { query } from "../_generated/server";

// ============================================================================
// Types
// ============================================================================

export interface VariableDefinition {
  id: string;
  label: string;
  description: string;
  /** Short explanation of how raw values map to 0-100 */
  normHint: string;
  category: "attendance" | "followup" | "serving";
  /** Normalize raw value to 0-100 scale */
  normalize: (raw: number) => number;
}

export interface ScoreDefinition {
  id: string;
  name: string;
  variables: Array<{
    variableId: string;
    weight: number;
  }>;
}

export interface AlertDefinition {
  id: string;
  variableId: string;
  operator: string; // "above" | "below"
  threshold: number;
  label?: string;
}

export interface ScoreConfig {
  scores: ScoreDefinition[];
  alerts?: AlertDefinition[];
}

// ============================================================================
// Variable Registry
// ============================================================================

/**
 * All available scoring variables.
 * Adding a new variable = add an entry here + deploy. No DB migration needed.
 */
export const VARIABLE_REGISTRY: VariableDefinition[] = [
  {
    id: "attendance_pct",
    label: "Attendance %",
    description: "Percentage of meetings attended (0-100)",
    normHint: "Direct percentage, 0-100%",
    category: "attendance",
    normalize: (raw) => Math.max(0, Math.min(100, raw)),
  },
  {
    id: "consecutive_missed",
    label: "Consecutive Missed",
    description: "Penalizes consecutive missed meetings from most recent",
    normHint: "Starts at 100, -15 per consecutive miss",
    category: "attendance",
    normalize: (raw) => Math.max(0, 100 - raw * 15),
  },
  {
    id: "days_since_last_followup",
    label: "Days Since Follow-up",
    description: "Recency of any follow-up action (call, text, in-person)",
    normHint: "Starts at 100, -1 per day since last follow-up",
    category: "followup",
    normalize: (raw) => Math.max(0, 100 - raw),
  },
  {
    id: "days_since_last_text",
    label: "Days Since Text",
    description: "Recency of last text message follow-up",
    normHint: "Starts at 100, -1 per day since last text",
    category: "followup",
    normalize: (raw) => Math.max(0, 100 - raw),
  },
  {
    id: "days_since_last_call",
    label: "Days Since Call",
    description: "Recency of last phone call follow-up",
    normHint: "Starts at 100, -1 per day since last call",
    category: "followup",
    normalize: (raw) => Math.max(0, 100 - raw),
  },
  {
    id: "days_since_last_in_person",
    label: "Days Since In-Person",
    description: "Recency of last in-person follow-up",
    normHint: "Starts at 100, -1 per day since last visit",
    category: "followup",
    normalize: (raw) => Math.max(0, 100 - raw),
  },
  {
    id: "attendance_streak",
    label: "Attendance Streak",
    description: "Pre-computed attendance portion from the connection formula",
    normHint: "100 when attending, -10 per consecutive miss",
    category: "attendance",
    normalize: (raw) => Math.max(0, Math.min(100, raw)),
  },
  {
    id: "followup_recency",
    label: "Follow-up Recency",
    description: "Pre-computed follow-up portion from the connection formula",
    normHint: "Based on best recent follow-up, decays over time",
    category: "followup",
    normalize: (raw) => Math.max(0, Math.min(100, raw)),
  },
  // Cross-group attendance — computed from all groups the member belongs to
  {
    id: "attendance_all_groups_pct",
    label: "All Groups Attendance %",
    description: "Attendance percentage across all groups (0-100)",
    normHint: "Direct percentage, 0-100%",
    category: "attendance",
    normalize: (raw) => Math.max(0, Math.min(100, raw)),
  },
  // PCO Serving variable — populated from chatChannelMembers sync history
  {
    id: "pco_services_past_2mo",
    label: "Services (2mo)",
    description: "Number of times served in the past 2 months via PCO",
    normHint: "20 points per service, max 100 at 5+",
    category: "serving",
    // 0 services = 0, 1 = 20, 2 = 40, 3 = 60, 4 = 80, 5+ = 100
    normalize: (raw) => Math.min(100, raw * 20),
  },
];

/** Lookup map for fast access */
export const VARIABLE_MAP = new Map(VARIABLE_REGISTRY.map((v) => [v.id, v]));

// ============================================================================
// Default Score Config (matches original hardcoded behavior)
// ============================================================================

/**
 * The default config used when group.followupScoreConfig is undefined.
 * These use special variable IDs that signal the scoring engine to use
 * the original calculateAttendanceScore / calculateConnectionScore functions.
 */
export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  scores: [
    {
      id: "default_attendance",
      name: "Attendance",
      variables: [{ variableId: "attendance_pct", weight: 1 }],
    },
    {
      id: "default_connection",
      name: "Connection",
      variables: [
        { variableId: "attendance_streak", weight: 1 },
        { variableId: "followup_recency", weight: 1 },
      ],
    },
  ],
};

// ============================================================================
// Raw Value Extraction
// ============================================================================

interface MeetingData {
  wasPresent: boolean;
  scheduledAt: number;
}

interface FollowupData {
  type: string;
  createdAt: number;
}

/**
 * PCO serving data for a single member, built from chatChannelMembers sync history.
 */
export interface PcoServingData {
  /** Number of services in the past 2 months */
  servicesPast2Months: number;
}

/**
 * Extract raw values for all variables from member data.
 * Returns a Record<variableId, rawValue>.
 */
export function extractRawValues(
  meetings: MeetingData[],
  followups: FollowupData[],
  isSnoozed: boolean,
  currentTime: number,
  connectionScoreParts?: { attendancePortion: number; followupPortion: number },
  pcoServing?: PcoServingData,
  crossGroupAttendancePct?: number,
): Record<string, number> {
  const values: Record<string, number> = {};
  const DAY_MS = 24 * 60 * 60 * 1000;

  // attendance_pct
  if (meetings.length > 0) {
    const attended = meetings.filter((m) => m.wasPresent).length;
    values.attendance_pct = Math.round((attended / meetings.length) * 100);
  } else {
    values.attendance_pct = 0;
  }

  // consecutive_missed
  let consecutiveMissed = 0;
  for (const meeting of meetings) {
    if (meeting.wasPresent) break;
    consecutiveMissed++;
  }
  values.consecutive_missed = consecutiveMissed;

  // Days since various follow-up types
  const lastFollowup = followups[0];
  values.days_since_last_followup = lastFollowup
    ? Math.floor((currentTime - lastFollowup.createdAt) / DAY_MS)
    : 999;

  const lastText = followups.find((f) => f.type === "text");
  values.days_since_last_text = lastText
    ? Math.floor((currentTime - lastText.createdAt) / DAY_MS)
    : 999;

  const lastCall = followups.find((f) => f.type === "call");
  values.days_since_last_call = lastCall
    ? Math.floor((currentTime - lastCall.createdAt) / DAY_MS)
    : 999;

  const lastInPerson = followups.find((f) => f.type === "followed_up");
  values.days_since_last_in_person = lastInPerson
    ? Math.floor((currentTime - lastInPerson.createdAt) / DAY_MS)
    : 999;

  // Pre-computed connection formula parts
  if (connectionScoreParts) {
    values.attendance_streak = connectionScoreParts.attendancePortion;
    values.followup_recency = connectionScoreParts.followupPortion;
  } else {
    values.attendance_streak = 0;
    values.followup_recency = 0;
  }

  // Cross-group attendance — only set when actually computed (detail view),
  // so alerts on this variable are skipped in list view where it's unavailable
  if (crossGroupAttendancePct !== undefined) {
    values.attendance_all_groups_pct = crossGroupAttendancePct;
  }

  // PCO Serving variable
  values.pco_services_past_2mo = pcoServing?.servicesPast2Months ?? 0;

  return values;
}

// ============================================================================
// Score Calculator
// ============================================================================

/**
 * Calculate a single score from a score definition and raw values.
 * Formula: Σ(normalize(rawValue) × weight) / Σ(weights) → 0-100
 */
export function calculateConfigurableScore(
  scoreDefinition: ScoreDefinition,
  rawValues: Record<string, number>
): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const { variableId, weight } of scoreDefinition.variables) {
    const variable = VARIABLE_MAP.get(variableId);
    if (!variable) continue;

    const rawValue = rawValues[variableId] ?? 0;
    const normalized = variable.normalize(rawValue);
    weightedSum += normalized * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;
  return Math.round(weightedSum / totalWeight);
}

/**
 * Calculate all scores for a member given a config and raw values.
 * Returns Record<scoreId, scoreValue>.
 */
export function calculateAllScores(
  config: ScoreConfig,
  rawValues: Record<string, number>
): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const scoreDef of config.scores) {
    scores[scoreDef.id] = calculateConfigurableScore(scoreDef, rawValues);
  }
  return scores;
}

// ============================================================================
// Alert Evaluation
// ============================================================================

/**
 * Evaluate alert thresholds against raw values for a member.
 * Returns an array of triggered alert labels.
 */
export function evaluateAlerts(
  alerts: AlertDefinition[],
  rawValues: Record<string, number>
): string[] {
  const triggered: string[] = [];
  for (const alert of alerts) {
    const raw = rawValues[alert.variableId];
    if (raw === undefined) continue;
    const fired = alert.operator === "above" ? raw > alert.threshold : raw < alert.threshold;
    if (fired) {
      const varDef = VARIABLE_MAP.get(alert.variableId);
      triggered.push(
        alert.label || `${varDef?.label ?? alert.variableId} ${alert.operator === "above" ? "high" : "low"}`
      );
    }
  }
  return triggered;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a score config. Throws on invalid config.
 */
export function validateScoreConfig(config: ScoreConfig): void {
  if (config.scores.length > 4) {
    throw new Error("Maximum 4 scores allowed");
  }
  if (config.scores.length === 0) {
    throw new Error("At least 1 score is required");
  }

  const seenIds = new Set<string>();
  for (const score of config.scores) {
    if (seenIds.has(score.id)) {
      throw new Error(`Duplicate score ID: ${score.id}`);
    }
    seenIds.add(score.id);

    if (score.name.length > 12) {
      throw new Error(`Score name "${score.name}" exceeds 12 characters`);
    }
    if (score.name.trim().length === 0) {
      throw new Error("Score name cannot be empty");
    }
    if (score.variables.length === 0) {
      throw new Error(`Score "${score.name}" must have at least 1 variable`);
    }

    for (const variable of score.variables) {
      if (!VARIABLE_MAP.has(variable.variableId)) {
        throw new Error(`Unknown variable: ${variable.variableId}`);
      }
      if (variable.weight <= 0) {
        throw new Error(`Weight must be positive for variable ${variable.variableId}`);
      }
    }
  }

  // Validate alerts
  if (config.alerts) {
    for (const alert of config.alerts) {
      if (!VARIABLE_MAP.has(alert.variableId)) {
        throw new Error(`Unknown alert variable: ${alert.variableId}`);
      }
      if (alert.operator !== "above" && alert.operator !== "below") {
        throw new Error(`Alert operator must be "above" or "below", got "${alert.operator}"`);
      }
      if (!Number.isFinite(alert.threshold)) {
        throw new Error("Alert threshold must be a finite number");
      }
    }
  }
}

// ============================================================================
// Query: Get Available Variables (for settings UI)
// ============================================================================

export const getAvailableVariables = query({
  args: {},
  handler: async () => {
    return VARIABLE_REGISTRY.map(({ id, label, description, normHint, category }) => ({
      id,
      label,
      description,
      normHint,
      category,
    }));
  },
});
