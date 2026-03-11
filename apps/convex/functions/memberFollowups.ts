/**
 * Member Followup functions
 *
 * Handles all follow-up related operations for group leaders:
 * - List members needing follow-up (with priority scoring)
 * - View member's follow-up history
 * - Add follow-up entries (notes, calls, texts, etc.)
 * - Snooze members
 * - Update attendance records
 *
 * ## Meeting Status Quirks
 *
 * The meetings schema defines 4 statuses: "scheduled", "confirmed", "completed", "cancelled".
 * In practice:
 * - "scheduled" — the only status ever set (default on creation)
 * - "cancelled" — set by leaders to cancel a meeting
 * - "completed" — defined but NEVER set by any code path or UI
 * - "confirmed" — defined but NEVER used anywhere
 *
 * Because "completed" is never set, attendance queries must use **past non-cancelled
 * meetings** (scheduledAt < now AND status !== "cancelled") instead of filtering by
 * status === "completed". See tech debt issue for cleanup.
 */

import { v, ConvexError } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "../_generated/server";
import { paginationOptsValidator } from "convex/server";
import { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { now, getMediaUrl, normalizePhone, isValidPhone, buildSearchText, safeSliceForJson } from "../lib/utils";
import { requireAuth } from "../lib/auth";
import { parseDateOptional } from "../lib/validation";
import { isCommunityAdmin } from "../lib/permissions";
import { syncUserChannelMembershipsLogic } from "./sync/memberships";
import {
  DEFAULT_SCORE_CONFIG,
  extractRawValues,
  calculateAllScores,
  evaluateAlerts,
  VARIABLE_MAP,
  type ScoreConfig,
  type PcoServingData,
} from "./followupScoring";
import { VALID_CUSTOM_SLOTS } from "../lib/followupConstants";

// ============================================================================
// Types and Constants
// ============================================================================

/**
 * Follow-up action type validator
 */
const followupTypeValidator = v.union(
  v.literal("note"),
  v.literal("call"),
  v.literal("text"),
  v.literal("snooze"),
  v.literal("followed_up")
);

/**
 * Snooze duration validator
 */
const snoozeDurationValidator = v.union(
  v.literal("1_week"),
  v.literal("2_weeks"),
  v.literal("1_month"),
  v.literal("3_months")
);

/**
 * Sort options validator — accepts any string to support custom score IDs
 */
const sortByValidator = v.string();

// ============================================================================
// Scoring Configuration
// ============================================================================

const SCORING_CONFIG = {
  // Meeting miss penalty: % deducted per consecutive meeting missed
  MEETING_MISS_PENALTY: 10,
  MEETING_MISS_PENALTY_SNOOZED: 5,

  // Decay rate: % lost per day since last follow-up
  DECAY_RATE_PER_DAY: 1,
  DECAY_RATE_PER_DAY_SNOOZED: 0.5,

  // Base scores for each follow-up type (before decay)
  FOLLOWUP_BASE_SCORES: {
    followed_up: 100, // In-person meeting - highest value
    call: 85, // Phone call - strong connection
    text: 70, // Text message - moderate connection
  } as Record<string, number>,

  // Priority score thresholds
  STREAK_PENALTY_THRESHOLD: 3,
  STREAK_PENALTY_MULTIPLIER: 5,

  // Drop-off detection
  DROPOFF_HIGH_THRESHOLD: 0.7,
  DROPOFF_HIGH_RECENT: 0.3,
  DROPOFF_HIGH_BONUS: 30,
  DROPOFF_LOW_THRESHOLD: 0.5,
  DROPOFF_LOW_RECENT: 0.25,
  DROPOFF_LOW_BONUS: 15,

  // Cross-group activity reduction
  CROSS_GROUP_VERY_ACTIVE: 4,
  CROSS_GROUP_VERY_ACTIVE_REDUCTION: 0.3,
  CROSS_GROUP_MODERATELY_ACTIVE: 2,
  CROSS_GROUP_MODERATE_REDUCTION: 0.5,
  CROSS_GROUP_SOMEWHAT_ACTIVE: 1,
  CROSS_GROUP_SLIGHT_REDUCTION: 0.7,

  // Recent follow-up decay factors
  FOLLOWUP_DECAY_7_DAYS: 0.3,
  FOLLOWUP_DECAY_14_DAYS: 0.6,
  FOLLOWUP_DECAY_30_DAYS: 0.8,
};

// ============================================================================
// Scoring Helpers
// ============================================================================

interface MeetingAttendanceData {
  meetingId: string;
  wasPresent: boolean;
  scheduledAt: number;
}

interface FollowupAction {
  type: string;
  createdAt: number;
}

interface ScoringInput {
  meetings: MeetingAttendanceData[];
  followups: FollowupAction[];
  isSnoozed: boolean;
  otherGroupAttendance: number;
}

/**
 * Calculate attendance score (simple percentage)
 */
function calculateAttendanceScore(meetings: MeetingAttendanceData[]): number {
  if (meetings.length === 0) return 0;
  const attended = meetings.filter((m) => m.wasPresent).length;
  return Math.round((attended / meetings.length) * 100);
}

/**
 * Calculate consecutive missed meetings (from most recent)
 */
function calculateConsecutiveMissed(meetings: MeetingAttendanceData[]): number {
  let consecutive = 0;
  for (const meeting of meetings) {
    if (meeting.wasPresent) break;
    consecutive++;
  }
  return consecutive;
}

/**
 * Calculate max consecutive missed (historical)
 */
function calculateMaxConsecutiveMissed(meetings: MeetingAttendanceData[]): number {
  let consecutive = 0;
  let maxConsecutive = 0;
  for (const meeting of meetings) {
    if (meeting.wasPresent) {
      consecutive = 0;
    } else {
      consecutive++;
      maxConsecutive = Math.max(maxConsecutive, consecutive);
    }
  }
  return maxConsecutive;
}

/**
 * Calculate connection score (composite of attendance + follow-ups)
 */
function calculateConnectionScore(input: ScoringInput): number {
  const config = SCORING_CONFIG;
  const currentTime = now();

  const meetingMissPenalty = input.isSnoozed
    ? config.MEETING_MISS_PENALTY_SNOOZED
    : config.MEETING_MISS_PENALTY;
  const decayRatePerDay = input.isSnoozed
    ? config.DECAY_RATE_PER_DAY_SNOOZED
    : config.DECAY_RATE_PER_DAY;

  const hasEverAttended = input.meetings.some((m) => m.wasPresent);
  const consecutiveMissed = calculateConsecutiveMissed(input.meetings);

  // Attendance portion
  let attendancePortion: number;
  if (!hasEverAttended) {
    attendancePortion = 0;
  } else {
    attendancePortion = Math.max(0, 100 - consecutiveMissed * meetingMissPenalty);
  }

  // Follow-up portion
  const remainingSpace = 100 - attendancePortion;
  let highestFollowupScore = 0;

  for (const followup of input.followups) {
    const baseScore = config.FOLLOWUP_BASE_SCORES[followup.type];
    if (baseScore === undefined) continue;

    const daysSinceFollowup = Math.floor(
      (currentTime - followup.createdAt) / (24 * 60 * 60 * 1000)
    );
    const decayedScore = Math.max(0, baseScore - decayRatePerDay * daysSinceFollowup);

    if (decayedScore > highestFollowupScore) {
      highestFollowupScore = decayedScore;
    }
  }

  const followupPortion = remainingSpace * (highestFollowupScore / 100);
  return Math.round(attendancePortion + followupPortion);
}

/**
 * Calculate full follow-up priority score (for sorting)
 */
function calculateFollowupPriority(input: ScoringInput): {
  attendanceScore: number;
  connectionScore: number;
  followupScore: number;
  missedMeetings: number;
  consecutiveMissed: number;
  maxConsecutive: number;
  scoreFactors: {
    recencyWeight: number;
    streakPenalty: number;
    dropoffDetected: boolean;
    activeInOtherGroups: boolean;
    otherGroupMeetingsAttended: number;
  };
} {
  const config = SCORING_CONFIG;
  const currentTime = now();

  // Calculate attendance-based metrics
  let baseScore = 0;
  let consecutiveMissed = 0;
  let maxConsecutive = 0;

  for (const meeting of input.meetings) {
    if (meeting.wasPresent) {
      consecutiveMissed = 0;
    } else {
      const weeksAgo = Math.floor(
        (currentTime - meeting.scheduledAt) / (7 * 24 * 60 * 60 * 1000)
      );
      const recencyWeight = Math.exp(-weeksAgo / 4);
      baseScore += 10 * recencyWeight;
      consecutiveMissed++;
      maxConsecutive = Math.max(maxConsecutive, consecutiveMissed);
    }
  }

  // Streak penalty
  const streakPenalty =
    maxConsecutive >= config.STREAK_PENALTY_THRESHOLD
      ? maxConsecutive * config.STREAK_PENALTY_MULTIPLIER
      : 0;

  // Drop-off detection
  const recentMeetings = input.meetings.slice(0, 4);
  const historicalMeetings = input.meetings.slice(4, 12);

  const calcRate = (mtgs: MeetingAttendanceData[]) => {
    if (mtgs.length === 0) return 0;
    const attended = mtgs.filter((m) => m.wasPresent).length;
    return attended / mtgs.length;
  };

  const recentRate = calcRate(recentMeetings);
  const historicalRate = calcRate(historicalMeetings);

  let dropoffBonus = 0;
  let dropoffDetected = false;
  if (historicalRate > config.DROPOFF_HIGH_THRESHOLD && recentRate < config.DROPOFF_HIGH_RECENT) {
    dropoffBonus = config.DROPOFF_HIGH_BONUS;
    dropoffDetected = true;
  } else if (historicalRate > config.DROPOFF_LOW_THRESHOLD && recentRate < config.DROPOFF_LOW_RECENT) {
    dropoffBonus = config.DROPOFF_LOW_BONUS;
    dropoffDetected = true;
  }

  // Snooze reduction
  const snoozeReduction = input.isSnoozed ? 0.1 : 1.0;

  // Recent follow-up decay
  const lastFollowup = input.followups[0];
  let followupDecay = 1.0;
  if (lastFollowup) {
    const daysSince = Math.floor(
      (currentTime - lastFollowup.createdAt) / (24 * 60 * 60 * 1000)
    );
    if (daysSince < 7) followupDecay = config.FOLLOWUP_DECAY_7_DAYS;
    else if (daysSince < 14) followupDecay = config.FOLLOWUP_DECAY_14_DAYS;
    else if (daysSince < 30) followupDecay = config.FOLLOWUP_DECAY_30_DAYS;
  }

  // Cross-group activity reduction
  let crossGroupReduction = 1.0;
  if (input.otherGroupAttendance >= config.CROSS_GROUP_VERY_ACTIVE) {
    crossGroupReduction = config.CROSS_GROUP_VERY_ACTIVE_REDUCTION;
  } else if (input.otherGroupAttendance >= config.CROSS_GROUP_MODERATELY_ACTIVE) {
    crossGroupReduction = config.CROSS_GROUP_MODERATE_REDUCTION;
  } else if (input.otherGroupAttendance >= config.CROSS_GROUP_SOMEWHAT_ACTIVE) {
    crossGroupReduction = config.CROSS_GROUP_SLIGHT_REDUCTION;
  }

  // Final priority score
  const rawScore =
    (baseScore + streakPenalty + dropoffBonus) *
    followupDecay *
    snoozeReduction *
    crossGroupReduction;
  const followupScore = Math.round(rawScore * 100) / 100;

  const missedMeetings = input.meetings.filter((m) => !m.wasPresent).length;
  const attendanceScore = calculateAttendanceScore(input.meetings);
  const connectionScore = calculateConnectionScore(input);

  return {
    attendanceScore,
    connectionScore,
    followupScore,
    missedMeetings,
    consecutiveMissed: calculateConsecutiveMissed(input.meetings),
    maxConsecutive,
    scoreFactors: {
      recencyWeight: Math.round(baseScore * 100) / 100,
      streakPenalty,
      dropoffDetected,
      activeInOtherGroups: input.otherGroupAttendance > 0,
      otherGroupMeetingsAttended: input.otherGroupAttendance,
    },
  };
}

// ============================================================================
// Internal Queries (for batched data access)
// ============================================================================

/**
 * Fetch group config, recent meetings, and score settings.
 * Lightweight query — no member data (members fetched separately via pagination).
 */
export const internalGetGroupConfig = internalQuery({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);

    // Past non-cancelled meetings (see "Meeting Status Quirks" at top of file)
    const meetings = await ctx.db
      .query("meetings")
      .withIndex("by_group_scheduledAt", (q) =>
        q.eq("groupId", args.groupId).lt("scheduledAt", Date.now())
      )
      .filter((q) => q.neq(q.field("status"), "cancelled"))
      .order("desc")
      .take(20);

    const scoreConfig: ScoreConfig = group?.followupScoreConfig ?? DEFAULT_SCORE_CONFIG;

    return {
      meetings: meetings.map((m) => ({
        _id: m._id,
        scheduledAt: m.scheduledAt,
      })),
      scoreConfigScores: scoreConfig.scores.map((s) => ({ id: s.id, name: s.name })),
      toolDisplayName: (group as any)?.toolDisplayNames?.followup || "Follow-up",
      memberSubtitle: (group?.followupScoreConfig as any)?.memberSubtitle || "",
    };
  },
});

