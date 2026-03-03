/**
 * Explore page filtering logic tests
 *
 * Tests the pure filtering function used by the explore page.
 * Admin defaults are seeded once as initial state; the user can then change filters freely.
 *
 * Run with: cd apps/mobile && pnpm test features/explore/utils/__tests__/filterGroups.test.ts
 */

import type { Group } from '@features/groups/types';
import type { FilterState } from '../../components/FilterModal';
import { filterExploreGroups } from '../filterGroups';

// ============================================================================
// Test Data Factories
// ============================================================================

function makeGroup(overrides: Partial<Group> & { _id: string }): Group {
  return {
    name: 'Test Group',
    group_type: null,
    meeting_type: null,
    ...overrides,
  };
}

// Stable test data
const mockGroups: Group[] = [
  makeGroup({ _id: 'g1', name: 'Group A', group_type: 'type1' as any, meeting_type: 1 }),
  makeGroup({ _id: 'g2', name: 'Group B', group_type: 'type2' as any, meeting_type: 2 }),
  makeGroup({ _id: 'g3', name: 'Group C', group_type: 'type1' as any, meeting_type: 2 }),
  makeGroup({ _id: 'g4', name: 'Group D', group_type: 'type3' as any, meeting_type: 1 }),
  makeGroup({ _id: 'g5', name: 'Group E', group_type: 'type2' as any, meeting_type: 1 }),
];

const NO_FILTERS: FilterState = { groupType: null, meetingType: null };

// ============================================================================
// filterExploreGroups - No session defaults, no filters
// ============================================================================

describe('filterExploreGroups - no defaults, no filters', () => {
  it('returns all groups when no session defaults and no filters are set', () => {
    const result = filterExploreGroups(mockGroups, NO_FILTERS, null);
    expect(result).toHaveLength(5);
  });

  it('returns all groups when session defaults is null', () => {
    const result = filterExploreGroups(mockGroups, NO_FILTERS, null);
    expect(result).toHaveLength(5);
  });

  it('returns empty array when groups array is empty', () => {
    const result = filterExploreGroups([], NO_FILTERS, null);
    expect(result).toEqual([]);
  });
});

// ============================================================================
// filterExploreGroups - Session group type defaults (seeded from admin)
// ============================================================================

describe('filterExploreGroups - session group type defaults', () => {
  it('filters to only matching group types when session defaults are set', () => {
    const result = filterExploreGroups(mockGroups, NO_FILTERS, ['type1']);

    // Only Group A (type1) and Group C (type1) should match
    expect(result).toHaveLength(2);
    expect(result.map(g => g.name)).toEqual(['Group A', 'Group C']);
  });

  it('allows multiple group types in session defaults', () => {
    const result = filterExploreGroups(mockGroups, NO_FILTERS, ['type1', 'type2']);

    // type1: Group A, Group C; type2: Group B, Group E
    expect(result).toHaveLength(4);
    expect(result.map(g => g.name)).toEqual(['Group A', 'Group B', 'Group C', 'Group E']);
  });

  it('returns empty when session defaults match no groups', () => {
    const result = filterExploreGroups(mockGroups, NO_FILTERS, ['nonexistent']);
    expect(result).toHaveLength(0);
  });

  it('shows all when session defaults is empty array', () => {
    // Empty array is treated like null (no restriction)
    const result = filterExploreGroups(mockGroups, NO_FILTERS, []);
    expect(result).toHaveLength(5);
  });

  it('shows all when session defaults is null (user cleared defaults)', () => {
    const result = filterExploreGroups(mockGroups, NO_FILTERS, null);
    expect(result).toHaveLength(5);
  });
});

// ============================================================================
// filterExploreGroups - Meeting type filter
// ============================================================================

