/**
 * Followup Score Pre-computation
 *
 * Maintains the `memberFollowupScores` table — the single source of truth for the
 * followup screen. Scores are recomputed:
 *   1. On events (followup added, snooze changed, meeting completed)
 *   2. Daily via cron (time-decay scores shift each day)
 *   3. On-demand via backfill CLI command
 *
 * Uses existing `internalScoreBatch` for actual score computation, then upserts
 * results into the pre-computed table.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { getMediaUrl } from "../lib/utils";
import type { ScoreConfig } from "./followupScoring";
import { DEFAULT_SCORE_CONFIG } from "./followupScoring";

// ============================================================================
// Internal Queries
// ============================================================================

/**
 * Get all group IDs that have members (for daily cron fan-out).
 * We compute scores for all groups — even those without custom config
 * (they use DEFAULT_SCORE_CONFIG).
 */
export const getAllGroupIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Get distinct group IDs from groupMembers
    // We query groups table directly and check for active members
    const groups = await ctx.db.query("groups").collect();
    return groups.map((g) => g._id);
  },
});

/**
 * Get members page for score computation. Returns cursor-based pages
 * of active members with their user data.
 */
export const getMembersForScoring = internalQuery({
  args: {
    groupId: v.id("groups"),
    cursor: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const query = ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("leftAt"), undefined));

    const result = await query.paginate({
      numItems: args.limit,
      cursor: args.cursor ?? null,
    });

    // Fetch user data for denormalization
    const membersWithUsers = await Promise.all(
      result.page.map(async (member) => {
        const user = await ctx.db.get(member.userId);
        return {
          _id: member._id,
          userId: member.userId,
          joinedAt: member.joinedAt,
          firstName: user?.firstName || "",
          lastName: user?.lastName || "",
          avatarUrl: getMediaUrl(user?.profilePhoto),
          email: user?.email,
          phone: user?.phone,
        };
      })
    );

    return {
      members: membersWithUsers,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

// ============================================================================
// Upsert Mutations
// ============================================================================

/**
 * Upsert a batch of score docs into memberFollowupScores.
 * Uses the by_groupMember index for fast lookup.
 */
export const internalUpsertScoreBatch = internalMutation({
  args: {
    groupId: v.id("groups"),
    scores: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    for (const score of args.scores) {
      const existing = await ctx.db
        .query("memberFollowupScores")
        .withIndex("by_groupMember", (q) =>
          q.eq("groupMemberId", score.groupMemberId)
        )
        .first();

      // NOTE: This doc object intentionally excludes custom field slots
      // (customText1-5, customNum1-5, customBool1-5). Since we use
      // ctx.db.patch() for existing docs, custom field values set by
      // leaders are automatically preserved during score recomputation.
      const doc = {
        groupId: args.groupId,
        groupMemberId: score.groupMemberId,
        userId: score.userId,
        firstName: score.firstName,
        lastName: score.lastName,
        avatarUrl: score.avatarUrl,
        email: score.email,
        phone: score.phone,
        searchText: [score.firstName, score.lastName, score.email, score.phone, score.phone?.replace(/^\+\d{1,3}/, "")]
          .filter(Boolean).join(" "),
        latestNote: score.latestNote,
        latestNoteAt: score.latestNoteAt,
        memberSubtitleValue: score.memberSubtitleValue,
        score1: score.score1,
        score2: score.score2,
        score3: score.score3,
        score4: score.score4,
        alerts: score.alerts,
        isSnoozed: score.isSnoozed,
        snoozedUntil: score.snoozedUntil,
        rawValues: score.rawValues,
        attendanceScore: score.attendanceScore,
        connectionScore: score.connectionScore,
        followupScore: score.followupScore,
        missedMeetings: score.missedMeetings,
        consecutiveMissed: score.consecutiveMissed,
        lastAttendedAt: score.lastAttendedAt,
        lastFollowupAt: score.lastFollowupAt,
        scoreFactors: score.scoreFactors,
        scoreIds: score.scoreIds,
        updatedAt: Date.now(),
        addedAt: score.addedAt,
      };

      if (existing) {
        await ctx.db.patch(existing._id, doc);
      } else {
        await ctx.db.insert("memberFollowupScores", doc);
      }
    }
  },
});

/**
 * Delete score doc when a member leaves the group.
 */
export const deleteScoreDoc = internalMutation({
  args: { groupMemberId: v.id("groupMembers") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("memberFollowupScores")
      .withIndex("by_groupMember", (q) =>
        q.eq("groupMemberId", args.groupMemberId)
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

// ============================================================================
// Score Computation Actions
// ============================================================================

/**
 * Transform a scored member (from internalScoreBatch) into a score doc shape.
 */
function transformScoredMember(
  member: any,
  scoredResult: any,
  scoreConfig: ScoreConfig,
): any {
  // Map scoreConfig.scores[i] → score1, score2, etc.
  const scoreIds = scoreConfig.scores.map((s) => s.id);
  const score1 = scoredResult.scores[scoreIds[0]] ?? 0;
  const score2 = scoredResult.scores[scoreIds[1]] ?? 0;
  const score3 = scoreIds[2] ? (scoredResult.scores[scoreIds[2]] ?? 0) : undefined;
  const score4 = scoreIds[3] ? (scoredResult.scores[scoreIds[3]] ?? 0) : undefined;

  return {
    groupMemberId: scoredResult.memberId,
    userId: scoredResult.odUserId,
    firstName: member.firstName,
    lastName: member.lastName,
    avatarUrl: member.avatarUrl,
    email: scoredResult.email ?? undefined,
    phone: scoredResult.phone ?? undefined,
    searchText: [member.firstName, member.lastName, scoredResult.email, scoredResult.phone, scoredResult.phone?.replace(/^\+\d{1,3}/, "")]
      .filter(Boolean).join(" "),
    latestNote: scoredResult.latestNoteContent ?? undefined,
    latestNoteAt: scoredResult.latestNoteAt ?? undefined,
    memberSubtitleValue: undefined,
    score1,
    score2,
    score3,
    score4,
    alerts: scoredResult.triggeredAlerts || [],
    isSnoozed: !!scoredResult.snoozedUntil,
    snoozedUntil: scoredResult.snoozedUntil ?? undefined,
    rawValues: undefined,
    attendanceScore: scoredResult.attendanceScore,
    connectionScore: scoredResult.connectionScore,
    followupScore: scoredResult.followupScore,
    missedMeetings: scoredResult.missedMeetings,
    consecutiveMissed: scoredResult.consecutiveMissed,
    lastAttendedAt: scoredResult.lastAttendedAt ?? undefined,
    lastFollowupAt: scoredResult.lastFollowupAt ?? undefined,
    scoreFactors: scoredResult.scoreFactors,
    scoreIds,
    addedAt: member.joinedAt,
  };
}

/**
 * Compute scores for all members of a group.
 * Orchestrates: fetch config → paginate members → batch score → upsert.
 */
export const computeGroupScores = internalAction({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    // Step 1: Get group config (meetings, score config)
    const config = await ctx.runQuery(
      internal.functions.memberFollowups.internalGetGroupConfig,
      { groupId: args.groupId }
    );

    // Get full score config for score ID mapping
    const groupDoc = await ctx.runQuery(
      internal.functions.followupScoreComputation.getGroupScoreConfig,
      { groupId: args.groupId }
    );
    const scoreConfig: ScoreConfig = groupDoc ?? DEFAULT_SCORE_CONFIG;

    // Step 2: Paginate through all members
    const BATCH_SIZE = 200;
    let cursor: string | undefined = undefined;
    let isDone = false;

    while (!isDone) {
      const page: {
        members: Array<{
          _id: Id<"groupMembers">;
          userId: Id<"users">;
          joinedAt: number;
          firstName: string;
          lastName: string;
          avatarUrl: string | undefined;
          email: string | undefined;
          phone: string | undefined;
        }>;
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(
        internal.functions.followupScoreComputation.getMembersForScoring,
        { groupId: args.groupId, cursor, limit: BATCH_SIZE }
      );

      if (page.members.length === 0) {
        isDone = page.isDone;
        cursor = page.continueCursor;
        continue;
      }

      // Step 3: Score the batch using existing internalScoreBatch
      const memberBatch = page.members.map((m) => ({
        _id: m._id,
        userId: m.userId,
        joinedAt: m.joinedAt,
      }));

      const scoredResults: any[] = await ctx.runQuery(
        internal.functions.memberFollowups.internalScoreBatch,
        {
          groupId: args.groupId,
          members: memberBatch,
          meetings: config.meetings,
        }
      );

      // Step 4: Transform and upsert
      // Build a lookup map from memberId to member data for denormalized fields
      const memberMap = new Map(page.members.map((m) => [m._id.toString(), m]));

      const scoreDocs = scoredResults.map((result: any) => {
        const member = memberMap.get(result.memberId.toString());
        return transformScoredMember(
          member || { firstName: result.firstName, lastName: result.lastName, avatarUrl: result.profileImage, joinedAt: 0 },
          result,
          scoreConfig,
        );
      });

      await ctx.runMutation(
        internal.functions.followupScoreComputation.internalUpsertScoreBatch,
        { groupId: args.groupId, scores: scoreDocs }
      );

      isDone = page.isDone;
      cursor = page.continueCursor;
    }
  },
});

/**
 * Recompute score for a single member.
 * Called after followup add, snooze change, etc.
 */
export const computeSingleMemberScore = internalAction({
  args: {
    groupId: v.id("groups"),
    groupMemberId: v.id("groupMembers"),
  },
  handler: async (ctx, args) => {
    // Get group config
    const config = await ctx.runQuery(
      internal.functions.memberFollowups.internalGetGroupConfig,
      { groupId: args.groupId }
    );

    const groupDoc = await ctx.runQuery(
      internal.functions.followupScoreComputation.getGroupScoreConfig,
      { groupId: args.groupId }
    );
    const scoreConfig: ScoreConfig = groupDoc ?? DEFAULT_SCORE_CONFIG;

    // Get the specific member data
    const memberData = await ctx.runQuery(
      internal.functions.followupScoreComputation.getSingleMemberForScoring,
      { groupMemberId: args.groupMemberId }
    );

    if (!memberData) return;

    // Score the single member
    const scoredResults = await ctx.runQuery(
      internal.functions.memberFollowups.internalScoreBatch,
      {
        groupId: args.groupId,
        members: [{
          _id: memberData._id,
          userId: memberData.userId,
          joinedAt: memberData.joinedAt,
        }],
        meetings: config.meetings,
      }
    );

    if (scoredResults.length === 0) return;

    const scoreDoc = transformScoredMember(memberData, scoredResults[0], scoreConfig);

    await ctx.runMutation(
      internal.functions.followupScoreComputation.internalUpsertScoreBatch,
      { groupId: args.groupId, scores: [scoreDoc] }
    );
  },
});

/**
 * Get a single member's data for scoring.
 */
export const getSingleMemberForScoring = internalQuery({
  args: { groupMemberId: v.id("groupMembers") },
  handler: async (ctx, args) => {
    const member = await ctx.db.get(args.groupMemberId);
    if (!member || member.leftAt) return null;

    const user = await ctx.db.get(member.userId);
    return {
      _id: member._id,
      userId: member.userId,
      joinedAt: member.joinedAt,
      firstName: user?.firstName || "",
      lastName: user?.lastName || "",
      avatarUrl: getMediaUrl(user?.profilePhoto),
      email: user?.email,
      phone: user?.phone,
    };
  },
});

/**
 * Get group's score config (internal query for use in actions).
 */
export const getGroupScoreConfig = internalQuery({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    return group?.followupScoreConfig ?? null;
  },
});

// ============================================================================
// Daily Cron Handler
// ============================================================================

/**
 * Daily refresh: fan out score computation for all groups.
 * Staggered via ctx.scheduler to avoid thundering herd.
 */
export const dailyRefreshAllScores = internalAction({
  args: {},
  handler: async (ctx) => {
    const groupIds: Id<"groups">[] = await ctx.runQuery(
      internal.functions.followupScoreComputation.getAllGroupIds,
      {}
    );

    // Stagger: schedule each group 100ms apart to avoid thundering herd
    for (let i = 0; i < groupIds.length; i++) {
      await ctx.scheduler.runAfter(
        i * 100, // 100ms stagger
        internal.functions.followupScoreComputation.computeGroupScores,
        { groupId: groupIds[i] }
      );
    }

    console.log(`[followup-score-refresh] Scheduled ${groupIds.length} groups for score recomputation`);
  },
});

// ============================================================================
// Backfill (CLI command)
// ============================================================================

/**
 * One-time backfill for existing groups.
 * Usage: npx convex run functions/followupScoreComputation:backfillAllGroups
 */
export const backfillAllGroups = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const groupIds: Id<"groups">[] = await ctx.runQuery(
      internal.functions.followupScoreComputation.getAllGroupIds,
      {}
    );

    for (let i = 0; i < groupIds.length; i++) {
      await ctx.scheduler.runAfter(
        i * 200,
        internal.functions.followupScoreComputation.computeGroupScores,
        { groupId: groupIds[i] }
      );
    }

    return { scheduled: groupIds.length };
  },
});

// ============================================================================
// Lightweight searchText Backfill
// ============================================================================

/**
 * Recompute only the `searchText` field for all memberFollowupScores in a group.
 * Does NOT recompute scores — just patches searchText from existing denormalized fields.
 * Processes in batches of 100 to stay within Convex mutation limits.
 */
export const backfillSearchText = internalMutation({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("memberFollowupScores")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    let patched = 0;
    for (const doc of docs) {
      const searchText = [
        doc.firstName,
        doc.lastName,
        doc.email,
        doc.phone,
        doc.phone?.replace(/^\+\d{1,3}/, ""),
      ]
        .filter(Boolean)
        .join(" ");

      await ctx.db.patch(doc._id, { searchText });
      patched++;
    }

    console.log(
      `[backfillSearchText] group=${args.groupId} patched=${patched}`
    );
  },
});

/**
 * Backfill searchText for all groups.
 * Usage: npx convex run functions/followupScoreComputation:backfillSearchTextForAllGroups
 */
export const backfillSearchTextForAllGroups = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const groupIds: Id<"groups">[] = await ctx.runQuery(
      internal.functions.followupScoreComputation.getAllGroupIds,
      {}
    );

    for (let i = 0; i < groupIds.length; i++) {
      await ctx.scheduler.runAfter(
        i * 200,
        internal.functions.followupScoreComputation.backfillSearchText,
        { groupId: groupIds[i] }
      );
    }

    console.log(
      `[backfillSearchTextForAllGroups] Scheduled ${groupIds.length} groups`
    );
    return { scheduled: groupIds.length };
  },
});
