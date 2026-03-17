/**
 * Migration: memberFollowupScores -> communityPeople
 *
 * Populates the new `communityPeople` table from existing `memberFollowupScores` data.
 * For each community's announcement group, reads score rows, recomputes system scores
 * where possible, and preserves leader-set fields (status, assigneeIds, custom fields).
 *
 * Also migrates per-group `followupColumnConfig` to community-level
 * `peopleCustomFields` and creates `peopleSavedViews` entries.
 *
 * Usage:
 *   npx convex run functions/migrations/migrateToCommunityPeople:migrateAllCommunities
 *   npx convex run functions/migrations/migrateToCommunityPeople:verifyMigration '{"communityId":"..."}'
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { getMediaUrl } from "../../lib/utils";

// ============================================================================
// Constants
// ============================================================================

/** Members per batch insert mutation */
const BATCH_SIZE = 100;

/** Millisecond interval between staggered community migrations */
const STAGGER_INTERVAL_MS = 3000;

// ============================================================================
// Internal Queries
// ============================================================================

/**
 * Get all memberFollowupScores rows for a given announcement group.
 * Returns them in batches for processing.
 */
export const getFollowupScoresForGroup = internalQuery({
  args: {
    groupId: v.id("groups"),
    cursor: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const query = ctx.db
      .query("memberFollowupScores")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId));

    const result = await query.paginate({
      numItems: args.limit,
      cursor: args.cursor ?? null,
    });

    return {
      scores: result.page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Get announcement group for a community.
 */
export const getAnnouncementGroup = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("groups")
      .withIndex("by_community", (q) =>
        q.eq("communityId", args.communityId)
      )
      .filter((q) => q.eq(q.field("isAnnouncementGroup"), true))
      .first();
  },
});

/**
 * Get all community IDs from the communities table.
 */
export const getAllCommunityIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const communities = await ctx.db.query("communities").collect();
    return communities.map((c) => c._id);
  },
});

/**
 * Get the community doc (for checking existing peopleCustomFields).
 */
export const getCommunity = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.communityId);
  },
});

/**
 * Enrich a batch of memberFollowupScores with user data for denormalization.
 * Fetches fresh user info (firstName, lastName, avatarUrl, email, phone).
 */
export const enrichScoreBatch = internalQuery({
  args: {
    communityId: v.id("communities"),
    scoreRows: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const enriched = await Promise.all(
      args.scoreRows.map(async (row: any) => {
        const user = await ctx.db.get(row.userId as Id<"users">);

        // Build assigneeIds: prefer existing assigneeIds, fall back to wrapping assigneeId
        let assigneeIds: Id<"users">[] | undefined;
        if (row.assigneeIds && row.assigneeIds.length > 0) {
          assigneeIds = row.assigneeIds;
        } else if (row.assigneeId) {
          assigneeIds = [row.assigneeId];
        }

        // Build search text from user data
        const firstName = user?.firstName || row.firstName || "";
        const lastName = user?.lastName || row.lastName || "";
        const email = user?.email || row.email;
        const phone = user?.phone || row.phone;
        const searchText = [firstName, lastName, email, phone]
          .filter(Boolean)
          .join(" ");

        return {
          userId: row.userId,
          firstName,
          lastName,
          avatarUrl: getMediaUrl(user?.profilePhoto) || row.avatarUrl,
          email,
          phone,
          searchText,

          // Scores from existing data (will be overwritten on next recomputation)
          score1: row.score1 ?? undefined,
          score2: row.score2 ?? undefined,
          score3: row.score3 ?? undefined,

          // Preserved leader-set fields
          status: row.status,
          assigneeIds,
          connectionPoint: row.connectionPoint,

          // Followup metadata
          lastFollowupAt: row.lastFollowupAt,
          lastActiveAt: row.lastActiveAt,
          lastAttendedAt: row.lastAttendedAt,
          addedAt: row.addedAt,

          // Alerts and snooze
          alerts: row.alerts ?? [],
          isSnoozed: row.isSnoozed ?? false,
          snoozedUntil: row.snoozedUntil,

          // Custom fields
          customText1: row.customText1,
          customText2: row.customText2,
          customText3: row.customText3,
          customText4: row.customText4,
          customText5: row.customText5,
          customNum1: row.customNum1,
          customNum2: row.customNum2,
          customNum3: row.customNum3,
          customNum4: row.customNum4,
          customNum5: row.customNum5,
          customBool1: row.customBool1,
          customBool2: row.customBool2,
          customBool3: row.customBool3,
          customBool4: row.customBool4,
          customBool5: row.customBool5,

          // Raw values (for detail view breakdown)
          rawValues: row.rawValues,
        };
      })
    );

    return enriched;
  },
});

