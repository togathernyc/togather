/**
 * Pure filtering logic for the explore page
 *
 * Admin defaults are seeded once as initial state when the page loads.
 * After that, the user controls all filters freely.
 *
 * Filter layers:
 * 1. Session group type defaults - from admin config, applied until user changes filters
 * 2. User's selected group type - single-select, narrows within session defaults
 * 3. Meeting type - from URL-synced state (seeded from admin default on load)
 */

import type { Group } from '@features/groups/types';
import type { FilterState } from '../components/FilterModal';

/**
 * Filter groups based on session defaults and user-selected filters.
 *
 * @param groups - The full list of groups to filter
 * @param filters - User's current filter state (group type + meeting type)
 * @param sessionGroupTypeDefaults - Admin group type defaults, applied as soft filter until user changes filters (null = no restriction)
 * @returns Filtered array of groups
 */
export function filterExploreGroups(
  groups: Group[],
  filters: FilterState,
  sessionGroupTypeDefaults: string[] | null,
): Group[] {
  return groups.filter((group) => {
    // 1. Apply session group type defaults (soft restriction until user interacts with filter)
    if (sessionGroupTypeDefaults && sessionGroupTypeDefaults.length > 0) {
      const groupTypeId = typeof group.group_type === 'object'
        ? (group.group_type as { id: number } | null)?.id
        : group.group_type;
      if (!sessionGroupTypeDefaults.includes(groupTypeId as any)) {
        return false;
      }
    }

    // 2. Apply user's group type filter (single select)
    if (filters.groupType !== null) {
      const groupTypeId = typeof group.group_type === 'object'
        ? (group.group_type as { id: number } | null)?.id
        : group.group_type;
      if (groupTypeId !== filters.groupType) {
        return false;
      }
    }

    // 3. Apply meeting type filter
    // Groups without a meeting_type are always included (they haven't been classified yet)
    if (filters.meetingType !== null && group.meeting_type != null && group.meeting_type !== filters.meetingType) {
      return false;
    }

    return true;
  });
}
