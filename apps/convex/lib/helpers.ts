/**
 * Generic helper functions for Convex functions
 *
 * This file contains utility functions that are used across multiple
 * Convex functions for common patterns like soft-delete checking.
 *
 * For group-specific membership logic, see ./membership.ts
 */

import type { Id } from "../_generated/dataModel";

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
// Channel Type Helpers
// ============================================================================

/**
 * Auto-managed channel types where membership is automatic.
 * - "main": General channel for all group members
 * - "leaders": Channel for leader/admin role members
 */
export const AUTO_CHANNEL_TYPES = ["main", "leaders"] as const;
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
 * `enabled: false` hides the channel from members and blocks chat, but keeps memberships.
 *
 * Reads the new unified `enabled` field, falling back to the legacy `isEnabled` for any
 * docs that haven't yet been touched by the cleanup migration (`_migrations/cleanupChannelEnabled`).
 */
export function channelIsLeaderEnabled(channel: { enabled?: boolean; isEnabled?: boolean }): boolean {
  if (channel.enabled !== undefined) return channel.enabled !== false;
  return channel.isEnabled !== false;
}

/**
 * Whether a channel is usable / listed for a given group's navigation (tab bar, inbox row).
 * Combines global leader disable (`enabled`) with per-linked-group hide for shared channels.
 */
export function channelEffectiveEnabledForGroup(
  channel: {
    groupId?: Id<"groups">;
    enabled?: boolean;
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