/**
 * Score a batch of members against meeting attendance and followup data.
 * Each batch should be ~200 members to stay within Convex's per-query read limits.
 * Read budget per batch of 200: ~8,420 (1 group + 200 users + 4000 attendance + 4000 followups).
 */
export const internalScoreBatch = internalQuery({
  args: {
    groupId: v.id("groups"),
    members: v.array(
      v.object({
        _id: v.id("groupMembers"),
        userId: v.id("users"),
        joinedAt: v.number(),
      })
    ),
    meetings: v.array(
      v.object({
        _id: v.id("meetings"),
        scheduledAt: v.number(),
      })
    ),
    crossGroupAttendanceMap: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const currentTime = now();
    const group = await ctx.db.get(args.groupId);
    const scoreConfig: ScoreConfig = group?.followupScoreConfig ?? DEFAULT_SCORE_CONFIG;
    const useCustomScoring = !!group?.followupScoreConfig;

    // Build PCO serving map from group doc
    const pcoServingMap = new Map<string, PcoServingData>();
    if (group?.pcoServingCounts?.counts) {
      for (const { userId, count } of group.pcoServingCounts.counts) {
        pcoServingMap.set(userId.toString(), { servicesPast2Months: count });
      }
    }

    const results = await Promise.all(
      args.members.map(async (member) => {
        const user = await ctx.db.get(member.userId);
        if (!user) return null;

        // Targeted attendance lookups using by_meeting_user index (1 read per meeting)
        const attendanceResults = await Promise.all(
          args.meetings.map((meeting) =>
            ctx.db
              .query("meetingAttendances")
              .withIndex("by_meeting_user", (q) =>
                q.eq("meetingId", meeting._id).eq("userId", member.userId)
              )
              .first()
          )
        );

        // Filter meetings to only those after member joined
        const memberMeetings = args.meetings.filter(
          (m) => m.scheduledAt >= member.joinedAt
        );

        const meetingData: MeetingAttendanceData[] = memberMeetings.map((m) => {
          const idx = args.meetings.findIndex((mt) => mt._id === m._id);
          return {
            meetingId: m._id,
            wasPresent: attendanceResults[idx]?.status === 1,
            scheduledAt: m.scheduledAt,
          };
        });

        // Fetch followups for this member
        const followups = await ctx.db
          .query("memberFollowups")
          .withIndex("by_groupMember_createdAt", (q) =>
            q.eq("groupMemberId", member._id)
          )
          .order("desc")
          .take(20);

        const followupData: FollowupAction[] = followups.map((f) => ({
          type: f.type,
          createdAt: f.createdAt,
        }));

        // Check for active snooze
        let snoozedUntil: number | null = null;
        for (const f of followups) {
          if (f.type === "snooze" && f.snoozeUntil && f.snoozeUntil > currentTime) {
            snoozedUntil = f.snoozeUntil;
            break;
          }
        }
        const isSnoozed = !!snoozedUntil;

        // Compute legacy scores
        const legacyScores = calculateFollowupPriority({
          meetings: meetingData,
          followups: followupData,
          isSnoozed,
          otherGroupAttendance: 0,
        });

        // Cross-group attendance: use pre-computed map (computed in action layer)
        const crossGroupAttendancePct = useCustomScoring
          ? (args.crossGroupAttendanceMap?.[member.userId.toString()] as number | undefined)
          : undefined;

        // Compute configurable scores
        let memberScores: Record<string, number>;
        let triggeredAlerts: string[] = [];

        if (!useCustomScoring) {
          memberScores = {
            default_attendance: legacyScores.attendanceScore,
            default_connection: legacyScores.connectionScore,
          };
        } else {
          const connectionParts = computeConnectionParts(
            meetingData, followupData, isSnoozed, currentTime
          );
          const pcoServing = pcoServingMap.get(member.userId.toString());
          const rawValues = extractRawValues(
            meetingData, followupData, isSnoozed, currentTime, connectionParts, pcoServing,
            crossGroupAttendancePct
          );
          memberScores = calculateAllScores(scoreConfig, rawValues);
          if (scoreConfig.alerts?.length) {
            triggeredAlerts = evaluateAlerts(scoreConfig.alerts, rawValues);
          }
        }

        // Get last attendance date
        let lastAttendedAt: number | null = null;
        for (const meeting of memberMeetings) {
          const idx = args.meetings.findIndex((mt) => mt._id === meeting._id);
          if (attendanceResults[idx]?.status === 1) {
            lastAttendedAt = meeting.scheduledAt;
            break;
          }
        }

        // Extract latest note for denormalization
        const latestNoteEntry = followups.find(f => f.type === "note" && f.content);
        const latestNoteContent = latestNoteEntry?.content
          ? safeSliceForJson(latestNoteEntry.content, 200)
          : null;
        const latestNoteAt = latestNoteEntry?.createdAt ?? null;

        return {
          memberId: member._id,
          odUserId: member.userId,
          firstName: user.firstName || "",
          lastName: user.lastName || "",
          email: user.email,
          phone: user.phone,
          profileImage: getMediaUrl(user.profilePhoto),
          followupScore: legacyScores.followupScore,
          attendanceScore: legacyScores.attendanceScore,
          connectionScore: legacyScores.connectionScore,
          scores: memberScores,
          missedMeetings: legacyScores.missedMeetings,
          consecutiveMissed: legacyScores.consecutiveMissed,
          lastAttendedAt,
          lastFollowupAt: followupData[0]?.createdAt || null,
          snoozedUntil,
          scoreFactors: legacyScores.scoreFactors,
          triggeredAlerts,
          pcoServingCount:
            pcoServingMap.get(member.userId.toString())?.servicesPast2Months ?? 0,
          latestNoteContent,
          latestNoteAt,
        };
      })
    );

    return results.filter(
      (r): r is NonNullable<(typeof results)[number]> => r !== null
    );
  },
});

/**
 * Compute cross-group attendance percentages for a batch of users.
 * Processes ~20 users at a time to stay within Convex read limits.
 * Returns a map of userId (string) -> attendance percentage (0-100).
 */
export const internalCrossGroupAttendance = internalQuery({
  args: {
    groupId: v.id("groups"),
    userIds: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    const currentTime = now();
    const sixtyDaysAgo = currentTime - 60 * 24 * 60 * 60 * 1000;
    const results: Record<string, number> = {};

    for (const userId of args.userIds) {
      const allMemberships = await ctx.db
        .query("groupMembers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .collect();

      let allGroupsTotal = 0;
      let allGroupsAttended = 0;

      for (const membership of allMemberships) {
        // Past non-cancelled meetings in window (see "Meeting Status Quirks" at top of file)
        const meetings = await ctx.db
          .query("meetings")
          .withIndex("by_group_scheduledAt", (q) =>
            q.eq("groupId", membership.groupId)
              .gte("scheduledAt", sixtyDaysAgo)
              .lt("scheduledAt", currentTime)
          )
          .filter((q) => q.neq(q.field("status"), "cancelled"))
          .order("desc")
          .take(10);

        const attendances = await Promise.all(
          meetings.map((m) =>
            ctx.db
              .query("meetingAttendances")
              .withIndex("by_meeting_user", (q) =>
                q.eq("meetingId", m._id).eq("userId", userId)
              )
              .first()
          )
        );

        allGroupsTotal += meetings.length;
        allGroupsAttended += attendances.filter((a) => a?.status === 1).length;
      }

      results[userId.toString()] =
        allGroupsTotal > 0 ? Math.round((allGroupsAttended / allGroupsTotal) * 100) : 0;
    }

    return results;
  },
});

// ============================================================================
// Queries & Actions
// ============================================================================

/**
 * Get paginated list of members needing follow-up.
 *
 * Reads from pre-computed `memberFollowupScores` table — zero joins,
 * zero computation at read time. Supports server-side sorting via indexes.
 */
export const list = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    sortBy: v.optional(v.string()),
    sortDirection: v.optional(v.string()),
    statusFilter: v.optional(v.string()),
    assigneeFilter: v.optional(v.id("users")),
    excludedAssigneeFilters: v.optional(v.array(v.id("users"))),
    scoreField: v.optional(v.string()),   // e.g. "score1", "score2"
    scoreMin: v.optional(v.number()),
    scoreMax: v.optional(v.number()),
    addedAtMin: v.optional(v.number()),
    addedAtMax: v.optional(v.number()),
    // Keep pagination optional for legacy clients that still call this
    // query via a non-paginated code path.
    paginationOpts: v.optional(paginationOptsValidator),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.token);
    const direction = args.sortDirection === "asc" ? "asc" : "desc";

    // Map sortBy to the correct index
    const indexMap: Record<string, string> = {
      score1: "by_group_score1",
      score2: "by_group_score2",
      firstName: "by_group_firstName",
      lastName: "by_group_lastName",
      addedAt: "by_group_addedAt",
      lastAttendedAt: "by_group_lastAttendedAt",
      lastFollowupAt: "by_group_lastFollowupAt",
      lastActiveAt: "by_group_lastActiveAt",
      status: "by_group_status",
      assignee: "by_group_assignee",
      customText1: "by_group_customText1",
      customText2: "by_group_customText2",
      customText3: "by_group_customText3",
      customNum1: "by_group_customNum1",
      customNum2: "by_group_customNum2",
      customNum3: "by_group_customNum3",
      customBool1: "by_group_customBool1",
      customBool2: "by_group_customBool2",
      customBool3: "by_group_customBool3",
    };
    const indexName = indexMap[args.sortBy ?? "score1"] ?? "by_group_score1";

    let q = ctx.db
      .query("memberFollowupScores")
      .withIndex(indexName as any, (fq: any) => fq.eq("groupId", args.groupId))
      .order(direction);

    // Apply optional filters
    const scoreFilterField = (args.scoreField ?? "score1") as "score1" | "score2" | "score3" | "score4";
    const hasFilters =
      args.statusFilter ||
      args.assigneeFilter ||
      (args.excludedAssigneeFilters && args.excludedAssigneeFilters.length > 0) ||
      args.scoreMax !== undefined ||
      args.scoreMin !== undefined ||
      args.addedAtMin !== undefined ||
      args.addedAtMax !== undefined;
    if (hasFilters) {
      q = q.filter((fq) => {
        const conds: any[] = [];
        if (args.statusFilter) conds.push(fq.eq(fq.field("status"), args.statusFilter));
        if (args.assigneeFilter) conds.push(fq.eq(fq.field("assigneeId"), args.assigneeFilter));
        if (args.excludedAssigneeFilters?.length) {
          for (const excludedAssigneeId of args.excludedAssigneeFilters) {
            conds.push(fq.neq(fq.field("assigneeId"), excludedAssigneeId));
          }
        }
        if (args.scoreMax !== undefined) conds.push(fq.lt(fq.field(scoreFilterField), args.scoreMax));
        if (args.scoreMin !== undefined) conds.push(fq.gt(fq.field(scoreFilterField), args.scoreMin));
        if (args.addedAtMax !== undefined) conds.push(fq.lte(fq.field("addedAt"), args.addedAtMax));
        if (args.addedAtMin !== undefined) conds.push(fq.gte(fq.field("addedAt"), args.addedAtMin));
        return conds.length === 1 ? conds[0] : fq.and(...(conds as [any, any, ...any[]]));
      });
    }

    const paginatedResult = await q.paginate(
      args.paginationOpts ?? { cursor: null, numItems: 50 }
    );

    if (!args.paginationOpts) {
      const group = await ctx.db.get(args.groupId);
      const scoreConfig: ScoreConfig = group?.followupScoreConfig ?? DEFAULT_SCORE_CONFIG;
      return {
        members: paginatedResult.page,
        scoreConfig: scoreConfig.scores.map((s) => ({ id: s.id, name: s.name })),
        toolDisplayName: (group as any)?.toolDisplayNames?.followup || "Follow-up",
        memberSubtitle: (group?.followupScoreConfig as any)?.memberSubtitle || "",
      };
    }

    return paginatedResult;
  },
});

