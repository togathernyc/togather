/**
 * Community People functions
 *
 * Handles community-level people operations for the People page:
 * - List community people (paginated, sorted, filtered)
 * - Search community people by name/email/phone
 * - Get score and custom field configuration
 * - Set custom fields, status, and assignees
 * - List people filtered by group membership
 *
 * Reads from the pre-computed `communityPeople` table — zero joins,
 * zero computation at read time. Supports server-side sorting via indexes.
 */

import { v, ConvexError } from "convex/values";
import { query, mutation, internalMutation } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { isCommunityAdmin } from "../lib/permissions";
import { isActiveMembership, isLeaderRole } from "../lib/helpers";
import { VALID_CUSTOM_SLOTS } from "../lib/followupConstants";
import { SYSTEM_SCORES } from "./systemScoring";

// ============================================================================
// Auth Helpers
// ============================================================================

/**
 * Verify user is a member of the community. Returns the membership record.
 */
async function requireCommunityMember(
  ctx: { db: any },
  communityId: Id<"communities">,
  userId: Id<"users">,
) {
  const membership = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q: any) =>
      q.eq("userId", userId).eq("communityId", communityId),
    )
    .first();

  if (!membership || membership.status !== 1) {
    throw new ConvexError("Not a community member");
  }

  return membership;
}

/**
 * Verify user is a community admin or a leader of any group in the community.
 * Uses the same pattern as memberFollowups.ts getActiveLeaderGroupIds.
 */
async function requireCommunityLeader(
  ctx: { db: any },
  communityId: Id<"communities">,
  userId: Id<"users">,
) {
  // Check if user is a community admin first (fast path)
  const isAdmin = await isCommunityAdmin(ctx, communityId, userId);
  if (isAdmin) return;

  // Check if user is a leader of any group in the community
  const memberships = await ctx.db
    .query("groupMembers")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .collect();

  for (const membership of memberships) {
    if (!isActiveMembership(membership) || !isLeaderRole(membership.role)) {
      continue;
    }
    // Verify this group belongs to the community
    const group = await ctx.db.get(membership.groupId);
    if (group && group.communityId === communityId) {
      return; // User is a leader in at least one group in this community
    }
  }

  throw new ConvexError("Must be a community leader or admin");
}

// ============================================================================
// Index Mapping
// ============================================================================

const INDEX_MAP: Record<string, string> = {
  score1: "by_community_score1",
  score2: "by_community_score2",
  score3: "by_community_score3",
  firstName: "by_community_firstName",
  lastName: "by_community_lastName",
  addedAt: "by_community_addedAt",
  lastAttendedAt: "by_community_lastAttendedAt",
  lastFollowupAt: "by_community_lastFollowupAt",
  lastActiveAt: "by_community_lastActiveAt",
  status: "by_community_status",
  customText1: "by_community_customText1",
  customText2: "by_community_customText2",
  customText3: "by_community_customText3",
  customText4: "by_community_customText4",
  customText5: "by_community_customText5",
  customNum1: "by_community_customNum1",
  customNum2: "by_community_customNum2",
  customNum3: "by_community_customNum3",
  customNum4: "by_community_customNum4",
  customNum5: "by_community_customNum5",
  customBool1: "by_community_customBool1",
  customBool2: "by_community_customBool2",
  customBool3: "by_community_customBool3",
  customBool4: "by_community_customBool4",
  customBool5: "by_community_customBool5",
};

// ============================================================================
// Queries
// ============================================================================

/**
 * Get paginated list of community people.
 *
 * Reads from pre-computed `communityPeople` table — zero joins,
 * zero computation at read time. Supports server-side sorting via indexes.
 */
