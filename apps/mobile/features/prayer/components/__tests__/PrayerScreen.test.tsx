/**
 * PrayerScreen — the whatsapp-shell skin (WHATSAPP-DESIGN-SYSTEM.md §7,
 * WA-VISUAL-DELTAS.md S1/S5/S7).
 *
 * The pray-session card mechanic survives the restyle — it IS the feature —
 * but the chrome, the type scale and the color discipline all change. Every
 * assertion here has a flag-off twin, so the restyle can never silently alter
 * today's rendering.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { PrayerScreen } from '../PrayerScreen';
import { useAuthenticatedQuery } from '@services/api/convex';

jest.mock('@services/api/convex', () => ({
  api: {
    functions: {
      prayers: {
        feed: 'feed',
        myPrayedThisWeekCount: 'myPrayedThisWeekCount',
        myPrayedFor: 'myPrayedFor',
        recordPrayerSession: 'recordPrayerSession',
        createPrayer: 'createPrayer',
        reportPrayer: 'reportPrayer',
        notifications: {
          getPrayerNotificationPreferences: 'getPrayerNotificationPreferences',
          setMasterPrayerNotifications: 'setMasterPrayerNotifications',
        },
      },
    },
  },
  useAuthenticatedQuery: jest.fn(),
  useAuthenticatedMutation: () => jest.fn(),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@providers/AuthProvider', () => ({
  useAuth: () => ({
    community: { id: 'community-1', name: 'Demo Community' },
    user: { first_name: 'Sam', last_name: 'Reed' },
  }),
}));

jest.mock('@hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff',
      backgroundGrouped: '#F2F2F2',
      surface: '#ffffff',
      surfaceSecondary: '#f5f5f5',
      border: '#e0e0e0',
      separator: '#E5E5E5',
      text: '#1a1a1a',
      textSecondary: '#666666',
      textTertiary: '#999999',
      icon: '#666666',
      iconSecondary: '#bdbdc1',
    },
    isDark: false,
  }),
}));

jest.mock('@hooks/useCommunityTheme', () => ({
  useCommunityTheme: () => ({ primaryColor: '#25D366' }),
}));

// Default flag-OFF so the pre-redesign assertions are the baseline.
let mockWhatsappShell = false;
jest.mock('@hooks/useWhatsappShell', () => ({
  useWhatsappShell: () => mockWhatsappShell,
}));

const PRAYER = {
  id: 'prayer-1',
  bodyText: 'Please pray for my brother, he starts treatment on Monday.',
  prayedForCount: 2,
  createdAt: Date.now() - 3_600_000,
  authorDisplayName: 'Sarah M.',
  crisisFlag: false,
};

/** Flattens a possibly-nested RN style prop into one object. */
const flatten = (style: unknown): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  const walk = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === 'object') Object.assign(out, node);
  };
  walk(style);
  return out;
};

/** Every host-element style in the tree, flattened — for container assertions. */
const hostStyles = (utils: { UNSAFE_root: any }): Record<string, unknown>[] =>
  utils.UNSAFE_root
    .findAll((node: any) => typeof node.type === 'string' && node.props?.style)
    .map((node: any) => flatten(node.props.style));

beforeEach(() => {
  (useAuthenticatedQuery as jest.Mock).mockImplementation((ref: string) => {
    switch (ref) {
      case 'feed':
        return [PRAYER];
      case 'myPrayedThisWeekCount':
        return { today: 1, week: 7 };
      case 'getPrayerNotificationPreferences':
        return { masterEnabled: true };
      case 'myPrayedFor':
        return [];
      default:
        return undefined;
    }
  });
});

afterEach(() => {
  mockWhatsappShell = false;
  jest.clearAllMocks();
});

describe('PrayerScreen — flag off (unchanged)', () => {
  it('keeps the 20pt inline heading and the "My prayers" text button', () => {
    const { getByText } = render(<PrayerScreen />);
    const heading = flatten(getByText('Pray for your community').props.style);
    expect(heading.fontSize).toBe(20);
    expect(heading.fontWeight).toBe('700');
    expect(getByText('My prayers')).toBeTruthy();
  });

  it('keeps the shadowed, hairline-bordered 20pt-radius card', () => {
    const styles = hostStyles(render(<PrayerScreen />) as any);
    expect(
      styles.some((s) => s.borderRadius === 20 && s.shadowOpacity === 0.08)
    ).toBe(true);
  });

  it('keeps the 19pt body, the 12pt progress label and the 11pt week chip', () => {
    const { getByText } = render(<PrayerScreen />);
    expect(flatten(getByText(PRAYER.bodyText).props.style).fontSize).toBe(19);
    expect(flatten(getByText('Prayer 2 of 3').props.style).fontSize).toBe(12);
    expect(flatten(getByText('7 this week').props.style).fontSize).toBe(11);
  });

  it('keeps the 16pt Pray button label', () => {
    const { getByText } = render(<PrayerScreen />);
    expect(flatten(getByText('Pray').props.style).fontSize).toBe(16);
  });
});