/**
 * Get all groups for a community that have followupColumnConfig.
 */
export const getGroupsWithColumnConfig = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) =>
        q.eq("communityId", args.communityId)
      )
      .collect();

    return groups
      .filter((g) => g.followupColumnConfig)
      .map((g) => ({
        _id: g._id,
        name: g.name,
        communityId: g.communityId,
        followupColumnConfig: g.followupColumnConfig,
      }));
  },
});

/**
 * Get the first leader of a group (for createdById on saved views).
 */
export const getGroupFirstLeader = internalQuery({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const leader = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) =>
        q.and(
          q.eq(q.field("role"), "leader"),
          q.eq(q.field("leftAt"), undefined)
        )
      )
      .first();

    return leader?.userId ?? null;
  },
});

// ============================================================================
// Internal Mutations
// ============================================================================

/**
 * Upsert a batch of migrated members into communityPeople.
 * Checks for existing rows by communityId+userId to avoid duplicates.
 */
export const upsertMigratedBatch = internalMutation({
  args: {
    communityId: v.id("communities"),
    members: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const nowTs = Date.now();

    for (const member of args.members) {
      try {
        const existing = await ctx.db
          .query("communityPeople")
          .withIndex("by_community_user", (q) =>
            q.eq("communityId", args.communityId).eq("userId", member.userId)
          )
          .first();

        const doc = {
          communityId: args.communityId,
          userId: member.userId,
          firstName: member.firstName,
          lastName: member.lastName,
          avatarUrl: member.avatarUrl,
          email: member.email,
          phone: member.phone,
          searchText: member.searchText,
          score1: member.score1,
          score2: member.score2,
          score3: member.score3,
          status: member.status,
          assigneeIds: member.assigneeIds,
          connectionPoint: member.connectionPoint,
          lastFollowupAt: member.lastFollowupAt,
          lastActiveAt: member.lastActiveAt,
          lastAttendedAt: member.lastAttendedAt,
          addedAt: member.addedAt,
          alerts: member.alerts,
          isSnoozed: member.isSnoozed,
          snoozedUntil: member.snoozedUntil,
          customText1: member.customText1,
          customText2: member.customText2,
          customText3: member.customText3,
          customText4: member.customText4,
          customText5: member.customText5,
          customNum1: member.customNum1,
          customNum2: member.customNum2,
          customNum3: member.customNum3,
          customNum4: member.customNum4,
          customNum5: member.customNum5,
          customBool1: member.customBool1,
          customBool2: member.customBool2,
          customBool3: member.customBool3,
          customBool4: member.customBool4,
          customBool5: member.customBool5,
          rawValues: member.rawValues,
          updatedAt: nowTs,
        };

        if (existing) {
          await ctx.db.patch(existing._id, doc);
        } else {
          await ctx.db.insert("communityPeople", {
            ...doc,
            createdAt: nowTs,
          });
        }
      } catch (e) {
        console.error(
          `[migration] Failed to upsert communityPeople for user ${member.userId}: ${e}`
        );
      }
    }
  },
});

/**
 * Set community-level peopleCustomFields from a group's followupColumnConfig.
 */
export const setCommunityPeopleCustomFields = internalMutation({
  args: {
    communityId: v.id("communities"),
    customFields: v.array(
      v.object({
        slot: v.string(),
        name: v.string(),
        type: v.string(),
        options: v.optional(v.array(v.string())),
      })
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.communityId, {
      peopleCustomFields: args.customFields,
    });
  },
});

/**
 * Create a peopleSavedViews entry from a group's followupColumnConfig.
 */
