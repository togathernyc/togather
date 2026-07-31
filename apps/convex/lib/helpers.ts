/**
 * Generic helper functions for Convex functions
 *
 * This file contains utility functions that are used across multiple
 * Convex functions for common patterns like soft-delete checking.
 *
 * For group-specific membership logic, see ./membership.ts
 */

import type { Id } from "../_generated/dataModel";
import { isCommunityAdmin } from "./permissions";

// ============================================================================
// Soft Delete Helpers
// ============================================================================

/**
 * Type for records that use the leftAt soft-delete pattern.
 * Used by groupMembers, chatChannelMembers, etc.
 */
export interface SoftDeletableRecord {
  leftAt?: number;
}

/**
 * Check if a record with soft-delete pattern is currently active.
 * Active means the record exists and leftAt is undefined (not set).
 *
 * This is the canonical way to check if a membership record is "not deleted".
 * Use this instead of manually checking `!record.leftAt` or `record.leftAt === undefined`.
 *
 * @example
 * // Instead of:
 * if (membership && !membership.leftAt) { ... }
 *
 * // Use:
 * if (isActiveMembership(membership)) { ... }
 */
export function isActiveMembership<T extends SoftDeletableRecord>(
  record: T | null | undefined
): record is T {
  return record != null && record.leftAt === undefined;
}

/**
 * Check if a record has been soft-deleted (leftAt is set).
 *
 * @example
 * if (hasLeft(membership)) {
 *   // User has left the group/channel
 * }
 */
export function hasLeft(record: SoftDeletableRecord | null | undefined): boolean {
  if (!record) return false;
  return record.leftAt !== undefined;
}

// ============================================================================
// Role Helpers
// ============================================================================

/**
 * Type for records that have a role field.
 */
export interface RoleRecord {
  role: string;
}

/**
 * Roles that grant elevated group permissions.
 */
export const LEADER_ROLES = ["leader"] as const;
export type LeaderRole = (typeof LEADER_ROLES)[number];

/**
 * Check if a role is a leader role.
 *
 * @example
 * if (isLeaderRole(membership.role)) {
 *   // User has leader permissions
 * }
 */
export function isLeaderRole(role: string | undefined | null): role is LeaderRole {
  if (!role) return false;
  return LEADER_ROLES.includes(role as LeaderRole);
}

/**
 * Check if an active membership record has leader role.
 * Combines the soft-delete check with role check.
 *
 * @example
 * // Instead of:
 * if (membership && !membership.leftAt && membership.role === "leader") { ... }
 *
 * // Use:
 * if (isActiveLeader(membership)) { ... }
 */
export function isActiveLeader<T extends SoftDeletableRecord & RoleRecord>(
  record: T | null | undefined
): boolean {
  return isActiveMembership(record) && isLeaderRole(record.role);
}

// ============================================================================
// User Helpers
// ============================================================================

/**
 * Check if a user record has been archived (deactivated).
 *
 * Users are archived by setting `isActive` to `false`; an undefined or `true`
 * value means the user is active. Archived users should be excluded from leader
 * lists, assignee pickers, and other surfaces that suggest people to act on.
 *
 * NOTE: provisional placeholder users (no claimed account) are also created with
 * `isActive: false`, so this also returns `true` for them. That's correct for
 * leader/assignee surfaces (placeholders are never leaders), but be cautious if
 * reusing this on a path that enumerates general members.
 *
 * @example
 * if (isArchivedUser(user)) {
 *   // Skip — this person is no longer active
 * }
 */
export function isArchivedUser(
  user: { isActive?: boolean } | null | undefined
): boolean {
  return user?.isActive === false;
}

// ============================================================================
// Channel Type Helpers
// ============================================================================

/**
 * Auto-managed channel types where membership is automatic.
 * - "main": General channel for all group members
 * - "leaders": Channel for leader/admin role members
 * - "announcements": Leader-broadcast channel for all group members (opt-in per group)
 */
export const AUTO_CHANNEL_TYPES = ["main", "leaders", "announcements"] as const;
export type AutoChannelType = (typeof AUTO_CHANNEL_TYPES)[number];

/**
 * Check if a channel type is an auto-managed channel.
 * Auto channels have automatic membership based on group membership or role.
 * Users cannot directly leave auto channels.
 *
 * @example
 * if (isAutoChannel(channel.channelType)) {
 *   // Membership is managed automatically
 * }
 */
