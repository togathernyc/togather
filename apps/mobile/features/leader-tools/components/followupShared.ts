export type FollowupMemberForScore = {
  score1: number;
  score2: number;
  score3?: number;
  score4?: number;
  scoreIds: string[];
};

/**
 * System score column definitions for the new community-level scoring.
 * These replace the dynamic per-group score configurations.
 * Used when the `system_scores` feature flag is enabled.
 */
export const SYSTEM_SCORE_COLUMNS = [
  { id: "sys_service", name: "Service", slot: "score1" as const },
  { id: "sys_attendance", name: "Attendance", slot: "score2" as const },
  { id: "sys_togather", name: "Togather", slot: "score3" as const },
] as const;

export type SubtitleVariable = {
  id: string;
  label: string;
  render: (
    item: {
      missedMeetings: number;
      consecutiveMissed: number;
      lastAttendedAt?: number;
      lastFollowupAt?: number;
    },
    formatDate: (date: number | undefined) => string
  ) => string;
};

export const SUBTITLE_VARIABLES: SubtitleVariable[] = [
  {
    id: "missed_count",
    label: "Missed count",
    render: (item) => `${item.missedMeetings} missed`,
  },
  {
    id: "consecutive_missed",
    label: "Consecutive missed",
    render: (item) => `${item.consecutiveMissed} missed in a row`,
  },
  {
    id: "last_attended",
    label: "Last attended",
    render: (item, formatDate) => `Last: ${formatDate(item.lastAttendedAt)}`,
  },
  {
    id: "last_followup",
    label: "Last follow-up",
    render: (item, formatDate) => `Follow-up: ${formatDate(item.lastFollowupAt)}`,
  },
];

export const SUBTITLE_VARIABLE_MAP = new Map(
  SUBTITLE_VARIABLES.map((variable) => [variable.id, variable])
);

export function normalizeSubtitleVariableIds(rawValue?: string): string[] {
  if (!rawValue) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const rawId of rawValue.split(",")) {
    const id = rawId.trim();
    if (!id || seen.has(id) || !SUBTITLE_VARIABLE_MAP.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

/**
 * Map dynamic follow-up score ids to fixed score slots.
 */
export function getScoreValue(member: FollowupMemberForScore, scoreId: string): number {
  const scoreIndex = member.scoreIds.indexOf(scoreId);
  if (scoreIndex === 0) return member.score1;
  if (scoreIndex === 1) return member.score2;
  if (scoreIndex === 2) return member.score3 ?? 0;
  if (scoreIndex === 3) return member.score4 ?? 0;
  return 0;
}

/**
 * Get the score value for a system score from a communityPeople record.
 * Unlike `getScoreValue` which maps dynamic scoreIds, this uses direct slot access.
 */
export function getSystemScoreValue(
  member: { score1?: number; score2?: number; score3?: number },
  scoreSlot: "score1" | "score2" | "score3",
): number | undefined {
  return member[scoreSlot] ?? undefined;
}
