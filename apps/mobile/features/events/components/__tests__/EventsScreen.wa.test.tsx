/**
 * EventsScreen — WhatsApp design-system parity (WA-VISUAL-DELTAS.md §7 + S5/S6/S7).
 *
 * The screen is dual-flag: every WA change lives behind `useWhatsappShell()`
 * and the flag-off tree must stay byte-identical, so each delta is asserted
 * BOTH ways (flag-on shows the new anatomy; flag-off still shows the old one).
 */
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { EventsScreen } from '../EventsScreen';
import { useWhatsappShell } from '@hooks/useWhatsappShell';
import { useEventsByTimeWindow } from '../../hooks/useEventsByTimeWindow';
import { useLaterEvents } from '../../hooks/useLaterEvents';
import { useMyRsvpedEvents } from '../../hooks/useCommunityEvents';
import {
  WA_LIST_AVATAR,
  WA_AVATAR_SQUIRCLE_RATIO,
  WA_TYPE_SECTION_HEADER,
  WA_TYPE_ROW_TITLE,
  WA_TYPE_SUBTITLE,
  WA_TYPE_FOOTNOTE,
  WA_HEADER_CIRCLE_SIZE,
  WA_LARGE_TITLE_SIZE,
  WA_TAB_ISLAND_HEIGHT,
  WA_FLOATING_CTA_HEIGHT,
  WA_FLOATING_CTA_CONTENT_CLEARANCE,
  waFloatingCtaBottomOffset,
  waTabBarBottomOffset,
} from '@components/wa';

const ACCENT = '#25D366';

/** Every flattened style object in the rendered tree, for metric assertions. */
function flattenAll(node: any, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => flattenAll(child, out));
    return out;
  }
  if (node.props?.style) out.push(StyleSheet.flatten(node.props.style) ?? {});
  if (Array.isArray(node.children)) node.children.forEach((c: any) => flattenAll(c, out));
  return out;
}

jest.mock('@hooks/useWhatsappShell', () => ({
  useWhatsappShell: jest.fn(() => true),
}));

jest.mock('@hooks/useCommunityTheme', () => ({
  useCommunityTheme: () => ({ primaryColor: '#25D366' }),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  useFocusEffect: jest.fn(),
}));

jest.mock('@providers/AuthProvider', () => ({
  useAuth: () => ({
    community: { id: 'community-1', name: 'Demo Community' },
    user: { id: 'user-1', first_name: 'Ada', timezone: 'America/New_York' },
  }),
}));

jest.mock('../../hooks/useEventsByTimeWindow', () => ({
  useEventsByTimeWindow: jest.fn(),
}));
jest.mock('../../hooks/useLaterEvents', () => ({
  useLaterEvents: jest.fn(),
}));
jest.mock('../../hooks/useCommunityEvents', () => ({
  useMyRsvpedEvents: jest.fn(() => ({ data: { events: [] }, isLoading: false })),
}));

// Flag-off children — stand-ins so "the flag-off tree still renders the old
// components" is assertable without dragging their Convex deps in.
jest.mock('../EventCardRow', () => {
  const { Text } = require('react-native');
  return { EventCardRow: () => <Text testID="legacy-event-card-row">card row</Text> };
});
jest.mock('../EventRowCommunityWide', () => {
  const { Text } = require('react-native');
  return { EventRowCommunityWide: () => <Text testID="legacy-cwe-row">cwe row</Text> };
});
jest.mock('../FeaturedEventTile', () => {
  const { Text } = require('react-native');
  return { FeaturedEventTile: () => <Text testID="legacy-featured-tile">tile</Text> };
});
jest.mock('../CommunityWideEventSheet', () => ({ CommunityWideEventSheet: () => null }));
jest.mock('../EventsMapView', () => {
  const { Text } = require('react-native');
  return { EventsMapView: () => <Text testID="events-map-view">map</Text> };
});