export function isAutoChannel(channelType: string): channelType is AutoChannelType {
  return AUTO_CHANNEL_TYPES.includes(channelType as AutoChannelType);
}

/**
 * Check if a channel type is a custom channel.
 * Custom channels have manual membership management.
 * Users can join and leave custom channels directly.
 *
 * @example
 * if (isCustomChannel(channel.channelType)) {
 *   // User can leave this channel
 * }
 */
export function isCustomChannel(channelType: string): boolean {
  return channelType === "custom";
}

/**
 * Get the display category for a channel type.
 * - "auto": Channels with automatic membership (main, leaders)
 * - "custom": User-created channels with manual membership
 *
 * @example
 * const category = getChannelCategory(channel.channelType);
 * // "auto" for main/leaders, "custom" for custom channels
 */
export function getChannelCategory(channelType: string): "auto" | "custom" {
  return isAutoChannel(channelType) ? "auto" : "custom";
}

/**
 * Whether a channel is leader-visible / member-active (not leader-disabled).
 * `isEnabled: false` hides the channel from members and blocks chat, but keeps memberships.
 */
export function channelIsLeaderEnabled(channel: { isEnabled?: boolean }): boolean {
  return channel.isEnabled !== false;
}

/**
 * Whether a channel is usable / listed for a given group's navigation (tab bar, inbox row).
 * Combines global leader disable (`isEnabled`) with per-linked-group hide for shared channels.
 */
export function channelEffectiveEnabledForGroup(
  channel: {
    groupId?: Id<"groups">;
    isEnabled?: boolean;
    isShared?: boolean;
    sharedGroups?: Array<{
      groupId: Id<"groups">;
      status: string;
      hiddenFromNavigation?: boolean;
    }>;
  },
  forGroupId: Id<"groups">,
): boolean {
  if (!channelIsLeaderEnabled(channel)) {
    return false;
  }
  if (!channel.isShared || !channel.sharedGroups?.length) {
    return true;
  }
  if (channel.groupId === forGroupId) {
    return true;
  }
  const entry = channel.sharedGroups.find(
    (sg) => sg.groupId === forGroupId && sg.status === "accepted",
  );
  if (!entry) {
    return true;
  }
  return entry.hiddenFromNavigation !== true;
}

// ============================================================================
// Fund Role Helpers (ADR-032 group giving)
// ============================================================================

/**
 * Fund permission ranks, lowest to highest. Separate from group roles
 * (ADR-032 §4) — a trusted treasurer doesn't need to be a group leader, and a
 * leader can't automatically move money without a fund role of their own
 * (except via `requireFundRoleOrGroupLeader` below, which the ADR carves out
 * specifically for role assignment).
 */
export const FUND_ROLE_ORDER = ["cardholder", "manager", "finance_admin"] as const;
export type FundRole = (typeof FUND_ROLE_ORDER)[number];

function fundRoleRank(role: FundRole): number {
  return FUND_ROLE_ORDER.indexOf(role);
}

/**
 * Shape of a `fundRoles` row (or a subset of one) needed to check access.
 */
export interface FundRoleRecord {
  role: FundRole;
  revokedAt?: number;
}

/**
 * Check if a (possibly absent/revoked) fund role grants at least `minRole`.
 *
 * @example
 * if (hasFundRole(roleDoc, "manager")) {
 *   // Can approve expenses
 * }
 */
export function hasFundRole(
  roleDoc: FundRoleRecord | null | undefined,
  minRole: FundRole,
): boolean {
  if (!roleDoc) return false;
  if (roleDoc.revokedAt !== undefined) return false;
  return fundRoleRank(roleDoc.role) >= fundRoleRank(minRole);
}

/**
 * Which of ADR-032 §4's three access paths let a caller through a fund gate.
 *
 * Callers need this, not just a boolean: `"group_leader"` is the LEAST
 * trusted of the three — it's the ADR's narrow carve-out that lets a leader
 * bootstrap finance roles on their own group's fund without holding one
 * themselves, and it deliberately ignores `minRole`. A mutation that can
 * escalate privilege (grantFundRole) must be able to tell that path apart
 * and apply extra rules to it; a plain read doesn't care.
 */
export type FundAccessVia = "community_admin" | "fund_role" | "group_leader";