/**
 * Get followup config for a group (called once, not per-page).
 * Returns score config, display name, and member subtitle settings.
 */
export const getFollowupConfig = query({
  args: { token: v.string(), groupId: v.id("groups") },
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.token);
    const group = await ctx.db.get(args.groupId);
    if (!group) return null;

    const scoreConfig: ScoreConfig = group.followupScoreConfig ?? DEFAULT_SCORE_CONFIG;

    return {
      scoreConfigScores: scoreConfig.scores.map((s) => ({ id: s.id, name: s.name })),
      toolDisplayName: (group as any)?.toolDisplayNames?.followup || "Follow-up",
      memberSubtitle: (group?.followupScoreConfig as any)?.memberSubtitle || "",
      followupColumnConfig: group.followupColumnConfig ?? null,
      followupRefreshState: group.followupRefreshState ?? null,
    };
  },
});

/**
 * Search members by name/email/phone using full-text search index.
 * Returns up to 200 results ordered by relevance.
 */
export const search = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    searchText: v.string(),
    statusFilter: v.optional(v.string()),
    assigneeFilter: v.optional(v.id("users")),
    excludedAssigneeFilters: v.optional(v.array(v.id("users"))),
    scoreField: v.optional(v.string()),
    scoreMin: v.optional(v.number()),
    scoreMax: v.optional(v.number()),
    addedAtMin: v.optional(v.number()),
    addedAtMax: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.token);
    let results = ctx.db
      .query("memberFollowupScores")
      .withSearchIndex("search_followup", (q) => {
        let sq = q.search("searchText", args.searchText).eq("groupId", args.groupId);
        if (args.statusFilter) sq = sq.eq("status", args.statusFilter);
        if (args.assigneeFilter) sq = sq.eq("assigneeId", args.assigneeFilter);
        return sq;
      });

    // Range filters via .filter()
    const scoreFilterField = (args.scoreField ?? "score1") as "score1" | "score2" | "score3" | "score4";
    if (args.scoreMax !== undefined || args.scoreMin !== undefined) {
      results = results.filter((fq) => {
        const conds: any[] = [];
        if (args.scoreMax !== undefined)
          conds.push(fq.lt(fq.field(scoreFilterField), args.scoreMax));
        if (args.scoreMin !== undefined)
          conds.push(fq.gt(fq.field(scoreFilterField), args.scoreMin));
        return conds.length === 1 ? conds[0] : fq.and(...(conds as [any, any, ...any[]]));
      });
    }

    if (
      (args.excludedAssigneeFilters && args.excludedAssigneeFilters.length > 0) ||
      args.addedAtMin !== undefined ||
      args.addedAtMax !== undefined
    ) {
      results = results.filter((fq) => {
        const conds: any[] = [];
        if (args.excludedAssigneeFilters?.length) {
          for (const excludedAssigneeId of args.excludedAssigneeFilters) {
            conds.push(fq.neq(fq.field("assigneeId"), excludedAssigneeId));
          }
        }
        if (args.addedAtMax !== undefined) conds.push(fq.lte(fq.field("addedAt"), args.addedAtMax));
        if (args.addedAtMin !== undefined) conds.push(fq.gte(fq.field("addedAt"), args.addedAtMin));
        return conds.length === 1 ? conds[0] : fq.and(...(conds as [any, any, ...any[]]));
      });
    }

    return await results.take(200);
  },
});

/**
 * Get total member count for a group.
 * Uses a streaming count to avoid loading all documents into memory.
 */
export const count = query({
  args: { token: v.string(), groupId: v.id("groups") },
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.token);
    let count = 0;
    for await (const _doc of ctx.db
      .query("memberFollowupScores")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))) {
      count++;
    }
    return count;
  },
});

/**
 * Compute the attendance and followup portions of the connection score formula.
 * These are used as pre-computed variables for the configurable engine.
 */
function computeConnectionParts(
  meetings: MeetingAttendanceData[],
  followups: FollowupAction[],
  isSnoozed: boolean,
  currentTime: number,
): { attendancePortion: number; followupPortion: number } {
  const config = SCORING_CONFIG;
  const meetingMissPenalty = isSnoozed
    ? config.MEETING_MISS_PENALTY_SNOOZED
    : config.MEETING_MISS_PENALTY;
  const decayRatePerDay = isSnoozed
    ? config.DECAY_RATE_PER_DAY_SNOOZED
    : config.DECAY_RATE_PER_DAY;

  const hasEverAttended = meetings.some((m) => m.wasPresent);
  const consecutiveMissed = calculateConsecutiveMissed(meetings);

  let attendancePortion: number;
  if (!hasEverAttended) {
    attendancePortion = 0;
  } else {
    attendancePortion = Math.max(0, 100 - consecutiveMissed * meetingMissPenalty);
  }

  // Follow-up portion
  let highestFollowupScore = 0;
  for (const followup of followups) {
    const baseScore = config.FOLLOWUP_BASE_SCORES[followup.type];
    if (baseScore === undefined) continue;
    const daysSinceFollowup = Math.floor(
      (currentTime - followup.createdAt) / (24 * 60 * 60 * 1000)
    );
    const decayedScore = Math.max(0, baseScore - decayRatePerDay * daysSinceFollowup);
    if (decayedScore > highestFollowupScore) {
      highestFollowupScore = decayedScore;
    }
  }

  const remainingSpace = 100 - attendancePortion;
  const followupPortion = remainingSpace * (highestFollowupScore / 100);

  return { attendancePortion, followupPortion };
}

/**
 * Get follow-up history for a specific member
 */
