/**
 * Community-Level Score Computation Pipeline
 *
 * Maintains the `communityPeople` table — the community-wide view of all members
 * with system scores (Service, Attendance, Togather). Scores are recomputed:
 *   1. Daily via cron (time-decay scores shift each day)
 *   2. On-demand for a single member after followup actions
 *   3. Via backfill CLI command
 *
 * This pipeline runs ALONGSIDE the existing per-group pipeline
 * (followupScoreComputation.ts). The old pipeline continues untouched.
 *
 * Key differences from the per-group pipeline:
 * - Uses the announcement group as the canonical member list
 * - Computes system scores (fixed 3 scores) instead of configurable per-group scores
 * - Cross-group attendance is always computed (not optional)
 * - Writes to `communityPeople` table instead of `memberFollowupScores`
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { now, getMediaUrl } from "../lib/utils";
import {
  extractSystemRawValues,
  calculateAllSystemScores,
  evaluateSystemAlerts,
} from "./systemScoring";

// ============================================================================
// Constants
// ============================================================================

/** Members per page during batch processing */
const BATCH_SIZE = 100;

/** Users per cross-group attendance sub-batch (keeps reads under Convex limits) */
const CROSS_GROUP_BATCH_SIZE = 10;

/** Millisecond interval between staggered community score jobs */
const STAGGER_INTERVAL_MS = 3000;

const DAY_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// Internal Queries
// ============================================================================

/**
 * Find the announcement group for a community.
 * Every community has exactly one group with isAnnouncementGroup === true.
 */
export const getAnnouncementGroup = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("isAnnouncementGroup"), true))
      .first();

    return groups;
  },
});

/**
 * Get all community IDs (for daily cron fan-out).
 * Derives communities from those that have an announcement group.
 */
export const getAllCommunityIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const communities = await ctx.db.query("communities").collect();
    return communities.map((c) => c._id);
  },
});

/**
 * Get the community's custom alert configuration.
 */
export const getCommunityAlertConfig = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const community = await ctx.db.get(args.communityId);
    return community?.alertConfig ?? null;
  },
});

/**
 * Get a paginated list of community members via the announcement group.
 * Returns member data with denormalized user info for upsert.
 */
