/**
 * Community People functions
 *
 * Handles group-level people operations for the People page:
 * - List community people by group (paginated, sorted, filtered)
 * - Search community people by group
 * - Get score and custom field configuration
 * - Set custom fields, status, and assignees (with sibling sync)
 *
 * Reads from the pre-computed `communityPeople` table — zero joins,
 * zero computation at read time. Supports server-side sorting via indexes.
 */

import { v, ConvexError } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query, mutation, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { isCommunityAdmin } from "../lib/permissions";
import { isActiveMembership, isLeaderRole } from "../lib/helpers";
import { VALID_CUSTOM_SLOTS } from "../lib/followupConstants";
import { SYSTEM_SCORES, SYSTEM_VARIABLE_IDS } from "./systemScoring";
import { getMediaUrl } from "../lib/utils";

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

/**
 * Get IDs of groups in the community where the user is an active leader/admin.
 */
async function getLeaderGroupIdsInCommunity(
  ctx: { db: any },
  communityId: Id<"communities">,
  userId: Id<"users">,
): Promise<Id<"groups">[]> {
  const memberships = await ctx.db
    .query("groupMembers")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .collect();
  const result: Id<"groups">[] = [];
  for (const m of memberships) {
    if (!isActiveMembership(m) || !isLeaderRole(m.role)) continue;
    const group = await ctx.db.get(m.groupId);
    if (group?.communityId === communityId) result.push(m.groupId);
  }
  return result;
}

// ============================================================================
// Index Mapping
// ============================================================================

const INDEX_MAP: Record<string, string> = {
  score1: "by_group_score1",
  score2: "by_group_score2",
  score3: "by_group_score3",
  firstName: "by_group_firstName",
  lastName: "by_group_lastName",
  addedAt: "by_group_addedAt",
  lastAttendedAt: "by_group_lastAttendedAt",
  lastFollowupAt: "by_group_lastFollowupAt",
  lastActiveAt: "by_group_lastActiveAt",
  status: "by_group_status",
  assignee: "by_group_assigneeSortKey",
  zipCode: "by_group_zipCode",
  customText1: "by_group_customText1",
  customText2: "by_group_customText2",
  customText3: "by_group_customText3",
  customText4: "by_group_customText4",
  customText5: "by_group_customText5",
  customNum1: "by_group_customNum1",
  customNum2: "by_group_customNum2",
  customNum3: "by_group_customNum3",
  customNum4: "by_group_customNum4",
  customNum5: "by_group_customNum5",
  customBool1: "by_group_customBool1",
  customBool2: "by_group_customBool2",
  customBool3: "by_group_customBool3",
  customBool4: "by_group_customBool4",
  customBool5: "by_group_customBool5",
};

// ============================================================================
// Queries
// ============================================================================

/**
 * Get paginated list of community people for a group.
 *
 * Reads from pre-computed `communityPeople` table — zero joins,
 * zero computation at read time. Supports server-side sorting via indexes.
 */
export const list = query({
  args: {
    groupId: v.id("groups"),
    token: v.optional(v.string()),
    sortBy: v.optional(v.string()),
    sortDirection: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    statusFilter: v.optional(v.string()),
    scoreField: v.optional(v.string()),
    scoreMin: v.optional(v.number()),
    scoreMax: v.optional(v.number()),
    assigneeFilter: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token ?? "");

    // Look up the group to get communityId for auth
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new ConvexError("Group not found");
    }
    await requireCommunityMember(ctx, group.communityId, userId);

    const direction = args.sortDirection === "desc" ? "desc" : "asc";
    const indexName =
      INDEX_MAP[args.sortBy ?? "lastName"] ?? "by_group_lastName";

    let q = ctx.db
      .query("communityPeople")
      .withIndex(indexName as any, (fq: any) => fq.eq("groupId", args.groupId))
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
 * Returns up to 200 results ordered by relevance.
 * Supports optional filters to narrow results server-side.
 */
export const search = query({
  args: {
    groupId: v.id("groups"),
    token: v.optional(v.string()),
    searchTerm: v.string(),
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
    const userId = await requireAuth(ctx, args.token ?? "");

    // Look up the group to get communityId for auth
    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new ConvexError("Group not found");
    }
    await requireCommunityMember(ctx, group.communityId, userId);

    let results = ctx.db
      .query("communityPeople")
      .withSearchIndex("search_communityPeople", (q: any) => {
        let sq = q
          .search("searchText", args.searchTerm)
          .eq("groupId", args.groupId);
        if (args.statusFilter) sq = sq.eq("status", args.statusFilter);
        return sq;
      });

    // Range filters via .filter() - score, assignee, and date filters
    const scoreFilterField = (args.scoreField ?? "score1") as
      | "score1"
      | "score2"
      | "score3";
    if (args.scoreMax !== undefined || args.scoreMin !== undefined) {
      results = results.filter((fq: any) => {
        const conds: any[] = [];
        if (args.scoreMax !== undefined)
          conds.push(fq.lt(fq.field(scoreFilterField), args.scoreMax));
        if (args.scoreMin !== undefined)
          conds.push(fq.gt(fq.field(scoreFilterField), args.scoreMin));
        return conds.length === 1
          ? conds[0]
          : fq.and(...(conds as [any, any, ...any[]]));
      });
    }

    // Assignee and date range filters
    const hasExcludedAssignees =
      args.excludedAssigneeFilters && args.excludedAssigneeFilters.length > 0;
    const hasAssigneeFilter = args.assigneeFilter !== undefined;
    const hasDateFilters =
      args.addedAtMin !== undefined || args.addedAtMax !== undefined;

    if (hasExcludedAssignees || hasAssigneeFilter || hasDateFilters) {
      results = results.filter((fq: any) => {
        const conds: any[] = [];
        // assigneeFilter checks if assignee is in assigneeIds array
        // Since Convex filter doesn't support array contains directly,
        // we'll skip assigneeFilter here and apply it client-side
        if (args.excludedAssigneeFilters?.length) {
          for (const excludedAssigneeId of args.excludedAssigneeFilters) {
            // Check that excluded assignee is not in the array
            // This is an approximation - client-side filtering handles it more precisely
            conds.push(
              fq.neq(fq.field("assigneeIds"), [excludedAssigneeId] as any),
            );
          }
        }
        if (args.addedAtMax !== undefined)
          conds.push(fq.lte(fq.field("addedAt"), args.addedAtMax));
        if (args.addedAtMin !== undefined)
          conds.push(fq.gte(fq.field("addedAt"), args.addedAtMin));
        if (conds.length === 0) return true;
        return conds.length === 1
          ? conds[0]
          : fq.and(...(conds as [any, any, ...any[]]));
      });
    }

    return await results.take(200);
  },
});