export const list = query({
  args: {
    communityId: v.id("communities"),
    token: v.optional(v.string()),
    sortBy: v.optional(v.string()),
    sortDirection: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    statusFilter: v.optional(v.string()),
    scoreField: v.optional(v.string()),
    scoreMin: v.optional(v.number()),
    scoreMax: v.optional(v.number()),
    assigneeFilter: v.optional(v.string()),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token ?? "");
    await requireCommunityMember(ctx, args.communityId, userId);

    const direction = args.sortDirection === "desc" ? "desc" : "asc";
    const indexName =
      INDEX_MAP[args.sortBy ?? "lastName"] ?? "by_community_lastName";

    let q = ctx.db
      .query("communityPeople")
      .withIndex(indexName as any, (fq: any) =>
        fq.eq("communityId", args.communityId),
      )
      .order(direction);

    // Apply optional filters
    const scoreFilterField = (args.scoreField ?? "score1") as
      | "score1"
      | "score2"
      | "score3";
    const hasFilters =
      args.statusFilter ||
      args.assigneeFilter ||
      args.scoreMax !== undefined ||
      args.scoreMin !== undefined;

    if (hasFilters) {
      q = q.filter((fq) => {
        const conds: any[] = [];
        if (args.statusFilter) {
          conds.push(fq.eq(fq.field("status"), args.statusFilter));
        }
        if (args.assigneeFilter) {
          // assigneeFilter is a userId string — check if it's in the assigneeIds array
          // Since Convex filter doesn't support array contains, we use a workaround:
          // For single-assignee filtering, we check assigneeIds field existence
          // This is a limitation — full array-contains filtering should be done client-side
          // For now, we pass through and let the client handle complex array filtering
        }
        if (args.scoreMax !== undefined) {
          conds.push(fq.lt(fq.field(scoreFilterField), args.scoreMax));
        }
        if (args.scoreMin !== undefined) {
          conds.push(fq.gt(fq.field(scoreFilterField), args.scoreMin));
        }
        if (conds.length === 0) return true;
        return conds.length === 1
          ? conds[0]
          : fq.and(...(conds as [any, any, ...any[]]));
      });
    }

    return await q.paginate(args.paginationOpts);
  },
});

/**
 * Search community people by name/email/phone using full-text search index.
 * Returns up to 50 results ordered by relevance.
 */
export const search = query({
  args: {
    communityId: v.id("communities"),
    token: v.optional(v.string()),
    searchTerm: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token ?? "");
    await requireCommunityMember(ctx, args.communityId, userId);

    const results = await ctx.db
      .query("communityPeople")
      .withSearchIndex("search_communityPeople", (q: any) =>
        q
          .search("searchText", args.searchTerm)
          .eq("communityId", args.communityId),
      )
      .take(50);

    return results;
  },
});

/**
 * Get score configuration and custom field definitions for the community.
 * Called once per page load, not per page of results.
 */
export const getConfig = query({
  args: {
    communityId: v.id("communities"),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token ?? "");
    await requireCommunityMember(ctx, args.communityId, userId);

    const community = await ctx.db.get(args.communityId);
    if (!community) {
      throw new ConvexError("Community not found");
    }

    return {
      scores: SYSTEM_SCORES,
      customFields: (community as any).peopleCustomFields ?? [],
    };
  },
});

/**
 * List community people filtered by group membership.
 * Fetches active group members, then batch-looks up their communityPeople records.
 * Uses manual cursor-based pagination (cursor = offset number as string).
 */
