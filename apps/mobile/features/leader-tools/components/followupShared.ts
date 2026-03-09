export type FollowupMemberForScore = {
  score1: number;
  score2: number;
  score3?: number;
  score4?: number;
  scoreIds: string[];
};

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
