/**
 * EventLinkCard — WhatsApp-shell anatomy (WHATSAPP-DESIGN-SYSTEM.md §7).
 *
 * §7 requires an in-thread event card to *be a bubble*: same fill as the
 * message bubbles around it, a compact banner rather than a poster, and an
 * RSVP pill row docked at the bottom — "never a separate attachment card
 * component with its own shadow/border language."
 *
 * The flag lives in `MessageItem`; this component receives it as the presence
 * of the `wa` prop, so these tests drive both shells by passing / omitting it.
 * The final block is the flag-off twin: it asserts the pre-WhatsApp card is
 * still rendered verbatim, which is the guarantee the rollout depends on.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { EventLinkCard } from '../EventLinkCard';
import { WA_CARD_COVER_ASPECT, WA_CARD_PILL_HEIGHT } from '../../waChatChrome';
import { api } from '@services/api/convex';

const mockUseQuery = jest.fn();
const mockSubmitRsvp = jest.fn();
const mockPush = jest.fn();

jest.mock('@services/api/convex', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: jest.fn(() => mockSubmitRsvp),
  useStoredAuthToken: jest.fn(() => 'mock-token'),
  api: {
    functions: {
      meetings: {
        index: {
          getByShortId: 'api.functions.meetings.index.getByShortId',
        },
      },
      meetingRsvps: {
        list: 'api.functions.meetingRsvps.list',
        myRsvp: 'api.functions.meetingRsvps.myRsvp',
        submit: 'api.functions.meetingRsvps.submit',
      },
    },
  },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@components/ui/Avatar', () => ({
  Avatar: () => null,
}));

// Surfaces the cover's resolved style so the banner-vs-poster crop is testable.
jest.mock('@components/ui/AppImage', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return {
    AppImage: (props: { style?: unknown }) =>
      ReactLocal.createElement(View, { testID: 'event-cover', style: props.style }),
  };
});

jest.mock('@/providers/ImageViewerProvider', () => ({
  ImageViewerManager: { show: jest.fn() },
}));

jest.mock('../../utils/imageActions', () => ({
  handleImageLongPress: jest.fn(),
  handleEventLongPress: jest.fn(),
  copyEventLink: jest.fn(() => Promise.resolve()),
}));

/** The pale-blue tint §7 bans on the flag-on card, kept flag-off. */
const LEGACY_TINTED_BODY = '#DCEEFF';

const WA_THEME = { accent: '#1E8449', bubbleFill: '#D9FDD3' };

const RSVP_OPTIONS = [
  { id: 1, label: 'Going', enabled: true },
  { id: 2, label: 'Maybe', enabled: true },
  { id: 3, label: "Can't Go", enabled: true },
];

const fullEventData = {
  id: 'meeting-1',
  shortId: 'evt123',
  title: 'Planning Night',
  scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  coverImage: 'covers/planning.jpg',
  locationOverride: 'Main Hall',
  meetingType: 1,
  rsvpEnabled: true,
  rsvpOptions: RSVP_OPTIONS,
  groupName: 'Core Team',
  communityName: 'Demo Community',
  hasAccess: true,
  status: 'scheduled',
};

function mockQueries({
  myRsvp = { optionId: null },
  goingCount = 3,
}: {
  myRsvp?: Record<string, unknown> | null;
  goingCount?: number;
} = {}) {
  mockUseQuery.mockImplementation((queryName: unknown, args: unknown) => {
    if (queryName === api.functions.meetings.index.getByShortId) {
      return args === 'skip' ? undefined : fullEventData;
    }
    if (queryName === api.functions.meetingRsvps.list) {
      return {
        total: goingCount,
        limitedAccess: true,
        rsvps: [
          { option: RSVP_OPTIONS[0], count: goingCount, users: [] },
          { option: RSVP_OPTIONS[1], count: 0, users: [] },
          { option: RSVP_OPTIONS[2], count: 0, users: [] },
        ],
      };
    }
    if (queryName === api.functions.meetingRsvps.myRsvp) {
      return myRsvp;
    }
    return undefined;
  });
}

/** Every color literal anywhere in the rendered tree. */
function renderedColors(tree: unknown): string {
  return JSON.stringify(tree);
}

function flatStyle(node: { props: { style?: unknown } }): Record<string, unknown> {
  return (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSubmitRsvp.mockResolvedValue(undefined);
});

