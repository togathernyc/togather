/**
 * CommunityWideEventSheet — WhatsApp parity for the surface behind a
 * community-wide Events row (WA-VISUAL-DELTAS.md §7 + S6/S7).
 *
 * Dual-flag like every other WA surface: flag-on renders WA rows, flag-off
 * renders the pre-pass `EventCard` stack unchanged.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { CommunityWideEventSheet } from '../CommunityWideEventSheet';
import { useWhatsappShell } from '@hooks/useWhatsappShell';
import { useAuthenticatedQuery } from '@services/api/convex';
import { WA_TYPE_HEADER_BLOCK, WA_TYPE_ROW_TITLE, WA_TYPE_FOOTNOTE } from '@components/wa';

const ACCENT = '#25D366';

jest.mock('@hooks/useWhatsappShell', () => ({
  useWhatsappShell: jest.fn(() => true),
}));

jest.mock('@services/api/convex', () => {
  const make = (path: string[]): any =>
    new Proxy(() => {}, {
      get: (_t, prop: any) =>
        prop === 'toString' || prop === Symbol.toPrimitive
          ? () => path.join('.')
          : make([...path, String(prop)]),
      apply: () => path.join('.'),
    });
  return { api: make([]), useAuthenticatedQuery: jest.fn() };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1', timezone: 'America/New_York' } }),
}));

jest.mock('@hooks/useCommunityTheme', () => ({
  useCommunityTheme: () => ({ primaryColor: '#25D366' }),
}));

jest.mock('@gorhom/bottom-sheet', () => {
  const { View } = require('react-native');
  const BottomSheet = ({ children }: any) => <View>{children}</View>;
  return {
    __esModule: true,
    default: BottomSheet,
    BottomSheetScrollView: ({ children }: any) => <View>{children}</View>,
  };
});

const NOW = Date.parse('2026-07-29T18:00:00.000Z');

const CHILD = {
  id: 'meeting-1',
  shortId: 'abc123',
  title: 'All-Church Picnic',
  scheduledAt: '2026-07-29T23:00:00.000Z',
  status: 'scheduled',
  visibility: 'community',
  coverImage: null,
  locationOverride: 'Riverside Park',
  meetingType: 1,
  rsvpEnabled: true,
  communityWideEventId: 'cwe-1',
  group: {
    id: 'group-1',
    name: 'Downtown Group',
    image: null,
    groupTypeName: 'Small Group',
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    zipCode: null,
  },
  rsvpSummary: { totalGoing: 7, topGoingGuests: [] },
  hideRsvpCount: false,
  createdById: null,
  viewerIsLeader: false,
};

describe('CommunityWideEventSheet — WhatsApp parity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    (useWhatsappShell as jest.Mock).mockReturnValue(true);
    (useAuthenticatedQuery as jest.Mock).mockReturnValue({
      parent: { title: 'All-Church Picnic', scheduledAt: '2026-07-29T23:00:00.000Z' },
      children: [CHILD],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('flag-on: children are WA rows with a 22pt header block above them', () => {
    render(<CommunityWideEventSheet parentId={'cwe-1' as any} onDismiss={jest.fn()} />);

    const headerTitle = screen.getByText('All-Church Picnic');
    expect(StyleSheet.flatten(headerTitle.props.style).fontSize).toBe(WA_TYPE_HEADER_BLOCK);
    expect(screen.getByText('Today 7:00 PM')).toBeTruthy();

    const row = screen.getByTestId('wa-cwe-child-row');
    expect(row).toBeTruthy();
    const rowTitle = screen.getByText('Downtown Group');
    expect(StyleSheet.flatten(rowTitle.props.style).fontSize).toBe(WA_TYPE_ROW_TITLE);
    expect(screen.getByText('Today 7:00 PM · Riverside Park')).toBeTruthy();

    // Going count is right-aligned gray footnote text, not a colored pill.
    const going = screen.getByText('7 going');
    const goingStyle = StyleSheet.flatten(going.props.style);
    expect(goingStyle.fontSize).toBe(WA_TYPE_FOOTNOTE);
    expect(goingStyle.color).not.toBe(ACCENT);

    // Image-less children reuse the shared neutral thumbnail.
    expect(screen.getByTestId('wa-event-thumbnail')).toBeTruthy();

    fireEvent.press(rowTitle);
    expect(mockPush).toHaveBeenCalledWith('/e/abc123?source=app');
  });

  it('flag-off: the pre-pass EventCard stack is untouched', () => {
    (useWhatsappShell as jest.Mock).mockReturnValue(false);
    render(<CommunityWideEventSheet parentId={'cwe-1' as any} onDismiss={jest.fn()} />);

    expect(screen.queryByTestId('wa-cwe-child-row')).toBeNull();
    expect(screen.queryByTestId('wa-event-thumbnail')).toBeNull();
    // Legacy header type + the legacy "EEE, MMM d · h:mm a zzz" line.
    expect(
      StyleSheet.flatten(screen.getAllByText('All-Church Picnic')[0].props.style).fontSize
    ).toBe(20);
    expect(screen.getAllByText(/Wed, Jul 29 · 7:00 PM/).length).toBeGreaterThan(0);
  });
});
