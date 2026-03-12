/**
 * Shared member search functionality
 *
 * This module provides the core search logic used by both admin and non-admin
 * member search endpoints. It handles:
 * - Comma-separated search terms: "john, jane, 555-1234"
 * - Phone number normalization: "(555) 123-4567" matches "5551234567"
 * - Matching against name, email, and phone
 * - Group count calculation
 * - Pagination support
 */

import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getMediaUrl, normalizePhone } from "./utils";
import { COMMUNITY_ADMIN_THRESHOLD, PRIMARY_ADMIN_ROLE } from "./permissions";

/**
 * Base member result returned by search
 */
export interface MemberSearchResult {
  id: Id<"users">;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  profilePhoto: string | null;
  isAdmin: boolean;
}

/**
 * Extended member result with admin-only fields
 */
export interface AdminMemberSearchResult extends MemberSearchResult {
  isPrimaryAdmin: boolean;
  role: number;
  lastLogin: number | null;
  groupsCount: number;
}

/**
 * Options for member search
 */
export interface MemberSearchOptions {
  communityId: Id<"communities">;
  search?: string;
  excludeUserIds?: Id<"users">[];
  groupId?: Id<"groups">;
  /** Include users who are active members of ANY of these groups */
  groupIds?: Id<"groups">[];
  /** Exclude users who are already active members of this group */
  excludeGroupId?: Id<"groups">;
  limit?: number;
  /** Include admin-only fields (isPrimaryAdmin, role, lastLogin) */
  includeAdminFields?: boolean;
}

/**
 * Paginated search options
 */
export interface PaginatedMemberSearchOptions extends MemberSearchOptions {
  page?: number;
  pageSize?: number;
}

/**
 * Paginated search result
 */
export interface PaginatedMemberSearchResult<T> {
  members: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMoreData: boolean;
}

/**
 * Parse search query into individual terms
 * Splits by whitespace and commas, filters empty terms
 */
export function parseSearchTerms(search: string): string[] {
  if (!search?.trim()) return [];
  return search.toLowerCase().split(/[\s,]+/).filter(Boolean);
}

/**
 * Check if a user matches the search terms
 * Matches against full name, email, and phone (with normalization)
 */
export function matchesSearchTerms(
  user: { firstName?: string; lastName?: string; email?: string; phone?: string },
  searchTerms: string[]
): boolean {
  if (searchTerms.length === 0) return true;

  const fullName = `${user.firstName || ""} ${user.lastName || ""}`.toLowerCase();
  const normalizedUserPhone = user.phone ? normalizePhone(user.phone).replace(/\D/g, "") : "";

  return searchTerms.some((term) => {
    // Match against name
    if (fullName.includes(term)) return true;
    // Match against email
    if (user.email?.toLowerCase().includes(term)) return true;
    // Match against phone (normalized) - require at least 3 digits to match
    const normalizedSearchTerm = normalizePhone(term).replace(/\D/g, "");
    if (normalizedSearchTerm.length >= 3 && normalizedUserPhone.includes(normalizedSearchTerm)) {
      return true;
    }
    return false;
  });
}

/**
 * Fetch group counts for users in a community
 * Returns a map of userId -> number of active groups
 */
export async function fetchUserGroupCounts(
  ctx: QueryCtx,
  communityId: Id<"communities">
): Promise<Map<Id<"users">, number>> {
  // Fetch all active groups in the community
  const groups = await ctx.db
    .query("groups")
    .withIndex("by_community", (q) => q.eq("communityId", communityId))
    .filter((q) => q.eq(q.field("isArchived"), false))
    .collect();

  // Fetch all active group memberships
  const groupMembershipPromises = groups.map((g) =>
    ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", g._id))
      .filter((q) =>
        q.and(
          q.eq(q.field("leftAt"), undefined),
          q.or(
            q.eq(q.field("requestStatus"), undefined),
            q.eq(q.field("requestStatus"), null),
            q.eq(q.field("requestStatus"), "accepted")
          )
        )
      )
      .collect()
  );
  const allGroupMembershipsArrays = await Promise.all(groupMembershipPromises);
  const allGroupMemberships = allGroupMembershipsArrays.flat();

  // Build count map
  const userGroupCounts = new Map<Id<"users">, number>();
  for (const gm of allGroupMemberships) {
    userGroupCounts.set(gm.userId, (userGroupCounts.get(gm.userId) ?? 0) + 1);
  }

  return userGroupCounts;
}

