/**
 * Extracts groups from memberships array
 * Filters out null/undefined groups
 */
export function extractGroupsFromMemberships(
  memberships: any[] | null | undefined
): any[] {
  if (!memberships) return [];
  return memberships
    .map((membership: any) => membership.group)
    .filter(Boolean);
}

