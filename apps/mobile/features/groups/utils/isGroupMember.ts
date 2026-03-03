import { Group, GroupMember } from "../types";

/**
 * Check if a user is a member of a group
 *
 * This utility checks multiple sources to determine membership:
 * 1. user_request_status === 'accepted' (most reliable, from API)
 * 2. user_role is set (indicates active membership - 'member', 'leader', or 'admin')
 * 3. User is in the members array (fallback for legacy data)
 *
 * @param group - The group to check membership for
 * @param userId - The user ID to check (Convex ID string or legacy numeric ID)
 * @returns true if the user is a member of the group, false otherwise
 */
export function isGroupMember(
  group: Group | null | undefined,
  userId: string | number | null | undefined
): boolean {
  if (!group || !userId) {
    return false;
  }

  // Check user_request_status (most reliable)
  if (group.user_request_status === 'accepted') {
    return true;
  }

  // Check user_role (indicates membership - includes leaders and admins)
  if (group.user_role && group.user_role !== null) {
    return true;
  }

  // Fallback: check members array
  const members = group.members || [];
  return members.some((member: GroupMember) => member.id === userId);
}