/**
 * Search community members with support for:
 * - Full-text search using the search_users index
 * - Comma-separated search terms (each term searched separately)
 * - Phone number normalization
 * - Group filtering
 * - Exclusion list
 *
 * This is the core search function used by both admin and non-admin endpoints.
 */
export async function searchCommunityMembersInternal(
  ctx: QueryCtx,
  options: MemberSearchOptions
): Promise<MemberSearchResult[]> {
  const {
    communityId,
    search,
    excludeUserIds = [],
    groupId,
    groupIds,
    excludeGroupId,
    limit = 50,
    includeAdminFields = false,
  } = options;

  const excludeIds = new Set(excludeUserIds);
  const searchQuery = search?.trim() || "";

  if (!searchQuery) {
    return [];
  }

  // Parse comma-separated search terms for multiple searches
  const searchTerms = searchQuery.split(",").map((t) => t.trim()).filter(Boolean);

  // Use full-text search index to find matching users
  // For comma-separated terms, search for each term and merge results
  const allMatchingUsers: Map<Id<"users">, Doc<"users">> = new Map();

  for (const term of searchTerms) {
    if (!term) continue;

    // Full-text search on searchText field
    const matchingUsers = await ctx.db
      .query("users")
      .withSearchIndex("search_users", (q) => q.search("searchText", term))
      .take(limit * 3); // Fetch extra to account for filtering

    for (const user of matchingUsers) {
      if (!allMatchingUsers.has(user._id)) {
        allMatchingUsers.set(user._id, user);
      }
    }
  }

  // Also handle phone number search with normalization
  // Full-text search doesn't handle formatted phone numbers well
  const normalizedPhone = normalizePhone(searchQuery).replace(/\D/g, "");
  if (normalizedPhone.length >= 4) {
    // Get community members and check for phone matches
    const communityMemberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .filter((q) => q.eq(q.field("status"), 1)) // Active only
      .take(2000);

    const phoneMatchPromises = communityMemberships.map(async (m) => {
      const user = await ctx.db.get(m.userId);
      if (user?.phone?.includes(normalizedPhone)) {
        return user;
      }
      return null;
    });
    const phoneMatches = await Promise.all(phoneMatchPromises);
    for (const user of phoneMatches) {
      if (user && !allMatchingUsers.has(user._id)) {
        allMatchingUsers.set(user._id, user);
      }
    }
  }

  if (allMatchingUsers.size === 0) {
    return [];
  }

  // If filtering by groups, get member user IDs from the allowed groups.
  let targetUserIds: Set<Id<"users">> | null = null;
  if (groupIds && groupIds.length > 0) {
    const uniqueGroupIds = [...new Set(groupIds)];
    const membershipSets = await Promise.all(
      uniqueGroupIds.map(async (targetGroupId) => {
        const groupMemberships = await ctx.db
          .query("groupMembers")
          .withIndex("by_group", (q) => q.eq("groupId", targetGroupId))
          .filter((q) =>
            q.and(
              q.eq(q.field("leftAt"), undefined),
              q.or(
                q.eq(q.field("requestStatus"), undefined),
                q.eq(q.field("requestStatus"), null),
                q.eq(q.field("requestStatus"), "accepted")
              )
            )
          )
          .collect();
        return groupMemberships.map((gm) => gm.userId);
      })
    );
    targetUserIds = new Set(membershipSets.flat());
  } else if (groupId) {
    const groupMemberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .filter((q) =>
        q.and(
          q.eq(q.field("leftAt"), undefined),
          q.or(
            q.eq(q.field("requestStatus"), undefined),
            q.eq(q.field("requestStatus"), null),
            q.eq(q.field("requestStatus"), "accepted")
          )
        )
      )
      .collect();
    targetUserIds = new Set(groupMemberships.map((gm) => gm.userId));
  }

  // If excluding an entire group's active members, collect those user IDs once.
  let excludedGroupUserIds: Set<Id<"users">> | null = null;
  if (excludeGroupId) {
    const groupMemberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", excludeGroupId))
      .filter((q) =>
        q.and(
          q.eq(q.field("leftAt"), undefined),
          q.or(
            q.eq(q.field("requestStatus"), undefined),
            q.eq(q.field("requestStatus"), null),
            q.eq(q.field("requestStatus"), "accepted")
          )
        )
      )
      .collect();
    excludedGroupUserIds = new Set(groupMemberships.map((gm) => gm.userId));
  }

  // Check which users are active members of this community
  const membershipPromises = Array.from(allMatchingUsers.values()).map((user) =>
    ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", user._id).eq("communityId", communityId)
      )
      .filter((q) => q.eq(q.field("status"), 1)) // Active status
      .first()
  );
  const memberships = await Promise.all(membershipPromises);

  // Build results for users who are community members
  const results: (MemberSearchResult | AdminMemberSearchResult)[] = [];
  const usersArray = Array.from(allMatchingUsers.values());

  for (let i = 0; i < usersArray.length; i++) {
    if (results.length >= limit) break;

    const user = usersArray[i];
    const membership = memberships[i];

    // Skip if not an active community member
    if (!membership) continue;

    // Skip if in exclude list
    if (excludeIds.has(user._id)) continue;

    // Skip if this user is already an active member of the excluded group
    if (excludedGroupUserIds?.has(user._id)) continue;

    // Skip if filtering by group and user is not in that group
    if (targetUserIds && !targetUserIds.has(user._id)) continue;

    const isAdmin = (membership.roles ?? 0) >= COMMUNITY_ADMIN_THRESHOLD;

    const baseResult: MemberSearchResult = {
      id: user._id,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      email: user.email || "",
      phone: user.phone || null,
      profilePhoto: getMediaUrl(user.profilePhoto) ?? null,
      isAdmin,
    };

    if (includeAdminFields) {
      const adminResult: AdminMemberSearchResult = {
        ...baseResult,
        isPrimaryAdmin: membership.roles === PRIMARY_ADMIN_ROLE,
        role: membership.roles ?? 0,
        lastLogin: membership.lastLogin || null,
        groupsCount: 0, // Not computed for search results; shown in member details
      };
      results.push(adminResult);
    } else {
      results.push(baseResult);
    }
  }

  return results;
}