export const history = query({
  args: {
    groupId: v.id("groups"),
    memberId: v.id("groupMembers"),
    currentUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const currentTime = now();

    // Get member info
    const member = await ctx.db.get(args.memberId);
    if (!member || member.groupId !== args.groupId) {
      throw new Error("Member not found");
    }

    const user = await ctx.db.get(member.userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Get attendance history (meetings in past 60 days, after member joined)
    const DAY_MS = 24 * 60 * 60 * 1000;
    const sixtyDaysAgo = currentTime - 60 * DAY_MS;
    const attendanceCutoff = Math.max(member.joinedAt, sixtyDaysAgo);
    // Past non-cancelled meetings (see "Meeting Status Quirks" at top of file)
    const meetings = await ctx.db
      .query("meetings")
      .withIndex("by_group_scheduledAt", (q) =>
        q.eq("groupId", args.groupId)
          .gte("scheduledAt", attendanceCutoff)
          .lt("scheduledAt", currentTime)
      )
      .filter((q) => q.neq(q.field("status"), "cancelled"))
      .order("desc")
      .take(20);

    // Batch fetch attendances for all meetings in parallel
    const attendanceResults = await Promise.all(
      meetings.map((meeting) =>
        ctx.db
          .query("meetingAttendances")
          .withIndex("by_meeting_user", (q) =>
            q.eq("meetingId", meeting._id).eq("userId", member.userId)
          )
          .first()
      )
    );

    const attendanceHistory = meetings.map((meeting, i) => ({
      meetingId: meeting._id,
      title: meeting.title,
      date: meeting.scheduledAt,
      status: attendanceResults[i]?.status ?? 0,
    }));

    // Get follow-up entries with limit
    const followups = await ctx.db
      .query("memberFollowups")
      .withIndex("by_groupMember_createdAt", (q) => q.eq("groupMemberId", args.memberId))
      .order("desc")
      .take(100);

    // Batch fetch all unique createdBy users
    const createdByIds = Array.from(new Set(followups.map((f) => f.createdById)));
    const createdByUsers = await Promise.all(
      createdByIds.map((id) => ctx.db.get(id) as Promise<Doc<"users"> | null>)
    );
    const createdByUserMap = new Map<string, Doc<"users">>(
      createdByUsers
        .filter((u): u is Doc<"users"> => u !== null)
        .map((u) => [u._id.toString(), u])
    );

    // Map followups with user data from cache
    const followupsWithUsers = followups.map((f) => {
      const createdByUser = createdByUserMap.get(f.createdById.toString());
      return {
        id: f._id,
        type: f.type as "note" | "call" | "text" | "snooze" | "followed_up",
        content: f.content,
        snoozeUntil: f.snoozeUntil,
        createdAt: f.createdAt,
        createdBy: createdByUser
          ? {
              id: createdByUser._id,
              firstName: createdByUser.firstName || "",
              lastName: createdByUser.lastName || "",
            }
          : null,
      };
    });

    // Check for active snooze
    const activeSnooze = followups.find(
      (f) => f.type === "snooze" && f.snoozeUntil && f.snoozeUntil > currentTime
    );
    const isSnoozed = !!activeSnooze;

    // Compute score breakdown
    const group = await ctx.db.get(args.groupId);
    const scoreConfig: ScoreConfig = group?.followupScoreConfig ?? DEFAULT_SCORE_CONFIG;
    const useCustomScoring = !!group?.followupScoreConfig;

    // Build meeting data for scoring
    const meetingData: MeetingAttendanceData[] = meetings.map((m, i) => ({
      meetingId: m._id,
      wasPresent: attendanceResults[i]?.status === 1,
      scheduledAt: m.scheduledAt,
    }));

    // Build followup data for scoring
    const followupData: FollowupAction[] = followups.map((f) => ({
      type: f.type,
      createdAt: f.createdAt,
    }));

    // Compute connection parts for pre-computed variables
    const connectionParts = computeConnectionParts(
      meetingData, followupData, isSnoozed, currentTime
    );

    // Build PCO serving data
    let pcoServing: PcoServingData | undefined;
    if (group?.pcoServingCounts?.counts) {
      const entry = group.pcoServingCounts.counts.find(
        (c: { userId: Id<"users">; count: number }) => c.userId.toString() === member.userId.toString()
      );
      if (entry) {
        pcoServing = { servicesPast2Months: entry.count };
      }
    }

    // ---- Cross-group attendance ----
    // Find all other groups the user belongs to
    const allMemberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", member.userId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();
    const otherMemberships = allMemberships.filter(
      (m) => m.groupId.toString() !== args.groupId.toString()
    );

    // For each other group: fetch last 10 completed meetings + attendance
    const crossGroupAttendance: Array<{
      groupId: string;
      groupName: string;
      canEdit: boolean;
      meetings: Array<{ meetingId: string; title: string; date: number; status: number }>;
    }> = [];

    let allGroupsAttended = meetings.filter((_, i) => attendanceResults[i]?.status === 1).length;
    let allGroupsTotal = meetings.length;

    for (const otherMember of otherMemberships) {
      const otherGroup = await ctx.db.get(otherMember.groupId);
      if (!otherGroup) continue;

      // Check if currentUserId is leader/admin in this other group
      let canEdit = false;
      if (args.currentUserId) {
        const callerMembership = await ctx.db
          .query("groupMembers")
          .withIndex("by_group_user", (q) =>
            q.eq("groupId", otherMember.groupId).eq("userId", args.currentUserId!)
          )
          .first();
        if (callerMembership && (callerMembership.role === "leader" || callerMembership.role === "admin")) {
          canEdit = true;
        }
      }

      // Past non-cancelled meetings (see "Meeting Status Quirks" at top of file)
      const otherMeetings = await ctx.db
        .query("meetings")
        .withIndex("by_group_scheduledAt", (q) =>
          q.eq("groupId", otherMember.groupId)
            .gte("scheduledAt", sixtyDaysAgo)
            .lt("scheduledAt", currentTime)
        )
        .filter((q) => q.neq(q.field("status"), "cancelled"))
        .order("desc")
        .take(10);

      const otherAttendances = await Promise.all(
        otherMeetings.map((m) =>
          ctx.db
            .query("meetingAttendances")
            .withIndex("by_meeting_user", (q) =>
              q.eq("meetingId", m._id).eq("userId", member.userId)
            )
            .first()
        )
      );

      const otherMeetingData = otherMeetings.map((m, i) => ({
        meetingId: m._id.toString(),
        title: m.title ?? "Meeting",
        date: m.scheduledAt,
        status: otherAttendances[i]?.status ?? 0,
      }));

      // Accumulate for cross-group attendance %
      allGroupsTotal += otherMeetings.length;
      allGroupsAttended += otherMeetingData.filter((m) => m.status === 1).length;

      crossGroupAttendance.push({
        groupId: otherMember.groupId.toString(),
        groupName: otherGroup.name,
        canEdit,
        meetings: otherMeetingData,
      });
    }

    const crossGroupAttendancePct =
      allGroupsTotal > 0 ? Math.round((allGroupsAttended / allGroupsTotal) * 100) : 0;

    // ---- Serving history (from PCO serving counts cache on group doc) ----
    const servingHistory: Array<{
      date: string;
      serviceTypeName: string;
      teamName: string;
      position: string | null;
    }> = [];

    const allDetails = group?.pcoServingCounts?.servingDetails ?? [];
    const userDetails = allDetails
      .filter((d: { userId: Id<"users"> }) => d.userId.toString() === member.userId.toString())
      .sort((a: { date: string }, b: { date: string }) => b.date.localeCompare(a.date));

    for (const d of userDetails) {
      servingHistory.push({
        date: d.date,
        serviceTypeName: d.serviceTypeName,
        teamName: d.teamName,
        position: d.position ?? null,
      });
      if (servingHistory.length >= 15) break;
    }

    const rawValues = extractRawValues(
      meetingData, followupData, isSnoozed, currentTime, connectionParts, pcoServing, crossGroupAttendancePct
    );

    // Compute final scores
    let memberScores: Record<string, number>;
    let triggeredAlerts: string[] = [];
    if (!useCustomScoring) {
      memberScores = {
        default_attendance: calculateAttendanceScore(meetingData),
        default_connection: calculateConnectionScore({
          meetings: meetingData,
          followups: followupData,
          isSnoozed,
          otherGroupAttendance: 0,
        }),
      };
    } else {
      memberScores = calculateAllScores(scoreConfig, rawValues);
      if (scoreConfig.alerts?.length) {
        triggeredAlerts = evaluateAlerts(scoreConfig.alerts, rawValues);
      }
    }

    // Build score breakdown for the UI
    const scoreBreakdown = scoreConfig.scores.map((scoreDef) => ({
      id: scoreDef.id,
      name: scoreDef.name,
      value: memberScores[scoreDef.id] ?? 0,
      variables: scoreDef.variables.map((v) => {
        const varDef = VARIABLE_MAP.get(v.variableId);
        const raw = rawValues[v.variableId] ?? 0;
        return {
          id: v.variableId,
          label: varDef?.label ?? v.variableId,
          normHint: varDef?.normHint ?? "",
          rawValue: raw,
          normalizedValue: varDef?.normalize(raw) ?? 0,
          weight: v.weight,
        };
      }),
    }));

    return {
      member: {
        id: member._id,
        odUserId: member.userId,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email,
        phone: user.phone,
        profileImage: getMediaUrl(user.profilePhoto),
        joinedAt: member.joinedAt,
      },
      attendanceHistory,
      followups: followupsWithUsers,
      isSnoozed,
      snoozedUntil: activeSnooze?.snoozeUntil,
      scoreBreakdown,
      crossGroupAttendance,
      servingHistory,
      toolDisplayName: (group as any)?.toolDisplayNames?.followup || "Follow-up",
      triggeredAlerts,
    };
  },
});

// ============================================================================
// Mutations
// ============================================================================

const csvImportRowValidator = v.object({
  rowNumber: v.number(),
  addedAt: v.optional(v.string()),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
  zipCode: v.optional(v.string()),
  dateOfBirth: v.optional(v.string()),
  notes: v.optional(v.string()),
  assignee: v.optional(v.string()),
  status: v.optional(v.string()),
  customFieldValues: v.optional(v.record(v.string(), v.string())),
});

/**
 * Validator for serialized batch rows passed to the scheduler.
 * These are pre-analyzed rows with parsed values ready for processing.
 */
const csvImportBatchRowValidator = v.object({
  rowNumber: v.number(),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
  zipCode: v.optional(v.string()),
  dateOfBirth: v.optional(v.string()),
  notes: v.optional(v.string()),
  normalizedPhone: v.string(),
  parsedAddedAt: v.optional(v.number()),
  parsedDateOfBirth: v.optional(v.number()),
  parsedStatus: v.optional(v.string()),
  parsedAssigneeId: v.optional(v.id("users")),
  parsedCustomFieldValues: v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
});

const CSV_IMPORT_NOTE_TAG = "[csv import]";
const MAX_CSV_IMPORT_ROWS = 500;
const CSV_IMPORT_BATCH_SIZE = 25;

/**
 * Shared helper that creates or updates a user and ensures they have
 * active community and group memberships. Used by both CSV import and quick-add.
 */
async function ensureUserAndMembership(
  ctx: any,
  prepared: PreparedCsvImportRow,
  group: Doc<"groups">,
  timestamp: number
): Promise<{
  userId: Id<"users">;
  groupMemberId: Id<"groupMembers">;
  createdUser: boolean;
}> {
  const memberTimestamp = prepared.parsedAddedAt ?? timestamp;
  const normalizedEmail = prepared.row.email?.toLowerCase();

  let userId: Id<"users">;
  let createdUser = false;
  if (prepared.existingUser) {
    userId = prepared.existingUser._id;
    const { updates } = getUserProfileUpdates(prepared.existingUser, prepared.row, prepared.parsedDateOfBirth);
    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(userId, updates);
    }
  } else {
    createdUser = true;
    userId = await ctx.db.insert("users", {
      firstName: prepared.row.firstName,
      lastName: prepared.row.lastName,
      phone: prepared.normalizedPhone,
      phoneVerified: false,
      email: normalizedEmail,
      zipCode: prepared.row.zipCode,
      dateOfBirth: prepared.parsedDateOfBirth,
      searchText: buildSearchText({
        firstName: prepared.row.firstName,
        lastName: prepared.row.lastName,
        email: normalizedEmail,
        phone: prepared.normalizedPhone,
      }),
      isActive: true,
      isStaff: false,
      isSuperuser: false,
      dateJoined: memberTimestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  const existingCommunityMembership = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q: any) =>
      q.eq("userId", userId).eq("communityId", group.communityId)
    )
    .first();

  if (!existingCommunityMembership) {
    await ctx.db.insert("userCommunities", {
      userId,
      communityId: group.communityId,
      roles: 1,
      status: 1,
      createdAt: memberTimestamp,
      updatedAt: timestamp,
    });
  } else if (existingCommunityMembership.status !== 1) {
    await ctx.db.patch(existingCommunityMembership._id, {
      status: 1,
      updatedAt: timestamp,
    });
  }

  const existingGroupMembership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q: any) =>
      q.eq("groupId", group._id).eq("userId", userId)
    )
    .first();

  let groupMemberId: Id<"groupMembers">;
  let needsChannelSync = false;
  if (!existingGroupMembership) {
    groupMemberId = await ctx.db.insert("groupMembers", {
      groupId: group._id,
      userId,
      role: "member",
      joinedAt: memberTimestamp,
      notificationsEnabled: true,
    });
    needsChannelSync = true;
  } else if (existingGroupMembership.leftAt) {
    await ctx.db.patch(existingGroupMembership._id, {
      leftAt: undefined,
      role: "member",
      joinedAt: memberTimestamp,
      notificationsEnabled: true,
    });
    groupMemberId = existingGroupMembership._id;
    needsChannelSync = true;
  } else {
    groupMemberId = existingGroupMembership._id;
  }

  if (needsChannelSync) {
    await syncUserChannelMembershipsLogic(ctx, userId, group._id);
  }

  return { userId, groupMemberId, createdUser };
}

/**
 * Apply custom field values to the member's score document, with a scheduler
 * fallback if the score document doesn't exist yet.
 */
async function applyCustomFieldValues(
  ctx: any,
  groupMemberId: Id<"groupMembers">,
  customFieldValues: Record<string, string | number | boolean>,
  timestamp: number
): Promise<void> {
  if (Object.keys(customFieldValues).length === 0) {
    return;
  }

  const scoreDoc = await ctx.db
    .query("memberFollowupScores")
    .withIndex("by_groupMember", (q: any) => q.eq("groupMemberId", groupMemberId))
    .first();

  if (scoreDoc) {
    await ctx.db.patch(scoreDoc._id, {
      ...customFieldValues,
      updatedAt: timestamp,
    });
  } else {
    await ctx.scheduler.runAfter(
      1000,
      internal.functions.memberFollowups.applyCsvImportScorePatch,
      {
        groupMemberId,
        customFieldValues,
      }
    );
  }
}

type CsvImportRow = {
  rowNumber: number;
  addedAt?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  zipCode?: string;
  dateOfBirth?: string;
  notes?: string;
  assignee?: string;
  status?: string;
  customFieldValues?: Record<string, string>;
};

