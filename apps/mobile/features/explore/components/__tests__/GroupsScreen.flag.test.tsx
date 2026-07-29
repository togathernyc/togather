/**
 * GroupsScreen — the whatsapp-shell fork, both ways.
 *
 * The flag-on branch swaps the map-first explore layout for
 * `WaGroupsScreen` (see that file's header). This suite is the guard on the
 * other half of the deal: flag-off, the tab must still render the original
 * tree — map, bottom sheet, the two floating circles, the filter modal — with
 * none of the WhatsApp surface leaking in.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

let mockShellEnabled = false;
jest.mock('@hooks/useWhatsappShell', () => ({
  useWhatsappShell: () => mockShellEnabled,
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, setParams: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));

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
      backgroundSecondary: '#f7f7f7',
      border: '#ccc',
      borderLight: '#eee',
      separator: '#e5e5e5',
      iconSecondary: '#666',
      inputPlaceholder: '#999',
      buttonPrimary: '#1E8449',
      buttonPrimaryText: '#fff',
      textInverse: '#fff',
      tabBar: '#fff',
      tabBarBorder: '#eee',
    },
    isDark: false,
  }),
}));

jest.mock('@hooks/useCommunityTheme', () => ({
  useCommunityTheme: () => ({ primaryColor: '#1E8449', accentLight: 'rgba(30,132,73,0.1)' }),
}));

jest.mock('@providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { is_admin: false },
    community: { id: 'community-1', name: 'Demo Community' },
    token: 'token',
  }),
}));

jest.mock('@services/api/convex', () => ({
  api: {
    functions: {
      admin: { settings: { getExploreDefaults: 'getExploreDefaults' } },
      groupCreationRequests: { mine: 'mine' },
    },
  },
  useQuery: () => undefined,
}));

jest.mock('@features/groups/hooks/useGroups', () => ({
  useGroupTypes: () => ({
    data: [{ id: 'gt-1', name: 'Small Group', slug: 'small-group', isActive: true }],
    isLoading: false,
  }),
  useGroupSearchQuery: () => ({
    data: [
      {
        _id: 'group-youth',
        id: 'group-youth',
        name: 'Youth Group',
        groupTypeName: 'Small Group',
        memberCount: 12,
        isMember: false,
        preview: null,
      },
    ],
    isLoading: false,
  }),
}));

// Pulls in `expo-location` (native module) at import time. Returning null also
// makes the point that the flag-on directory lists every group, geocoded or not
// — the flag-off sheet only ever showed the ones the map could place.
jest.mock('@features/groups/utils/geocodeLocation', () => ({
  getGroupCoordinates: () => null,
}));

jest.mock('../../hooks/useExploreFilters', () => ({
  useExploreFilters: () => ({
    filters: { groupType: null, meetingType: null },
    setFilters: jest.fn(),
    hasActiveGroupFilters: false,
    activeGroupFilterCount: 0,
  }),
}));

jest.mock('../ExploreMap', () => {
  const React = require('react');
  return { ExploreMap: () => React.createElement('View', { testID: 'explore-map' }, null) };
});
jest.mock('../ExploreBottomSheet', () => {
  const React = require('react');
  return {
    ExploreBottomSheet: () =>
      React.createElement('View', { testID: 'explore-bottom-sheet' }, null),
  };
});
jest.mock('../FloatingGroupCard', () => {
  const React = require('react');
  return {
    FloatingGroupCard: () =>
      React.createElement('View', { testID: 'floating-group-card' }, null),
  };
});
jest.mock('../FilterModal', () => {
  const React = require('react');
  return { FilterModal: () => React.createElement('View', { testID: 'filter-modal' }, null) };
});

// Imported after the mocks so the module graph picks them up.
const { GroupsScreen } = require('../GroupsScreen');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GroupsScreen — flag off (unchanged explore surface)', () => {
  beforeAll(() => {
    mockShellEnabled = false;
  });

  it('keeps the map-first layout: map behind, bottom sheet over it', () => {
    const { getByTestId } = render(<GroupsScreen />);
    expect(getByTestId('explore-map')).toBeTruthy();
    expect(getByTestId('explore-bottom-sheet')).toBeTruthy();
    expect(getByTestId('filter-modal')).toBeTruthy();
  });

  it('renders none of the WhatsApp directory surface', () => {
    const { queryByTestId, queryByText } = render(<GroupsScreen />);
    expect(queryByTestId('wa-groups-search')).toBeNull();
    expect(queryByTestId('wa-group-filter-chips')).toBeNull();
    expect(queryByTestId('wa-groups-add')).toBeNull();
    expect(queryByText('Groups you can join')).toBeNull();
  });
});

describe('GroupsScreen — flag on (WhatsApp directory surface)', () => {
  beforeAll(() => {
    mockShellEnabled = true;
  });
  afterAll(() => {
    mockShellEnabled = false;
  });

  it('renders the WhatsApp surface instead of the sheet-over-map layout', () => {
    const { getByTestId, getByText, queryByTestId } = render(<GroupsScreen />);
    expect(getByTestId('wa-groups-search')).toBeTruthy();
    expect(getByTestId('wa-group-filter-chips')).toBeTruthy();
    expect(getByTestId('wa-groups-add')).toBeTruthy();
    expect(getByText('Groups you can join')).toBeTruthy();
    expect(queryByTestId('explore-bottom-sheet')).toBeNull();
    // The map view is behind the header's Map circle, not rendered at rest.
    expect(queryByTestId('explore-map')).toBeNull();
  });

  it('feeds the group types it fetched into the chip strip', () => {
    const { getByTestId } = render(<GroupsScreen />);
    expect(getByTestId('wa-group-chip-gt-1')).toBeTruthy();
  });
});