export const createSavedView = internalMutation({
  args: {
    communityId: v.id("communities"),
    createdById: v.id("users"),
    name: v.string(),
    columnOrder: v.optional(v.array(v.string())),
    hiddenColumns: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const nowTs = Date.now();
    await ctx.db.insert("peopleSavedViews", {
      communityId: args.communityId,
      createdById: args.createdById,
      visibility: "shared",
      name: args.name,
      columnOrder: args.columnOrder,
      hiddenColumns: args.hiddenColumns,
      createdAt: nowTs,
      updatedAt: nowTs,
    });
  },
});

// ============================================================================
// Migration Actions
// ============================================================================

/**
 * Migrate a single community's memberFollowupScores to communityPeople.
 *
 * Steps:
 * 1. Find announcement group
 * 2. Paginate through all memberFollowupScores for that group
 * 3. Enrich with user data and map fields
 * 4. Upsert into communityPeople in batches
 * 5. Copy followupColumnConfig.customFields to communities.peopleCustomFields
 */
export const migrateCommunity = internalAction({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    console.log(
      `[migration] Starting migration for community ${args.communityId}`
    );

    // Step 1: Find announcement group
    const announcementGroup = await ctx.runQuery(
      internal.functions.migrations.migrateToCommunityPeople
        .getAnnouncementGroup,
      { communityId: args.communityId }
    );

    if (!announcementGroup) {
      console.log(
        `[migration] No announcement group for community ${args.communityId}, skipping`
      );
      return;
    }

    // Step 2: Paginate through memberFollowupScores
    let cursor: string | undefined = undefined;
    let isDone = false;
    let totalMigrated = 0;

    while (!isDone) {
      const page: { scores: any[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(
        internal.functions.migrations.migrateToCommunityPeople
          .getFollowupScoresForGroup,
        {
          groupId: announcementGroup._id,
          cursor,
          limit: BATCH_SIZE,
        }
      );

      if (page.scores.length === 0) {
        isDone = page.isDone;
        cursor = page.continueCursor;
        continue;
      }

      // Step 3: Enrich with user data
      const enrichedMembers = await ctx.runQuery(
        internal.functions.migrations.migrateToCommunityPeople.enrichScoreBatch,
        {
          communityId: args.communityId,
          scoreRows: page.scores,
        }
      );

      // Step 4: Upsert batch
      await ctx.runMutation(
        internal.functions.migrations.migrateToCommunityPeople
          .upsertMigratedBatch,
        {
          communityId: args.communityId,
          members: enrichedMembers,
        }
      );

      totalMigrated += enrichedMembers.length;
      isDone = page.isDone;
      cursor = page.continueCursor;
    }

    // Step 5: Copy followupColumnConfig.customFields to community
    const groupsWithConfig = await ctx.runQuery(
      internal.functions.migrations.migrateToCommunityPeople
        .getGroupsWithColumnConfig,
      { communityId: args.communityId }
    );

    // Use the announcement group's config first, or the first group that has one
    const sourceGroup =
      groupsWithConfig.find(
        (g: any) => g._id === announcementGroup._id
      ) ?? groupsWithConfig[0];

    const customFields = sourceGroup?.followupColumnConfig?.customFields;
    if (customFields && customFields.length > 0) {
      const community = await ctx.runQuery(
        internal.functions.migrations.migrateToCommunityPeople.getCommunity,
        { communityId: args.communityId }
      );

      // Only set if community doesn't already have peopleCustomFields
      if (!community?.peopleCustomFields?.length) {
        await ctx.runMutation(
          internal.functions.migrations.migrateToCommunityPeople
            .setCommunityPeopleCustomFields,
          {
            communityId: args.communityId,
            customFields,
          }
        );
        console.log(
          `[migration] Copied ${customFields.length} custom field definitions to community ${args.communityId}`
        );
      }
    }

    console.log(
      `[migration] Migrated ${totalMigrated} members for community ${args.communityId}`
    );
  },
});

/**
 * Migrate all communities by fanning out migrateCommunity calls.
 * Staggered at 3s intervals to avoid thundering herd.
 */
export const migrateAllCommunities = internalAction({
  args: {},
  handler: async (ctx) => {
    const communityIds: Id<"communities">[] = await ctx.runQuery(
      internal.functions.migrations.migrateToCommunityPeople.getAllCommunityIds,
      {}
    );

    for (let i = 0; i < communityIds.length; i++) {
      await ctx.scheduler.runAfter(
        i * STAGGER_INTERVAL_MS,
        internal.functions.migrations.migrateToCommunityPeople.migrateCommunity,
        { communityId: communityIds[i] }
      );
    }

    console.log(
      `[migration] Scheduled migration for ${communityIds.length} communities`
    );
  },
});

/**
 * Migrate followupColumnConfig from groups to peopleSavedViews.
 *
 * For each group with a followupColumnConfig:
 * - Creates a peopleSavedViews entry preserving column order and hidden columns
 * - Names the view "{group name} View"
 * - Sets visibility to "shared"
 * - Uses the group's first leader as createdById
 */
export const migrateColumnConfigsToViews = internalAction({
  args: {},
  handler: async (ctx) => {
    const communityIds: Id<"communities">[] = await ctx.runQuery(
      internal.functions.migrations.migrateToCommunityPeople.getAllCommunityIds,
      {}
    );

    let totalViews = 0;

    for (const communityId of communityIds) {
      try {
        const groupsWithConfig = await ctx.runQuery(
          internal.functions.migrations.migrateToCommunityPeople
            .getGroupsWithColumnConfig,
          { communityId }
        );

        for (const group of groupsWithConfig) {
          const config = group.followupColumnConfig as any;
          if (!config) continue;

          // Find a leader for createdById
          const leaderId = await ctx.runQuery(
            internal.functions.migrations.migrateToCommunityPeople
              .getGroupFirstLeader,
            { groupId: group._id }
          );

          if (!leaderId) {
            console.log(
              `[migration] No leader found for group ${group._id} (${group.name}), skipping view creation`
            );
            continue;
          }

          await ctx.runMutation(
            internal.functions.migrations.migrateToCommunityPeople
              .createSavedView,
            {
              communityId: group.communityId,
              createdById: leaderId,
              name: `${group.name} View`,
              columnOrder: config.columnOrder,
              hiddenColumns: config.hiddenColumns,
            }
          );

          totalViews++;
        }
      } catch (e) {
        console.error(
          `[migration] Failed to migrate column configs for community ${communityId}: ${e}`
        );
      }
    }

    console.log(
      `[migration] Created ${totalViews} saved views from column configs`
    );
  },
});

// ============================================================================
// Verification
// ============================================================================

/**
 * Verify migration for a given community.
 * Compares communityPeople count against memberFollowupScores count
 * for the announcement group and reports any missing members.
 */
export const verifyMigration = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    // Find announcement group
    const announcementGroup = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) =>
        q.eq("communityId", args.communityId)
      )
      .filter((q) => q.eq(q.field("isAnnouncementGroup"), true))
      .first();

    if (!announcementGroup) {
      return {
        communityPeopleCount: 0,
        memberFollowupScoresCount: 0,
        missingMembers: [] as string[],
        error: "No announcement group found",
      };
    }

    // Count memberFollowupScores for the announcement group
    const followupScores = await ctx.db
      .query("memberFollowupScores")
      .withIndex("by_group", (q) =>
        q.eq("groupId", announcementGroup._id)
      )
      .collect();

    // Count communityPeople for this community
    const communityPeople = await ctx.db
      .query("communityPeople")
      .withIndex("by_community", (q) =>
        q.eq("communityId", args.communityId)
      )
      .collect();

    // Find missing members (in followupScores but not in communityPeople)
    const communityPeopleUserIds = new Set(
      communityPeople.map((cp) => cp.userId.toString())
    );
    const missingMembers: string[] = [];

    for (const score of followupScores) {
      if (!communityPeopleUserIds.has(score.userId.toString())) {
        const user = await ctx.db.get(score.userId);
        missingMembers.push(
          `${user?.firstName ?? "?"} ${user?.lastName ?? "?"} (${score.userId})`
        );
      }
    }

    return {
      communityPeopleCount: communityPeople.length,
      memberFollowupScoresCount: followupScores.length,
      missingMembers,
    };
  },
});