/**
 * List community people with zip codes for map display.
 * Returns a lean shape with only the fields needed for map pins.
 * Uses the by_group_zipCode index in desc order so non-null zip codes come first;
 * stops collecting once a record with no zipCode is encountered.
 */
export const listForMap = query({
  args: {
    groupId: v.id("groups"),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new ConvexError("Group not found");
    }
    await requireCommunityMember(ctx, group.communityId, userId);

    const MAX_RESULTS = 5000;
    const results: Array<{
      _id: Id<"communityPeople">;
      firstName: string;
      lastName: string;
      avatarUrl: string | undefined;
      zipCode: string;
      status: string | undefined;
    }> = [];

    for await (const record of ctx.db
      .query("communityPeople")
      .withIndex("by_group_zipCode", (q: any) =>
        q.eq("groupId", args.groupId),
      )
      .order("desc")) {
      if (!record.zipCode) break;
      if (results.length >= MAX_RESULTS) break;
      results.push({
        _id: record._id,
        firstName: record.firstName ?? "",
        lastName: record.lastName ?? "",
        avatarUrl: record.avatarUrl,
        zipCode: record.zipCode,
        status: record.status,
      });
    }

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
 * List community people assigned to the current user (or assigneeFilter).
 * Used by the People tab (Profile > Leader Tools > People).
 * Same data as list() but scoped to community and filtered by assignee.
 */
export const listAssignedToMe = query({
  args: {
    communityId: v.id("communities"),
    token: v.optional(v.string()),
    sortBy: v.optional(v.string()),
    sortDirection: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    statusFilter: v.optional(v.string()),
    assigneeFilter: v.optional(v.id("users")),
    excludedAssigneeFilters: v.optional(v.array(v.id("users"))),
    scoreField: v.optional(v.string()),
    scoreMin: v.optional(v.number()),
    scoreMax: v.optional(v.number()),
    addedAtMin: v.optional(v.number()),
    addedAtMax: v.optional(v.number()),
    groupFilter: v.optional(v.id("groups")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token ?? "");
    await requireCommunityLeader(ctx, args.communityId, userId);

    const leaderGroupIds = await getLeaderGroupIdsInCommunity(
      ctx,
      args.communityId,
      userId,
    );
    if (leaderGroupIds.length === 0) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    const leaderGroupIdSet = new Set(leaderGroupIds.map((id) => id.toString()));

    const assigneeId = args.assigneeFilter ?? userId;
    const direction = args.sortDirection === "desc" ? "desc" : "asc";
    const indexName =
      INDEX_MAP[args.sortBy ?? "lastName"] ?? "by_group_lastName";

    // Query by community + assignee for "assigned to me" filter
    let q = ctx.db
      .query("communityPeople")
      .withIndex("by_community_assignee", (fq: any) =>
        fq.eq("communityId", args.communityId).eq("assigneeId", assigneeId),
      );

    // We need to filter by leader groups and apply other filters.
    // by_community_assignee doesn't support sortBy - we'll need to collect and sort/filter.
    const scoreFilterField = (args.scoreField ?? "score1") as
      | "score1"
      | "score2"
      | "score3";
    const hasFilters =
      args.statusFilter ||
      (args.excludedAssigneeFilters && args.excludedAssigneeFilters.length > 0) ||
      args.scoreMax !== undefined ||
      args.scoreMin !== undefined ||
      args.addedAtMin !== undefined ||
      args.addedAtMax !== undefined ||
      args.groupFilter;

    if (hasFilters) {
      q = q.filter((fq) => {
        const conds: any[] = [];
        if (args.statusFilter)
          conds.push(fq.eq(fq.field("status"), args.statusFilter));
        if (args.excludedAssigneeFilters?.length) {
          for (const excludedId of args.excludedAssigneeFilters) {
            conds.push(fq.neq(fq.field("assigneeId"), excludedId));
          }
        }
        if (args.scoreMax !== undefined)
          conds.push(fq.lt(fq.field(scoreFilterField), args.scoreMax));
        if (args.scoreMin !== undefined)
          conds.push(fq.gt(fq.field(scoreFilterField), args.scoreMin));
        if (args.addedAtMax !== undefined)
          conds.push(fq.lte(fq.field("addedAt"), args.addedAtMax));
        if (args.addedAtMin !== undefined)
          conds.push(fq.gte(fq.field("addedAt"), args.addedAtMin));
        if (args.groupFilter)
          conds.push(fq.eq(fq.field("groupId"), args.groupFilter));
        return conds.length === 0
          ? true
          : conds.length === 1
            ? conds[0]
            : fq.and(...(conds as [any, any, ...any[]]));
      });
    }

    const paginatedResult = await q.paginate(args.paginationOpts);

    const filteredPage = args.groupFilter
      ? paginatedResult.page
      : paginatedResult.page.filter((doc: any) =>
          leaderGroupIdSet.has(doc.groupId.toString()),
        );

    const groupNameCache = new Map<string, string>();
    const enrichedPage = await Promise.all(
      filteredPage.map(async (doc: any) => {
        const gidStr = doc.groupId.toString();
        if (!groupNameCache.has(gidStr)) {
          const group = await ctx.db.get(doc.groupId as Id<"groups">);
          groupNameCache.set(gidStr, (group as any)?.name ?? "Unknown Group");
        }
        return { ...doc, groupName: groupNameCache.get(gidStr) };
      }),
    );

    return {
      ...paginatedResult,
      page: enrichedPage,
    };
  },
});

/**
 * Search community people assigned to the current user.
 * Used by the People tab when searching.
 */
export const searchAssignedToMe = query({
  args: {
    communityId: v.id("communities"),
    token: v.optional(v.string()),
    searchTerm: v.string(),
    statusFilter: v.optional(v.string()),
    assigneeFilter: v.optional(v.id("users")),
    excludedAssigneeFilters: v.optional(v.array(v.id("users"))),
    scoreField: v.optional(v.string()),
    scoreMin: v.optional(v.number()),
    scoreMax: v.optional(v.number()),
    addedAtMin: v.optional(v.number()),
    addedAtMax: v.optional(v.number()),
    groupFilter: v.optional(v.id("groups")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token ?? "");
    await requireCommunityLeader(ctx, args.communityId, userId);

    const leaderGroupIds = await getLeaderGroupIdsInCommunity(
      ctx,
      args.communityId,
      userId,
    );
    if (leaderGroupIds.length === 0) return [];
    const leaderGroupIdSet = new Set(leaderGroupIds.map((id) => id.toString()));

    const assigneeId = args.assigneeFilter ?? userId;

    let results = ctx.db
      .query("communityPeople")
      .withSearchIndex("search_communityPeople", (q: any) => {
        let sq = q
          .search("searchText", args.searchTerm)
          .eq("communityId", args.communityId)
          .eq("assigneeId", assigneeId);
        if (args.statusFilter) sq = sq.eq("status", args.statusFilter);
        if (args.groupFilter) sq = sq.eq("groupId", args.groupFilter);
        return sq;
      });

    const scoreFilterField = (args.scoreField ?? "score1") as
      | "score1"
      | "score2"
      | "score3";
    if (args.scoreMax !== undefined || args.scoreMin !== undefined) {
      results = results.filter((fq: any) => {
        const conds: any[] = [];
        if (args.scoreMax !== undefined)
          conds.push(fq.lt(fq.field(scoreFilterField), args.scoreMax));
        if (args.scoreMin !== undefined)
          conds.push(fq.gt(fq.field(scoreFilterField), args.scoreMin));
        return conds.length === 1
          ? conds[0]
          : fq.and(...(conds as [any, any, ...any[]]));
      });
    }

    const hasExcludedAssignees =
      args.excludedAssigneeFilters && args.excludedAssigneeFilters.length > 0;
    const hasDateFilters =
      args.addedAtMin !== undefined || args.addedAtMax !== undefined;

    if (hasExcludedAssignees || hasDateFilters) {
      results = results.filter((fq: any) => {
        const conds: any[] = [];
        if (args.excludedAssigneeFilters?.length) {
          for (const excludedId of args.excludedAssigneeFilters) {
            conds.push(fq.neq(fq.field("assigneeId"), excludedId));
          }
        }
        if (args.addedAtMax !== undefined)
          conds.push(fq.lte(fq.field("addedAt"), args.addedAtMax));
        if (args.addedAtMin !== undefined)
          conds.push(fq.gte(fq.field("addedAt"), args.addedAtMin));
        return conds.length === 0
          ? true
          : conds.length === 1
            ? conds[0]
            : fq.and(...(conds as [any, any, ...any[]]));
      });
    }

    const allResults = await results.take(200);
    const filtered = args.groupFilter
      ? allResults
      : allResults.filter((doc: any) =>
          leaderGroupIdSet.has(doc.groupId.toString()),
        );

    const groupNameCache = new Map<string, string>();
    return Promise.all(
      filtered.map(async (doc: any) => {
        const gidStr = doc.groupId.toString();
        if (!groupNameCache.has(gidStr)) {
          const group = await ctx.db.get(doc.groupId as Id<"groups">);
          groupNameCache.set(gidStr, (group as any)?.name ?? "Unknown Group");
        }
        return { ...doc, groupName: groupNameCache.get(gidStr) };
      }),
    );
  },
});

/**
 * Count community people assigned to the current user (for People tab).
 */
export const countAssignedToMe = query({
  args: {
    communityId: v.id("communities"),
    token: v.optional(v.string()),
    statusFilter: v.optional(v.string()),
    assigneeFilter: v.optional(v.id("users")),
    groupFilter: v.optional(v.id("groups")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token ?? "");
    await requireCommunityLeader(ctx, args.communityId, userId);

    const leaderGroupIds = await getLeaderGroupIdsInCommunity(
      ctx,
      args.communityId,
      userId,
    );
    if (leaderGroupIds.length === 0) return 0;
    const leaderGroupIdSet = new Set(leaderGroupIds.map((id) => id.toString()));

    const assigneeId = args.assigneeFilter ?? userId;

    let count = 0;
    for await (const doc of ctx.db
      .query("communityPeople")
      .withIndex("by_community_assignee", (q: any) =>
        q.eq("communityId", args.communityId).eq("assigneeId", assigneeId),
      )) {
      if (args.groupFilter) {
        if (doc.groupId.toString() !== args.groupFilter.toString()) continue;
      } else if (!leaderGroupIdSet.has(doc.groupId.toString())) {
        continue;
      }
      if (args.statusFilter && doc.status !== args.statusFilter) continue;
      count++;
    }
    return count;
  },
});

// ============================================================================
// Assignee Sort Key Helper
// ============================================================================

/**
 * Build a sort key string from assignee IDs by resolving user names.
 * Returns undefined if no assignees, otherwise concatenated "FirstName LastName" strings.
 */
async function buildAssigneeSortKey(
  ctx: any,
  assigneeIds: string[] | undefined,
): Promise<string | undefined> {
  if (!assigneeIds || assigneeIds.length === 0) return undefined;
  const names: string[] = [];
  for (const id of assigneeIds) {
    const user = await ctx.db.get(id);
    if (user) {
      names.push(
        `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || id,
      );
    }
  }
  return names.length > 0 ? names.join(", ") : undefined;
}

// ============================================================================
// Sibling Sync Helper
// ============================================================================

/**
 * Propagate field changes to all other communityPeople records for the same
 * user in the same community. This keeps per-group records in sync when
 * a leader edits one of them.
 */
async function syncToSiblingRecords(
  ctx: any,
  cpRecord: any,
  fields: Record<string, any>,
) {
  const siblings = await ctx.db
    .query("communityPeople")
    .withIndex("by_community_user", (q: any) =>
      q.eq("communityId", cpRecord.communityId).eq("userId", cpRecord.userId),
    )
    .collect();

  for (const sibling of siblings) {
    if (sibling._id === cpRecord._id) continue;
    await ctx.db.patch(sibling._id, { ...fields, updatedAt: Date.now() });
  }
}

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
    const patchFields = { [args.field]: value === null ? undefined : value };
    await ctx.db.patch(args.communityPeopleId, {
      ...patchFields,
      updatedAt: Date.now(),
    });

    // Sync to sibling records in the same community
    await syncToSiblingRecords(ctx, cpRecord, patchFields);

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

    const patchFields = {
      status: args.status === null ? undefined : args.status,
    };
    await ctx.db.patch(args.communityPeopleId, {
      ...patchFields,
      updatedAt: Date.now(),
    });

    // Sync to sibling records in the same community
    await syncToSiblingRecords(ctx, cpRecord, patchFields);

    return { success: true };
  },
});

/**
 * Set or clear the zipCode on a community person.
 * Syncs the value to sibling communityPeople records and to the users table.
 */
export const setZipCode = mutation({
  args: {
    token: v.string(),
    communityPeopleId: v.id("communityPeople"),
    zipCode: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const cpRecord = await ctx.db.get(args.communityPeopleId);
    if (!cpRecord) {
      throw new ConvexError("Community person record not found");
    }

    await requireCommunityLeader(ctx, cpRecord.communityId, userId);

    const patchFields = {
      zipCode: args.zipCode === null ? undefined : args.zipCode,
    };
    await ctx.db.patch(args.communityPeopleId, {
      ...patchFields,
      updatedAt: Date.now(),
    });

    // Sync to sibling records in the same community
    await syncToSiblingRecords(ctx, cpRecord, patchFields);

    // Sync to the users table
    await ctx.db.patch(cpRecord.userId, {
      zipCode: args.zipCode === null ? undefined : args.zipCode,
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

    const normalizedIds =
      args.assigneeIds.length > 0 ? args.assigneeIds : undefined;
    const assigneeSortKey = await buildAssigneeSortKey(ctx, normalizedIds as string[] | undefined);
    const assigneeId = normalizedIds?.[0];
    const patchFields = {
      assigneeIds: normalizedIds,
      assigneeId,
      assigneeSortKey,
    };
    await ctx.db.patch(args.communityPeopleId, {
      ...patchFields,
      updatedAt: Date.now(),
    });

    // Sync to sibling records in the same community
    await syncToSiblingRecords(ctx, cpRecord, patchFields);

    return { success: true };
  },
});

// ============================================================================
// Additional Queries
// ============================================================================

/**
 * Count community people for a given group.
 * Uses the by_group index for a direct count — no joins needed.
 */
export const count = query({
  args: {
    groupId: v.id("groups"),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token ?? "");

    const group = await ctx.db.get(args.groupId);
    if (!group?.communityId) return 0;

    await requireCommunityMember(ctx, group.communityId, userId);

    let count = 0;
    for await (const _cp of ctx.db
      .query("communityPeople")
      .withIndex("by_group", (q: any) => q.eq("groupId", args.groupId))) {
      count++;
    }
    return count;
  },
});

/**
 * Get detailed history for a community person.
 * Aggregates attendance and followup history across all groups.
 *
 * Accepts either communityPeopleId (from per-group People view) or groupMemberId
 * (from cross-group view which uses memberFollowupScores). When groupMemberId
 * is provided, resolves it to the corresponding communityPeople record.
 */
export const history = query({
  args: {
    communityPeopleId: v.optional(v.id("communityPeople")),
    groupMemberId: v.optional(v.id("groupMembers")),
    token: v.optional(v.string()),
    currentUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const authUserId = await requireAuth(ctx, args.token ?? "");
    const currentTime = Date.now();

    let cpRecord: any;
    if (args.communityPeopleId) {
      cpRecord = await ctx.db.get(args.communityPeopleId);
    } else if (args.groupMemberId) {
      const groupMember = await ctx.db.get(args.groupMemberId);
      if (!groupMember) {
        throw new ConvexError("Group member not found");
      }
      const group = await ctx.db.get(groupMember.groupId);
      if (!group?.communityId) {
        throw new ConvexError("Group or community not found");
      }
      cpRecord = await ctx.db
        .query("communityPeople")
        .withIndex("by_group_user", (q: any) =>
          q.eq("groupId", groupMember.groupId).eq("userId", groupMember.userId),
        )
        .first();
    } else {
      throw new ConvexError("Either communityPeopleId or groupMemberId is required");
    }

    if (!cpRecord) {
      throw new ConvexError("Community person not found");
    }

    await requireCommunityMember(ctx, cpRecord.communityId, authUserId);

    const user = await ctx.db.get(cpRecord.userId);
    if (!user) {
      throw new ConvexError("User not found");
    }

    // Find announcement group for this community
    const announcementGroup = await ctx.db
      .query("groups")
      .withIndex("by_community", (q: any) =>
        q.eq("communityId", cpRecord.communityId),
      )
      .filter((q: any) => q.eq(q.field("isAnnouncementGroup"), true))
      .first();

    // Find announcement group membership (primary membership for followups)
    let primaryGroupMember: any = null;
    if (announcementGroup) {
      primaryGroupMember = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q: any) =>
          q.eq("groupId", announcementGroup._id).eq("userId", cpRecord.userId),
        )
        .first();
    }

    // Get all active group memberships for this user in this community
    const allMemberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q: any) => q.eq("userId", cpRecord.userId))
      .collect();

    const communityMemberships = [];
    for (const membership of allMemberships) {
      if (membership.leftAt !== undefined) continue;
      const group = await ctx.db.get(membership.groupId);
      if (group && group.communityId === cpRecord.communityId) {
        communityMemberships.push({ membership, group });
      }
    }

    // Get followup entries from announcement group membership
    const followups = primaryGroupMember
      ? await ctx.db
          .query("memberFollowups")
          .withIndex("by_groupMember_createdAt", (q: any) =>
            q.eq("groupMemberId", primaryGroupMember._id),
          )
          .order("desc")
          .take(100)
      : [];

    // Batch fetch createdBy users
    const createdByIds = Array.from(
      new Set(followups.map((f: any) => f.createdById)),
    );
    const createdByUsers = await Promise.all(
      createdByIds.map((id: any) => ctx.db.get(id)),
    );
    const createdByUserMap = new Map(
      createdByUsers
        .filter((u: any): u is any => u !== null)
        .map((u: any) => [u._id.toString(), u]),
    );

    const followupsWithUsers = followups.map((f: any) => {
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
      (f: any) =>
        f.type === "snooze" && f.snoozeUntil && f.snoozeUntil > currentTime,
    );

    // Build cross-group attendance
    const DAY_MS = 24 * 60 * 60 * 1000;
    const sixtyDaysAgo = currentTime - 60 * DAY_MS;
    const crossGroupAttendance: Array<{
      groupId: string;
      groupName: string;
      canEdit: boolean;
      meetings: Array<{
        meetingId: string;
        title: string;
        date: number;
        status: number;
      }>;
    }> = [];

    let allGroupsAttended = 0;
    let allGroupsTotal = 0;

    for (const { membership, group } of communityMemberships) {
      // Check if current user can edit attendance in this group
      let canEdit = false;
      if (args.currentUserId) {
        const callerMembership = await ctx.db
          .query("groupMembers")
          .withIndex("by_group_user", (q: any) =>
            q.eq("groupId", group._id).eq("userId", args.currentUserId!),
          )
          .first();
        if (
          callerMembership &&
          (callerMembership.role === "leader" ||
            callerMembership.role === "admin")
        ) {
          canEdit = true;
        }
      }

      const attendanceCutoff = Math.max(membership.joinedAt ?? 0, sixtyDaysAgo);
      const meetings = await ctx.db
        .query("meetings")
        .withIndex("by_group_scheduledAt", (q: any) =>
          q
            .eq("groupId", group._id)
            .gte("scheduledAt", attendanceCutoff)
            .lt("scheduledAt", currentTime),
        )
        .filter((q: any) => q.neq(q.field("status"), "cancelled"))
        .order("desc")
        .take(20);

      const attendanceResults = await Promise.all(
        meetings.map((meeting: any) =>
          ctx.db
            .query("meetingAttendances")
            .withIndex("by_meeting_user", (q: any) =>
              q.eq("meetingId", meeting._id).eq("userId", cpRecord.userId),
            )
            .first(),
        ),
      );

      const meetingData = meetings.map((m: any, i: number) => ({
        meetingId: m._id.toString(),
        title: m.title ?? "Meeting",
        date: m.scheduledAt,
        status: attendanceResults[i]?.status ?? 0,
      }));

      allGroupsTotal += meetings.length;
      allGroupsAttended += meetingData.filter(
        (m: any) => m.status === 1,
      ).length;

      crossGroupAttendance.push({
        groupId: group._id.toString(),
        groupName: group.name,
        canEdit,
        meetings: meetingData,
      });
    }

    // Build score breakdown from rawValues on the communityPeople record
    const rawValues = cpRecord.rawValues ?? {};
    const scoreBreakdown = SYSTEM_SCORES.map((scoreDef: any) => ({
      id: scoreDef.id,
      name: scoreDef.name,
      value: (cpRecord as any)[scoreDef.slot] ?? 0,
      variables:
        scoreDef.variables?.map((v: any) => ({
          id: v.variableId,
          label: v.label ?? v.variableId,
          normHint: v.normHint ?? "",
          rawValue: (rawValues as any)[v.variableId] ?? 0,
          normalizedValue: 0,
          weight: v.weight ?? 1,
        })) ?? [],
    }));

    // Serving history from announcement group's PCO data
    const servingHistory: Array<{
      date: string;
      serviceTypeName: string;
      teamName: string;
      position: string | null;
    }> = [];

    if (announcementGroup) {
      const allDetails =
        (announcementGroup as any)?.pcoServingCounts?.servingDetails ?? [];
      const userDetails = allDetails
        .filter((d: any) => d.userId.toString() === cpRecord.userId.toString())
        .sort((a: any, b: any) => b.date.localeCompare(a.date));

      for (const d of userDetails) {
        servingHistory.push({
          date: d.date,
          serviceTypeName: d.serviceTypeName,
          teamName: d.teamName,
          position: d.position ?? null,
        });
        if (servingHistory.length >= 15) break;
      }
    }

    // Get profile image URL
    const profileImage = user.profilePhoto
      ? typeof user.profilePhoto === "string"
        ? user.profilePhoto
        : undefined
      : undefined;

    return {
      member: {
        id: cpRecord._id,
        odUserId: cpRecord.userId,
        firstName: user.firstName || cpRecord.firstName || "",
        lastName: user.lastName || cpRecord.lastName || "",
        email: user.email || cpRecord.email,
        phone: user.phone || cpRecord.phone,
        profileImage,
        joinedAt: cpRecord.addedAt,
      },
      attendanceHistory:
        crossGroupAttendance.length > 0
          ? crossGroupAttendance[0].meetings.map((m: any) => ({
              meetingId: m.meetingId,
              title: m.title,
              date: m.date,
              status: m.status,
            }))
          : [],
      followups: followupsWithUsers,
      isSnoozed: !!activeSnooze,
      snoozedUntil: activeSnooze?.snoozeUntil,
      scoreBreakdown,
      crossGroupAttendance,
      servingHistory,
      toolDisplayName: "People",
      triggeredAlerts: cpRecord.alerts ?? [],
    };
  },
});

/**
 * Set or clear the connection point on a community person.
 */
export const setConnectionPoint = mutation({
  args: {
    token: v.string(),
    communityPeopleId: v.id("communityPeople"),
    connectionPoint: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const cpRecord = await ctx.db.get(args.communityPeopleId);
    if (!cpRecord) {
      throw new ConvexError("Community person record not found");
    }

    await requireCommunityLeader(ctx, cpRecord.communityId, userId);

    const patchFields = {
      connectionPoint:
        args.connectionPoint === null ? undefined : args.connectionPoint,
    };
    await ctx.db.patch(args.communityPeopleId, {
      ...patchFields,
      updatedAt: Date.now(),
    });

    // Sync to sibling records in the same community
    await syncToSiblingRecords(ctx, cpRecord, patchFields);

    return { success: true };
  },
});

/**
 * Snooze a community person for a specified duration.
 * Creates a snooze followup entry in the announcement group membership.
 */
export const snooze = mutation({
  args: {
    token: v.string(),
    communityPeopleId: v.id("communityPeople"),
    duration: v.union(
      v.literal("1_week"),
      v.literal("2_weeks"),
      v.literal("1_month"),
      v.literal("3_months"),
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const timestamp = Date.now();

    const cpRecord = await ctx.db.get(args.communityPeopleId);
    if (!cpRecord) {
      throw new ConvexError("Community person record not found");
    }

    await requireCommunityLeader(ctx, cpRecord.communityId, userId);

    // Calculate snooze end date
    const DAY_MS = 24 * 60 * 60 * 1000;
    const durationMap: Record<string, number> = {
      "1_week": 7 * DAY_MS,
      "2_weeks": 14 * DAY_MS,
      "1_month": 30 * DAY_MS,
      "3_months": 90 * DAY_MS,
    };
    const snoozeUntil = timestamp + (durationMap[args.duration] ?? 7 * DAY_MS);

    const durationLabels: Record<string, string> = {
      "1_week": "1 week",
      "2_weeks": "2 weeks",
      "1_month": "1 month",
      "3_months": "3 months",
    };
    const content = args.note
      ? `Snoozed for ${durationLabels[args.duration]}: ${args.note}`
      : `Snoozed for ${durationLabels[args.duration]}`;

    // Update communityPeople snooze state
    await ctx.db.patch(args.communityPeopleId, {
      isSnoozed: true,
      snoozedUntil: snoozeUntil,
      updatedAt: timestamp,
    });

    // Sync to sibling records in the same community
    await syncToSiblingRecords(ctx, cpRecord, {
      isSnoozed: true,
      snoozedUntil: snoozeUntil,
    });

    // Find announcement group membership to store the followup entry
    const announcementGroup = await ctx.db
      .query("groups")
      .withIndex("by_community", (q: any) =>
        q.eq("communityId", cpRecord.communityId),
      )
      .filter((q: any) => q.eq(q.field("isAnnouncementGroup"), true))
      .first();

    let followupId = null;
    if (announcementGroup) {
      const groupMember = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q: any) =>
          q.eq("groupId", announcementGroup._id).eq("userId", cpRecord.userId),
        )
        .first();

      if (groupMember && groupMember.leftAt === undefined) {
        followupId = await ctx.db.insert("memberFollowups", {
          groupMemberId: groupMember._id,
          createdById: userId,
          type: "snooze",
          content,
          snoozeUntil,
          createdAt: timestamp,
        });
      }
    }

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
 * Add a followup entry (note, call, text, followed_up) for a community person.
 * Stores in the announcement group membership.
 */
export const addFollowup = mutation({
  args: {
    token: v.string(),
    communityPeopleId: v.id("communityPeople"),
    type: v.union(
      v.literal("note"),
      v.literal("call"),
      v.literal("text"),
      v.literal("followed_up"),
    ),
    content: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const timestamp = Date.now();

    const cpRecord = await ctx.db.get(args.communityPeopleId);
    if (!cpRecord) {
      throw new ConvexError("Community person record not found");
    }

    await requireCommunityLeader(ctx, cpRecord.communityId, userId);

    // Update lastFollowupAt and latestNote on communityPeople when adding a note
    const patchFields: Record<string, any> = {
      lastFollowupAt: timestamp,
      updatedAt: timestamp,
    };
    if (args.type === "note" && args.content) {
      patchFields.latestNote =
        args.content.length > 200 ? args.content.slice(0, 200) : args.content;
      patchFields.latestNoteAt = timestamp;
    }
    await ctx.db.patch(args.communityPeopleId, patchFields);

    // Sync to sibling records in the same community
    await syncToSiblingRecords(ctx, cpRecord, patchFields);

    // Find announcement group membership
    const announcementGroup = await ctx.db
      .query("groups")
      .withIndex("by_community", (q: any) =>
        q.eq("communityId", cpRecord.communityId),
      )
      .filter((q: any) => q.eq(q.field("isAnnouncementGroup"), true))
      .first();

    let followupId = null;
    if (announcementGroup) {
      const groupMember = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q: any) =>
          q.eq("groupId", announcementGroup._id).eq("userId", cpRecord.userId),
        )
        .first();

      if (groupMember && groupMember.leftAt === undefined) {
        followupId = await ctx.db.insert("memberFollowups", {
          groupMemberId: groupMember._id,
          createdById: userId,
          type: args.type,
          content: args.content,
          createdAt: timestamp,
        });
      }
    }

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

// ============================================================================
// Internal Mutations
// ============================================================================

/**
 * Upsert communityPeople records from a user's announcement group data.
 *
 * Reads the announcement group's memberFollowupScores as canonical source,
 * then creates/updates a communityPeople record for each group the user
 * is actually a member of. New landing-page users only exist in the
 * announcement group, so they get one record. Existing multi-group users
 * get all their groups updated.
 */
export const upsertFromSubmission = internalMutation({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const nowTs = Date.now();

    // 1. Find announcement group
    const announcementGroup = await ctx.db
      .query("groups")
      .withIndex("by_community", (q: any) =>
        q.eq("communityId", args.communityId),
      )
      .filter((q: any) => q.eq(q.field("isAnnouncementGroup"), true))
      .first();

    if (!announcementGroup) return;

    // 2. Find announcement group membership
    const groupMember = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q: any) =>
        q.eq("groupId", announcementGroup._id).eq("userId", args.userId),
      )
      .first();

    if (!groupMember || groupMember.leftAt !== undefined) return;

    // 3. Get canonical memberFollowupScores from announcement group
    const scoreDoc = await ctx.db
      .query("memberFollowupScores")
      .withIndex("by_groupMember", (q: any) =>
        q.eq("groupMemberId", groupMember._id),
      )
      .first();

    if (!scoreDoc) return;

    // 4. Get user for denormalized fields
    const user = await ctx.db.get(args.userId);

    // 5. Build canonical fields from scoreDoc + user
    const firstName = user?.firstName || (scoreDoc as any).firstName || "";
    const lastName = user?.lastName || (scoreDoc as any).lastName || "";
    const email = user?.email || (scoreDoc as any).email;
    const phone = user?.phone || (scoreDoc as any).phone;
    const zipCode = user?.zipCode || (scoreDoc as any).zipCode;
    const searchText = [firstName, lastName, email, phone]
      .filter(Boolean)
      .join(" ");

    // Normalize assigneeIds
    let assigneeIds: Id<"users">[] | undefined;
    if ((scoreDoc as any).assigneeIds?.length > 0) {
      assigneeIds = (scoreDoc as any).assigneeIds;
    } else if ((scoreDoc as any).assigneeId) {
      assigneeIds = [(scoreDoc as any).assigneeId];
    }
    const assigneeSortKey = await buildAssigneeSortKey(ctx, assigneeIds as string[] | undefined);
    const assigneeId = assigneeIds?.[0];

    const canonicalFields = {
      communityId: args.communityId,
      userId: args.userId,
      firstName,
      lastName,
      avatarUrl: getMediaUrl(user?.profilePhoto) || (scoreDoc as any).avatarUrl,
      email,
      phone,
      zipCode,
      searchText,
      score1: (scoreDoc as any).score1,
      score2: (scoreDoc as any).score2,
      score3: (scoreDoc as any).score3,
      status: (scoreDoc as any).status,
      assigneeIds,
      assigneeId,
      assigneeSortKey,
      connectionPoint: (scoreDoc as any).connectionPoint,
      lastFollowupAt: (scoreDoc as any).lastFollowupAt,
      lastActiveAt: (scoreDoc as any).lastActiveAt,
      lastAttendedAt: (scoreDoc as any).lastAttendedAt,
      addedAt: (scoreDoc as any).addedAt ?? groupMember.joinedAt,
      latestNote: (scoreDoc as any).latestNote,
      latestNoteAt: (scoreDoc as any).latestNoteAt,
      alerts: (scoreDoc as any).alerts ?? [],
      isSnoozed: (scoreDoc as any).isSnoozed ?? false,
      snoozedUntil: (scoreDoc as any).snoozedUntil,
      customText1: (scoreDoc as any).customText1,
      customText2: (scoreDoc as any).customText2,
      customText3: (scoreDoc as any).customText3,
      customText4: (scoreDoc as any).customText4,
      customText5: (scoreDoc as any).customText5,
      customNum1: (scoreDoc as any).customNum1,
      customNum2: (scoreDoc as any).customNum2,
      customNum3: (scoreDoc as any).customNum3,
      customNum4: (scoreDoc as any).customNum4,
      customNum5: (scoreDoc as any).customNum5,
      customBool1: (scoreDoc as any).customBool1,
      customBool2: (scoreDoc as any).customBool2,
      customBool3: (scoreDoc as any).customBool3,
      customBool4: (scoreDoc as any).customBool4,
      customBool5: (scoreDoc as any).customBool5,
      rawValues: (scoreDoc as any).rawValues,
      updatedAt: nowTs,
    };

    // 6. Find all active group memberships for this user in this community
    const allMemberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q: any) => q.eq("userId", args.userId))
      .collect();

    const communityGroupIds: Id<"groups">[] = [];
    for (const membership of allMemberships) {
      if (membership.leftAt !== undefined) continue;
      const group = await ctx.db.get(membership.groupId);
      if (group && group.communityId === args.communityId) {
        communityGroupIds.push(group._id);
      }
    }

    // 7. Upsert communityPeople record for each group
    for (const groupId of communityGroupIds) {
      const existing = await ctx.db
        .query("communityPeople")
        .withIndex("by_group_user", (q: any) =>
          q.eq("groupId", groupId).eq("userId", args.userId),
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, { ...canonicalFields, groupId });
      } else {
        await ctx.db.insert("communityPeople", {
          ...canonicalFields,
          groupId,
          createdAt: nowTs,
        });
      }
    }
  },
});

// ============================================================================
// Community Alert Config
// ============================================================================

/**
 * Get the community's custom alert configuration.
 */
export const getCommunityAlerts = query({
  args: {
    token: v.optional(v.string()),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token ?? "");
    await requireCommunityMember(ctx, args.communityId, userId);
    const community = await ctx.db.get(args.communityId);
    return community?.alertConfig ?? [];
  },
});

/**
 * Update the community's custom alert configuration (admin-only).
 */
export const updateCommunityAlerts = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    alerts: v.array(
      v.object({
        id: v.string(),
        variableId: v.string(),
        operator: v.string(),
        threshold: v.number(),
        label: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const isAdmin = await isCommunityAdmin(ctx, args.communityId, userId);
    if (!isAdmin) {
      throw new ConvexError("Only community admins can manage alerts");
    }

    // Validate alerts against system-level variables only
    for (const alert of args.alerts) {
      if (!SYSTEM_VARIABLE_IDS.has(alert.variableId)) {
        throw new ConvexError(`Unknown variable: ${alert.variableId}`);
      }
      if (alert.operator !== "above" && alert.operator !== "below") {
        throw new ConvexError(`Operator must be "above" or "below"`);
      }
      if (!Number.isFinite(alert.threshold)) {
        throw new ConvexError("Threshold must be a finite number");
      }
    }

    await ctx.db.patch(args.communityId, {
      alertConfig: args.alerts,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// ============================================================================
// Backfill: assigneeSortKey
// ============================================================================

/**
 * Backfill assigneeSortKey and assigneeId for existing communityPeople records
 * that have assigneeIds but are missing these fields. Processes in batches of
 * 100 and auto-schedules continuation until all records are processed. Run via:
 *   npx convex run functions/communityPeople:backfillAssigneeSortKey
 */
export const backfillAssigneeSortKey = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 100;
    const results = await ctx.db
      .query("communityPeople")
      .paginate({ numItems: batchSize, cursor: args.cursor ?? null });

    let updated = 0;
    for (const row of results.page) {
      const hasAssignees = row.assigneeIds && row.assigneeIds.length > 0;
      const needsSortKey = hasAssignees && !row.assigneeSortKey;
      const needsAssigneeId = hasAssignees && !row.assigneeId;
      if (needsSortKey || needsAssigneeId) {
        const patch: Record<string, any> = { updatedAt: Date.now() };
        if (needsSortKey) {
          const sortKey = await buildAssigneeSortKey(ctx, row.assigneeIds as string[]);
          if (sortKey) patch.assigneeSortKey = sortKey;
        }
        if (needsAssigneeId) patch.assigneeId = row.assigneeIds![0];
        await ctx.db.patch(row._id, patch);
        updated++;
      }
    }

    // Auto-continue with next batch if there are more records
    if (!results.isDone) {
      await ctx.scheduler.runAfter(0, internal.functions.communityPeople.backfillAssigneeSortKey, {
        cursor: results.continueCursor,
        batchSize,
      });
    }

    return {
      updated,
      isDone: results.isDone,
      continueCursor: results.isDone ? null : results.continueCursor,
    };
  },
});
