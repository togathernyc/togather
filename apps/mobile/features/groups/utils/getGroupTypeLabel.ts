/**
 * Gets the group type label based on type name or number.
 *
 * IMPORTANT: Prefer using groupTypeName when available (from API response)
 * rather than relying on ID mappings, since group type IDs are dynamic per community.
 *
 * @param typeOrName - Either the group_type_name string from API, or type ID (legacy)
 * @param userData - User data with community settings (optional, for legacy ID lookups)
 */
export function getGroupTypeLabel(
  typeOrName: number | string | null | undefined,
  userData?: any
): string {
  // If we got a string name directly from the API, use it
  if (typeof typeOrName === 'string' && typeOrName) {
    return typeOrName;
  }

  // Legacy fallback: map numeric IDs to names
  // Note: These mappings may not match the actual database IDs
  const type = typeof typeOrName === 'number' ? typeOrName : 1;

  // Try to get from community memberships
  const community = userData?.community_memberships?.[0]?.community;
  const typeNames = community?.group_type_verbose_names;

  if (!typeNames) {
    switch (type) {
      case 1:
        return "Dinner Party";
      case 2:
        return "Team";
      case 3:
        return "Public Group";
      case 4:
        return "Table";
      default:
        return "";
    }
  }

  switch (type) {
    case 1:
      return typeNames.dinner_party_verbose_name || "Dinner Party";
    case 2:
      return typeNames.team_verbose_name || "Team";
    case 3:
      return "Public Group";
    case 4:
      return typeNames.table_verbose_name || "Table";
    default:
      return "";
  }
}

