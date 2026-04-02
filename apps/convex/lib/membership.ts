/**
 * Centralized membership status helpers for group membership logic
 *
 * The groupMembers table uses a soft-delete pattern with these key fields:
 * - leftAt: Timestamp when user left (undefined = still active)
 * - requestStatus: "pending" | "accepted" | "declined" | undefined
 *
 * Membership states:
 * - Active member (public group): leftAt=undefined, requestStatus=undefined
 * - Active member (private group): leftAt=undefined, requestStatus="accepted"
 * - Pending request: leftAt=timestamp (set by design), requestStatus="pending"
 * - Declined request: leftAt=undefined, requestStatus="declined"
 * - Left group: leftAt=timestamp, requestStatus=undefined or "accepted"
 */

import type { Doc } from "../_generated/dataModel";

type GroupMember = Doc<"groupMembers">;

/**
 * Check if a membership record represents an active member
 *
 * Active member criteria:
 * - Has NOT left (leftAt is undefined)
 * - Either no request status (public group) OR request was accepted (private group)
 */
export function isActiveMember(
  membership: GroupMember | null | undefined
): boolean {
  if (!membership) return false;
  if (membership.leftAt !== undefined) return false;
  if (
    membership.requestStatus &&
    membership.requestStatus !== "accepted"
  ) {
    return false;
  }
  return true;
}

/**
 * Check if a membership record represents a pending join request
 */
export function isPendingRequest(
  membership: GroupMember | null | undefined
): boolean {
  if (!membership) return false;
  return membership.requestStatus === "pending";
}

/**
 * Check if a membership record represents a declined request
 */
export function isDeclinedRequest(
  membership: GroupMember | null | undefined
): boolean {
  if (!membership) return false;
  return membership.requestStatus === "declined";
}

/**
 * Check if a user has left the group (was previously a member)
 * Note: This excludes pending requests which also have leftAt set
 */
export function hasLeftGroup(
  membership: GroupMember | null | undefined
): boolean {
  if (!membership) return false;
  // User has left if leftAt is set AND they're not in pending state
  return membership.leftAt !== undefined && membership.requestStatus !== "pending";
}

/**
 * Get the membership status for UI display
 * Returns the status that should be shown to the user
 */
export function getMembershipStatus(
  membership: GroupMember | null | undefined
): "active" | "pending" | "declined" | "left" | "none" {
  if (!membership) return "none";

  if (isPendingRequest(membership)) return "pending";
  if (isActiveMember(membership)) return "active";
  if (isDeclinedRequest(membership)) return "declined";
  if (hasLeftGroup(membership)) return "left";

  return "none";
}

/**
 * Check if user is an active member with leader role
 */
export function isGroupLeader(
  membership: GroupMember | null | undefined
): boolean {
  if (!isActiveMember(membership)) return false;
  return membership!.role === "leader";
}