/** 2026-07-29 14:00 America/New_York. */
const NOW = Date.parse('2026-07-29T18:00:00.000Z');

function singleCard(overrides: Record<string, any> = {}) {
  return {
    kind: 'single',
    id: 'meeting-1',
    shortId: 'abc123',
    title: 'Sunday Service',
    scheduledAt: '2026-07-29T23:00:00.000Z', // Today 7:00 PM EDT
    status: 'scheduled',
    visibility: 'community',
    coverImage: null,
    locationOverride: null,
    meetingType: 1,
    rsvpEnabled: true,
    communityWideEventId: null,
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
    rsvpSummary: { totalGoing: 12, topGoingGuests: [] },
    hideRsvpCount: false,
    createdById: null,
    viewerIsLeader: false,
    ...overrides,
  };
}

function cweCard(overrides: Record<string, any> = {}) {
  return {
    kind: 'community_wide',
    parentId: 'cwe-1',
    title: 'All-Church Picnic',
    scheduledAt: '2026-08-12T19:00:00.000Z',
    status: 'scheduled',
    meetingType: 1,
    groupCount: 3,
    totalGoing: 40,
    coverImage: null,
    representativeShortId: 'zzz999',
    ...overrides,
  };
}

function mockData({
  myEvents = [] as any[],
  nextUp = [] as any[],
  thisWeek = [] as any[],
  later = [] as any[],
  isLoading = false,
} = {}) {
  (useEventsByTimeWindow as jest.Mock).mockReturnValue({
    data: { myEvents, nextUp, thisWeek },
    isLoading,
  });
  (useLaterEvents as jest.Mock).mockReturnValue({
    cards: later,
    loadMore: jest.fn(),
    status: 'Exhausted',
  });
}

/** Flattened style of the first node rendering `text`. */
function styleOf(text: string | RegExp) {
  return StyleSheet.flatten(screen.getAllByText(text)[0].props.style);
}