describe('filterExploreGroups - meeting type filter', () => {
  it('filters by meeting type when set in filters', () => {
    const filters: FilterState = { groupType: null, meetingType: 1 }; // Online
    const result = filterExploreGroups(mockGroups, filters, null);

    // meeting_type=1: Group A, Group D, Group E
    expect(result).toHaveLength(3);
    expect(result.map(g => g.name)).toEqual(['Group A', 'Group D', 'Group E']);
  });

  it('filters In-Person (2) correctly', () => {
    const filters: FilterState = { groupType: null, meetingType: 2 }; // In-Person
    const result = filterExploreGroups(mockGroups, filters, null);

    // meeting_type=2: Group B, Group C
    expect(result).toHaveLength(2);
    expect(result.map(g => g.name)).toEqual(['Group B', 'Group C']);
  });

  it('includes groups with null meeting_type when no filter set', () => {
    const groupsWithNull = [
      ...mockGroups,
      makeGroup({ _id: 'g6', name: 'Group F', group_type: 'type1' as any, meeting_type: null }),
    ];
    const result = filterExploreGroups(groupsWithNull, NO_FILTERS, null);
    expect(result).toHaveLength(6);
  });

  it('includes groups with null/undefined meeting_type even when meeting filter is set', () => {
    const groupsWithNull = [
      ...mockGroups,
      makeGroup({ _id: 'g6', name: 'Group F', group_type: 'type1' as any, meeting_type: null }),
    ];
    const filters: FilterState = { groupType: null, meetingType: 1 };
    const result = filterExploreGroups(groupsWithNull, filters, null);

    // Groups without a meeting_type are always included (unclassified)
    expect(result.find(g => g.name === 'Group F')).toBeDefined();
  });
});

// ============================================================================
// filterExploreGroups - User filters with session defaults
// ============================================================================

describe('filterExploreGroups - user filters with session defaults', () => {
  it('user group type filter narrows within session defaults', () => {
    const filters: FilterState = { groupType: 'type1' as any, meetingType: null };
    const result = filterExploreGroups(mockGroups, filters, ['type1', 'type2']);

    // Session defaults allow type1 and type2, user selects type1 only
    // Only Group A and Group C (type1) match
    expect(result).toHaveLength(2);
    expect(result.map(g => g.name)).toEqual(['Group A', 'Group C']);
  });

  it('user group type outside session defaults returns no results', () => {
    const filters: FilterState = { groupType: 'type2' as any, meetingType: null };
    const result = filterExploreGroups(mockGroups, filters, ['type1']);

    // Session defaults only allow type1, user selected type2 -> no overlap
    expect(result).toHaveLength(0);
  });

  it('user meeting type filter works independently of session defaults', () => {
    const filters: FilterState = { groupType: null, meetingType: 1 };
    const result = filterExploreGroups(mockGroups, filters, null);

    // User chose Online (1)
    expect(result).toHaveLength(3);
    expect(result.every(g => g.meeting_type === 1)).toBe(true);
  });

  it('combines session defaults + user group type + meeting type', () => {
    const filters: FilterState = { groupType: 'type1' as any, meetingType: 2 };
    const result = filterExploreGroups(mockGroups, filters, ['type1', 'type2']);

    // Session allows type1/type2, user selects type1, meeting_type=2
    // Only Group C (type1, meeting_type=2) matches all criteria
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Group C');
  });
});

// ============================================================================
// filterExploreGroups - Session defaults cleared (user interacted with filter)
// ============================================================================

describe('filterExploreGroups - session defaults cleared', () => {
  it('shows all group types when session defaults are cleared (null)', () => {
    // After user touches the filter, sessionGroupTypeDefaults becomes null
    const result = filterExploreGroups(mockGroups, NO_FILTERS, null);
    expect(result).toHaveLength(5);
  });

  it('user can select any group type after session defaults are cleared', () => {
    const filters: FilterState = { groupType: 'type3' as any, meetingType: null };
    // Session defaults cleared (null) - user can pick any type
    const result = filterExploreGroups(mockGroups, filters, null);

    // type3: only Group D
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Group D');
  });
});

// ============================================================================
// filterExploreGroups - Edge cases
// ============================================================================

