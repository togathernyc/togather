/**
 * PCO Services Filter Helpers
 *
 * Helper functions for the filter-based auto channels feature.
 * Handles position matching (fuzzy) and deduplication of members across services.
 */

/**
 * Member data structure for filtering and deduplication.
 * Represents a team member from PCO with all relevant sync info.
 */
export interface FilterableMember {
  pcoPersonId: string | null;
  name: string;
  position: string | null;
  teamId: string | null;
  teamName: string | null;
  status: string;
  scheduledRemovalAt: number;
  // Optional fields for multi-service sync
  serviceTypeId?: string;
  serviceTypeName?: string;
  planId?: string;
  planDate?: number;
}

/**
 * Position filter with optional context for disambiguation.
 * When teamId or serviceTypeId is provided, the position will only match
 * members from that specific team/service.
 */
export interface PositionFilter {
  name: string;
  teamId?: string;
  teamName?: string;
  serviceTypeId?: string;
  serviceTypeName?: string;
}

/**
 * Position filter can be either a simple string or an object with context.
 */
export type PositionFilterInput = string | PositionFilter;

/**
 * Context for matching positions against a member.
 */
export interface MemberContext {
  teamId?: string | null;
  serviceTypeId?: string | null;
}

/**
 * Check if a position matches any of the filter positions.
 * Uses fuzzy matching - a filter term matches if it appears anywhere in the position.
 *
 * Supports both simple string filters and position objects with context:
 * - String: fuzzy match on position name (backward compatible)
 * - Object: fuzzy match on name + optional teamId/serviceTypeId context matching
 *
 * When a filter object has teamId, the member's teamId must match.
 * When a filter object has serviceTypeId, the member's serviceTypeId must match.
 *
 * Examples:
 *   matchPosition("Music Director", ["Director"]) => true
 *   matchPosition("Drums", ["Director"]) => false
 *   matchPosition("Worship Leader", [{ name: "Worship Leader", teamId: "manhattan" }], { teamId: "manhattan" }) => true
 *   matchPosition("Worship Leader", [{ name: "Worship Leader", teamId: "manhattan" }], { teamId: "brooklyn" }) => false
 *
 * @param memberPosition - The position from the team member (may be null)
 * @param filterPositions - Array of position filters (strings or objects) to match against
 * @param memberContext - Optional context containing the member's teamId/serviceTypeId
 * @returns true if the position matches any filter
 */
export function matchPosition(
  memberPosition: string | null,
  filterPositions: PositionFilterInput[],
  memberContext?: MemberContext
): boolean {
  // No match if position is null/undefined or filters are empty
  if (!memberPosition || filterPositions.length === 0) {
    return false;
  }

  const normalizedPosition = memberPosition.trim().toLowerCase();

  // Check if any filter term appears in the position (fuzzy match)
  return filterPositions.some((filter) => {
    // Handle string filter (backward compatible)
    if (typeof filter === "string") {
      const normalizedFilter = filter.trim().toLowerCase();
      return normalizedPosition.includes(normalizedFilter);
    }

    // Handle position object filter
    const { name, teamId, serviceTypeId } = filter;
    const normalizedFilterName = name.trim().toLowerCase();

    // First check if the position name matches (fuzzy)
    if (!normalizedPosition.includes(normalizedFilterName)) {
      return false;
    }

    // If filter has teamId, member's teamId must match
    if (teamId !== undefined) {
      if (!memberContext || memberContext.teamId !== teamId) {
        return false;
      }
    }

    // If filter has serviceTypeId, member's serviceTypeId must match
    if (serviceTypeId !== undefined) {
      if (!memberContext || memberContext.serviceTypeId !== serviceTypeId) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Deduplicate members by PCO person ID.
 * When the same person appears multiple times (e.g., in multiple services or teams),
 * keeps only one entry with the LATEST scheduledRemovalAt date.
 *
 * Members with null pcoPersonId are kept as-is since they can't be deduplicated.
 *
 * @param members - Array of members to deduplicate
 * @returns Deduplicated array with latest removal dates preserved
 */
export function deduplicateByPersonId<T extends FilterableMember>(
  members: T[]
): T[] {
  // Use a Map to track the best entry for each person
  const personMap = new Map<string, T>();
  const nullPersonMembers: T[] = [];

  for (const member of members) {
    if (member.pcoPersonId === null) {
      // Can't deduplicate null IDs - keep them all
      nullPersonMembers.push(member);
      continue;
    }

    const existing = personMap.get(member.pcoPersonId);
    if (!existing) {
      // First time seeing this person
      personMap.set(member.pcoPersonId, member);
    } else if (member.scheduledRemovalAt > existing.scheduledRemovalAt) {
      // This entry has a later removal date - replace
      personMap.set(member.pcoPersonId, member);
    }
    // Otherwise, keep the existing entry (it has a later or equal removal date)
  }

  // Combine results: deduplicated entries + null person entries
  return [...personMap.values(), ...nullPersonMembers];
}

/**
 * Apply filters to a list of team members.
 *
 * @param members - Array of team members from PCO API
 * @param filters - Filter configuration from autoChannelConfig
 * @returns Filtered array of members
 */
export function applyFilters<
  T extends {
    teamId: string | null;
    position: string | null;
    status: string;
    serviceTypeId?: string;
  }
>(
  members: T[],
  filters: {
    teamIds?: string[];
    positions?: PositionFilterInput[];
    statuses?: string[];
  }
): T[] {
  return members.filter((member) => {
    // Team filter
    if (filters.teamIds && filters.teamIds.length > 0) {
      if (!member.teamId || !filters.teamIds.includes(member.teamId)) {
        return false;
      }
    }

    // Position filter (fuzzy match with optional context)
    if (filters.positions && filters.positions.length > 0) {
      // Build member context for position matching
      const memberContext: MemberContext = {
        teamId: member.teamId,
        serviceTypeId: member.serviceTypeId,
      };
      if (!matchPosition(member.position, filters.positions, memberContext)) {
        return false;
      }
    }

    // Status filter
    if (filters.statuses && filters.statuses.length > 0) {
      if (!filters.statuses.includes(member.status)) {
        return false;
      }
    } else {
      // Default: exclude declined (D) if no status filter specified
      if (member.status === "D") {
        return false;
      }
    }

    return true;
  });
}

/**
 * Filter and aggregate positions from team members based on selected teams.
 * Implements cascading filter logic where positions are filtered by selected teams.
 *
 * When teamIds is empty or undefined, returns all positions across all teams.
 * When teamIds contains IDs, returns only positions from members on those teams.
 *
 * @param members - Array of team members with position and team info
 * @param teamIds - Optional array of team IDs to filter by
 * @returns Unique positions sorted by frequency (most common first)
 */
export function filterPositionsByTeams<
  T extends {
    position: string | null;
    teamId: string | null;
    teamName?: string | null;
  }
>(
  members: T[],
  teamIds: string[] | undefined
): Array<{ name: string; count: number }> {
  // Filter members by team if teamIds specified
  let filteredMembers = members;
  if (teamIds && teamIds.length > 0) {
    filteredMembers = members.filter(
      (member) => member.teamId && teamIds.includes(member.teamId)
    );
  }

  // Aggregate positions with counts
  const positionCounts = new Map<string, number>();
  for (const member of filteredMembers) {
    if (member.position) {
      const currentCount = positionCounts.get(member.position) || 0;
      positionCounts.set(member.position, currentCount + 1);
    }
  }

  // Convert to array and sort by count (most common first)
  return Array.from(positionCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}