export const listByGroup = query({
  args: {
    communityId: v.id("communities"),
    groupId: v.id("groups"),
    token: v.optional(v.string()),
    sortBy: v.optional(v.string()),
    sortDirection: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token ?? "");
    await requireCommunityMember(ctx, args.communityId, userId);

    // Verify group belongs to this community
    const group = await ctx.db.get(args.groupId);
    if (!group || group.communityId !== args.communityId) {
      throw new ConvexError("Group not found in this community");
    }

    // Get all active group members
    const groupMembers = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q: any) => q.eq("groupId", args.groupId))
      .collect();

    const activeMembers = groupMembers.filter(
      (m: any) => m.leftAt === undefined,
    );

    // Batch-fetch communityPeople records for each active member
    const communityPeopleRecords: any[] = [];
    for (const member of activeMembers) {
      const cpRecord = await ctx.db
        .query("communityPeople")
        .withIndex("by_community_user", (q: any) =>
          q.eq("communityId", args.communityId).eq("userId", member.userId),
        )
        .first();
      if (cpRecord) {
        communityPeopleRecords.push(cpRecord);
      }
    }

    // Sort in-function by desired field
    const sortBy = args.sortBy ?? "lastName";
    const sortDir = args.sortDirection === "desc" ? -1 : 1;
    communityPeopleRecords.sort((a: any, b: any) => {
      const aVal = a[sortBy] ?? "";
      const bVal = b[sortBy] ?? "";
      if (aVal < bVal) return -1 * sortDir;
      if (aVal > bVal) return 1 * sortDir;
      return 0;
    });

    // Manual pagination using cursor = offset number as string
    const offset = args.paginationOpts.cursor
      ? parseInt(args.paginationOpts.cursor, 10)
      : 0;
    const numItems = args.paginationOpts.numItems;
    const page = communityPeopleRecords.slice(offset, offset + numItems);
    const nextOffset = offset + numItems;
    const isDone = nextOffset >= communityPeopleRecords.length;

    return {
      page,
      isDone,
      continueCursor: isDone ? "" : String(nextOffset),
    };
  },
});

// ============================================================================
// Mutations
// ============================================================================

/**
 * Set or clear a custom field value on a community person.
 * Validates that the slot name is valid and the value type matches the slot prefix.
 * Syncs the value to all memberFollowupScores rows for this user in the community.
 */
export const setCustomField = mutation({
  args: {
    token: v.string(),
    communityPeopleId: v.id("communityPeople"),
    field: v.string(),
    value: v.union(v.string(), v.number(), v.boolean(), v.null()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get the communityPeople record to find the communityId
    const cpRecord = await ctx.db.get(args.communityPeopleId);
    if (!cpRecord) {
      throw new ConvexError("Community person record not found");
    }

    await requireCommunityLeader(ctx, cpRecord.communityId, userId);

    // Validate field name
    if (!VALID_CUSTOM_SLOTS.has(args.field)) {
      throw new ConvexError(`Invalid custom field slot: ${args.field}`);
    }

    // Validate value type matches slot prefix
    const value = args.value;
    if (value !== null) {
      if (args.field.startsWith("customText") && typeof value !== "string") {
        throw new ConvexError(`Slot ${args.field} requires a string value`);
      }
      if (args.field.startsWith("customNum") && typeof value !== "number") {
        throw new ConvexError(`Slot ${args.field} requires a number value`);
      }
      if (args.field.startsWith("customBool") && typeof value !== "boolean") {
        throw new ConvexError(`Slot ${args.field} requires a boolean value`);
      }
    }

    // Patch the communityPeople document
    await ctx.db.patch(args.communityPeopleId, {
      [args.field]: value === null ? undefined : value,
      updatedAt: Date.now(),
    });

    // Sync to all group-level memberFollowupScores rows for this user
    await syncCommunityFieldToGroupRows(ctx, {
      communityId: cpRecord.communityId,
      userId: cpRecord.userId,
      field: args.field,
      value: value === null ? undefined : value,
    });

    return { success: true };
  },
});

/**
 * Set or clear the status on a community person.
 * Syncs the value to all memberFollowupScores rows for this user in the community.
 */
export const setStatus = mutation({
  args: {
    token: v.string(),
    communityPeopleId: v.id("communityPeople"),
    status: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const cpRecord = await ctx.db.get(args.communityPeopleId);
    if (!cpRecord) {
      throw new ConvexError("Community person record not found");
    }

    await requireCommunityLeader(ctx, cpRecord.communityId, userId);

    await ctx.db.patch(args.communityPeopleId, {
      status: args.status === null ? undefined : args.status,
      updatedAt: Date.now(),
    });

    // Sync status to all group-level memberFollowupScores rows
    await syncCommunityFieldToGroupRows(ctx, {
      communityId: cpRecord.communityId,
      userId: cpRecord.userId,
      field: "status",
      value: args.status === null ? undefined : args.status,
    });

    return { success: true };
  },
});

/**
 * Set assignee IDs on a community person.
 * Syncs the value to all memberFollowupScores rows for this user in the community.
 */
export const setAssignees = mutation({
  args: {
    token: v.string(),
    communityPeopleId: v.id("communityPeople"),
    assigneeIds: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const cpRecord = await ctx.db.get(args.communityPeopleId);
    if (!cpRecord) {
      throw new ConvexError("Community person record not found");
    }

    await requireCommunityLeader(ctx, cpRecord.communityId, userId);

    await ctx.db.patch(args.communityPeopleId, {
      assigneeIds: args.assigneeIds.length > 0 ? args.assigneeIds : undefined,
      updatedAt: Date.now(),
    });

    // Sync assignees to all group-level memberFollowupScores rows
    // Group-level rows store assigneeId (single) and assigneeIds (array)
    await syncAssigneesToGroupRows(ctx, {
      communityId: cpRecord.communityId,
      userId: cpRecord.userId,
      assigneeIds: args.assigneeIds,
    });

    return { success: true };
  },
});

// ============================================================================
// Internal Sync Helpers
// ============================================================================

/**
 * Sync a single field from communityPeople to all memberFollowupScores rows
 * for the same user across all groups in the community.
 *
 * This ensures community-level changes (status, custom fields) are reflected
 * in the group-level pre-computed score table.
 */
async function syncCommunityFieldToGroupRows(
  ctx: any,
  opts: {
    communityId: Id<"communities">;
    userId: Id<"users">;
    field: string;
    value: any;
  },
) {
  // Find all groups in this community
  const groups = await ctx.db
    .query("groups")
    .withIndex("by_community", (q: any) =>
      q.eq("communityId", opts.communityId),
    )
    .collect();

  // For each group, find the user's memberFollowupScores record and update it
  for (const group of groups) {
    const groupMember = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q: any) =>
        q.eq("groupId", group._id).eq("userId", opts.userId),
      )
      .first();

    if (!groupMember || groupMember.leftAt !== undefined) continue;

    const scoreDoc = await ctx.db
      .query("memberFollowupScores")
      .withIndex("by_groupMember", (q: any) =>
        q.eq("groupMemberId", groupMember._id),
      )
      .first();

    if (scoreDoc) {
      await ctx.db.patch(scoreDoc._id, {
        [opts.field]: opts.value,
        updatedAt: Date.now(),
      });
    }
  }
}