export const getCommunityMembers = internalQuery({
  args: {
    communityId: v.id("communities"),
    announcementGroupId: v.id("groups"),
    cursor: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const query = ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.announcementGroupId))
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
              q.eq("userId", member.userId).eq("communityId", args.communityId)
            )
            .first(),
        ]);
        return {
          groupMemberId: member._id,
          userId: member.userId,
          joinedAt: member.joinedAt,
          firstName: user?.firstName || "",
          lastName: user?.lastName || "",
          avatarUrl: getMediaUrl(user?.profilePhoto),
          email: user?.email,
          phone: user?.phone,
          zipCode: user?.zipCode,
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

/**
 * Score a batch of community members using system scores.
 *
 * For each member:
 * 1. Fetches their followup records from the announcement group
 * 2. Computes days-since for each followup type
 * 3. Reads PCO serving count from announcement group's pcoServingCounts
 * 4. Uses cross-group attendance from the pre-computed map
 * 5. Calculates system scores and evaluates alerts
 */
export const computeCommunityScoresBatch = internalQuery({
  args: {
    communityId: v.id("communities"),
    announcementGroupId: v.id("groups"),
    members: v.array(
      v.object({
        groupMemberId: v.id("groupMembers"),
        userId: v.id("users"),
        joinedAt: v.number(),
        firstName: v.string(),
        lastName: v.string(),
        avatarUrl: v.optional(v.string()),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
        zipCode: v.optional(v.string()),
        lastActiveAt: v.optional(v.number()),
      })
    ),
    crossGroupAttendanceMap: v.optional(v.any()),
    customAlerts: v.optional(
      v.array(
        v.object({
          id: v.string(),
          variableId: v.string(),
          operator: v.string(),
          threshold: v.number(),
          label: v.optional(v.string()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const currentTime = now();
    const announcementGroup = await ctx.db.get(args.announcementGroupId);

    // Build PCO serving map from announcement group doc
    const pcoServingMap = new Map<string, number>();
    if (announcementGroup?.pcoServingCounts?.counts) {
      for (const { userId, count } of announcementGroup.pcoServingCounts
        .counts) {
        pcoServingMap.set(userId.toString(), count);
      }
    }

    const results = await Promise.all(
      args.members.map(async (member) => {
        // Fetch followups for this member in the announcement group
        const followups = await ctx.db
          .query("memberFollowups")
          .withIndex("by_groupMember_createdAt", (q) =>
            q.eq("groupMemberId", member.groupMemberId)
          )
          .order("desc")
          .take(20);

        // Compute days since each followup type
        const lastFollowup = followups.find(
          (f) =>
            f.type === "followed_up" ||
            f.type === "call" ||
            f.type === "text" ||
            f.type === "note"
        );
        const lastInPerson = followups.find((f) => f.type === "followed_up");
        const lastCall = followups.find((f) => f.type === "call");
        const lastText = followups.find((f) => f.type === "text");

        const daysSince = (entry: { createdAt: number } | undefined): number =>
          entry
            ? Math.floor((currentTime - entry.createdAt) / DAY_MS)
            : Infinity;

        // Consecutive missed meetings — look at all groups this user is in
        // We use cross-group data for this. For consecutive missed, we need
        // the announcement group meetings specifically.
        const meetings = await ctx.db
          .query("meetings")
          .withIndex("by_group_scheduledAt", (q) =>
            q
              .eq("groupId", args.announcementGroupId)
              .lt("scheduledAt", currentTime)
          )
          .filter((q) => q.neq(q.field("status"), "cancelled"))
          .order("desc")
          .take(20);

        // Filter to meetings after member joined
        const memberMeetings = meetings.filter(
          (m) => m.scheduledAt >= member.joinedAt
        );

        // Check attendance for each meeting
        let consecutiveMissed = 0;
        for (const meeting of memberMeetings) {
          const attendance = await ctx.db
            .query("meetingAttendances")
            .withIndex("by_meeting_user", (q) =>
              q.eq("meetingId", meeting._id).eq("userId", member.userId)
            )
            .first();
          if (attendance?.status === 1) break;
          consecutiveMissed++;
        }

        // Get last attended date
        let lastAttendedAt: number | undefined;
        for (const meeting of memberMeetings) {
          const attendance = await ctx.db
            .query("meetingAttendances")
            .withIndex("by_meeting_user", (q) =>
              q.eq("meetingId", meeting._id).eq("userId", member.userId)
            )
            .first();
          if (attendance?.status === 1) {
            lastAttendedAt = meeting.scheduledAt;
            break;
          }
        }

        // Check snooze state
        let snoozedUntil: number | undefined;
        for (const f of followups) {
          if (
            f.type === "snooze" &&
            f.snoozeUntil &&
            f.snoozeUntil > currentTime
          ) {
            snoozedUntil = f.snoozeUntil;
            break;
          }
        }

        // Cross-group attendance percentage
        const crossGroupPct =
          (args.crossGroupAttendanceMap?.[member.userId.toString()] as
            | number
            | undefined) ?? 0;

        // PCO serving count
        const pcoCount = pcoServingMap.get(member.userId.toString()) ?? 0;

        // Extract system raw values
        const rawValues = extractSystemRawValues({
          crossGroupAttendancePct: crossGroupPct,
          consecutiveMissed,
          daysSinceLastFollowup: daysSince(lastFollowup),
          daysSinceLastInPerson: daysSince(lastInPerson),
          daysSinceLastCall: daysSince(lastCall),
          daysSinceLastText: daysSince(lastText),
          pcoServicesCount: pcoCount,
        });

        // Calculate scores and alerts
        const scores = calculateAllSystemScores(rawValues);
        const alerts = evaluateSystemAlerts(rawValues, args.customAlerts);

        // Build search text
        const searchText = [
          member.firstName,
          member.lastName,
          member.email,
          member.phone,
          member.phone?.replace(/^\+\d{1,3}/, ""),
        ]
          .filter(Boolean)
          .join(" ");

        return {
          userId: member.userId,
          firstName: member.firstName,
          lastName: member.lastName,
          avatarUrl: member.avatarUrl,
          email: member.email,
          phone: member.phone,
          zipCode: member.zipCode,
          searchText,
          score1: scores.score1,
          score2: scores.score2,
          score3: scores.score3,
          alerts,
          isSnoozed: !!snoozedUntil,
          snoozedUntil,
          rawValues,
          lastFollowupAt: lastFollowup?.createdAt,
          lastActiveAt: member.lastActiveAt,
          lastAttendedAt,
          addedAt: member.joinedAt,
        };
      })
    );

    return results;
  },
});

// ============================================================================
// Upsert Mutations
// ============================================================================

/**
 * Upsert a batch of scored members into the communityPeople table.
 *
 * On update: patches scores, alerts, denormalized info, rawValues.
 *   Preserves: status, assigneeIds, connectionPoint, custom fields, isSnoozed (if not recomputed).
 * On insert: creates a new row with all computed fields.
 */
export const upsertCommunityPeopleBatch = internalMutation({
  args: {
    communityId: v.id("communities"),
    groupId: v.id("groups"),
    scoredMembers: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const nowTs = Date.now();

    for (const member of args.scoredMembers) {
      const existing = await ctx.db
        .query("communityPeople")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", args.groupId).eq("userId", member.userId)
        )
        .first();

      // Fields updated on every score recomputation
      const scoreDoc = {
        communityId: args.communityId,
        groupId: args.groupId,
        userId: member.userId,
        firstName: member.firstName,
        lastName: member.lastName,
        avatarUrl: member.avatarUrl,
        email: member.email,
        phone: member.phone,
        zipCode: member.zipCode,
        searchText: member.searchText,
        score1: member.score1,
        score2: member.score2,
        score3: member.score3,
        alerts: member.alerts,
        isSnoozed: member.isSnoozed,
        snoozedUntil: member.snoozedUntil,
        rawValues: member.rawValues,
        lastFollowupAt: member.lastFollowupAt,
        lastActiveAt: member.lastActiveAt,
        lastAttendedAt: member.lastAttendedAt,
        addedAt: member.addedAt,
        updatedAt: nowTs,
      };

      if (existing) {
        // Patch preserves custom fields, status, assigneeIds, connectionPoint
        await ctx.db.patch(existing._id, scoreDoc);
      } else {
        // Check if user has a record in another group — copy leader-set fields
        const siblingRecord = await ctx.db
          .query("communityPeople")
          .withIndex("by_community_user", (q) =>
            q.eq("communityId", args.communityId).eq("userId", member.userId)
          )
          .first();

        await ctx.db.insert("communityPeople", {
          ...scoreDoc,
          // Copy leader-set fields from sibling if exists
          status: siblingRecord?.status,
          assigneeIds: siblingRecord?.assigneeIds,
          connectionPoint: siblingRecord?.connectionPoint,
          customText1: siblingRecord?.customText1,
          customText2: siblingRecord?.customText2,
          customText3: siblingRecord?.customText3,
          customText4: siblingRecord?.customText4,
          customText5: siblingRecord?.customText5,
          customNum1: siblingRecord?.customNum1,
          customNum2: siblingRecord?.customNum2,
          customNum3: siblingRecord?.customNum3,
          customNum4: siblingRecord?.customNum4,
          customNum5: siblingRecord?.customNum5,
          customBool1: siblingRecord?.customBool1,
          customBool2: siblingRecord?.customBool2,
          customBool3: siblingRecord?.customBool3,
          customBool4: siblingRecord?.customBool4,
          customBool5: siblingRecord?.customBool5,
          createdAt: nowTs,
        });
      }
    }
  },
});

/**
 * Delete communityPeople rows for members who are no longer active in the
 * record's group. Each communityPeople record is tied to a specific group,
 * so we verify membership per-group rather than only against the announcement group.
 */
export const pruneStaleRows = internalMutation({
  args: {
    communityId: v.id("communities"),
    announcementGroupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("communityPeople")
      .withIndex("by_community", (q) =>
        q.eq("communityId", args.communityId)
      )
      .collect();

    let deleted = 0;
    for (const doc of docs) {
      // Each record has a groupId — check if user is still an active member of that group
      if (!doc.groupId) {
        // Legacy record without groupId — prune it
        await ctx.db.delete(doc._id);
        deleted++;
        continue;
      }
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q
            .eq("groupId", doc.groupId!)
            .eq("userId", doc.userId)
        )
        .first();

      const isStale =
        !membership || membership.leftAt !== undefined;

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
 * Compute community-level scores for all members of a community.
 *
 * Orchestration:
 * 1. Find announcement group (canonical member list)
 * 2. Optionally refresh PCO serving data
 * 3. Paginate through members (BATCH_SIZE per page)
 * 4. For each page: compute cross-group attendance, score batch, upsert
 * 5. Prune stale rows for members who left
 */
export const computeCommunityScores = internalAction({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    // Step 1: Find announcement group
    const announcementGroup = await ctx.runQuery(
      internal.functions.communityScoreComputation.getAnnouncementGroup,
      { communityId: args.communityId }
    );

    if (!announcementGroup) {
      console.log(
        `[community-scores] No announcement group found for community ${args.communityId}, skipping`
      );
      return;
    }

    const announcementGroupId = announcementGroup._id;

    // Step 1b: Fetch community alert config
    const community = await ctx.runQuery(
      internal.functions.communityScoreComputation.getCommunityAlertConfig,
      { communityId: args.communityId }
    );
    const customAlerts = community ?? undefined;

    // Step 2: Refresh PCO serving data for the announcement group
    try {
      await ctx.runAction(
        internal.functions.pcoServices.servingHistory.internalRefreshPcoServing,
        { groupId: announcementGroupId }
      );
    } catch (e) {
      // PCO fetch failed — continue with stale cached data
      console.log(
        `[community-scores] PCO refresh failed for community ${args.communityId}, using cached data: ${e}`
      );
    }

    // Step 3: Paginate through all members
    let cursor: string | undefined = undefined;
    let isDone = false;

    while (!isDone) {
      const page: {
        members: Array<{
          groupMemberId: Id<"groupMembers">;
          userId: Id<"users">;
          joinedAt: number;
          firstName: string;
          lastName: string;
          avatarUrl: string | undefined;
          email: string | undefined;
          phone: string | undefined;
          lastActiveAt: number | undefined;
        }>;
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(
        internal.functions.communityScoreComputation.getCommunityMembers,
        {
          communityId: args.communityId,
          announcementGroupId,
          cursor,
          limit: BATCH_SIZE,
        }
      );

      if (page.members.length === 0) {
        isDone = page.isDone;
        cursor = page.continueCursor;
        continue;
      }

      // Step 4: Compute cross-group attendance for this batch
      const crossGroupAttendanceMap: Record<string, number> = {};
      const userIds = page.members.map((m) => m.userId);
      for (let i = 0; i < userIds.length; i += CROSS_GROUP_BATCH_SIZE) {
        const batch = userIds.slice(i, i + CROSS_GROUP_BATCH_SIZE);
        const batchResults: Record<string, number> = await ctx.runQuery(
          internal.functions.memberFollowups.internalCrossGroupAttendance,
          { groupId: announcementGroupId, userIds: batch }
        );
        Object.assign(crossGroupAttendanceMap, batchResults);
      }

      // Step 5: Score the batch
      const scoredMembers = await ctx.runQuery(
        internal.functions.communityScoreComputation.computeCommunityScoresBatch,
        {
          communityId: args.communityId,
          announcementGroupId,
          members: page.members,
          crossGroupAttendanceMap,
          customAlerts,
        }
      );

      // Step 6: Upsert results for the announcement group
      await ctx.runMutation(
        internal.functions.communityScoreComputation.upsertCommunityPeopleBatch,
        {
          communityId: args.communityId,
          groupId: announcementGroupId,
          scoredMembers,
        }
      );

      isDone = page.isDone;
      cursor = page.continueCursor;
    }

    // Step 7: Create per-group records for all non-announcement groups
    const allGroups = await ctx.runQuery(
      internal.functions.communityScoreComputation.getCommunityGroups,
      { communityId: args.communityId }
    );

    for (const group of allGroups) {
      if (group._id === announcementGroupId) continue; // already handled

      // Get active members for this group
      const groupMemberUserIds: Id<"users">[] = await ctx.runQuery(
        internal.functions.communityScoreComputation.getGroupMemberUserIds,
        { groupId: group._id }
      );

      if (groupMemberUserIds.length === 0) continue;

      // Find scored data for these users from the announcement group records
      const scoredForGroup = await ctx.runQuery(
        internal.functions.communityScoreComputation.getScoredDataForUsers,
        { communityId: args.communityId, userIds: groupMemberUserIds }
      );

      if (scoredForGroup.length > 0) {
        await ctx.runMutation(
          internal.functions.communityScoreComputation
            .upsertCommunityPeopleBatch,
          {
            communityId: args.communityId,
            groupId: group._id,
            scoredMembers: scoredForGroup,
          }
        );
      }
    }

    // Step 8: Prune stale rows
    await ctx.runMutation(
      internal.functions.communityScoreComputation.pruneStaleRows,
      {
        communityId: args.communityId,
        announcementGroupId,
      }
    );

    console.log(
      `[community-scores] Completed score computation for community ${args.communityId}`
    );
  },
});

/**
 * Compute scores for a single community member and upsert.
 * Used for real-time updates after followup actions.
 */
export const computeSingleCommunityMember = internalAction({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Find announcement group
    const announcementGroup = await ctx.runQuery(
      internal.functions.communityScoreComputation.getAnnouncementGroup,
      { communityId: args.communityId }
    );

    if (!announcementGroup) return;

    // Find the user's membership in the announcement group
    const membership = await ctx.runQuery(
      internal.functions.communityScoreComputation.getAnnouncementGroupMember,
      {
        announcementGroupId: announcementGroup._id,
        userId: args.userId,
      }
    );

    if (!membership) return;

    // Fetch community alert config
    const communityAlerts = await ctx.runQuery(
      internal.functions.communityScoreComputation.getCommunityAlertConfig,
      { communityId: args.communityId }
    );
    const customAlerts = communityAlerts ?? undefined;

    // Compute cross-group attendance for this single user
    const crossGroupAttendanceMap: Record<string, number> = await ctx.runQuery(
      internal.functions.memberFollowups.internalCrossGroupAttendance,
      { groupId: announcementGroup._id, userIds: [args.userId] }
    );

    // Score the single member
    const scoredMembers = await ctx.runQuery(
      internal.functions.communityScoreComputation.computeCommunityScoresBatch,
      {
        communityId: args.communityId,
        announcementGroupId: announcementGroup._id,
        members: [membership],
        crossGroupAttendanceMap,
        customAlerts,
      }
    );

    if (scoredMembers.length === 0) return;

    // Upsert the result for the announcement group
    await ctx.runMutation(
      internal.functions.communityScoreComputation.upsertCommunityPeopleBatch,
      {
        communityId: args.communityId,
        groupId: announcementGroup._id,
        scoredMembers,
      }
    );

    // Also upsert into all other groups this user belongs to
    const allGroups = await ctx.runQuery(
      internal.functions.communityScoreComputation.getCommunityGroups,
      { communityId: args.communityId }
    );

    for (const group of allGroups) {
      if (group._id === announcementGroup._id) continue; // already handled

      // Check if user is an active member of this group
      const groupMembership = await ctx.runQuery(
        internal.functions.communityScoreComputation.getAnnouncementGroupMember,
        { announcementGroupId: group._id, userId: args.userId }
      );

      if (!groupMembership) continue;

      await ctx.runMutation(
        internal.functions.communityScoreComputation.upsertCommunityPeopleBatch,
        {
          communityId: args.communityId,
          groupId: group._id,
          scoredMembers,
        }
      );
    }
  },
});

/**
 * Get a single member's data from the announcement group.
 * Used by computeSingleCommunityMember.
 */
export const getAnnouncementGroupMember = internalQuery({
  args: {
    announcementGroupId: v.id("groups"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const member = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.announcementGroupId).eq("userId", args.userId)
      )
      .first();

    if (!member || member.leftAt) return null;

    const group = await ctx.db.get(args.announcementGroupId);
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
      groupMemberId: member._id,
      userId: member.userId,
      joinedAt: member.joinedAt,
      firstName: user?.firstName || "",
      lastName: user?.lastName || "",
      avatarUrl: getMediaUrl(user?.profilePhoto),
      email: user?.email,
      phone: user?.phone,
      zipCode: user?.zipCode,
      lastActiveAt: communityMembership?.lastLogin ?? user?.lastLogin,
    };
  },
});

/**
 * Get all groups in a community.
 * Used to iterate non-announcement groups for per-group record creation.
 */
export const getCommunityGroups = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
  },
});

/**
 * Get active member user IDs for a group.
 * Returns only users who have not left (leftAt is undefined).
 */
export const getGroupMemberUserIds = internalQuery({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    return members
      .filter((m) => m.leftAt === undefined)
      .map((m) => m.userId);
  },
});

/**
 * Get scored data for a list of users from existing communityPeople records.
 * Looks up any existing record for each user in the community (typically
 * the announcement group record) and returns the score fields needed for
 * creating per-group records.
 */
export const getScoredDataForUsers = internalQuery({
  args: {
    communityId: v.id("communities"),
    userIds: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    const results = [];
    for (const userId of args.userIds) {
      // Find ANY existing communityPeople record for this user in this community
      // (the announcement group record will have the scores)
      const existing = await ctx.db
        .query("communityPeople")
        .withIndex("by_community_user", (q) =>
          q.eq("communityId", args.communityId).eq("userId", userId)
        )
        .first();
      if (existing) {
        results.push({
          userId: existing.userId,
          firstName: existing.firstName,
          lastName: existing.lastName,
          avatarUrl: existing.avatarUrl,
          email: existing.email,
          phone: existing.phone,
          zipCode: existing.zipCode,
          searchText: existing.searchText,
          score1: existing.score1,
          score2: existing.score2,
          score3: existing.score3,
          alerts: existing.alerts,
          isSnoozed: existing.isSnoozed,
          snoozedUntil: existing.snoozedUntil,
          rawValues: existing.rawValues,
          lastFollowupAt: existing.lastFollowupAt,
          lastActiveAt: existing.lastActiveAt,
          lastAttendedAt: existing.lastAttendedAt,
          addedAt: existing.addedAt,
        });
      }
    }
    return results;
  },
});

// ============================================================================
// Cross-Table Sync
// ============================================================================

/**
 * Sync a community-level field change to all per-group memberFollowupScores rows
 * AND all communityPeople sibling records.
 *
 * When a leader updates status, assigneeIds, or custom fields at the community
 * level, this mutation propagates the change to:
 * 1. All memberFollowupScores rows for the same user across all groups (legacy table)
 * 2. All communityPeople rows for the same user across all groups in the community
 */
export const syncCommunityFieldToGroups = internalMutation({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
    field: v.string(),
    value: v.any(),
  },
  handler: async (ctx, args) => {
    // Find all groups in this community
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) =>
        q.eq("communityId", args.communityId)
      )
      .collect();

    let patched = 0;
    for (const group of groups) {
      // Find the user's membership in this group
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", group._id).eq("userId", args.userId)
        )
        .first();

      if (!membership || membership.leftAt) continue;

      // Find their score doc (legacy table)
      const scoreDoc = await ctx.db
        .query("memberFollowupScores")
        .withIndex("by_groupMember", (q) =>
          q.eq("groupMemberId", membership._id)
        )
        .first();

      if (scoreDoc) {
        await ctx.db.patch(scoreDoc._id, {
          [args.field]: args.value,
          updatedAt: Date.now(),
        });
        patched++;
      }
    }

    // Also sync across all communityPeople sibling records for this user
    const communityPeopleRows = await ctx.db
      .query("communityPeople")
      .withIndex("by_community_user", (q) =>
        q.eq("communityId", args.communityId).eq("userId", args.userId)
      )
      .collect();

    for (const row of communityPeopleRows) {
      await ctx.db.patch(row._id, {
        [args.field]: args.value,
        updatedAt: Date.now(),
      });
    }

    return { patched };
  },
});