/** The caller's currently-active (non-revoked) fundRoles row on a fund, if any. */
async function getActiveFundRoleRow(
  ctx: { db: any },
  fundId: Id<"funds">,
  userId: Id<"users">,
): Promise<FundRoleRecord | null> {
  // Collect + filter rather than .first(): grantFundRole's upsert keeps the
  // old row (with revokedAt set) and inserts a new active one, so .first()
  // could return the revoked grant and wrongly deny a re-granted user.
  const roleRows = await ctx.db
    .query("fundRoles")
    .withIndex("by_user_fund", (q: any) =>
      q.eq("userId", userId).eq("fundId", fundId),
    )
    .collect();
  return (
    roleRows.find((r: { revokedAt?: number }) => r.revokedAt === undefined) ??
    null
  );
}

/**
 * Non-throwing core of `requireFundRole`: community-admin override first,
 * then an explicit fund-role grant. Returns `null` when neither applies.
 *
 * Admin is checked FIRST so a community admin who also happens to lead the
 * fund's group resolves to `"community_admin"`, not to the weaker
 * `"group_leader"` carve-out — otherwise the self-grant guard in
 * `grantFundRole` would wrongly fire on a legitimate admin.
 */
async function resolveFundAccess(
  ctx: { db: any },
  fund: { _id: Id<"funds">; communityId: Id<"communities"> },
  userId: Id<"users">,
  minRole: FundRole,
): Promise<FundAccessVia | null> {
  if (await isCommunityAdmin(ctx, fund.communityId, userId)) {
    return "community_admin";
  }
  const roleDoc = await getActiveFundRoleRow(ctx, fund._id, userId);
  return hasFundRole(roleDoc, minRole) ? "fund_role" : null;
}

/**
 * Require that a user holds at least `minRole` on a fund, or throw.
 * Community admins always pass (ADR-032 §4 override), mirroring
 * `requireCommunityAdmin` / `requireGroupLeaderOrCommunityAdmin`.
 *
 * @returns which access path allowed the call (see `FundAccessVia`).
 * @throws Error if the fund doesn't exist or the user's fund role (if any)
 * doesn't meet `minRole`.
 */
export async function requireFundRole(
  ctx: { db: any },
  fundId: Id<"funds">,
  userId: Id<"users">,
  minRole: FundRole,
): Promise<FundAccessVia> {
  const fund = await ctx.db.get(fundId);
  if (!fund) {
    throw new Error("Fund not found");
  }

  const via = await resolveFundAccess(ctx, fund, userId, minRole);
  if (!via) {
    throw new Error(
      `You need at least "${minRole}" access on this fund to do that`,
    );
  }
  return via;
}

/**
 * Same as `requireFundRole`, but also passes for an active leader of the
 * fund's group. Per ADR-032 §4, group leaders can always manage fund roles
 * on their own group's fund (they're who grants the initial finance_admin
 * on giving-enablement) even before they hold a fund role themselves.
 *
 * The carve-out ignores `minRole` by design — a leader with no fund role at
 * all passes a `"finance_admin"` gate. That is exactly why this returns
 * `"group_leader"` instead of just resolving: a caller that lets the carve-
 * out through a privilege-granting mutation MUST bound what the leader can
 * do with it (see `grantFundRole`'s self-grant guard in
 * functions/finance/roles.ts). Reads can ignore the return value.
 *
 * @returns which access path allowed the call (see `FundAccessVia`).
 * @throws Error if the fund doesn't exist, the caller isn't an active leader
 * of the fund's group, and `requireFundRole` also rejects them.
 */
export async function requireFundRoleOrGroupLeader(
  ctx: { db: any },
  fundId: Id<"funds">,
  userId: Id<"users">,
  minRole: FundRole,
): Promise<FundAccessVia> {
  const fund = await ctx.db.get(fundId);
  if (!fund) {
    throw new Error("Fund not found");
  }

  // Try the strong paths first so their (higher-trust) label wins when a
  // caller qualifies more than one way.
  const via = await resolveFundAccess(ctx, fund, userId, minRole);
  if (via) {
    return via;
  }

  if (fund.groupId) {
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q: any) =>
        q.eq("groupId", fund.groupId).eq("userId", userId),
      )
      .first();
    if (isActiveLeader(membership)) {
      return "group_leader";
    }
  }

  throw new Error(
    `You need at least "${minRole}" access on this fund to do that`,
  );
}

// ============================================================================
// Re-exports from membership.ts for convenience
// ============================================================================

// Re-export the more specific group membership helpers
// These handle additional requestStatus logic specific to group members
export {
  isActiveMember,
  isPendingRequest,
  isDeclinedRequest,
  hasLeftGroup,
  getMembershipStatus,
  isGroupLeader,
} from "./membership";
