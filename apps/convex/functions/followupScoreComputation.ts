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
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      return {
        members: [],
        isDone: true,
        continueCursor: "",
      };
    }

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
        const [user, communityMembership] = await Promise.all([
          ctx.db.get(member.userId),
          ctx.db
            .query("userCommunities")
            .withIndex("by_user_community", (q) =>
              q.eq("userId", member.userId).eq("communityId", group.communityId)
            )
            .first(),
        ]);
        return {
          _id: member._id,
          userId: member.userId,
          joinedAt: member.joinedAt,
          firstName: user?.firstName || "",
          lastName: user?.lastName || "",
          avatarUrl: getMediaUrl(user?.profilePhoto),
          email: user?.email,
          phone: user?.phone,
          zipCode: user?.zipCode,
          dateOfBirth: user?.dateOfBirth,
          // Community-scoped activity is tracked on userCommunities.lastLogin.
          // Fall back to users.lastLogin for older records.
          lastActiveAt: communityMembership?.lastLogin ?? user?.lastLogin,
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
 *
 * Optional initialStatus/initialAssigneeId(s) are applied when INSERTING a new doc,
 * ensuring these values are set atomically during quick-add (avoids race condition
 * with the separate applyQuickAddFollowupPatch mutation).
 */
export const internalUpsertScoreBatch = internalMutation({
  args: {
    groupId: v.id("groups"),
    scores: v.array(v.any()),
    initialStatus: v.optional(v.string()),
    initialAssigneeId: v.optional(v.id("users")),
    initialAssigneeIds: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, args) => {
    const normalizedInitialAssigneeIds = args.initialAssigneeIds !== undefined
      ? Array.from(new Set(args.initialAssigneeIds))
      : args.initialAssigneeId
        ? [args.initialAssigneeId]
        : undefined;
    const primaryInitialAssigneeId = normalizedInitialAssigneeIds?.[0] ?? args.initialAssigneeId;

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
        zipCode: score.zipCode,
        dateOfBirth: score.dateOfBirth,
        searchText: score.searchText,
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
        lastActiveAt: score.lastActiveAt,
        scoreFactors: score.scoreFactors,
        scoreIds: score.scoreIds,
        updatedAt: Date.now(),
        addedAt: score.addedAt,
      };

      if (existing) {
        await ctx.db.patch(existing._id, doc);
      } else {
        // When creating a new doc, include initial status/assignee if provided
        const insertDoc = {
          ...doc,
          ...(args.initialStatus !== undefined && { status: args.initialStatus }),
          ...(primaryInitialAssigneeId !== undefined && { assigneeId: primaryInitialAssigneeId }),
          ...(normalizedInitialAssigneeIds !== undefined && { assigneeIds: normalizedInitialAssigneeIds }),
        };
        await ctx.db.insert("memberFollowupScores", insertDoc);
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

      // Also delete the matching communityPeople record for this group+user
      const cpRecord = await ctx.db
        .query("communityPeople")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", existing.groupId).eq("userId", existing.userId)
        )
        .first();
      if (cpRecord) {
        // Clean up junction rows before deleting the communityPeople record
        const junctionRows = await ctx.db
          .query("communityPeopleAssignees")
          .withIndex("by_communityPerson", (q: any) =>
            q.eq("communityPersonId", cpRecord._id),
          )
          .collect();
        for (const row of junctionRows) {
          await ctx.db.delete(row._id);
        }
        await ctx.db.delete(cpRecord._id);
      }
    }
  },
});

/**
 * Delete denormalized score docs that no longer map to an active group member.
 * This prevents stale rows from surviving after community/group membership cleanup.
 */
