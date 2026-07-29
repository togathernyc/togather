/**
 * WaGroupsScreen — the flag-on Groups tab's WhatsApp anatomy
 * (WA-VISUAL-DELTAS.md S1/S5/S6/S7 + D4).
 *
 * These pin the restyle so a later pass can't quietly regress it back toward
 * the flag-off explore surface: 44pt search pill, 34pt neutral filter chips
 * (never accent-FILLED), 58pt row avatars, sentence-case section headers, one
 * green CTA, and every affordance the map-first layout had still reachable.
 *
 * The flag-off twin lives in `GroupsScreen.flag.test.tsx`.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { WaGroupsScreen, type ExploreGroup } from '../WaGroupsScreen';

const ACCENT = '#1E8449';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      text: '#000',
      textSecondary: '#555',
      textTertiary: '#999',
      surface: '#fff',
      surfaceSecondary: '#eee',
      backgroundGrouped: '#f2f2f7',
      background: '#fff',
      border: '#ccc',
      borderLight: '#eee',
      separator: '#e5e5e5',
      iconSecondary: '#666',
      textInverse: '#fff',
    },
    isDark: false,
  }),
}));

jest.mock('@hooks/useCommunityTheme', () => ({
  useCommunityTheme: () => ({ primaryColor: '#1E8449', accentLight: 'rgba(30,132,73,0.1)' }),
}));

// Native map + its preview card: kept out of the test renderer, exactly as the
// safe-area suite does. The point here is that the Map circle still reaches
// them, not what Mapbox draws.
jest.mock('../ExploreMap', () => {
  const React = require('react');
  return { ExploreMap: () => React.createElement('View', { testID: 'explore-map' }, null) };
});
jest.mock('../FloatingGroupCard', () => {
  const React = require('react');
  return {
    FloatingGroupCard: () =>
      React.createElement('View', { testID: 'floating-group-card' }, null),
  };
});

const YOUTH: ExploreGroup = {
  _id: 'group-youth',
  id: 'group-youth',
  name: 'Youth Group',
  group_type_name: 'Small Group',
  member_count: 12,
  is_member: false,
  preview: null,
};

const WORSHIP: ExploreGroup = {
  _id: 'group-worship',
  id: 'group-worship',
  name: 'Worship Team',
  group_type_name: 'Teams',
  member_count: 1,
  is_member: true,
  preview: null,
};

const GROUP_TYPES = [
  { id: 'gt-1', name: 'Small Group', slug: 'small-group', isActive: true },
  { id: 'gt-2', name: 'Teams', slug: 'teams', isActive: true },
];

function renderScreen(overrides: Partial<React.ComponentProps<typeof WaGroupsScreen>> = {}) {
  const props: React.ComponentProps<typeof WaGroupsScreen> = {
    hasCommunityContext: true,
    isLoading: false,
    groups: [YOUTH, WORSHIP],
    groupsWithLocation: [YOUTH],
    selectedGroup: null,
    onGroupSelect: jest.fn(),
    onBoundsChange: jest.fn(),
    mapboxToken: 'token',
    searchQuery: '',
    onSearchChange: jest.fn(),
    groupTypes: GROUP_TYPES,
    filters: { groupType: null, meetingType: null },
    onFilterChange: jest.fn(),
    onAddGroup: jest.fn(),
    ...overrides,
  };
  return { props, ...render(<WaGroupsScreen {...props} />) };
}

/** Every flattened style object in the rendered tree, for metric assertions. */
function flattenStyles(node: any, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => flattenStyles(child, out));
    return out;
  }
  if (node.props?.style) out.push(StyleSheet.flatten(node.props.style) ?? {});
  if (Array.isArray(node.children)) node.children.forEach((c: any) => flattenStyles(c, out));
  return out;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('WaGroupsScreen — chrome (S1/S6.5)', () => {
  it('renders the "Groups" large title with neutral List/Map circles', () => {
    const { getByText, getByLabelText } = renderScreen();
    expect(getByText('Groups')).toBeTruthy();
    expect(getByLabelText('List view')).toBeTruthy();
    expect(getByLabelText('Map view')).toBeTruthy();
  });

  it('gives the search pill the 44pt fully-rounded geometry (S6.5)', () => {
    const { toJSON } = renderScreen();
    const pill = flattenStyles(toJSON()).find((s) => s.height === 44 && s.borderRadius === 22);
    expect(pill).toBeDefined();
  });

  it('routes search typing back to the owner of the query', () => {
    const { props, getByTestId } = renderScreen();
    fireEvent.changeText(getByTestId('wa-groups-search'), 'youth');
    expect(props.onSearchChange).toHaveBeenCalledWith('youth');
  });

  it('filters the list by the active query', () => {
    const { getByText, queryByText } = renderScreen({ searchQuery: 'worship' });
    expect(getByText('Worship Team')).toBeTruthy();
    expect(queryByText('Youth Group')).toBeNull();
  });
});