type CsvImportAction = "none" | "create" | "update" | "add" | "reactivate" | "append";

type CsvImportRowReport = {
  rowNumber: number;
  phone?: string;
  status: "ready" | "skipped";
  reasons: string[];
  actions: {
    user: CsvImportAction;
    profileUpdates: string[];
    community: CsvImportAction;
    group: CsvImportAction;
    followup: CsvImportAction;
    notes: CsvImportAction;
      customFields: CsvImportAction;
  };
};

type PreparedCsvImportRow = {
  row: CsvImportRow;
  normalizedPhone: string;
  parsedAddedAt?: number;
  parsedDateOfBirth?: number;
  parsedStatus?: "green" | "orange" | "red";
  parsedAssigneeId?: Id<"users">;
  parsedCustomFieldValues: Record<string, string | number | boolean>;
  existingUser: Doc<"users"> | null;
  rowReport: CsvImportRowReport;
};

const FATAL_CSV_IMPORT_REASONS = new Set([
  "missing_phone",
  "invalid_phone",
  "missing_first_name",
  "duplicate_phone_in_csv",
]);

function hasFatalCsvImportReason(reasons: string[]): boolean {
  return reasons.some((reason) => FATAL_CSV_IMPORT_REASONS.has(reason));
}

function sanitizeCsvValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getNormalizedRow(row: CsvImportRow): CsvImportRow {
  const normalizedCustomValues = Object.fromEntries(
    Object.entries(row.customFieldValues ?? {})
      .map(([slot, value]) => [slot, sanitizeCsvValue(value)])
      .filter(([, value]) => value !== undefined)
  ) as Record<string, string>;

  return {
    rowNumber: row.rowNumber,
    addedAt: sanitizeCsvValue(row.addedAt),
    firstName: sanitizeCsvValue(row.firstName),
    lastName: sanitizeCsvValue(row.lastName),
    phone: sanitizeCsvValue(row.phone),
    email: sanitizeCsvValue(row.email),
    zipCode: sanitizeCsvValue(row.zipCode),
    dateOfBirth: sanitizeCsvValue(row.dateOfBirth),
    notes: sanitizeCsvValue(row.notes),
    assignee: sanitizeCsvValue(row.assignee),
    status: sanitizeCsvValue(row.status),
    customFieldValues: Object.keys(normalizedCustomValues).length > 0
      ? normalizedCustomValues
      : undefined,
  };
}

function parseCsvBoolean(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return undefined;
}

function parseCsvStatus(value: string): "green" | "orange" | "red" | undefined {
  const normalized = value.trim().toLowerCase();
  if (["green", "g"].includes(normalized)) return "green";
  if (["orange", "amber", "yellow", "o", "y"].includes(normalized)) return "orange";
  if (["red", "r"].includes(normalized)) return "red";
  return undefined;
}

function normalizeAssigneeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type CsvAssigneeLookup = {
  byFullName: Map<string, Id<"users">>;
  byFirstName: Map<string, Id<"users">[]>;
  byLastName: Map<string, Id<"users">[]>;
};

function appendAssigneeLookupIndex(
  index: Map<string, Id<"users">[]>,
  key: string,
  userId: Id<"users">
) {
  if (!key) return;
  const existing = index.get(key) ?? [];
  if (!existing.includes(userId)) {
    existing.push(userId);
    index.set(key, existing);
  }
}

async function buildCsvAssigneeLookup(
  ctx: any,
  groupId: Id<"groups">
): Promise<CsvAssigneeLookup> {
  const leaderMemberships = await ctx.db
    .query("groupMembers")
    .withIndex("by_group", (q: any) => q.eq("groupId", groupId))
    .filter((q: any) =>
      q.and(
        q.eq(q.field("leftAt"), undefined),
        q.or(q.eq(q.field("role"), "leader"), q.eq(q.field("role"), "admin"))
      )
    )
    .take(100);

  const userIds = Array.from(new Set(leaderMemberships.map((m: Doc<"groupMembers">) => m.userId)));
  const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));

  const byFullName = new Map<string, Id<"users">>();
  const byFirstName = new Map<string, Id<"users">[]>();
  const byLastName = new Map<string, Id<"users">[]>();

  for (const user of users) {
    if (!user) continue;
    const first = normalizeAssigneeName(user.firstName ?? "");
    const last = normalizeAssigneeName(user.lastName ?? "");
    const full = normalizeAssigneeName(`${user.firstName ?? ""} ${user.lastName ?? ""}`);

    if (full) {
      byFullName.set(full, user._id);
    }
    appendAssigneeLookupIndex(byFirstName, first, user._id);
    appendAssigneeLookupIndex(byLastName, last, user._id);
  }

  return {
    byFullName,
    byFirstName,
    byLastName,
  };
}

function resolveCsvAssignee(
  assignee: string | undefined,
  lookup: CsvAssigneeLookup
): {
  assigneeId?: Id<"users">;
  reason?: string;
} {
  if (!assignee) return {};

  const tokens = Array.from(
    new Set(
      [
        assignee,
        ...assignee
          .split(/[,;]+|&|\/|\band\b/gi)
          .map((token) => token.trim())
          .filter(Boolean),
      ]
        .map(normalizeAssigneeName)
        .filter(Boolean)
    )
  );

  const matchedIds: Id<"users">[] = [];
  let sawAmbiguous = false;

  for (const token of tokens) {
    const fullMatch = lookup.byFullName.get(token);
    if (fullMatch) {
      matchedIds.push(fullMatch);
      continue;
    }

    const firstMatches = lookup.byFirstName.get(token) ?? [];
    if (firstMatches.length === 1) {
      matchedIds.push(firstMatches[0]);
      continue;
    }
    if (firstMatches.length > 1) {
      sawAmbiguous = true;
      continue;
    }

    const lastMatches = lookup.byLastName.get(token) ?? [];
    if (lastMatches.length === 1) {
      matchedIds.push(lastMatches[0]);
      continue;
    }
    if (lastMatches.length > 1) {
      sawAmbiguous = true;
    }
  }

  const uniqueMatches = Array.from(new Set(matchedIds));
  if (uniqueMatches.length === 0) {
    return {
      reason: sawAmbiguous ? "ambiguous_assignee_ignored" : "unknown_assignee_ignored",
    };
  }

  if (uniqueMatches.length > 1) {
    return {
      assigneeId: uniqueMatches[0],
      reason: "multiple_assignees_first_used",
    };
  }

  return { assigneeId: uniqueMatches[0] };
}

function parseCsvCustomFieldValues(
  row: CsvImportRow,
  customFieldDefsBySlot: Map<string, { type: string; options?: string[] }>
): {
  parsedValues: Record<string, string | number | boolean>;
  reasons: string[];
} {
  const parsedValues: Record<string, string | number | boolean> = {};
  const reasons: string[] = [];

  for (const [slot, rawValue] of Object.entries(row.customFieldValues ?? {})) {
    if (!VALID_CUSTOM_SLOTS.has(slot)) {
      reasons.push("unknown_custom_field_slot_ignored");
      continue;
    }
    const definition = customFieldDefsBySlot.get(slot);
    if (!definition) {
      reasons.push("unknown_custom_field_slot_ignored");
      continue;
    }
    const value = sanitizeCsvValue(rawValue);
    if (!value) continue;

    if (definition.type === "number") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        parsedValues[slot] = parsed;
      } else {
        reasons.push("invalid_custom_number_ignored");
      }
      continue;
    }

    if (definition.type === "boolean") {
      const parsed = parseCsvBoolean(value);
      if (parsed === undefined) {
        reasons.push("invalid_custom_boolean_ignored");
      } else {
        parsedValues[slot] = parsed;
      }
      continue;
    }

    if (definition.type === "dropdown") {
      const options = definition.options ?? [];
      if (options.length === 0) {
        parsedValues[slot] = value;
        continue;
      }
      const matchedOption = options.find(
        (option) => option.trim().toLowerCase() === value.trim().toLowerCase()
      );
      if (matchedOption) {
        parsedValues[slot] = matchedOption;
      } else {
        reasons.push("invalid_custom_dropdown_option_ignored");
      }
      continue;
    }

    if (definition.type === "multiselect") {
      const options = definition.options ?? [];
      if (options.length === 0) {
        parsedValues[slot] = value;
        continue;
      }
      const delimiter = value.includes(";") ? /;+/ : /,+/;
      const parts = value.split(delimiter).map((p) => p.trim()).filter(Boolean);
      const validParts: string[] = [];
      for (const part of parts) {
        const matchedOption = options.find(
          (option) => option.trim().toLowerCase() === part.toLowerCase()
        );
        if (matchedOption) {
          validParts.push(matchedOption);
        } else {
          reasons.push("invalid_custom_multiselect_option_ignored");
        }
      }
      const deduplicated = Array.from(new Set(validParts));
      if (deduplicated.length > 0) {
        parsedValues[slot] = deduplicated.join("; ");
      }
      continue;
    }

    parsedValues[slot] = value;
  }

  return {
    parsedValues,
    reasons: Array.from(new Set(reasons)),
  };
}

async function requireImportAccess(
  ctx: any,
  token: string,
  groupId: Id<"groups">
): Promise<{ group: Doc<"groups">; userId: Id<"users"> }> {
  const userId = await requireAuth(ctx, token);
  const group = await ctx.db.get(groupId);
  if (!group) {
    throw new ConvexError("Group not found");
  }

  const membership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q: any) =>
      q.eq("groupId", groupId).eq("userId", userId)
    )
    .first();

  const isLeaderOrAdmin =
    !!membership && !membership.leftAt && (membership.role === "leader" || membership.role === "admin");
  const isCommAdmin = await isCommunityAdmin(ctx, group.communityId, userId);
  if (!isLeaderOrAdmin && !isCommAdmin) {
    throw new ConvexError("Only group leaders or community admins can import CSV members");
  }

  return { group, userId };
}

function getUserProfileUpdates(
  existingUser: Doc<"users">,
  row: CsvImportRow,
  parsedDateOfBirth: number | undefined
): {
  updates: Partial<Doc<"users">>;
  updatedFields: string[];
} {
  const updates: Partial<Doc<"users">> = {};
  const updatedFields: string[] = [];

  if (row.firstName && row.firstName !== existingUser.firstName) {
    updates.firstName = row.firstName;
    updatedFields.push("firstName");
  }
  if (row.lastName && row.lastName !== existingUser.lastName) {
    updates.lastName = row.lastName;
    updatedFields.push("lastName");
  }
  if (row.email) {
    const normalizedEmail = row.email.toLowerCase();
    if (normalizedEmail !== existingUser.email) {
      updates.email = normalizedEmail;
      updatedFields.push("email");
    }
  }
  if (row.zipCode && row.zipCode !== existingUser.zipCode) {
    updates.zipCode = row.zipCode;
    updatedFields.push("zipCode");
  }
  if (
    parsedDateOfBirth !== undefined &&
    parsedDateOfBirth !== existingUser.dateOfBirth
  ) {
    updates.dateOfBirth = parsedDateOfBirth;
    updatedFields.push("dateOfBirth");
  }

  if (updatedFields.length > 0) {
    updates.updatedAt = now();
    updates.searchText = buildSearchText({
      firstName: (updates.firstName as string | undefined) ?? existingUser.firstName,
      lastName: (updates.lastName as string | undefined) ?? existingUser.lastName,
      email: (updates.email as string | undefined) ?? existingUser.email,
      phone: existingUser.phone,
    });
  }

  return { updates, updatedFields };
}

