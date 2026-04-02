/**
 * Permission constants and helpers for role-based access control
 *
 * Centralizes permission-related logic that was duplicated across multiple files:
 * - admin/auth.ts
 * - communities.ts
 * - groupMembers.ts
 * - groups/queries.ts
 * - groups/mutations.ts
 * - groups/members.ts
 * - meetings/communityEvents.ts
 * - communityWideEvents.ts
 */

import type { Id } from "../_generated/dataModel";

// ============================================================================
// Community Role Constants
// ============================================================================

/**
 * Community role levels (stored in userCommunities.roles as number)
 */
export const COMMUNITY_ROLES = {
  MEMBER: 1,
  MODERATOR: 2, // Reserved, not currently used
  ADMIN: 3,
  PRIMARY_ADMIN: 4,
} as const;

/**
 * Minimum role level required for community admin privileges.
 * Admin (3) and Primary Admin (4) both qualify as community admins.
 */
export const COMMUNITY_ADMIN_THRESHOLD = COMMUNITY_ROLES.ADMIN;

/**
 * Primary Admin role level - highest privilege level.
 * Only one user per community can have this role.
 */
export const PRIMARY_ADMIN_ROLE = COMMUNITY_ROLES.PRIMARY_ADMIN;

/**
 * Alias for COMMUNITY_ADMIN_THRESHOLD for backwards compatibility.
 * @deprecated Use COMMUNITY_ADMIN_THRESHOLD instead
 */
export const ADMIN_ROLE_THRESHOLD = COMMUNITY_ADMIN_THRESHOLD;

// ============================================================================
// Group Role Constants
// ============================================================================

/**
 * Roles that have leadership privileges in a group.
 * Used for permission checks in group-level operations.
 */
export const LEADER_ROLES = ["leader"] as const;

// ============================================================================
// Permission Check Helpers
// ============================================================================

/**
 * Check if user is a community admin (Admin or Primary Admin).
 * Returns boolean, doesn't throw.
 *
 * @param ctx - Convex query/mutation context with db access
 * @param communityId - The community to check admin status for
 * @param userId - The user to check
 * @returns true if user is an active admin (roles >= 3)
 */
export async function isCommunityAdmin(
  ctx: { db: any },
  communityId: Id<"communities">,
  userId: Id<"users">
): Promise<boolean> {
  const membership = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q: any) =>
      q.eq("userId", userId).eq("communityId", communityId)
    )
    .first();

  return !!(
    membership &&
    (membership.roles ?? 0) >= COMMUNITY_ADMIN_THRESHOLD &&
    membership.status === 1
  );
}

/**
 * Check if user is the Primary Admin of a community.
 * Returns boolean, doesn't throw.
 *
 * @param ctx - Convex query/mutation context with db access
 * @param communityId - The community to check
 * @param userId - The user to check
 * @returns true if user is the Primary Admin (roles === 4)
 */
export async function isPrimaryAdmin(
  ctx: { db: any },
  communityId: Id<"communities">,
  userId: Id<"users">
): Promise<boolean> {
  const membership = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q: any) =>
      q.eq("userId", userId).eq("communityId", communityId)
    )
    .first();

  return !!(membership && membership.roles === PRIMARY_ADMIN_ROLE && membership.status === 1);
}

/**
 * Require community admin role. Throws if user is not an admin.
 *
 * @param ctx - Convex query/mutation context with db access
 * @param communityId - The community to check admin status for
 * @param userId - The user to check
 * @throws Error if user is not a community admin
 */
export async function requireCommunityAdmin(
  ctx: { db: any },
  communityId: Id<"communities">,
  userId: Id<"users">
): Promise<void> {
  const isAdmin = await isCommunityAdmin(ctx, communityId, userId);
  if (!isAdmin) {
    throw new Error("Community admin role required");
  }
}

/**
 * Require Primary Admin role. Throws if user is not the primary admin.
 *
 * @param ctx - Convex query/mutation context with db access
 * @param communityId - The community to check
 * @param userId - The user to check
 * @throws Error if user is not the Primary Admin
 */
export async function requirePrimaryAdmin(
  ctx: { db: any },
  communityId: Id<"communities">,
  userId: Id<"users">
): Promise<void> {
  const membership = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q: any) =>
      q.eq("userId", userId).eq("communityId", communityId)
    )
    .first();

  if (!membership || membership.roles !== PRIMARY_ADMIN_ROLE || membership.status !== 1) {
    throw new Error("Primary Admin role required");
  }
}

/**
 * Check if a group membership has a leader role.
 *
 * @param role - The role string from groupMembers record
 * @returns true if role is "leader"
 */
export function isLeaderRole(role: string | undefined): boolean {
  if (!role) return false;
  return LEADER_ROLES.includes(role as typeof LEADER_ROLES[number]);
}