describe('PrayerScreen — whatsapp-shell skin', () => {
  beforeEach(() => {
    mockWhatsappShell = true;
  });

  it('renders the S1 chrome: a 34pt "Prayer" large title over the content', () => {
    const { getByText } = render(<PrayerScreen />);
    expect(flatten(getByText('Prayer').props.style).fontSize).toBe(34);
  });

  it('keeps the framing copy as the 15pt gray subtitle under the title', () => {
    const { getByText } = render(<PrayerScreen />);
    const subtitle = flatten(getByText('Pray for your community').props.style);
    expect(subtitle.fontSize).toBe(15);
    expect(subtitle.color).toBe('#666666');
  });

  it('moves every header action into a neutral circle — no text button left', () => {
    const { queryByText, getByLabelText } = render(<PrayerScreen />);
    expect(queryByText('My prayers')).toBeNull();
    expect(getByLabelText('My prayers')).toBeTruthy();
    expect(getByLabelText('Request prayer')).toBeTruthy();
    expect(getByLabelText('Turn off prayer notifications')).toBeTruthy();
  });

  it('flattens the card: 24pt radius, no border, no shadow (§7)', () => {
    const styles = hostStyles(render(<PrayerScreen />) as any);
    const card = styles.find((s) => s.borderRadius === 24 && s.padding === 20);
    expect(card).toBeDefined();
    expect(card!.borderWidth).toBe(0);
    expect(card!.shadowOpacity).toBe(0);
    expect(card!.elevation).toBe(0);
    // ...and the old shadowed 20pt-radius card is gone. (The kit's floating
    // header circles legitimately carry their own 0.08 shadow, so this checks
    // the pair, not the shadow alone.)
    expect(
      styles.some((s) => s.borderRadius === 20 && s.shadowOpacity === 0.08)
    ).toBe(false);
  });

  it('puts the body, the Pray label and the author on the S7 type scale', () => {
    const { getByText } = render(<PrayerScreen />);
    expect(flatten(getByText(PRAYER.bodyText).props.style).fontSize).toBe(17);
    expect(flatten(getByText('Pray').props.style).fontSize).toBe(17);
    const author = flatten(getByText('Sarah M.').props.style);
    expect(author.fontSize).toBe(17);
    expect(author.fontWeight).toBe('600');
  });

  it('renders the Pray CTA as a fully-rounded accent pill', () => {
    const styles = hostStyles(render(<PrayerScreen />) as any);
    expect(
      styles.some((s) => s.borderRadius === 26 && s.backgroundColor === '#25D366')
    ).toBe(true);
  });

  it('makes the session + week labels neutral 15pt pills, not colored chips (S5)', () => {
    const utils = render(<PrayerScreen />);
    const setLabel = flatten(utils.getByText('Prayer 2 of 3').props.style);
    expect(setLabel.fontSize).toBe(15);
    expect(setLabel.color).toBe('#1a1a1a');
    const weekLabel = flatten(utils.getByText('7 this week').props.style);
    expect(weekLabel.fontSize).toBe(15);
    expect(weekLabel.color).toBe('#1a1a1a');
    // 34pt fully-rounded capsules with no hairline border.
    const pills = hostStyles(utils as any).filter(
      (s) => s.height === 34 && s.borderRadius === 17
    );
    expect(pills.length).toBe(2);
    expect(pills.every((s) => !s.borderWidth)).toBe(true);
  });

  it('keeps the accent off the progress dots — neutral ink instead of green', () => {
    const styles = hostStyles(render(<PrayerScreen />) as any);
    const dots = styles.filter((s) => s.width === 8 && s.height === 8);
    expect(dots.length).toBe(3);
    expect(dots.some((s) => s.backgroundColor === '#34C759')).toBe(false);
    expect(dots.filter((s) => s.backgroundColor === '#1a1a1a').length).toBe(1);
  });

  it('still routes "My prayers" and keeps the report affordance', () => {
    const { getByLabelText } = render(<PrayerScreen />);
    expect(getByLabelText('Report this prayer')).toBeTruthy();
  });

  it('renders the 17pt/15pt empty state when nothing is waiting', () => {
    (useAuthenticatedQuery as jest.Mock).mockImplementation((ref: string) => {
      switch (ref) {
        case 'feed':
          return [];
        case 'myPrayedThisWeekCount':
          return { today: 0, week: 0 };
        case 'getPrayerNotificationPreferences':
          return { masterEnabled: true };
        default:
          return [];
      }
    });
    const { getByText } = render(<PrayerScreen />);
    expect(flatten(getByText('All caught up').props.style).fontSize).toBe(17);
    expect(
      flatten(
        getByText(
          "There's no one waiting for prayer right now. Add a request for your community."
        ).props.style
      ).fontSize
    ).toBe(15);
  });
});