async function getExistingCsvImportNote(
  ctx: any,
  groupMemberId: Id<"groupMembers">
): Promise<Doc<"memberFollowups"> | null> {
  const followups = await ctx.db
    .query("memberFollowups")
    .withIndex("by_groupMember_createdAt", (q: any) => q.eq("groupMemberId", groupMemberId))
    .order("desc")
    .take(100);
  return (
    followups.find(
      (f: Doc<"memberFollowups">) =>
        f.type === "note" &&
        typeof f.content === "string" &&
        f.content.includes(CSV_IMPORT_NOTE_TAG)
    ) ?? null
  );
}

async function analyzeCsvImportRows(
  ctx: any,
  group: Doc<"groups">,
  rows: CsvImportRow[]
): Promise<{
  rowReports: CsvImportRowReport[];
  preparedRows: PreparedCsvImportRow[];
}> {
  const customFieldDefs = ((group.followupColumnConfig as any)?.customFields ?? []) as Array<{
    slot: string;
    type: string;
    options?: string[];
  }>;
  const assigneeLookup = await buildCsvAssigneeLookup(ctx, group._id);
  const customFieldDefsBySlot = new Map(
    customFieldDefs.map((field) => [
      field.slot,
      {
        type: field.type,
        options: field.options,
      },
    ])
  );

  const normalizedRows = rows.map(getNormalizedRow);

  const base = normalizedRows.map((row) => {
    const reasons: string[] = [];
    if (!row.phone) reasons.push("missing_phone");
    if (row.phone && !isValidPhone(row.phone)) reasons.push("invalid_phone");
    if (!row.firstName) reasons.push("missing_first_name");

    let parsedDateOfBirth: number | undefined;
    if (row.dateOfBirth) {
      try {
        parsedDateOfBirth = parseDateOptional(row.dateOfBirth, "dateOfBirth");
      } catch {
        reasons.push("invalid_date_of_birth_ignored");
      }
    }

    let parsedAddedAt: number | undefined;
    if (row.addedAt) {
      try {
        parsedAddedAt = parseDateOptional(row.addedAt, "addedAt");
      } catch {
        reasons.push("invalid_added_at_ignored");
      }
    }

    let parsedStatus: "green" | "orange" | "red" | undefined;
    if (row.status) {
      parsedStatus = parseCsvStatus(row.status);
      if (!parsedStatus) {
        reasons.push("invalid_status_ignored");
      }
    }

    const { assigneeId: parsedAssigneeId, reason: assigneeReason } = resolveCsvAssignee(
      row.assignee,
      assigneeLookup
    );
    if (assigneeReason) {
      reasons.push(assigneeReason);
    }

    const { parsedValues: parsedCustomFieldValues, reasons: customFieldReasons } =
      parseCsvCustomFieldValues(row, customFieldDefsBySlot);
    reasons.push(...customFieldReasons);

    const normalizedPhone = row.phone && isValidPhone(row.phone)
      ? normalizePhone(row.phone)
      : undefined;

    return {
      row,
      reasons,
      normalizedPhone,
      parsedAddedAt,
      parsedDateOfBirth,
      parsedStatus,
      parsedAssigneeId,
      parsedCustomFieldValues,
    };
  });

  const phoneCounts = new Map<string, number>();
  for (const row of base) {
    if (!row.normalizedPhone || hasFatalCsvImportReason(row.reasons)) continue;
    phoneCounts.set(row.normalizedPhone, (phoneCounts.get(row.normalizedPhone) ?? 0) + 1);
  }

  for (const row of base) {
    if (!row.normalizedPhone || hasFatalCsvImportReason(row.reasons)) continue;
    if ((phoneCounts.get(row.normalizedPhone) ?? 0) > 1) {
      row.reasons.push("duplicate_phone_in_csv");
    }
  }

  const uniquePhones = Array.from(
    new Set(
      base
        .filter((r) => !hasFatalCsvImportReason(r.reasons) && r.normalizedPhone)
        .map((r) => r.normalizedPhone!) // safe by filter
    )
  );

  const usersByPhone = new Map<string, Doc<"users"> | null>();
  for (const phone of uniquePhones) {
    const user = await ctx.db
      .query("users")
      .withIndex("by_phone", (q: any) => q.eq("phone", phone))
      .first();
    usersByPhone.set(phone, user ?? null);
  }

  const rowReports: CsvImportRowReport[] = [];
  const preparedRows: PreparedCsvImportRow[] = [];

  for (const item of base) {
    const uniqueReasons = Array.from(new Set(item.reasons));
    const status: "ready" | "skipped" = hasFatalCsvImportReason(uniqueReasons)
      ? "skipped"
      : "ready";

    const report: CsvImportRowReport = {
      rowNumber: item.row.rowNumber,
      phone: item.normalizedPhone,
      status,
      reasons: uniqueReasons,
      actions: {
        user: "none",
        profileUpdates: [],
        community: "none",
        group: "none",
        followup: "none",
        notes: "none",
        customFields: "none",
      },
    };

    if (status === "skipped" || !item.normalizedPhone) {
      rowReports.push(report);
      continue;
    }

    const existingUser = usersByPhone.get(item.normalizedPhone) ?? null;
    report.actions.user = existingUser ? "none" : "create";

    let communityMembership: Doc<"userCommunities"> | null = null;
    let groupMembership: Doc<"groupMembers"> | null = null;

    if (existingUser) {
      const { updatedFields } = getUserProfileUpdates(existingUser, item.row, item.parsedDateOfBirth);
      report.actions.profileUpdates = updatedFields;
      if (updatedFields.length > 0) {
        report.actions.user = "update";
      }

      communityMembership = await ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q: any) =>
          q.eq("userId", existingUser._id).eq("communityId", group.communityId)
        )
        .first();

      groupMembership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q: any) =>
          q.eq("groupId", group._id).eq("userId", existingUser._id)
        )
        .first();
    }

    if (!existingUser || !communityMembership) {
      report.actions.community = "add";
    } else if (communityMembership.status !== 1) {
      report.actions.community = "reactivate";
    }

    if (!existingUser || !groupMembership) {
      report.actions.group = "add";
    } else if (groupMembership.leftAt) {
      report.actions.group = "reactivate";
    }

    if (report.actions.group !== "none") {
      report.actions.followup = "create";
    } else if (groupMembership) {
      const scoreDoc = await ctx.db
        .query("memberFollowupScores")
        .withIndex("by_groupMember", (q: any) => q.eq("groupMemberId", groupMembership._id))
        .first();
      if (!scoreDoc) {
        report.actions.followup = "create";
      }
    }

    if (item.row.notes) {
      if (groupMembership) {
        const existingCsvNote = await getExistingCsvImportNote(ctx, groupMembership._id);
        report.actions.notes = existingCsvNote ? "append" : "create";
      } else {
        report.actions.notes = "create";
      }
    }
    if (Object.keys(item.parsedCustomFieldValues).length > 0) {
      report.actions.customFields = "update";
    }

    rowReports.push(report);
    preparedRows.push({
      row: item.row,
      normalizedPhone: item.normalizedPhone,
      parsedAddedAt: item.parsedAddedAt,
      parsedDateOfBirth: item.parsedDateOfBirth,
      parsedStatus: item.parsedStatus,
      parsedAssigneeId: item.parsedAssigneeId,
      parsedCustomFieldValues: item.parsedCustomFieldValues,
      existingUser,
      rowReport: report,
    });
  }

  return { rowReports, preparedRows };
}

function buildCsvImportSummary(rowReports: CsvImportRowReport[]) {
  const summary = {
    totalRows: rowReports.length,
    readyRows: rowReports.filter((r) => r.status === "ready").length,
    skippedRows: rowReports.filter((r) => r.status === "skipped").length,
    duplicateRows: rowReports.filter((r) => r.reasons.includes("duplicate_phone_in_csv")).length,
    invalidPhoneRows: rowReports.filter((r) => r.reasons.includes("invalid_phone") || r.reasons.includes("missing_phone")).length,
    missingFirstNameRows: rowReports.filter((r) => r.reasons.includes("missing_first_name")).length,
    usersToCreate: rowReports.filter((r) => r.actions.user === "create").length,
    usersToUpdate: rowReports.filter((r) => r.actions.user === "update").length,
    communityAdds: rowReports.filter((r) => r.actions.community === "add").length,
    communityReactivations: rowReports.filter((r) => r.actions.community === "reactivate").length,
    groupAdds: rowReports.filter((r) => r.actions.group === "add").length,
    groupReactivations: rowReports.filter((r) => r.actions.group === "reactivate").length,
    followupCreates: rowReports.filter((r) => r.actions.followup === "create").length,
    notesCreates: rowReports.filter((r) => r.actions.notes === "create").length,
    notesAppends: rowReports.filter((r) => r.actions.notes === "append").length,
    customFieldUpdates: rowReports.filter((r) => r.actions.customFields === "update").length,
  };
  return summary;
}

export const applyCsvImportScorePatch = internalMutation({
  args: {
    groupMemberId: v.id("groupMembers"),
    status: v.optional(v.string()),
    assigneeId: v.optional(v.id("users")),
    customFieldValues: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean()))),
    retryCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const validCustomPatch = Object.fromEntries(
      Object.entries(args.customFieldValues ?? {}).filter(([slot]) => VALID_CUSTOM_SLOTS.has(slot))
    );
    const metadataPatch: Record<string, string | Id<"users">> = {};
    if (args.status) metadataPatch.status = args.status;
    if (args.assigneeId) metadataPatch.assigneeId = args.assigneeId;

    const fullPatch = {
      ...metadataPatch,
      ...validCustomPatch,
    };
    if (Object.keys(fullPatch).length === 0) {
      return { applied: false };
    }

    const scoreDoc = await ctx.db
      .query("memberFollowupScores")
      .withIndex("by_groupMember", (q) => q.eq("groupMemberId", args.groupMemberId))
      .first();

    if (scoreDoc) {
      await ctx.db.patch(scoreDoc._id, {
        ...fullPatch,
        updatedAt: now(),
      });
      return { applied: true };
    }

    const retryCount = args.retryCount ?? 0;
    if (retryCount < 5) {
      await ctx.scheduler.runAfter(
        1000,
        internal.functions.memberFollowups.applyCsvImportScorePatch,
        {
          groupMemberId: args.groupMemberId,
          status: args.status,
          assigneeId: args.assigneeId,
          customFieldValues: validCustomPatch,
          retryCount: retryCount + 1,
        }
      );
    }
    return { applied: false, retried: retryCount < 5 };
  },
});

/**
 * Internal mutation that processes a batch of pre-analyzed CSV import rows.
 * Called via scheduler from applyCsvImport to stay under the 32K document read limit.
 */
