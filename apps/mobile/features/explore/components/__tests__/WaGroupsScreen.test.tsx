/**
 * WaGroupsScreen — the flag-on Groups tab's WhatsApp anatomy
 * (WA-VISUAL-DELTAS.md S1/S5/S6/S7 + D4).
 *
 * These pin the restyle so a later pass can't quietly regress it back toward
 * the flag-off explore surface: 44pt search pill, 34pt neutral filter chips
 * (never accent-FILLED), WA_LIST_AVATAR row avatars, sentence-case section headers, one
 * green CTA, and every affordance the map-first layout had still reachable.
 *
 * The flag-off twin lives in `GroupsScreen.flag.test.tsx`.
 */
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { geocodeZipCode } from '@/features/groups/utils/geocodeLocation';
import { WaGroupsScreen, type ExploreGroup } from '../WaGroupsScreen';
import {
  WA_LIST_AVATAR,
  WA_FLOATING_CTA_HEIGHT,
  WA_FLOATING_CTA_CONTENT_CLEARANCE,
  WA_TAB_ISLAND_HEIGHT,
  waFloatingCtaBottomOffset,
  waTabBarBottomOffset,
} from '@components/wa';

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

// The compass is additionally gated on the nearby-device-location Convex
// flag (hidden until the native build with the iOS permission string ships).
// Default ON here so the near-me suite exercises the full affordance; the
// flag-off specs override per-test.
const mockDeviceLocationFlag = { enabled: true, loaded: true };
jest.mock('@hooks/useConvexFeatureFlag', () => ({
  useConvexFeatureFlag: () => mockDeviceLocationFlag,
}));

jest.mock('@hooks/useCommunityTheme', () => ({
  useCommunityTheme: () => ({ primaryColor: '#1E8449', accentLight: 'rgba(30,132,73,0.1)' }),
}));

