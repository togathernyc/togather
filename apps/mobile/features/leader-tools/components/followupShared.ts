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
  { id: "sys_togather", name: "Connection", slot: "score3" as const },
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

const DEV_FAKE_ZIP_CODES = [
  "10001", "10003", "10011", "10019", "10025", "10027", "10032", "10039",
  "10128", "10314", "10458", "10467", "11101", "11106", "11201", "11205",
  "11215", "11218", "11221", "11226", "11233", "11238", "11354", "11368",
  "11372", "11375", "11385", "11415", "11432", "11691", "07030", "07302",
] as const;

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getSyntheticZipCode(seed: string): string {
  return DEV_FAKE_ZIP_CODES[hashString(seed) % DEV_FAKE_ZIP_CODES.length];
}

type MemberWithZipCode = {
  _id?: string;
  userId?: string;
  zipCode?: string | null;
};

export function applyDevZipCodeSample<T extends MemberWithZipCode>(members: T[]): T[] {
  if (!__DEV__ || members.length === 0) return members;

  const selectedIds = new Set(
    members
      .filter((member) => !member.zipCode)
      .map((member) => ({
        key: String(member.userId ?? member._id ?? ""),
        rank: hashString(String(member._id ?? member.userId ?? "")),
      }))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 1000)
      .map((member) => member.key),
  );

  if (selectedIds.size === 0) return members;

  return members.map((member) => {
    if (member.zipCode) return member;
    const key = String(member.userId ?? member._id ?? "");
    if (!selectedIds.has(key)) return member;
    return {
      ...member,
      zipCode: getSyntheticZipCode(key),
    };
  });
}

/**
 * Adapt a communityPeople record into the FollowupMember shape
 * expected by FollowupDesktopTable and FollowupMobileGrid.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function adaptCommunityPerson(cp: any) {
  return {
    _id: cp._id,
    groupMemberId: cp._id,
    userId: cp.userId,
    firstName: cp.firstName,
    lastName: cp.lastName,
    avatarUrl: cp.avatarUrl,
    email: cp.email,
    phone: cp.phone,
    zipCode: cp.zipCode,
    score1: cp.score1 ?? 0,
    score2: cp.score2 ?? 0,
    score3: cp.score3 ?? 0,
    scoreIds: ["sys_service", "sys_attendance", "sys_togather"],
    alerts: cp.alerts ?? [],
    isSnoozed: cp.isSnoozed ?? false,
    snoozedUntil: cp.snoozedUntil,
    attendanceScore: 0,
    connectionScore: 0,
    followupScore: 0,
    missedMeetings: 0,
    consecutiveMissed: 0,
    lastAttendedAt: cp.lastAttendedAt,
    lastFollowupAt: cp.lastFollowupAt,
    lastActiveAt: cp.lastActiveAt,
    addedAt: cp.addedAt,
    status: cp.status,
    assigneeId: cp.assigneeIds?.[0],
    assigneeIds: cp.assigneeIds,
    groupId: cp.groupId,
    groupName: cp.groupName,
    customText1: cp.customText1,
    customText2: cp.customText2,
    customText3: cp.customText3,
    customText4: cp.customText4,
    customText5: cp.customText5,
    customNum1: cp.customNum1,
    customNum2: cp.customNum2,
    customNum3: cp.customNum3,
    customNum4: cp.customNum4,
    customNum5: cp.customNum5,
    customBool1: cp.customBool1,
    customBool2: cp.customBool2,
    customBool3: cp.customBool3,
    customBool4: cp.customBool4,
    customBool5: cp.customBool5,
    latestNote: cp.latestNote,
    latestNoteAt: cp.latestNoteAt,
    isLeader: cp.isLeader ?? false,
  };
}