export const applyCsvImportBatch = internalMutation({
  args: {
    groupId: v.id("groups"),
    importedById: v.id("users"),
    timestamp: v.number(),
    batchRows: v.array(csvImportBatchRowValidator),
  },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    if (!group) return;

    for (const batchRow of args.batchRows) {
      // Reconstruct the PreparedCsvImportRow from serialized data
      const existingUser = await ctx.db
        .query("users")
        .withIndex("by_phone", (q: any) => q.eq("phone", batchRow.normalizedPhone))
        .first();

      const prepared: PreparedCsvImportRow = {
        row: {
          rowNumber: batchRow.rowNumber,
          firstName: batchRow.firstName,
          lastName: batchRow.lastName,
          phone: batchRow.phone,
          email: batchRow.email,
          zipCode: batchRow.zipCode,
          dateOfBirth: batchRow.dateOfBirth,
          notes: batchRow.notes,
        },
        normalizedPhone: batchRow.normalizedPhone,
        parsedAddedAt: batchRow.parsedAddedAt,
        parsedDateOfBirth: batchRow.parsedDateOfBirth,
        parsedStatus: batchRow.parsedStatus as PreparedCsvImportRow["parsedStatus"],
        parsedAssigneeId: batchRow.parsedAssigneeId,
        parsedCustomFieldValues: batchRow.parsedCustomFieldValues,
        existingUser: existingUser ?? null,
        rowReport: {
          rowNumber: batchRow.rowNumber,
          phone: batchRow.normalizedPhone,
          status: "ready",
          reasons: [],
          actions: { user: "none", profileUpdates: [], community: "none", group: "none", followup: "none", notes: "none", customFields: "none" },
        },
      };

      const { groupMemberId } = await ensureUserAndMembership(ctx, prepared, group, args.timestamp);

      if (batchRow.notes) {
        const existingCsvNote = await getExistingCsvImportNote(ctx, groupMemberId);
        if (existingCsvNote) {
          // Strip existing tag, append new note, re-add tag at bottom
          const withoutTag = existingCsvNote.content?.replace(/\n?\[csv import\]$/m, "").trim() ?? "";
          const nextContent = `${withoutTag}\n${batchRow.notes}\n${CSV_IMPORT_NOTE_TAG}`;
          await ctx.db.patch(existingCsvNote._id, {
            content: nextContent,
            createdAt: args.timestamp,
            createdById: args.importedById,
          });
        } else {
          await ctx.db.insert("memberFollowups", {
            groupMemberId,
            createdById: args.importedById,
            type: "note",
            content: `${batchRow.notes}\n${CSV_IMPORT_NOTE_TAG}`,
            createdAt: args.timestamp,
          });
        }
      }

      const scorePatch: Record<string, string | number | boolean | Id<"users">> = {
        ...batchRow.parsedCustomFieldValues,
      };
      if (batchRow.parsedStatus) {
        scorePatch.status = batchRow.parsedStatus;
      }
      if (batchRow.parsedAssigneeId) {
        scorePatch.assigneeId = batchRow.parsedAssigneeId;
      }

      if (Object.keys(scorePatch).length > 0) {
        const scoreDoc = await ctx.db
          .query("memberFollowupScores")
          .withIndex("by_groupMember", (q: any) => q.eq("groupMemberId", groupMemberId))
          .first();

        if (scoreDoc) {
          await ctx.db.patch(scoreDoc._id, {
            ...scorePatch,
            updatedAt: args.timestamp,
          });
        } else {
          await ctx.scheduler.runAfter(
            1000,
            internal.functions.memberFollowups.applyCsvImportScorePatch,
            {
              groupMemberId,
              status: batchRow.parsedStatus,
              assigneeId: batchRow.parsedAssigneeId,
              customFieldValues: Object.keys(batchRow.parsedCustomFieldValues).length > 0
                ? batchRow.parsedCustomFieldValues
                : undefined,
            }
          );
        }
      }

      await ctx.scheduler.runAfter(
        0,
        internal.functions.followupScoreComputation.computeSingleMemberScore,
        {
          groupId: group._id,
          groupMemberId,
          status: batchRow.parsedStatus,
          assigneeId: batchRow.parsedAssigneeId,
        }
      );
    }
  },
});

/**
 * One-time backfill: reformat existing CSV import notes so the actual note
 * text is on top and the [csv import] tag is at the bottom.
 *
 * Run via: npx convex run --prod functions/memberFollowups:backfillCsvImportNotes
 */
export const backfillCsvImportNotes = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allNotes = await ctx.db
      .query("memberFollowups")
      .filter((q: any) => q.eq(q.field("type"), "note"))
      .collect();

    const csvNotes = allNotes.filter(
      (n) => typeof n.content === "string" && n.content.includes(CSV_IMPORT_NOTE_TAG)
    );

    let updated = 0;
    for (const note of csvNotes) {
      const content = note.content as string;

      // Already in new format (tag at end, not at start)
      if (!content.startsWith(CSV_IMPORT_NOTE_TAG)) continue;

      // Old format: "[csv import]\n2026-03-11T02:12:34.622Z - actual note text"
      // New format: "actual note text\n[csv import]"
      const lines = content.split("\n").filter((l) => l.trim().length > 0);

      const noteLines: string[] = [];
      for (const line of lines) {
        if (line === CSV_IMPORT_NOTE_TAG) continue;
        // Strip "2026-03-11T02:12:34.622Z - " prefix from note lines
        const match = line.match(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*-\s*(.+)$/);
        if (match) {
          noteLines.push(match[1]);
        } else {
          noteLines.push(line);
        }
      }

      const newContent = `${noteLines.join("\n")}\n${CSV_IMPORT_NOTE_TAG}`;

      await ctx.db.patch(note._id, { content: newContent });
      updated++;
    }

    return { total: csvNotes.length, updated };
  },
});

export const applyQuickAddFollowupPatch = internalMutation({
  args: {
    groupId: v.id("groups"),
    groupMemberId: v.id("groupMembers"),
    status: v.optional(v.string()),
    assigneeId: v.optional(v.id("users")),
    retryCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};
    if (args.status !== undefined) {
      patch.status = args.status;
    }
    if (args.assigneeId !== undefined) {
      patch.assigneeId = args.assigneeId;
    }
    if (Object.keys(patch).length === 0) {
      return { applied: false };
    }

    const scoreDoc = await ctx.db
      .query("memberFollowupScores")
      .withIndex("by_groupMember", (q) => q.eq("groupMemberId", args.groupMemberId))
      .first();

    if (scoreDoc) {
      // Only patch fields that haven't been modified by another user since quick-add.
      // If current value is undefined, we set it. If it differs from what we want to set,
      // another user changed it and we should not overwrite their change.
      const safePatch: Record<string, unknown> = {};
      if (args.status !== undefined && scoreDoc.status === undefined) {
        safePatch.status = args.status;
      }
      if (args.assigneeId !== undefined && scoreDoc.assigneeId === undefined) {
        safePatch.assigneeId = args.assigneeId;
      }
      if (Object.keys(safePatch).length > 0) {
        await ctx.db.patch(scoreDoc._id, {
          ...safePatch,
          updatedAt: now(),
        });
      }
      // Send notification if assigneeId was requested and is now set (either by us or atomically by computeSingleMemberScore)
      if (args.assigneeId && (safePatch.assigneeId || scoreDoc.assigneeId === args.assigneeId)) {
        await ctx.scheduler.runAfter(0, internal.functions.notifications.senders.notifyFollowupAssigned, {
          assigneeId: args.assigneeId,
          groupId: args.groupId,
          groupMemberId: args.groupMemberId,
        });
      }
      return { applied: Object.keys(safePatch).length > 0 };
    }

    const retryCount = args.retryCount ?? 0;
    if (retryCount < 5) {
      await ctx.scheduler.runAfter(
        1000,
        internal.functions.memberFollowups.applyQuickAddFollowupPatch,
        {
          groupId: args.groupId,
          groupMemberId: args.groupMemberId,
          status: args.status,
          assigneeId: args.assigneeId,
          retryCount: retryCount + 1,
        }
      );
    }
    return { applied: false, retried: retryCount < 5 };
  },
});

export const previewCsvImport = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    rows: v.array(csvImportRowValidator),
  },
  handler: async (ctx, args) => {
    if (args.rows.length === 0) {
      throw new ConvexError("CSV import is empty");
    }
    if (args.rows.length > MAX_CSV_IMPORT_ROWS) {
      throw new ConvexError(`CSV import is limited to ${MAX_CSV_IMPORT_ROWS} rows`);
    }

    const { group } = await requireImportAccess(ctx, args.token, args.groupId);
    const { rowReports } = await analyzeCsvImportRows(ctx, group, args.rows);

    return {
      summary: buildCsvImportSummary(rowReports),
      rows: rowReports,
    };
  },
});

export const applyCsvImport = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    rows: v.array(csvImportRowValidator),
  },
  handler: async (ctx, args) => {
    if (args.rows.length === 0) {
      throw new ConvexError("CSV import is empty");
    }
    if (args.rows.length > MAX_CSV_IMPORT_ROWS) {
      throw new ConvexError(`CSV import is limited to ${MAX_CSV_IMPORT_ROWS} rows`);
    }

    const { group, userId: importedById } = await requireImportAccess(ctx, args.token, args.groupId);
    const { rowReports, preparedRows } = await analyzeCsvImportRows(ctx, group, args.rows);
    const timestamp = now();

    // Serialize ready rows for batch scheduling
    const readyRows = preparedRows
      .filter((p) => p.rowReport.status === "ready")
      .map((p) => ({
        rowNumber: p.row.rowNumber,
        firstName: p.row.firstName,
        lastName: p.row.lastName,
        phone: p.row.phone,
        email: p.row.email,
        zipCode: p.row.zipCode,
        dateOfBirth: p.row.dateOfBirth,
        notes: p.row.notes,
        normalizedPhone: p.normalizedPhone,
        parsedAddedAt: p.parsedAddedAt,
        parsedDateOfBirth: p.parsedDateOfBirth,
        parsedStatus: p.parsedStatus,
        parsedAssigneeId: p.parsedAssigneeId,
        parsedCustomFieldValues: p.parsedCustomFieldValues,
      }));

    // Schedule batches of rows for processing in separate transactions
    for (let i = 0; i < readyRows.length; i += CSV_IMPORT_BATCH_SIZE) {
      const batch = readyRows.slice(i, i + CSV_IMPORT_BATCH_SIZE);
      await ctx.scheduler.runAfter(
        0,
        internal.functions.memberFollowups.applyCsvImportBatch,
        {
          groupId: group._id,
          importedById,
          timestamp,
          batchRows: batch,
        }
      );
    }

    return {
      summary: buildCsvImportSummary(rowReports),
      rows: rowReports,
    };
  },
});

export const quickAddRow = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    firstName: v.string(),
    phone: v.string(),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    dateOfBirth: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.optional(v.string()),
    assigneeId: v.optional(v.id("users")),
    customFieldValues: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args) => {
    const normalizedStatus = args.status?.trim().toLowerCase();
    if (
      normalizedStatus !== undefined &&
      normalizedStatus.length > 0 &&
      normalizedStatus !== "green" &&
      normalizedStatus !== "orange" &&
      normalizedStatus !== "red"
    ) {
      throw new ConvexError("Status must be green, orange, or red");
    }

    const { group, userId: importedById } = await requireImportAccess(ctx, args.token, args.groupId);

    if (args.assigneeId) {
      const leaderMembership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q: any) =>
          q.eq("groupId", group._id).eq("userId", args.assigneeId)
        )
        .first();
      if (!leaderMembership || leaderMembership.leftAt || (leaderMembership.role !== "leader" && leaderMembership.role !== "admin")) {
        throw new ConvexError("Assignee must be an active group leader or admin");
      }
    }

    const row: CsvImportRow = {
      rowNumber: 2,
      firstName: args.firstName,
      lastName: args.lastName,
      phone: args.phone,
      email: args.email,
      zipCode: args.zipCode,
      dateOfBirth: args.dateOfBirth,
      notes: args.notes,
      customFieldValues: args.customFieldValues,
    };

    const { rowReports, preparedRows } = await analyzeCsvImportRows(ctx, group, [row]);
    const report = rowReports[0];
    const prepared = preparedRows[0];
    if (!report || report.status !== "ready" || !prepared) {
      const reason = report?.reasons?.join(", ") || "invalid_data";
      throw new ConvexError(`Could not add member: ${reason}`);
    }

    const timestamp = now();

    const { userId, groupMemberId, createdUser } = await ensureUserAndMembership(ctx, prepared, group, timestamp);

    if (prepared.row.notes) {
      await ctx.db.insert("memberFollowups", {
        groupMemberId,
        createdById: importedById,
        type: "note",
        content: prepared.row.notes,
        createdAt: timestamp,
      });
    }

    await applyCustomFieldValues(ctx, groupMemberId, prepared.parsedCustomFieldValues, timestamp);

    await ctx.scheduler.runAfter(
      0,
      internal.functions.followupScoreComputation.computeSingleMemberScore,
      {
        groupId: group._id,
        groupMemberId,
        status: normalizedStatus || undefined,
        assigneeId: args.assigneeId,
      }
    );

    if (normalizedStatus || args.assigneeId) {
      // Patch serves as fallback (if action races) and triggers notification
      await ctx.scheduler.runAfter(
        500,
        internal.functions.memberFollowups.applyQuickAddFollowupPatch,
        {
          groupId: group._id,
          groupMemberId,
          status: normalizedStatus || undefined,
          assigneeId: args.assigneeId,
        }
      );
    }

    return {
      groupMemberId,
      userId,
      createdUser,
      row: report,
    };
  },
});