// Zip → coords is a local lookup (`us-zips`); stubbed so the near-me specs
// assert the wiring rather than shipping the whole zip table into jest.
jest.mock('@/features/groups/utils/geocodeLocation', () => ({
  geocodeZipCode: jest.fn(() => null),
  geocodeAddressAsync: jest.fn(async () => null),
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

beforeEach(async () => {
  jest.clearAllMocks();
  // `useUserLocation` caches the last fix to AsyncStorage, and the mock is
  // module-scoped — without this a granted spec leaks its coordinates into the
  // permission-denied one.
  await AsyncStorage.clear();
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

  it('draws WA_LIST_AVATAR row avatars (S6.1)', () => {
    const { toJSON } = renderScreen();
    const avatars = flattenStyles(toJSON()).filter((s) => s.width === WA_LIST_AVATAR && s.height === WA_LIST_AVATAR);
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

  it('uses the shared kit CTA geometry and floats clear of the tab island', () => {
    const { getByTestId } = renderScreen();
    const pill = StyleSheet.flatten(getByTestId('wa-groups-add').props.style);
    expect(pill.height).toBe(WA_FLOATING_CTA_HEIGHT);
    expect(pill.borderRadius).toBe(WA_FLOATING_CTA_HEIGHT / 2);
    // Centered auto-width, not the full-width bar this screen used to draw.
    expect(pill.width).toBeUndefined();
    expect(pill.alignSelf).toBeUndefined();

    const wrap = StyleSheet.flatten(getByTestId('wa-groups-add-wrap').props.style);
    // The mocked safe-area inset is 0 here; the offset still has to clear the island.
    expect(wrap.bottom).toBe(waFloatingCtaBottomOffset(0));
    expect(wrap.bottom).toBeGreaterThan(waTabBarBottomOffset(0) + WA_TAB_ISLAND_HEIGHT);
  });

  it('pads the list so the last row clears both the island and the CTA', () => {
    const { UNSAFE_getAllByType } = renderScreen();
    const list = UNSAFE_getAllByType(ScrollView).find((sv: any) =>
      Boolean(StyleSheet.flatten(sv.props.contentContainerStyle)?.paddingBottom)
    );
    expect(
      StyleSheet.flatten(list!.props.contentContainerStyle).paddingBottom
    ).toBe(WA_FLOATING_CTA_CONTENT_CLEARANCE);
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

describe('WaGroupsScreen — find groups near me', () => {
  const NYC = { latitude: 40.7128, longitude: -74.006 };
  const PHILLY = { latitude: 39.9526, longitude: -75.1652 };

  /** Joinable, geocoded ~0 mi from the mocked device position. */
  const CLOSE: ExploreGroup & { latitude: number; longitude: number } = {
    _id: 'group-close',
    id: 'group-close',
    name: 'Corner Bible Study',
    group_type_name: 'Small Group',
    member_count: 4,
    is_member: false,
    preview: null,
    latitude: 40.72,
    longitude: -74.0,
  };

  /** Joinable, geocoded ~80 mi away. */
  const FAR: ExploreGroup & { latitude: number; longitude: number } = {
    _id: 'group-far',
    id: 'group-far',
    name: 'Philly Prayer',
    group_type_name: 'Small Group',
    member_count: 9,
    is_member: false,
    preview: null,
    latitude: PHILLY.latitude,
    longitude: PHILLY.longitude,
  };

  /** Joinable, but no address on file — must never be dropped. */
  const UNPLACED: ExploreGroup = {
    _id: 'group-unplaced',
    id: 'group-unplaced',
    name: 'Online Only',
    group_type_name: 'Teams',
    member_count: 3,
    is_member: false,
    preview: null,
  };

  /**
   * Member groups, geocoded. The owner is in nearly every group in their
   * community, so "Groups you're in" is the section that has to sort — it was
   * why zip search read as a no-op (owner directive, 2026-07-30).
   */
  const MY_CLOSE: ExploreGroup & { latitude: number; longitude: number } = {
    _id: 'group-my-close',
    id: 'group-my-close',
    name: 'Tuesday Table',
    group_type_name: 'Small Group',
    member_count: 6,
    is_member: true,
    preview: null,
    latitude: 40.72,
    longitude: -74.0,
  };

  const MY_FAR: ExploreGroup & { latitude: number; longitude: number } = {
    _id: 'group-my-far',
    id: 'group-my-far',
    name: 'Fishtown Fellowship',
    group_type_name: 'Small Group',
    member_count: 7,
    is_member: true,
    preview: null,
    latitude: PHILLY.latitude,
    longitude: PHILLY.longitude,
  };

  /**
   * Deliberately shuffled so a passing order assertion can only come from the
   * sort, never from the incoming order. WORSHIP and UNPLACED have no address
   * and must trail inside their own section rather than vanish.
   */
  function renderNearby(
    overrides: Partial<React.ComponentProps<typeof WaGroupsScreen>> = {}
  ) {
    return renderScreen({
      groups: [WORSHIP, MY_FAR, FAR, UNPLACED, CLOSE, MY_CLOSE],
      groupsWithLocation: [MY_FAR, FAR, CLOSE, MY_CLOSE],
      ...overrides,
    });
  }

  /**
   * Rendered row ids, top to bottom — the only way to prove a sort happened.
   * Walks the JSON tree rather than leaning on a query matcher so the assertion
   * is about document order, not query order.
   */
  function rowOrder(tree: any): string[] {
    const ids: string[] = [];
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      const testID = node.props?.testID;
      if (typeof testID === 'string' && testID.startsWith('wa-group-row-')) {
        const id = testID.slice('wa-group-row-'.length);
        if (!ids.includes(id)) ids.push(id);
      }
      if (Array.isArray(node.children)) node.children.forEach(walk);
    };
    walk(tree);
    return ids;
  }

  const grantLocation = () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'granted',
    });
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({ coords: NYC });
  };

  const denyLocation = () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'denied',
    });
  };

  beforeEach(() => {
    denyLocation();
    (geocodeZipCode as jest.Mock).mockImplementation((zip: string) =>
      zip === '19104' ? PHILLY : null
    );
  });

  it('renders a neutral compass circle beside the search pill', () => {
    const { getByLabelText, getByTestId, getByText } = renderNearby();
    expect(getByTestId('wa-groups-search')).toBeTruthy();
    expect(getByLabelText('Find groups near me')).toBeTruthy();
    // Outline glyph at rest; the accent budget stays on the CTA.
    expect(getByText('compass-outline')).toBeTruthy();
  });

  it('leaves both sections in their incoming order, undecorated, with no origin', () => {
    const { toJSON, getByText, queryAllByText } = renderNearby();
    expect(getByText("Groups you're in")).toBeTruthy();
    expect(getByText('Groups you can join')).toBeTruthy();
    expect(rowOrder(toJSON())).toEqual([
      'group-worship',
      'group-my-far',
      'group-my-close',
      'group-far',
      'group-unplaced',
      'group-close',
    ]);
    expect(queryAllByText(/\d+(\.\d)? mi$/)).toHaveLength(0);
  });

  it('sorts BOTH sections nearest-first and labels every geocoded row', async () => {
    grantLocation();
    const { getByLabelText, getByText, toJSON } = renderNearby();

    fireEvent.press(getByLabelText('Find groups near me'));
    await waitFor(() =>
      expect(getByText(/^Small Group · 6 members · 0(\.\d)? mi$/)).toBeTruthy()
    );
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled();

    // The membership sections stay — the sort is a sort, not a regrouping.
    expect(getByText("Groups you're in")).toBeTruthy();
    expect(getByText('Groups you can join')).toBeTruthy();

    // Nearest first inside EACH section, un-geocoded rows trailing their own
    // section instead of disappearing.
    expect(rowOrder(toJSON())).toEqual([
      'group-my-close', // 0 mi   ┐ Groups you're in
      'group-my-far', //  ~80 mi  │
      'group-worship', // no address ┘
      'group-close', //   0 mi   ┐ Groups you can join
      'group-far', //     ~80 mi │
      'group-unplaced', // no address ┘
    ]);

    // …and every geocoded row carries its distance in the 15pt subtitle,
    // members included (this is the part that made zip look like a no-op).
    expect(getByText(/^Small Group · 7 members · 8\d mi$/)).toBeTruthy();
    expect(getByText(/^Small Group · 4 members · 0(\.\d)? mi$/)).toBeTruthy();
    expect(getByText(/^Small Group · 9 members · 8\d mi$/)).toBeTruthy();
    // Un-geocoded rows keep their plain subtitle.
    expect(getByText('Teams · 1 member')).toBeTruthy();
    expect(getByText('Teams · 3 members')).toBeTruthy();
  });

  it('keeps the compass neutral — the CTA stays the only accent element', async () => {
    grantLocation();
    const { getByLabelText, queryAllByText, toJSON } = renderNearby();
    fireEvent.press(getByLabelText('Find groups near me'));
    await waitFor(() => expect(queryAllByText(/\d+(\.\d)? mi$/).length).toBeGreaterThan(0));
    const accentFilled = flattenStyles(toJSON()).filter((s) => s.backgroundColor === ACCENT);
    expect(accentFilled).toHaveLength(1);
  });

  it('falls back to a quiet zip hint when permission is denied', async () => {
    denyLocation();
    const { getByLabelText, getByTestId, queryAllByText } = renderNearby();
    fireEvent.press(getByLabelText('Find groups near me'));

    await waitFor(() => expect(getByTestId('wa-groups-nearby-hint')).toBeTruthy());
    expect(getByTestId('wa-groups-nearby-hint').props.children).toMatch(/zip code/i);
    // No ordering happened, so no row claims a distance.
    expect(queryAllByText(/\d+(\.\d)? mi$/)).toHaveLength(0);
  });

  it('treats a bare 5-digit zip in the search field as a location query', async () => {
    const { getByText, toJSON } = renderNearby({ searchQuery: '19104' });

    await waitFor(() =>
      expect(getByText(/^Small Group · 7 members · 0(\.\d)? mi$/)).toBeTruthy()
    );
    expect(geocodeZipCode).toHaveBeenCalledWith('19104');
    // Origin flips to Philadelphia, so the Philly groups lead BOTH sections —
    // and the zip is NOT applied as a name filter, so nothing is filtered away.
    expect(rowOrder(toJSON())).toEqual([
      'group-my-far',
      'group-my-close',
      'group-worship',
      'group-far',
      'group-close',
      'group-unplaced',
    ]);
    expect(getByText(/^Small Group · 9 members · 0(\.\d)? mi$/)).toBeTruthy();
    expect(getByText('Corner Bible Study')).toBeTruthy();
    expect(getByText('Groups you can join')).toBeTruthy();
  });

  it('says so plainly when an unknown zip is typed', async () => {
    const { getByTestId, queryAllByText } = renderNearby({ searchQuery: '00000' });
    await waitFor(() => expect(getByTestId('wa-groups-nearby-hint')).toBeTruthy());
    expect(getByTestId('wa-groups-nearby-hint').props.children).toMatch(/00000/);
    expect(queryAllByText(/\d+(\.\d)? mi$/)).toHaveLength(0);
  });

  it('never sorts around stale coordinates after the current lookup fails', async () => {
    // Seed the hook's 30-minute cache with a previous fix (Philadelphia)…
    await AsyncStorage.setItem(
      'user_location_cache',
      JSON.stringify({ latitude: 39.9526, longitude: -75.1652, timestamp: Date.now() })
    );
    // …then type an UNKNOWN zip. The cached coords are restored by the hook,
    // but the CURRENT lookup failed — nearby mode must not activate around
    // the stale point while the failure hint is showing.
    const { getByTestId, toJSON, queryAllByText } = renderNearby({ searchQuery: '00000' });
    await waitFor(() => expect(getByTestId('wa-groups-nearby-hint')).toBeTruthy());
    expect(queryAllByText(/\d+(\.\d)? mi$/)).toHaveLength(0);
    expect(rowOrder(toJSON())).toEqual([
      'group-worship',
      'group-my-far',
      'group-my-close',
      'group-far',
      'group-unplaced',
      'group-close',
    ]);
  });

  it('never sorts around a previous zip fix after location permission is denied', async () => {
    await AsyncStorage.setItem(
      'user_location_cache',
      JSON.stringify({ latitude: 39.9526, longitude: -75.1652, timestamp: Date.now() })
    );
    denyLocation();
    const { getByLabelText, getByTestId, queryAllByText } = renderNearby();
    fireEvent.press(getByLabelText('Find groups near me'));
    await waitFor(() => expect(getByTestId('wa-groups-nearby-hint')).toBeTruthy());
    expect(getByTestId('wa-groups-nearby-hint').props.children).toMatch(/zip code/i);
    expect(queryAllByText(/\d+(\.\d)? mi$/)).toHaveLength(0);
  });

  it('says so plainly when nothing in the directory has an address', async () => {
    grantLocation();
    const { getByLabelText, getByTestId } = renderScreen({
      groups: [WORSHIP, UNPLACED],
      groupsWithLocation: [],
    });
    fireEvent.press(getByLabelText('Find groups near me'));
    await waitFor(() => expect(getByTestId('wa-groups-nearby-hint')).toBeTruthy());
    expect(getByTestId('wa-groups-nearby-hint').props.children).toMatch(/address/i);
  });

  it('hides the compass and advertises zip search while the device-location flag is off', () => {
    mockDeviceLocationFlag.enabled = false;
    try {
      const { queryByLabelText, getByTestId } = renderScreen();
      expect(queryByLabelText('Find groups near me')).toBeNull();
      expect(getByTestId('wa-groups-search').props.placeholder).toBe(
        'Search groups or zip code'
      );
    } finally {
      mockDeviceLocationFlag.enabled = true;
    }
  });

  it('keeps zip search working with the flag off', async () => {
    mockDeviceLocationFlag.enabled = false;
    try {
      const { queryAllByText } = renderNearby({ searchQuery: '19104' });
      await waitFor(() =>
        expect(queryAllByText(/\d+(\.\d)? mi$/).length).toBeGreaterThan(0)
      );
    } finally {
      mockDeviceLocationFlag.enabled = true;
    }
  });

  it('toggles back off, restoring the undecorated directory order', async () => {
    grantLocation();
    const { getByLabelText, getByText, queryAllByText, toJSON } = renderNearby();
    fireEvent.press(getByLabelText('Find groups near me'));
    await waitFor(() =>
      expect(queryAllByText(/\d+(\.\d)? mi$/).length).toBeGreaterThan(0)
    );

    fireEvent.press(getByLabelText('Find groups near me'));
    expect(queryAllByText(/\d+(\.\d)? mi$/)).toHaveLength(0);
    expect(getByText('Groups you can join')).toBeTruthy();
    expect(rowOrder(toJSON())).toEqual([
      'group-worship',
      'group-my-far',
      'group-my-close',
      'group-far',
      'group-unplaced',
      'group-close',
    ]);
  });
});
