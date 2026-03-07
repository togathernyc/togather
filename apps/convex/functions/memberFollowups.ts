/**
 * Member Followup functions
 *
 * Handles all follow-up related operations for group leaders:
 * - List members needing follow-up (with priority scoring)
 * - View member's follow-up history
 * - Add follow-up entries (notes, calls, texts, etc.)
 * - Snooze members
 * - Update attendance records
 */

import { v, ConvexError } from "convex/values";
import { query, mutation, internalQuery } from "../_generated/server";
import { paginationOptsValidator } from "convex/server";
import { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { now, getMediaUrl } from "../lib/utils";
import { requireAuth } from "../lib/auth";
import {
  DEFAULT_SCORE_CONFIG,
  extractRawValues,
  calculateAllScores,
  evaluateAlerts,
  VARIABLE_MAP,
  type ScoreConfig,
  type PcoServingData,
} from "./followupScoring";

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

    const meetings = await ctx.db
      .query("meetings")
      .withIndex("by_group_status", (q) =>
        q.eq("groupId", args.groupId).eq("status", "completed")
      )
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
 * Fetch a page of active members using cursor-based pagination.
 * Avoids Convex's 8192 array length limit on return values.
 */
export const internalGetMemberPage = internalQuery({
  args: {
    groupId: v.id("groups"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .paginate(args.paginationOpts);

    return {
      members: result.page.map((m) => ({
        _id: m._id,
        userId: m.userId,
        joinedAt: m.joinedAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
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
            undefined
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
        const latestNoteContent = latestNoteEntry?.content?.slice(0, 200) ?? null;
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
    groupId: v.id("groups"),
    sortBy: v.optional(v.string()),
    sortDirection: v.optional(v.string()),
    statusFilter: v.optional(v.string()),
    assigneeFilter: v.optional(v.id("users")),
    attendanceMax: v.optional(v.number()),
    attendanceMin: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
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
    const hasFilters = args.statusFilter || args.assigneeFilter ||
                       args.attendanceMax !== undefined || args.attendanceMin !== undefined;
    if (hasFilters) {
      q = q.filter((fq) => {
        const conds: any[] = [];
        if (args.statusFilter) conds.push(fq.eq(fq.field("status"), args.statusFilter));
        if (args.assigneeFilter) conds.push(fq.eq(fq.field("assigneeId"), args.assigneeFilter));
        if (args.attendanceMax !== undefined) conds.push(fq.lt(fq.field("attendanceScore"), args.attendanceMax));
        if (args.attendanceMin !== undefined) conds.push(fq.gt(fq.field("attendanceScore"), args.attendanceMin));
        return conds.length === 1 ? conds[0] : fq.and(...(conds as [any, any, ...any[]]));
      });
    }

    return q.paginate(args.paginationOpts);
  },
});

/**
 * Get followup config for a group (called once, not per-page).
 * Returns score config, display name, and member subtitle settings.
 */
export const getFollowupConfig = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    if (!group) return null;

    const scoreConfig: ScoreConfig = group.followupScoreConfig ?? DEFAULT_SCORE_CONFIG;

    return {
      scoreConfigScores: scoreConfig.scores.map((s) => ({ id: s.id, name: s.name })),
      toolDisplayName: (group as any)?.toolDisplayNames?.followup || "Follow-up",
      memberSubtitle: (group?.followupScoreConfig as any)?.memberSubtitle || "",
      followupColumnConfig: group.followupColumnConfig ?? null,
    };
  },
});

/**
 * Search members by name/email/phone using full-text search index.
 * Returns up to 200 results ordered by relevance.
 */
export const search = query({
  args: {
    groupId: v.id("groups"),
    searchText: v.string(),
    statusFilter: v.optional(v.string()),
    assigneeFilter: v.optional(v.id("users")),
    attendanceMax: v.optional(v.number()),
    attendanceMin: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let results = ctx.db
      .query("memberFollowupScores")
      .withSearchIndex("search_followup", (q) => {
        let sq = q.search("searchText", args.searchText).eq("groupId", args.groupId);
        if (args.statusFilter) sq = sq.eq("status", args.statusFilter);
        if (args.assigneeFilter) sq = sq.eq("assigneeId", args.assigneeFilter);
        return sq;
      });

    // Range filters via .filter()
    if (args.attendanceMax !== undefined || args.attendanceMin !== undefined) {
      results = results.filter((fq) => {
        const conds: any[] = [];
        if (args.attendanceMax !== undefined)
          conds.push(fq.lt(fq.field("attendanceScore"), args.attendanceMax));
        if (args.attendanceMin !== undefined)
          conds.push(fq.gt(fq.field("attendanceScore"), args.attendanceMin));
        return conds.length === 1 ? conds[0] : fq.and(...(conds as [any, any, ...any[]]));
      });
    }

    return await results.take(200);
  },
});

/**
 * Get total member count for a group.
 */
export const count = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("memberFollowupScores")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    return all.length;
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
    const meetings = await ctx.db
      .query("meetings")
      .withIndex("by_group_status", (q) =>
        q.eq("groupId", args.groupId).eq("status", "completed")
      )
      .filter((q) => q.gte(q.field("scheduledAt"), attendanceCutoff))
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

      const otherMeetings = await ctx.db
        .query("meetings")
        .withIndex("by_group_status", (q) =>
          q.eq("groupId", otherMember.groupId).eq("status", "completed")
        )
        .filter((q) => q.gte(q.field("scheduledAt"), sixtyDaysAgo))
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

      return {
        meetingId: args.meetingId,
        odUserId: args.targetUserId,
        status: args.status,
      };
    }

    // Create new attendance record
    await ctx.db.insert("meetingAttendances", {
      meetingId: args.meetingId,
      userId: args.targetUserId,
      status: args.status,
      recordedById: userId,
      recordedAt: timestamp,
    });

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
const VALID_CUSTOM_SLOTS = new Set([
  "customText1","customText2","customText3","customText4","customText5",
  "customNum1","customNum2","customNum3","customNum4","customNum5",
  "customBool1","customBool2","customBool3","customBool4","customBool5",
]);

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