export const pruneStaleScoreDocsForGroup = internalMutation({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("memberFollowupScores")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    let deleted = 0;
    for (const doc of docs) {
      const groupMember = await ctx.db.get(doc.groupMemberId);
      const isStale =
        !groupMember ||
        groupMember.groupId !== args.groupId ||
        groupMember.leftAt !== undefined;

      if (isStale) {
        await ctx.db.delete(doc._id);
        deleted++;
      }
    }

    return { deleted };
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
    zipCode: member.zipCode,
    dateOfBirth: member.dateOfBirth,
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
    lastActiveAt: member.lastActiveAt,
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
  args: {
    groupId: v.id("groups"),
    runId: v.optional(v.string()),
    requestedById: v.optional(v.id("users")),
    trigger: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const runId = args.runId ?? `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await ctx.runMutation(
      internal.functions.followupScoreComputation.setFollowupRefreshRunning,
      {
        groupId: args.groupId,
        runId,
        requestedById: args.requestedById,
        trigger: args.trigger,
      }
    );

    try {
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

      // Step 1b: Refresh PCO serving data if the score config uses it
      const usesPco = scoreConfig.scores.some((s) =>
        s.variables.some((v) => v.variableId === "pco_services_past_2mo")
      );
      if (usesPco) {
        try {
          await ctx.runAction(
            internal.functions.pcoServices.servingHistory.internalRefreshPcoServing,
            { groupId: args.groupId }
          );
        } catch (e) {
          // PCO fetch failed — continue with stale cached data
          console.log(`[computeGroupScores] PCO refresh failed for group ${args.groupId}, using cached data: ${e}`);
        }
      }

      // Step 2: Paginate through all members
      // Batch size 100 keeps internalScoreBatch under ~2,200 reads (limit: 4,096).
      // Formula: 1 + N*(M+2) where M=meetings(~20). At N=100: 2,201 reads.
      const BATCH_SIZE = 100;
      let cursor: string | undefined = undefined;
      let isDone = false;

      // Pre-compute whether cross-group attendance is needed (depends only on scoreConfig)
      const usesCrossGroup = scoreConfig.scores.some((s) =>
        s.variables.some((v) => v.variableId === "attendance_all_groups_pct")
      ) || scoreConfig.alerts?.some((a) => a.variableId === "attendance_all_groups_pct");

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
            zipCode: string | undefined;
            dateOfBirth: number | undefined;
            lastActiveAt: number | undefined;
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

        // Step 3: Pre-compute cross-group attendance (only when score config uses it)
        const memberBatch = page.members.map((m) => ({
          _id: m._id,
          userId: m.userId,
          joinedAt: m.joinedAt,
        }));

        let crossGroupAttendanceMap: Record<string, number> | undefined;
        if (usesCrossGroup) {
          crossGroupAttendanceMap = {};
          const CROSS_BATCH = 10;
          const userIds = page.members.map((m) => m.userId);
          for (let i = 0; i < userIds.length; i += CROSS_BATCH) {
            const batch = userIds.slice(i, i + CROSS_BATCH);
            const batchResults: Record<
              string,
              { pct: number; attendedWeekStarts: number[] }
            > = await ctx.runQuery(
              internal.functions.memberFollowups.internalCrossGroupAttendance,
              { groupId: args.groupId, userIds: batch }
            );
            for (const [uid, data] of Object.entries(batchResults)) {
              crossGroupAttendanceMap[uid] = data.pct;
            }
          }
        }

        // Step 4: Score the batch using existing internalScoreBatch
        const scoredResults: any[] = await ctx.runQuery(
          internal.functions.memberFollowups.internalScoreBatch,
          {
            groupId: args.groupId,
            members: memberBatch,
            meetings: config.meetings,
            crossGroupAttendanceMap,
          }
        );

        // Step 5: Transform and upsert
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

      // Step 6: prune stale denormalized rows for deleted/left members.
      await ctx.runMutation(
        internal.functions.followupScoreComputation.pruneStaleScoreDocsForGroup,
        { groupId: args.groupId }
      );

      await ctx.runMutation(
        internal.functions.followupScoreComputation.setFollowupRefreshCompleted,
        { groupId: args.groupId, runId }
      );
    } catch (error) {
      await ctx.runMutation(
        internal.functions.followupScoreComputation.setFollowupRefreshFailed,
        {
          groupId: args.groupId,
          runId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  },
});

/**
 * Recompute score for a single member.
 * Called after followup add, snooze change, etc.
 *
 * Optional status/assigneeId(s) are passed through to the upsert so they're
 * set atomically when creating a new score doc (avoids race with patch).
 */
export const computeSingleMemberScore = internalAction({
  args: {
    groupId: v.id("groups"),
    groupMemberId: v.id("groupMembers"),
    status: v.optional(v.string()),
    assigneeId: v.optional(v.id("users")),
    assigneeIds: v.optional(v.array(v.id("users"))),
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

    // Pre-compute cross-group attendance (only when score config uses it)
    let crossGroupAttendanceMap: Record<string, number> | undefined;
    const usesCrossGroup = scoreConfig.scores.some((s) =>
      s.variables.some((v) => v.variableId === "attendance_all_groups_pct")
    ) || scoreConfig.alerts?.some((a) => a.variableId === "attendance_all_groups_pct");
    if (usesCrossGroup) {
      const rawMap: Record<
        string,
        { pct: number; attendedWeekStarts: number[] }
      > = await ctx.runQuery(
        internal.functions.memberFollowups.internalCrossGroupAttendance,
        { groupId: args.groupId, userIds: [memberData.userId] }
      );
      crossGroupAttendanceMap = {};
      for (const [uid, data] of Object.entries(rawMap)) {
        crossGroupAttendanceMap[uid] = data.pct;
      }
    }

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
        crossGroupAttendanceMap,
      }
    );

    if (scoredResults.length === 0) return;

    const scoreDoc = transformScoredMember(memberData, scoredResults[0], scoreConfig);

    await ctx.runMutation(
      internal.functions.followupScoreComputation.internalUpsertScoreBatch,
      {
        groupId: args.groupId,
        scores: [scoreDoc],
        initialStatus: args.status,
        initialAssigneeId: args.assigneeId,
        initialAssigneeIds: args.assigneeIds,
      }
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

    const group = await ctx.db.get(member.groupId);
    const [user, communityMembership] = await Promise.all([
      ctx.db.get(member.userId),
      group
        ? ctx.db
            .query("userCommunities")
            .withIndex("by_user_community", (q) =>
              q.eq("userId", member.userId).eq("communityId", group.communityId)
            )
            .first()
        : Promise.resolve(null),
    ]);

    return {
      _id: member._id,
      userId: member.userId,
      joinedAt: member.joinedAt,
      firstName: user?.firstName || "",
      lastName: user?.lastName || "",
      avatarUrl: getMediaUrl(user?.profilePhoto),
      email: user?.email,
      phone: user?.phone,
      zipCode: user?.zipCode,
      dateOfBirth: user?.dateOfBirth,
      lastActiveAt: communityMembership?.lastLogin ?? user?.lastLogin,
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

/**
 * Mark a follow-up refresh run as running for a group.
 */
export const setFollowupRefreshRunning = internalMutation({
  args: {
    groupId: v.id("groups"),
    runId: v.string(),
    requestedById: v.optional(v.id("users")),
    trigger: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const nowTs = Date.now();
    await ctx.db.patch(args.groupId, {
      followupRefreshState: {
        status: "running",
        runId: args.runId,
        startedAt: nowTs,
        requestedById: args.requestedById,
        trigger: args.trigger ?? "scheduled",
      },
      updatedAt: nowTs,
    });
  },
});

/**
 * Mark a follow-up refresh run as completed.
 * Only updates state if this run is still the active run.
 */
export const setFollowupRefreshCompleted = internalMutation({
  args: {
    groupId: v.id("groups"),
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    const current = group?.followupRefreshState;
    if (!group || !current || current.runId !== args.runId) return;

    const nowTs = Date.now();
    await ctx.db.patch(args.groupId, {
      followupRefreshState: {
        ...current,
        status: "idle",
        completedAt: nowTs,
        failedAt: undefined,
        error: undefined,
      },
      updatedAt: nowTs,
    });
  },
});

/**
 * Mark a follow-up refresh run as failed.
 * Only updates state if this run is still the active run.
 */
export const setFollowupRefreshFailed = internalMutation({
  args: {
    groupId: v.id("groups"),
    runId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    const current = group?.followupRefreshState;
    if (!group || !current || current.runId !== args.runId) return;

    const nowTs = Date.now();
    await ctx.db.patch(args.groupId, {
      followupRefreshState: {
        ...current,
        status: "failed",
        failedAt: nowTs,
        error: args.error.slice(0, 300),
      },
      updatedAt: nowTs,
    });
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

    // Stagger: schedule each group 3s apart to respect PCO rate limits
    // (groups with pco_services_past_2mo make ~10-30 API calls each)
    for (let i = 0; i < groupIds.length; i++) {
      await ctx.scheduler.runAfter(
        i * 3000,
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
        i * 3000,
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