describe('EventsScreen — WhatsApp parity (flag-on) vs legacy (flag-off)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    (useWhatsappShell as jest.Mock).mockReturnValue(true);
    (useMyRsvpedEvents as jest.Mock).mockReturnValue({
      data: { events: [] },
      isLoading: false,
    });
    mockData({
      myEvents: [singleCard()],
      thisWeek: [singleCard({ id: 'meeting-2', title: 'Prayer Night', shortId: 'def456' })],
      later: [cweCard()],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('S3.5: section headers are sentence case, ~20pt gray semibold — never Title Case or ALL CAPS', () => {
    render(<EventsScreen />);

    for (const header of ['My events', 'This week', 'Later']) {
      const style = styleOf(header);
      expect(style.fontSize).toBe(WA_TYPE_SECTION_HEADER);
      expect(style.fontWeight).toBe('600');
    }
    expect(screen.queryByText('My Events')).toBeNull();
    expect(screen.queryByText('MY EVENTS')).toBeNull();
    expect(screen.queryByText('This Week')).toBeNull();

    screen.unmount();
    (useWhatsappShell as jest.Mock).mockReturnValue(false);
    render(<EventsScreen />);
    expect(screen.getByText('My Events')).toBeTruthy();
    expect(screen.queryByText('My events')).toBeNull();
  });

  it('S6: rows are 17pt semibold title + 15pt gray "when · where" subtitle', () => {
    render(<EventsScreen />);

    const title = styleOf('Sunday Service');
    expect(title.fontSize).toBe(WA_TYPE_ROW_TITLE);
    expect(title.fontWeight).toBe('600');

    const subtitle = styleOf('Today 7:00 PM · Downtown Group');
    expect(subtitle.fontSize).toBe(WA_TYPE_SUBTITLE);
    // No timezone abbreviation, no "EEE" for something happening today.
    expect(screen.queryByText(/EDT|EST/)).toBeNull();

    // CWE rows share the anatomy, with the location count as their "where".
    expect(screen.getByText('Wed, Aug 12 3:00 PM · 3 locations')).toBeTruthy();
  });

  it('S5.1/§7: image-less rows get a neutral 58pt rounded-square thumbnail, not an accent-tinted disc', () => {
    render(<EventsScreen />);

    const thumbnails = screen.getAllByTestId('wa-event-thumbnail');
    const style = StyleSheet.flatten(thumbnails[0].props.style);
    expect(style.width).toBe(WA_LIST_AVATAR);
    expect(style.height).toBe(WA_LIST_AVATAR);
    // Rounded square (S6 "generous thumbnails"), not a circle.
    expect(style.borderRadius).toBeCloseTo(WA_LIST_AVATAR * WA_AVATAR_SQUIRCLE_RATIO);
    expect(style.borderRadius).not.toBe(WA_LIST_AVATAR / 2);
    // Neutral gray fill — never the community accent at any alpha.
    expect(style.backgroundColor).toBe('#EFEFEF');
    expect(String(style.backgroundColor).toLowerCase()).not.toContain(
      ACCENT.slice(1).toLowerCase()
    );
  });

  it('S3.5/S6: secondary info is right-aligned 13pt gray text, not a colored badge', () => {
    render(<EventsScreen />);

    const going = styleOf('12 going');
    expect(going.fontSize).toBe(WA_TYPE_FOOTNOTE);
    expect(going.color).not.toBe(ACCENT);
    // CWE totals ride the same slot.
    expect(screen.getByText('40 going')).toBeTruthy();
  });

  it('respects hideRsvpCount instead of showing a count the event opted out of', () => {
    mockData({ myEvents: [singleCard({ hideRsvpCount: true })] });
    render(<EventsScreen />);
    expect(screen.queryByText('12 going')).toBeNull();
  });

  it('S1.1: the List/Map switch is the floating neutral circle pair — no in-flow chips', () => {
    render(<EventsScreen />);

    // Owner directive 2026-07-30: chip rows are for FILTERS; the view toggle is
    // chrome, so it takes the same header circles the Groups tab draws.
    expect(screen.queryByTestId('wa-events-view-chips')).toBeNull();

    const circles = flattenAll(screen.toJSON()).filter(
      (s) =>
        s.width === WA_HEADER_CIRCLE_SIZE &&
        s.height === WA_HEADER_CIRCLE_SIZE &&
        s.borderRadius === WA_HEADER_CIRCLE_SIZE / 2
    );
    expect(circles).toHaveLength(2);
    // Neutral white, never a green fill — the active view reads from its glyph.
    expect(circles.every((s) => s.backgroundColor !== ACCENT)).toBe(true);

    // Still switches views, and the circles survive into map mode so the user
    // can switch back.
    fireEvent.press(screen.getByLabelText('Map view'));
    expect(screen.getByTestId('events-map-view')).toBeTruthy();
    expect(screen.getByLabelText('List view')).toBeTruthy();

    screen.unmount();
    (useWhatsappShell as jest.Mock).mockReturnValue(false);
    render(<EventsScreen />);
    expect(screen.queryByTestId('wa-events-view-chips')).toBeNull();
    expect(screen.getByLabelText('List view')).toBeTruthy(); // legacy floating toggle
  });

  it('shares the Groups tab’s header anatomy: 34pt large title over the circle pair', () => {
    render(<EventsScreen />);

    const title = styleOf('Events');
    expect(title.fontSize).toBe(WA_LARGE_TITLE_SIZE);
    // The greeting sits quietly UNDER the title on the 17/15 row scale, so the
    // title is the only large type on the screen.
    expect(styleOf('Hey Ada').fontSize).toBeLessThan(WA_LARGE_TITLE_SIZE);

    screen.unmount();
    (useWhatsappShell as jest.Mock).mockReturnValue(false);
    render(<EventsScreen />);
    // Flag-off has no large title at all — the legacy screen is header-less.
    expect(screen.queryByText('Events')).toBeNull();
  });

  it('keeps the greeting, restyled as a quiet left-aligned block with accent only on the action link', () => {
    render(<EventsScreen />);

    const hello = styleOf('Hey Ada');
    expect(hello.fontSize).toBe(WA_TYPE_ROW_TITLE);
    expect(hello.fontWeight).toBe('600');
    expect(hello.textAlign).toBeUndefined();

    const action = styleOf('Make plans');
    expect(action.color).toBe(ACCENT);
    expect(action.textDecorationLine).toBeUndefined();

    screen.unmount();
    (useWhatsappShell as jest.Mock).mockReturnValue(false);
    render(<EventsScreen />);
    const legacyHello = styleOf('Hey Ada');
    expect(legacyHello.fontSize).toBe(20);
    expect(legacyHello.textAlign).toBe('center');
    expect(styleOf('Make plans').textDecorationLine).toBe('underline');
  });

  it('S7: the empty state is a centered glyph + 17pt title + 15pt gray subtitle', () => {
    mockData({});
    render(<EventsScreen />);

    expect(styleOf('No upcoming events').fontSize).toBe(WA_TYPE_ROW_TITLE);
    expect(styleOf('Check back later or create one yourself.').fontSize).toBe(WA_TYPE_SUBTITLE);

    screen.unmount();
    (useWhatsappShell as jest.Mock).mockReturnValue(false);
    render(<EventsScreen />);
    expect(styleOf('No upcoming events').fontSize).toBe(18);
    expect(styleOf('Check back later or create one yourself.').fontSize).toBe(14);
  });

  it('S6: flag-on rows are full-bleed (WaRow owns the leading inset); flag-off keeps its card gutter', () => {
    render(<EventsScreen />);
    const waList = screen.UNSAFE_getAllByType(ScrollView)[0];
    expect(
      StyleSheet.flatten(waList.props.contentContainerStyle).paddingHorizontal
    ).toBe(0);

    screen.unmount();
    (useWhatsappShell as jest.Mock).mockReturnValue(false);
    render(<EventsScreen />);
    const legacyList = screen.UNSAFE_getAllByType(ScrollView)[0];
    expect(
      StyleSheet.flatten(legacyList.props.contentContainerStyle).paddingHorizontal
    ).toBe(16);
  });

  it('§7.4: Create Event stays the single green CTA pill on both paths', () => {
    render(<EventsScreen />);
    const cta = screen.getByText('Create Event');
    expect(cta).toBeTruthy();
    fireEvent.press(cta);
    expect(mockPush).toHaveBeenCalledWith('/(user)/create-event');
  });

  it('flag-on the CTA is the shared kit pill, floating clear of the tab island', () => {
    render(<EventsScreen />);
    const pill = StyleSheet.flatten(screen.getByTestId('wa-events-create').props.style);
    expect(pill.height).toBe(WA_FLOATING_CTA_HEIGHT);
    expect(pill.borderRadius).toBe(WA_FLOATING_CTA_HEIGHT / 2);
    expect(pill.backgroundColor).toBe(ACCENT);

    const wrap = StyleSheet.flatten(
      screen.getByTestId('wa-events-create-wrap').props.style
    );
    expect(wrap.bottom).toBe(waFloatingCtaBottomOffset(0));
    expect(wrap.bottom).toBeGreaterThan(waTabBarBottomOffset(0) + WA_TAB_ISLAND_HEIGHT);

    // …and it stays the screen's ONLY accent-filled surface.
    const accentFilled = flattenAll(screen.toJSON()).filter(
      (s) => s.backgroundColor === ACCENT
    );
    expect(accentFilled).toHaveLength(1);

    // Flag-off keeps the legacy container (no kit pill at all).
    screen.unmount();
    (useWhatsappShell as jest.Mock).mockReturnValue(false);
    render(<EventsScreen />);
    expect(screen.queryByTestId('wa-events-create')).toBeNull();
    expect(screen.getByText('Create Event')).toBeTruthy();
  });

  it('flag-on pads the list so the last row clears both the island and the CTA', () => {
    render(<EventsScreen />);
    const list = screen.UNSAFE_getAllByType(ScrollView)[0];
    expect(
      StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom
    ).toBe(WA_FLOATING_CTA_CONTENT_CLEARANCE);

    screen.unmount();
    (useWhatsappShell as jest.Mock).mockReturnValue(false);
    render(<EventsScreen />);
    const legacyList = screen.UNSAFE_getAllByType(ScrollView)[0];
    expect(
      StyleSheet.flatten(legacyList.props.contentContainerStyle).paddingBottom
    ).toBe(120);
  });

  it('rows keep navigating to the event, and CWE rows keep opening the children sheet', () => {
    render(<EventsScreen />);
    fireEvent.press(screen.getByText('Sunday Service'));
    expect(mockPush).toHaveBeenCalledWith('/e/abc123?source=app');
  });

  it('flag-off still renders the legacy tiles/rows, and flag-on renders neither', () => {
    render(<EventsScreen />);
    expect(screen.queryByTestId('legacy-featured-tile')).toBeNull();
    expect(screen.queryByTestId('legacy-event-card-row')).toBeNull();
    expect(screen.getAllByTestId('wa-event-row').length).toBe(3);

    screen.unmount();
    (useWhatsappShell as jest.Mock).mockReturnValue(false);
    render(<EventsScreen />);
    expect(screen.getByTestId('legacy-featured-tile')).toBeTruthy();
    expect(screen.getByTestId('legacy-event-card-row')).toBeTruthy();
    expect(screen.queryAllByTestId('wa-event-row').length).toBe(0);
  });
});

describe('EventsScreen — no community context ("My RSVPs" fallback)', () => {
  const rsvpEvent = {
    id: 'meeting-9',
    shortId: 'rsvp99',
    title: 'Community Dinner',
    scheduledAt: '2026-07-30T23:00:00.000Z',
    coverImage: null,
    group: { name: 'Uptown Group', image: null },
    community: { name: 'Other Church' },
    rsvpStatus: { optionLabel: 'Going' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);
    (useWhatsappShell as jest.Mock).mockReturnValue(true);
    mockData({});
    (useMyRsvpedEvents as jest.Mock).mockReturnValue({
      data: { events: [rsvpEvent] },
      isLoading: false,
    });
    jest
      .spyOn(require('@providers/AuthProvider'), 'useAuth')
      .mockReturnValue({
        community: null,
        user: { id: 'user-1', first_name: 'Ada', timezone: 'America/New_York' },
      } as any);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('flag-on: shadowed cards + accent date + tinted RSVP chip become WA rows', () => {
    render(<EventsScreen />);

    const title = styleOf('Community Dinner');
    expect(title.fontSize).toBe(WA_TYPE_ROW_TITLE);
    expect(styleOf('Tomorrow 7:00 PM · Uptown Group · Other Church').fontSize).toBe(
      WA_TYPE_SUBTITLE
    );

    // The RSVP label is right-aligned gray footnote text, not an accent-tinted pill.
    const status = styleOf('Going');
    expect(status.fontSize).toBe(WA_TYPE_FOOTNOTE);
    expect(status.color).not.toBe(ACCENT);
  });

  it('flag-off: the legacy card layout is untouched (accent date line + tinted chip)', () => {
    (useWhatsappShell as jest.Mock).mockReturnValue(false);
    render(<EventsScreen />);

    expect(styleOf('Community Dinner').fontSize).toBe(16);
    expect(styleOf('Going').fontSize).toBe(12);
    // Legacy accent-colored date line survives.
    const dateNode = screen.getByText(/Thu, Jul 30/);
    expect(StyleSheet.flatten(dateNode.props.style).color).toBe(ACCENT);
  });
});