// ============================================================================
// Daily Cron Handler
// ============================================================================

/**
 * Daily refresh: fan out score computation for all communities.
 * Staggered via ctx.scheduler to avoid thundering herd.
 */
export const dailyRefreshAllCommunityScores = internalAction({
  args: {},
  handler: async (ctx) => {
    const communityIds: Id<"communities">[] = await ctx.runQuery(
      internal.functions.communityScoreComputation.getAllCommunityIds,
      {}
    );

    // Stagger: schedule each community 3s apart to respect PCO rate limits
    for (let i = 0; i < communityIds.length; i++) {
      await ctx.scheduler.runAfter(
        i * STAGGER_INTERVAL_MS,
        internal.functions.communityScoreComputation.computeCommunityScores,
        { communityId: communityIds[i] }
      );
    }

    console.log(
      `[community-score-refresh] Scheduled ${communityIds.length} communities for score recomputation`
    );
  },
});

// ============================================================================
// Backfill (CLI command)
// ============================================================================

/**
 * One-time backfill for all communities.
 * Usage: npx convex run functions/communityScoreComputation:backfillAllCommunities
 */
export const backfillAllCommunities = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const communityIds: Id<"communities">[] = await ctx.runQuery(
      internal.functions.communityScoreComputation.getAllCommunityIds,
      {}
    );

    for (let i = 0; i < communityIds.length; i++) {
      await ctx.scheduler.runAfter(
        i * STAGGER_INTERVAL_MS,
        internal.functions.communityScoreComputation.computeCommunityScores,
        { communityId: communityIds[i] }
      );
    }

    return { scheduled: communityIds.length };
  },
});

// ============================================================================
// Event-triggered single member recomputation (convenience wrapper)
// ============================================================================

/**
 * Recompute community scores for a single member, given a groupId.
 * Resolves the communityId from the group doc and delegates to
 * computeSingleCommunityMember. This avoids every call site needing
 * to look up the community themselves.
 */
export const recomputeForGroupMember = internalMutation({
  args: {
    groupId: v.id("groups"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    if (!group?.communityId) return;

    await ctx.scheduler.runAfter(
      0,
      internal.functions.communityScoreComputation.computeSingleCommunityMember,
      { communityId: group.communityId, userId: args.userId }
    );
  },
});