/**
 * Search community members with pagination support
 * Used by admin endpoints that need full pagination
 *
 * OPTIMIZED for speed:
 * - Uses by_community_lastLogin index with .order("desc") for database-level sorting
 * - Uses .take() to only fetch what we need (no .collect() on full table)
 * - Group counts removed from list view (shown in detail view only) - saves 50+ queries
 */
export async function searchCommunityMembersPaginated(
  ctx: QueryCtx,
  options: PaginatedMemberSearchOptions
): Promise<PaginatedMemberSearchResult<AdminMemberSearchResult>> {
  const {
    communityId,
    search,
    excludeUserIds = [],
    groupId,
    page = 1,
    pageSize = 20,
  } = options;

  const excludeIds = new Set(excludeUserIds);
  const searchTerms = parseSearchTerms(search || "");
  const skip = (page - 1) * pageSize;
  const hasFilters = searchTerms.length > 0 || groupId !== undefined;

  // ============================================================================
  // FAST PATH: No search or group filter - use database index directly
  // ============================================================================
  if (!hasFilters) {
    // Use the by_community_lastLogin index with descending order
    // This leverages the database index for sorting - no in-memory sort needed!
    // undefined lastLogin values appear at the end with desc order (which is what we want)
    const memberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_community_lastLogin", (q) => q.eq("communityId", communityId))
      .order("desc")
      .filter((q) => q.neq(q.field("status"), 3))
      .take(skip + pageSize + excludeIds.size + 1); // Fetch one extra to check if there's more data

    // Filter out excluded users and take the page we need
    const filteredMemberships = excludeIds.size > 0
      ? memberships.filter((m) => !excludeIds.has(m.userId))
      : memberships;
    const pageMemberships = filteredMemberships.slice(skip, skip + pageSize);

    // Fetch users for this page only (parallel for speed)
    const pageUserIds = pageMemberships.map((m) => m.userId);
    const users = await Promise.all(pageUserIds.map((id) => ctx.db.get(id)));
    const userMap = new Map(
      users.filter((u): u is NonNullable<typeof u> => u !== null).map((u) => [u._id, u])
    );

    // Build results - NO group counts (shown in detail view only for speed)
    const results: AdminMemberSearchResult[] = [];
    for (const membership of pageMemberships) {
      const user = userMap.get(membership.userId);
      if (!user) continue;

      const isAdmin = (membership.roles ?? 0) >= COMMUNITY_ADMIN_THRESHOLD;
      results.push({
        id: user._id,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
        phone: user.phone || null,
        profilePhoto: getMediaUrl(user.profilePhoto) ?? null,
        isAdmin,
        isPrimaryAdmin: membership.roles === PRIMARY_ADMIN_ROLE,
        role: membership.roles ?? 0,
        lastLogin: membership.lastLogin || null,
        groupsCount: 0, // Not fetched in list view for performance - see detail view
      });
    }

    // For total count, check if we have more data
    // If we got a full page, there's likely more
    const hasMore = filteredMemberships.length > skip + pageSize;

    return {
      members: results,
      total: hasMore ? -1 : filteredMemberships.length, // -1 indicates unknown total
      page,
      pageSize,
      totalPages: hasMore ? -1 : Math.ceil(filteredMemberships.length / pageSize),
      hasMoreData: hasMore,
    };
  }

  // ============================================================================
  // FILTERED PATH: Has search or group filter - need to process more data
  // ============================================================================

  // If filtering by group, get those member user IDs first
  let targetUserIds: Set<Id<"users">> | null = null;
  if (groupId) {
    const groupMemberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .filter((q) =>
        q.and(
          q.eq(q.field("leftAt"), undefined),
          q.or(
            q.eq(q.field("requestStatus"), undefined),
            q.eq(q.field("requestStatus"), "accepted")
          )
        )
      )
      .collect();
    targetUserIds = new Set(groupMemberships.map((gm) => gm.userId));
  }

  // Fetch community memberships (limit for filtered queries)
  const MAX_FILTERED_ITEMS = 500;
  const memberships = await ctx.db
    .query("userCommunities")
    .withIndex("by_community", (q) => q.eq("communityId", communityId))
    .filter((q) => q.neq(q.field("status"), 3))
    .take(MAX_FILTERED_ITEMS);

  const hitMaxItems = memberships.length >= MAX_FILTERED_ITEMS;

  // Filter by group if specified
  const filteredMemberships = targetUserIds
    ? memberships.filter((m) => targetUserIds!.has(m.userId))
    : memberships;

  // Batch fetch users (smaller set due to filters)
  const userIds = filteredMemberships.map((m) => m.userId);
  const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
  const userMap = new Map(
    users.filter((u): u is NonNullable<typeof u> => u !== null).map((u) => [u._id, u])
  );

  // Process matching members
  type MemberWithMembership = { user: Doc<"users">; membership: Doc<"userCommunities"> };
  const matchingMembers: MemberWithMembership[] = [];

  for (const membership of filteredMemberships) {
    if (excludeIds.has(membership.userId)) continue;

    const user = userMap.get(membership.userId);
    if (!user) continue;

    // Apply search filter
    if (searchTerms.length > 0 && !matchesSearchTerms(user, searchTerms)) {
      continue;
    }

    matchingMembers.push({ user, membership });
  }

  // Sort by last login descending, then by name
  matchingMembers.sort((a, b) => {
    const aLogin = a.membership.lastLogin;
    const bLogin = b.membership.lastLogin;
    if (aLogin && bLogin) return bLogin - aLogin;
    if (aLogin) return -1;
    if (bLogin) return 1;
    return `${a.user.lastName} ${a.user.firstName}`.localeCompare(
      `${b.user.lastName} ${b.user.firstName}`
    );
  });

  // Apply pagination
  const paginatedMembers = matchingMembers.slice(skip, skip + pageSize);

  // Build results - NO group counts for performance (shown in detail view)
  const results: AdminMemberSearchResult[] = paginatedMembers.map(({ user, membership }) => {
    const isAdmin = (membership.roles ?? 0) >= COMMUNITY_ADMIN_THRESHOLD;
    return {
      id: user._id,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      email: user.email || "",
      phone: user.phone || null,
      profilePhoto: getMediaUrl(user.profilePhoto) ?? null,
      isAdmin,
      isPrimaryAdmin: membership.roles === PRIMARY_ADMIN_ROLE,
      role: membership.roles ?? 0,
      lastLogin: membership.lastLogin || null,
      groupsCount: 0, // Not fetched in list view for performance - see detail view
    };
  });

  return {
    members: results,
    total: matchingMembers.length,
    page,
    pageSize,
    totalPages: Math.ceil(matchingMembers.length / pageSize),
    hasMoreData: hitMaxItems,
  };
}