describe('EventLinkCard — WhatsApp shell (flag-on)', () => {
  it('renders as a bubble: message fill, no tinted body, 16:9 banner', () => {
    mockQueries();

    const { getByTestId, toJSON } = render(
      <EventLinkCard shortId="evt123" wa={WA_THEME} />
    );

    // §7: the card takes the message's own bubble fill, and the §7-banned
    // pale-blue tinted panel is gone from the tree entirely.
    expect(renderedColors(toJSON())).toContain(WA_THEME.bubbleFill);
    expect(renderedColors(toJSON())).not.toContain(LEGACY_TINTED_BODY);

    // Compact banner, not the natural-ratio (1:1 default) poster.
    expect(flatStyle(getByTestId('event-cover')).aspectRatio).toBe(WA_CARD_COVER_ASPECT);
  });

  it('collapses the three RSVP rows into one 32pt pill row with inline counts', () => {
    mockQueries({ goingCount: 3 });

    const { getByTestId, getByText, queryByText } = render(
      <EventLinkCard shortId="evt123" wa={WA_THEME} />
    );

    expect(getByTestId('wa-rsvp-pill-1')).toBeTruthy();
    expect(getByTestId('wa-rsvp-pill-2')).toBeTruthy();
    expect(getByTestId('wa-rsvp-pill-3')).toBeTruthy();
    expect(flatStyle(getByTestId('wa-rsvp-pill-1')).height).toBe(WA_CARD_PILL_HEIGHT);

    // Count rides inline in the label when > 0; zero-count options stay bare.
    expect(getByText('Going 👍 3')).toBeTruthy();
    expect(getByText('Maybe 🤔')).toBeTruthy();
    expect(getByText("Can't Go 😢")).toBeTruthy();

    // The full-height row anatomy (label + separate numeric count column) is gone.
    expect(queryByText('Going 👍')).toBeNull();
  });

  it('gives the viewer’s selected pill the pale accent tint and accent ink', () => {
    mockQueries({ myRsvp: { optionId: 2, guestCount: 0 } });

    const { getByTestId, getByText } = render(
      <EventLinkCard shortId="evt123" wa={WA_THEME} />
    );

    const selectedFill = flatStyle(getByTestId('wa-rsvp-pill-2')).backgroundColor;
    const unselectedFill = flatStyle(getByTestId('wa-rsvp-pill-1')).backgroundColor;

    // §1.6: a pale wash of the accent, never the accent itself.
    expect(selectedFill).toBe('rgba(30, 132, 73, 0.18)');
    expect(selectedFill).not.toBe(WA_THEME.accent);
    expect(unselectedFill).not.toBe(selectedFill);

    expect(flatStyle(getByText('Maybe 🤔')).color).toBe(WA_THEME.accent);
    expect(flatStyle(getByText('Going 👍 3')).color).not.toBe(WA_THEME.accent);
  });

  it('passes RSVP taps through to the same mutation, clearing guests on a switch', async () => {
    mockQueries({ myRsvp: { optionId: 1, guestCount: 2 } });

    const { getByTestId } = render(<EventLinkCard shortId="evt123" wa={WA_THEME} />);

    await act(async () => {
      fireEvent.press(getByTestId('wa-rsvp-pill-3'));
    });

    expect(mockSubmitRsvp).toHaveBeenCalledWith({
      token: 'mock-token',
      meetingId: 'meeting-1',
      optionId: 3,
      guestCount: 0,
    });
  });

  it('preserves plus-ones when the viewer re-taps the option they already picked', async () => {
    mockQueries({ myRsvp: { optionId: 1, guestCount: 2 } });

    const { getByTestId } = render(<EventLinkCard shortId="evt123" wa={WA_THEME} />);

    await act(async () => {
      fireEvent.press(getByTestId('wa-rsvp-pill-1'));
    });

    expect(mockSubmitRsvp).toHaveBeenCalledWith({
      token: 'mock-token',
      meetingId: 'meeting-1',
      optionId: 1,
      guestCount: 2,
    });
  });

  it('keeps both footer actions as accent text links', async () => {
    mockQueries();

    const { getByText } = render(<EventLinkCard shortId="evt123" wa={WA_THEME} />);

    const copyLink = getByText('Copy link');
    const viewDetails = getByText('View details');
    expect(flatStyle(copyLink).color).toBe(WA_THEME.accent);
    expect(flatStyle(viewDetails).color).toBe(WA_THEME.accent);

    await act(async () => {
      fireEvent.press(viewDetails);
    });
    expect(mockPush).toHaveBeenCalledWith('/e/evt123?source=app');

    await act(async () => {
      fireEvent.press(copyLink);
    });
    const { copyEventLink } = require('../../utils/imageActions');
    expect(copyEventLink).toHaveBeenCalledWith('evt123');
  });
});

describe('EventLinkCard — flag-off twin', () => {
  it('keeps the tinted body, the full RSVP rows and the natural cover crop', () => {
    mockQueries({ goingCount: 3 });

    const { getByText, getByTestId, queryByTestId, toJSON } = render(
      <EventLinkCard shortId="evt123" />
    );

    // The pale-blue panel and its 1:1 poster crop are untouched flag-off.
    expect(renderedColors(toJSON())).toContain(LEGACY_TINTED_BODY);
    expect(flatStyle(getByTestId('event-cover')).aspectRatio).toBe(1);

    // Full-height radio rows, each with its own numeric count — no pills.
    expect(queryByTestId('wa-rsvp-pill-1')).toBeNull();
    expect(getByText('Going 👍')).toBeTruthy();
    expect(getByText('Maybe 🤔')).toBeTruthy();
    expect(getByText("Can't Go 😢")).toBeTruthy();
    expect(getByText('3')).toBeTruthy();

    // Legacy footer casing.
    expect(getByText('View Details')).toBeTruthy();
  });
});
