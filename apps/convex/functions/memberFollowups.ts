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
import { query, mutation } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
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
// Queries
// ============================================================================

/**
 * Get ranked list of members needing follow-up
 *
 * Returns { members, scoreConfig } where scoreConfig describes the active scores.
 * When the group has no custom followupScoreConfig, uses the default
 * Attendance + Connection scores (exact backward compat behavior).
 */
export const list = query({
  args: {
    groupId: v.id("groups"),
    sortBy: v.optional(sortByValidator),
    sortDirection: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  handler: async (ctx, args) => {
    const sortDirection = args.sortDirection || "asc";
    const currentTime = now();

    // Fetch group to read followupScoreConfig
    const group = await ctx.db.get(args.groupId);
    const scoreConfig: ScoreConfig = group?.followupScoreConfig ?? DEFAULT_SCORE_CONFIG;
    const useCustomScoring = !!group?.followupScoreConfig;

    // Default sortBy to the first score in the config
    const sortBy = args.sortBy || scoreConfig.scores[0]?.id || "default_connection";

    // Get ALL active members (excluding leaders) — no artificial limit
    const members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();

    const toolDisplayName = (group as any)?.toolDisplayNames?.followup || "Follow-up";
    const memberSubtitle = group?.followupScoreConfig?.memberSubtitle || "";

    if (members.length === 0) {
      return {
        members: [],
        scoreConfig: scoreConfig.scores.map((s) => ({ id: s.id, name: s.name })),
        toolDisplayName,
        memberSubtitle,
      };
    }

    // Get the last 20 meetings for attendance score
    const meetings = await ctx.db
      .query("meetings")
      .withIndex("by_group_status", (q) =>
        q.eq("groupId", args.groupId).eq("status", "completed")
      )
      .order("desc")
      .take(20);

    // Batch fetch all attendances for meetings in parallel (max 20 queries)
    const attendancesByMeeting = await Promise.all(
      meetings.map((meeting) =>
        ctx.db
          .query("meetingAttendances")
          .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
          .collect()
      )
    );

    // Create attendance map: userId -> meetingId -> status
    const attendanceMap = new Map<string, Map<string, number>>();
    for (let i = 0; i < meetings.length; i++) {
      const meeting = meetings[i];
      const attendances = attendancesByMeeting[i];
      for (const a of attendances) {
        const userIdStr = a.userId.toString();
        if (!attendanceMap.has(userIdStr)) {
          attendanceMap.set(userIdStr, new Map());
        }
        attendanceMap.get(userIdStr)!.set(meeting._id.toString(), a.status);
      }
    }

    // Get member IDs for batch queries
    const memberIds = members.map((m) => m._id);

    // Batch fetch followups for all members in parallel
    const followupResults = await Promise.all(
      memberIds.map((memberId) =>
        ctx.db
          .query("memberFollowups")
          .withIndex("by_groupMember_createdAt", (q) => q.eq("groupMemberId", memberId))
          .order("desc")
          .take(20)
      )
    );

    // Build snooze map and followups map from batch results
    const snoozeMap = new Map<string, number>();
    const followupsMap = new Map<string, FollowupAction[]>();

    for (let i = 0; i < memberIds.length; i++) {
      const memberId = memberIds[i];
      const memberIdStr = memberId.toString();
      const followups = followupResults[i];

      // Find active snooze (most recent snooze entry that's still active)
      for (const f of followups) {
        if (f.type === "snooze" && f.snoozeUntil && f.snoozeUntil > currentTime) {
          snoozeMap.set(memberIdStr, f.snoozeUntil);
          break;
        }
      }

      // Build followup actions
      followupsMap.set(
        memberIdStr,
        followups.map((f) => ({
          type: f.type,
          createdAt: f.createdAt,
        }))
      );
    }

    // Batch fetch all users for members
    const userIds = Array.from(new Set(members.map((m) => m.userId)));
    const users = await Promise.all(
      userIds.map((id) => ctx.db.get(id) as Promise<Doc<"users"> | null>)
    );
    const userMap = new Map<string, Doc<"users">>(
      users
        .filter((u): u is Doc<"users"> => u !== null)
        .map((u) => [u._id.toString(), u])
    );

    // Build PCO serving map from group doc (written by getServingCounts action)
    const pcoServingMap = new Map<string, PcoServingData>();
    if (group?.pcoServingCounts?.counts) {
      for (const { userId, count } of group.pcoServingCounts.counts) {
        pcoServingMap.set(userId.toString(), { servicesPast2Months: count });
      }
    }

    // Calculate scores for each member
    const scoredMembers = members.map((member) => {
      const user = userMap.get(member.userId.toString());
      if (!user) return null;

      const userAttendance = attendanceMap.get(member.userId.toString()) || new Map();

      // Filter meetings to only those after the member joined
      const memberMeetings = meetings.filter(
        (m) => m.scheduledAt >= member.joinedAt
      );

      const meetingData: MeetingAttendanceData[] = memberMeetings.map((m) => ({
        meetingId: m._id,
        wasPresent: userAttendance.get(m._id.toString()) === 1,
        scheduledAt: m.scheduledAt,
      }));

      const followupData = followupsMap.get(member._id.toString()) || [];
      const snoozedUntil = snoozeMap.get(member._id.toString());
      const isSnoozed = !!snoozedUntil;

      // Always compute the legacy scores (used for backward compat fields + connection formula parts)
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
        // No custom config — map defaults to legacy functions for exact backward compat
        memberScores = {
          default_attendance: legacyScores.attendanceScore,
          default_connection: legacyScores.connectionScore,
        };
      } else {
        // Custom config — use the configurable scoring engine
        // Compute connection formula parts for the pre-computed variables
        const connectionParts = computeConnectionParts(
          meetingData, followupData, isSnoozed, currentTime
        );
        const pcoServing = pcoServingMap.get(member.userId.toString());
        const rawValues = extractRawValues(
          meetingData, followupData, isSnoozed, currentTime, connectionParts, pcoServing,
          undefined // crossGroupAttendancePct not computed in list view (too expensive per-member)
        );
        memberScores = calculateAllScores(scoreConfig, rawValues);

        // Evaluate alert thresholds
        if (scoreConfig.alerts?.length) {
          triggeredAlerts = evaluateAlerts(scoreConfig.alerts, rawValues);
        }
      }

      // Get last attendance date
      let lastAttendedAt: number | null = null;
      for (const meeting of memberMeetings) {
        if (userAttendance.get(meeting._id.toString()) === 1) {
          lastAttendedAt = meeting.scheduledAt;
          break;
        }
      }

      return {
        memberId: member._id,
        odUserId: member.userId,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email,
        phone: user.phone,
        profileImage: getMediaUrl(user.profilePhoto),
        // Legacy fields (kept for backward compat)
        followupScore: legacyScores.followupScore,
        attendanceScore: legacyScores.attendanceScore,
        connectionScore: legacyScores.connectionScore,
        // Configurable scores
        scores: memberScores,
        missedMeetings: legacyScores.missedMeetings,
        consecutiveMissed: legacyScores.consecutiveMissed,
        lastAttendedAt,
        lastFollowupAt: followupData[0]?.createdAt || null,
        snoozedUntil: snoozedUntil || null,
        scoreFactors: legacyScores.scoreFactors,
        triggeredAlerts,
        pcoServingCount: pcoServingMap.get(member.userId.toString())?.servicesPast2Months ?? 0,
      };
    });

    // Filter out nulls and sort
    const validMembers = scoredMembers.filter((m) => m !== null) as NonNullable<
      (typeof scoredMembers)[number]
    >[];

    validMembers.sort((a, b) => {
      let aScore: number;
      let bScore: number;

      if (sortBy === "__weighted__") {
        // Primary: alert count (more alerts = needs more attention)
        const aAlerts = a.triggeredAlerts?.length ?? 0;
        const bAlerts = b.triggeredAlerts?.length ?? 0;
        if (aAlerts !== bAlerts) {
          const alertDiff = aAlerts - bAlerts;
          // desc: most alerts first; asc: fewest alerts first
          return sortDirection === "desc" ? -alertDiff : alertDiff;
        }
        // Tiebreaker: weighted average across all configured scores
        const scoreIds = scoreConfig.scores.map((s) => s.id);
        const aSum = scoreIds.reduce((sum, id) => sum + (a.scores[id] ?? 0), 0);
        const bSum = scoreIds.reduce((sum, id) => sum + (b.scores[id] ?? 0), 0);
        aScore = scoreIds.length > 0 ? aSum / scoreIds.length : 0;
        bScore = scoreIds.length > 0 ? bSum / scoreIds.length : 0;
      } else {
        aScore = a.scores[sortBy] ?? 0;
        bScore = b.scores[sortBy] ?? 0;
      }

      const diff = aScore - bScore;
      return sortDirection === "desc" ? -diff : diff;
    });

    return {
      members: validMembers,
      scoreConfig: scoreConfig.scores.map((s) => ({ id: s.id, name: s.name })),
      toolDisplayName,
      memberSubtitle,
    };
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

    await ctx.db.delete(args.followupId);
    return { success: true };
  },
});