describe('filterExploreGroups - edge cases', () => {
  it('handles groups with undefined group_type', () => {
    const groups = [
      makeGroup({ _id: 'g1', name: 'No Type', group_type: undefined as any }),
    ];
    const result = filterExploreGroups(groups, NO_FILTERS, ['type1']);

    // Group has undefined type, doesn't match 'type1'
    expect(result).toHaveLength(0);
  });

  it('handles groups with null group_type when session defaults are set', () => {
    const groups = [
      makeGroup({ _id: 'g1', name: 'Null Type', group_type: null }),
    ];
    const result = filterExploreGroups(groups, NO_FILTERS, ['type1']);
    expect(result).toHaveLength(0);
  });

  it('handles groups with null group_type when no session defaults', () => {
    const groups = [
      makeGroup({ _id: 'g1', name: 'Null Type', group_type: null }),
    ];
    const result = filterExploreGroups(groups, NO_FILTERS, null);
    // No restriction, so null group_type groups pass
    expect(result).toHaveLength(1);
  });

  it('preserves original array order', () => {
    const result = filterExploreGroups(mockGroups, NO_FILTERS, ['type1', 'type2']);

    // Should maintain the original insertion order
    const names = result.map(g => g.name);
    expect(names).toEqual(['Group A', 'Group B', 'Group C', 'Group E']);
  });
});

// ============================================================================
// Integration scenarios
// ============================================================================

describe('filterExploreGroups - integration scenarios', () => {
  it('scenario: admin restricts to small groups only (seeded as session defaults)', () => {
    const groups = [
      makeGroup({ _id: 'g1', name: 'Alpha Small Group', group_type: 'small-group' as any, meeting_type: 2 }),
      makeGroup({ _id: 'g2', name: 'Beta Bible Study', group_type: 'bible-study' as any, meeting_type: 2 }),
      makeGroup({ _id: 'g3', name: 'Gamma Small Group', group_type: 'small-group' as any, meeting_type: 1 }),
      makeGroup({ _id: 'g4', name: 'Delta Service Team', group_type: 'service-team' as any, meeting_type: 2 }),
    ];

    const result = filterExploreGroups(groups, NO_FILTERS, ['small-group']);
    expect(result).toHaveLength(2);
    expect(result.map(g => g.name)).toEqual(['Alpha Small Group', 'Gamma Small Group']);
  });

  it('scenario: user overrides meeting type (admin set In-Person, user picks Online)', () => {
    // Meeting type is already in the URL filter state (seeded from admin, then user changed it)
    const filters: FilterState = { groupType: null, meetingType: 1 };
    const result = filterExploreGroups(mockGroups, filters, null);
    expect(result.every(g => g.meeting_type === 1)).toBe(true);
  });

  it('scenario: admin sets defaults, user opens filter modal and changes -> defaults cleared', () => {
    // Step 1: initial state with admin session defaults
    const withDefaults = filterExploreGroups(mockGroups, NO_FILTERS, ['type1', 'type2']);
    expect(withDefaults).toHaveLength(4); // type1 + type2

    // Step 2: user opens filter modal, picks type3 -> session defaults cleared (null)
    const afterUserChange = filterExploreGroups(
      mockGroups,
      { groupType: 'type3' as any, meetingType: null },
      null, // cleared
    );
    expect(afterUserChange).toHaveLength(1); // Only Group D (type3)
    expect(afterUserChange[0].name).toBe('Group D');
  });

  it('scenario: session defaults + user filters combined', () => {
    const filters: FilterState = { groupType: 'type1' as any, meetingType: 2 };
    const result = filterExploreGroups(mockGroups, filters, ['type1', 'type2']);

    // type1 + meeting_type=2 = only Group C
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Group C');
  });

  it('scenario: no admin defaults, user selects filters freely', () => {
    const filters: FilterState = { groupType: 'type2' as any, meetingType: 1 };
    const result = filterExploreGroups(mockGroups, filters, null);

    // type2 + meeting_type=1 = only Group E
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Group E');
  });
});