describe('WaGroupsScreen — filter chips (D4/S5)', () => {
  it('renders one chip per group type plus All and the meeting types', () => {
    const { getByText } = renderScreen();
    expect(getByText('All')).toBeTruthy();
    expect(getByText('Small Group')).toBeTruthy();
    expect(getByText('Teams')).toBeTruthy();
    expect(getByText('In-Person')).toBeTruthy();
    expect(getByText('Online')).toBeTruthy();
  });

  it('sizes chips at 34pt fully rounded and never fills one with the accent', () => {
    const { toJSON } = renderScreen({ filters: { groupType: 'gt-2', meetingType: null } });
    const chips = flattenStyles(toJSON()).filter((s) => s.height === 34 && s.borderRadius === 17);
    expect(chips.length).toBeGreaterThan(0);
    // S5/§7: a selected chip takes the pale accent tint, never the full-
    // saturation brand fill (that's a filled chip, and would read as a second
    // green CTA).
    expect(chips.every((s) => s.backgroundColor !== ACCENT)).toBe(true);
  });

  it('selects a group type and clears it via All', () => {
    const first = renderScreen();
    fireEvent.press(first.getByTestId('wa-group-chip-gt-1'));
    expect(first.props.onFilterChange).toHaveBeenCalledWith({
      groupType: 'gt-1',
      meetingType: null,
    });

    const second = renderScreen({ filters: { groupType: 'gt-1', meetingType: null } });
    fireEvent.press(second.getByTestId('wa-group-chip-all'));
    expect(second.props.onFilterChange).toHaveBeenCalledWith({
      groupType: null,
      meetingType: null,
    });
  });

  it('toggles the meeting-type filter off when its chip is already active', () => {
    const { props, getByTestId } = renderScreen({
      filters: { groupType: null, meetingType: 1 },
    });
    fireEvent.press(getByTestId('wa-group-chip-in-person'));
    expect(props.onFilterChange).toHaveBeenCalledWith({ groupType: null, meetingType: null });
  });
});

describe('WaGroupsScreen — rows and sections (S6/§5.3)', () => {
  it('splits results into sentence-case membership sections', () => {
    const { getByText, queryByText } = renderScreen();
    expect(getByText("Groups you're in")).toBeTruthy();
    expect(getByText('Groups you can join')).toBeTruthy();
    expect(queryByText("GROUPS YOU'RE IN")).toBeNull();
    expect(queryByText('GROUPS ON MAP')).toBeNull();
  });

  it('renders "type · member count" subtitles, singularizing one member', () => {
    const { getByText } = renderScreen();
    expect(getByText('Small Group · 12 members')).toBeTruthy();
    expect(getByText('Teams · 1 member')).toBeTruthy();
  });

  it('draws 58pt row avatars (S6.1)', () => {
    const { toJSON } = renderScreen();
    const avatars = flattenStyles(toJSON()).filter((s) => s.width === 58 && s.height === 58);
    expect(avatars.length).toBeGreaterThan(0);
  });

  it('navigates to the group when a row is pressed', () => {
    const { getByTestId } = renderScreen();
    fireEvent.press(getByTestId('wa-group-row-group-youth'));
    expect(mockPush).toHaveBeenCalledWith('/groups/group-youth');
  });
});

describe('WaGroupsScreen — CTA, empty states and the map (S5.1)', () => {
  it('keeps exactly one accent-filled element: the Add group pill', () => {
    const { toJSON, getByTestId } = renderScreen();
    expect(getByTestId('wa-groups-add')).toBeTruthy();
    const accentFilled = flattenStyles(toJSON()).filter((s) => s.backgroundColor === ACCENT);
    expect(accentFilled).toHaveLength(1);
  });

  it('forwards the Add group press to the create/request flow', () => {
    const { props, getByTestId } = renderScreen();
    fireEvent.press(getByTestId('wa-groups-add'));
    expect(props.onAddGroup).toHaveBeenCalled();
  });

  it('shows a centered empty state when nothing matches', () => {
    const { getByTestId, getByText } = renderScreen({ groups: [], searchQuery: 'nope' });
    expect(getByTestId('wa-groups-empty')).toBeTruthy();
    expect(getByText('No groups found')).toBeTruthy();
  });

  it('shows the join-a-community empty state without chips or CTA', () => {
    const { queryByTestId, getByText } = renderScreen({ hasCommunityContext: false });
    expect(getByText('Join a community to see groups')).toBeTruthy();
    expect(queryByTestId('wa-group-filter-chips')).toBeNull();
    expect(queryByTestId('wa-groups-add')).toBeNull();
  });

  it('still reaches the map (and its preview card) from the Map circle', () => {
    const { queryByTestId, getByTestId, getByLabelText } = renderScreen({
      selectedGroup: YOUTH,
    });
    expect(queryByTestId('explore-map')).toBeNull();
    fireEvent.press(getByLabelText('Map view'));
    expect(getByTestId('explore-map')).toBeTruthy();
    expect(getByTestId('floating-group-card')).toBeTruthy();
  });
});