/**
 * Sync assignee IDs from communityPeople to all memberFollowupScores rows.
 * Group-level rows store both assigneeId (first) and assigneeIds (array).
 */
async function syncAssigneesToGroupRows(
  ctx: any,
  opts: {
    communityId: Id<"communities">;
    userId: Id<"users">;
    assigneeIds: Id<"users">[];
  },
) {
  const groups = await ctx.db
    .query("groups")
    .withIndex("by_community", (q: any) =>
      q.eq("communityId", opts.communityId),
    )
    .collect();

  for (const group of groups) {
    const groupMember = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q: any) =>
        q.eq("groupId", group._id).eq("userId", opts.userId),
      )
      .first();

    if (!groupMember || groupMember.leftAt !== undefined) continue;

    const scoreDoc = await ctx.db
      .query("memberFollowupScores")
      .withIndex("by_groupMember", (q: any) =>
        q.eq("groupMemberId", groupMember._id),
      )
      .first();

    if (scoreDoc) {
      await ctx.db.patch(scoreDoc._id, {
        assigneeId: opts.assigneeIds[0],
        assigneeIds:
          opts.assigneeIds.length > 0 ? opts.assigneeIds : undefined,
        updatedAt: Date.now(),
      });
    }
  }
}

// ============================================================================
// Internal Mutations (for use by other Convex functions)
// ============================================================================

/**
 * Internal mutation to sync a community-level field to all group rows.
 * Can be called via ctx.scheduler or internal API from other modules.
 */
export const syncFieldToGroups = internalMutation({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
    field: v.string(),
    value: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await syncCommunityFieldToGroupRows(ctx, {
      communityId: args.communityId,
      userId: args.userId,
      field: args.field,
      value: args.value,
    });
  },
});