/**
 * Add a follow-up entry (note, call, text, or followed_up)
 */
export const add = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    memberId: v.id("groupMembers"),
    type: followupTypeValidator,
    content: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const timestamp = now();

    // Verify member belongs to this group
    const member = await ctx.db.get(args.memberId);
    if (!member || member.groupId !== args.groupId) {
      throw new Error("Member not found in this group");
    }

    // Create follow-up entry
    const followupId = await ctx.db.insert("memberFollowups", {
      groupMemberId: args.memberId,
      createdById: userId,
      type: args.type,
      content: args.content,
      createdAt: timestamp,
    });

    const createdByUser = await ctx.db.get(userId);

    // Trigger score recomputation for this member
    await ctx.scheduler.runAfter(
      0,
      internal.functions.followupScoreComputation.computeSingleMemberScore,
      { groupId: args.groupId, groupMemberId: args.memberId }
    );

    return {
      id: followupId,
      type: args.type as "note" | "call" | "text" | "followed_up",
      content: args.content,
      createdAt: timestamp,
      createdBy: createdByUser
        ? {
            id: createdByUser._id,
            firstName: createdByUser.firstName || "",
            lastName: createdByUser.lastName || "",
          }
        : null,
    };
  },
});

/**
 * Snooze a member for a specified duration
 */
export const snooze = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    memberId: v.id("groupMembers"),
    duration: snoozeDurationValidator,
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const timestamp = now();

    // Verify member belongs to this group
    const member = await ctx.db.get(args.memberId);
    if (!member || member.groupId !== args.groupId) {
      throw new Error("Member not found in this group");
    }

    // Calculate snooze end date
    let snoozeUntil = timestamp;
    const DAY_MS = 24 * 60 * 60 * 1000;

    switch (args.duration) {
      case "1_week":
        snoozeUntil += 7 * DAY_MS;
        break;
      case "2_weeks":
        snoozeUntil += 14 * DAY_MS;
        break;
      case "1_month":
        snoozeUntil += 30 * DAY_MS;
        break;
      case "3_months":
        snoozeUntil += 90 * DAY_MS;
        break;
    }

    // Duration labels for content
    const durationLabels: Record<string, string> = {
      "1_week": "1 week",
      "2_weeks": "2 weeks",
      "1_month": "1 month",
      "3_months": "3 months",
    };

    const content = args.note
      ? `Snoozed for ${durationLabels[args.duration]}: ${args.note}`
      : `Snoozed for ${durationLabels[args.duration]}`;

    // Create snooze entry
    const followupId = await ctx.db.insert("memberFollowups", {
      groupMemberId: args.memberId,
      createdById: userId,
      type: "snooze",
      content,
      snoozeUntil,
      createdAt: timestamp,
    });

    const createdByUser = await ctx.db.get(userId);

    // Trigger score recomputation for this member
    await ctx.scheduler.runAfter(
      0,
      internal.functions.followupScoreComputation.computeSingleMemberScore,
      { groupId: args.groupId, groupMemberId: args.memberId }
    );

    return {
      id: followupId,
      type: "snooze" as const,
      content,
      snoozeUntil,
      createdAt: timestamp,
      createdBy: createdByUser
        ? {
            id: createdByUser._id,
            firstName: createdByUser.firstName || "",
            lastName: createdByUser.lastName || "",
          }
        : null,
    };
  },
});

/**
 * Update attendance for a member at a specific meeting
 */
export const updateAttendance = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    meetingId: v.id("meetings"),
    targetUserId: v.id("users"),
    status: v.number(), // 0 = absent, 1 = present
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const timestamp = now();

    // Verify meeting belongs to this group
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting || meeting.groupId !== args.groupId) {
      throw new Error("Meeting not found in this group");
    }

    // Check for existing attendance record
    const existing = await ctx.db
      .query("meetingAttendances")
      .withIndex("by_meeting_user", (q) =>
        q.eq("meetingId", args.meetingId).eq("userId", args.targetUserId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        recordedById: userId,
        recordedAt: timestamp,
      });
    } else {
      // Create new attendance record
      await ctx.db.insert("meetingAttendances", {
        meetingId: args.meetingId,
        userId: args.targetUserId,
        status: args.status,
        recordedById: userId,
        recordedAt: timestamp,
      });
    }

    // Recompute scores after attendance change
    const groupMember = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("userId"), args.targetUserId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();
    if (groupMember) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.followupScoreComputation.computeSingleMemberScore,
        { groupId: args.groupId, groupMemberId: groupMember._id }
      );
    }

    return {
      meetingId: args.meetingId,
      odUserId: args.targetUserId,
      status: args.status,
    };
  },
});

/**
 * Unsnooze a member (cancel active snooze)
 */
export const unsnooze = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    memberId: v.id("groupMembers"),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.token);
    const currentTime = now();

    // Verify member belongs to this group
    const member = await ctx.db.get(args.memberId);
    if (!member || member.groupId !== args.groupId) {
      throw new Error("Member not found in this group");
    }

    // Find active snooze
    const activeSnooze = await ctx.db
      .query("memberFollowups")
      .withIndex("by_groupMember", (q) => q.eq("groupMemberId", args.memberId))
      .filter((q) =>
        q.and(
          q.eq(q.field("type"), "snooze"),
          q.gt(q.field("snoozeUntil"), currentTime)
        )
      )
      .first();

    if (!activeSnooze) {
      throw new Error("No active snooze found");
    }

    // Update snooze to end now
    await ctx.db.patch(activeSnooze._id, {
      snoozeUntil: currentTime,
      content: `${activeSnooze.content} (cancelled early)`,
    });

    // Trigger score recomputation for this member
    await ctx.scheduler.runAfter(
      0,
      internal.functions.followupScoreComputation.computeSingleMemberScore,
      { groupId: args.groupId, groupMemberId: args.memberId }
    );

    return { success: true };
  },
});

/**
 * Delete a follow-up entry (only the creator can delete their own entries)
 */
export const deleteFollowup = mutation({
  args: {
    token: v.string(),
    followupId: v.id("memberFollowups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const followup = await ctx.db.get(args.followupId);
    if (!followup) {
      throw new ConvexError("Follow-up entry not found");
    }

    if (followup.createdById !== userId) {
      throw new ConvexError("You can only delete your own follow-up entries");
    }

    const groupMember = await ctx.db.get(followup.groupMemberId);

    await ctx.db.delete(args.followupId);

    // Trigger score recomputation for this member
    if (groupMember) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.followupScoreComputation.computeSingleMemberScore,
        { groupId: groupMember.groupId, groupMemberId: followup.groupMemberId }
      );
    }

    return { success: true };
  },
});

// ============================================================================
// Manual Field Mutations (Phase 2 — desktop spreadsheet)
// ============================================================================

/**
 * Helper: verify caller is leader/admin of the group and return the score doc.
 */
async function requireLeaderAndGetScoreDoc(
  ctx: any,
  token: string,
  groupId: Id<"groups">,
  groupMemberId: Id<"groupMembers">,
) {
  const userId = await requireAuth(ctx, token);

  // Verify caller is leader/admin
  const callerMembership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q: any) =>
      q.eq("groupId", groupId).eq("userId", userId)
    )
    .first();

  if (!callerMembership || (callerMembership.role !== "leader" && callerMembership.role !== "admin")) {
    throw new ConvexError("Only leaders and admins can update this field");
  }

  // Find score doc
  const scoreDoc = await ctx.db
    .query("memberFollowupScores")
    .withIndex("by_groupMember", (q: any) => q.eq("groupMemberId", groupMemberId))
    .first();

  if (!scoreDoc) {
    throw new ConvexError("Member score record not found");
  }

  return scoreDoc;
}

/**
 * Set or clear the assignee for a member's followup score doc.
 */
export const setAssignee = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    groupMemberId: v.id("groupMembers"),
    assigneeId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const scoreDoc = await requireLeaderAndGetScoreDoc(
      ctx, args.token, args.groupId, args.groupMemberId
    );
    await ctx.db.patch(scoreDoc._id, {
      assigneeId: args.assigneeId,
      updatedAt: Date.now(),
    });

    // Notify the assignee (skip if clearing assignment)
    if (args.assigneeId) {
      await ctx.scheduler.runAfter(0, internal.functions.notifications.senders.notifyFollowupAssigned, {
        assigneeId: args.assigneeId,
        groupId: args.groupId,
        groupMemberId: args.groupMemberId,
      });
    }

    return { success: true };
  },
});

/**
 * Set or clear the status for a member's followup score doc.
 */
export const setStatus = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    groupMemberId: v.id("groupMembers"),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scoreDoc = await requireLeaderAndGetScoreDoc(
      ctx, args.token, args.groupId, args.groupMemberId
    );
    await ctx.db.patch(scoreDoc._id, {
      status: args.status,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

/**
 * Set or clear the connection point for a member's followup score doc.
 */
export const setConnectionPoint = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    groupMemberId: v.id("groupMembers"),
    connectionPoint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scoreDoc = await requireLeaderAndGetScoreDoc(
      ctx, args.token, args.groupId, args.groupMemberId
    );
    await ctx.db.patch(scoreDoc._id, {
      connectionPoint: args.connectionPoint,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

/**
 * Set or clear a custom field value on a member's followup score doc.
 * Validates that the slot name is valid and the value type matches the slot prefix.
 */
export const setCustomField = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    groupMemberId: v.id("groupMembers"),
    slot: v.string(),
    value: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    if (!VALID_CUSTOM_SLOTS.has(args.slot)) {
      throw new ConvexError(`Invalid custom field slot: ${args.slot}`);
    }

    // Validate value type matches slot prefix
    if (args.value !== undefined && args.value !== null) {
      if (args.slot.startsWith("customText") && typeof args.value !== "string") {
        throw new ConvexError(`Slot ${args.slot} requires a string value`);
      }
      if (args.slot.startsWith("customNum") && typeof args.value !== "number") {
        throw new ConvexError(`Slot ${args.slot} requires a number value`);
      }
      if (args.slot.startsWith("customBool") && typeof args.value !== "boolean") {
        throw new ConvexError(`Slot ${args.slot} requires a boolean value`);
      }
    }

    const scoreDoc = await requireLeaderAndGetScoreDoc(
      ctx, args.token, args.groupId, args.groupMemberId
    );

    await ctx.db.patch(scoreDoc._id, {
      [args.slot]: args.value ?? undefined,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});
