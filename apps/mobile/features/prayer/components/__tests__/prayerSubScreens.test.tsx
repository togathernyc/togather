/**
 * MyPrayersScreen + PrayedHistoryScreen — the whatsapp-shell skin.
 *
 * Both are one hop off the Prayer tab (the header's "My prayers" circle and the
 * rail's "See all"). MyPrayersScreen carried the worst §7 violation in the
 * feature — a blue/orange/red/gray taxonomy-chip family — so flag-on every
 * badge becomes the same neutral gray capsule and the rows go flat. Flag-off
 * twins pin today's rendering.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { MyPrayersScreen } from '../MyPrayersScreen';
import { PrayedHistoryScreen } from '../PrayedHistoryScreen';
import { useAuthenticatedQuery } from '@services/api/convex';

jest.mock('@services/api/convex', () => ({
  api: {
    functions: {
      prayers: { myPrayers: 'myPrayers', myPrayedFor: 'myPrayedFor' },
    },
  },
  useAuthenticatedQuery: jest.fn(),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  Stack: { Screen: () => null },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@providers/AuthProvider', () => ({
  useAuth: () => ({ community: { id: 'community-1' } }),
}));

jest.mock('@hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      surface: '#ffffff',
      surfaceSecondary: '#f5f5f5',
      border: '#e0e0e0',
      text: '#1a1a1a',
      textSecondary: '#666666',
      textTertiary: '#999999',
      iconSecondary: '#bdbdc1',
    },
    isDark: false,
  }),
}));

jest.mock('@hooks/useCommunityTheme', () => ({
  useCommunityTheme: () => ({ primaryColor: '#25D366' }),
}));

let mockWhatsappShell = false;
jest.mock('@hooks/useWhatsappShell', () => ({
  useWhatsappShell: () => mockWhatsappShell,
}));

const MINE = [
  {
    id: 'prayer-1',
    bodyText: 'Pray for my brother, he starts treatment on Monday.',
    status: 'active',
    moderationStatus: 'pending_review',
    isAnonymous: true,
    crisisFlag: true,
    prayedForCount: 4,
  },
];

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

const hostStyles = (utils: { UNSAFE_root: any }): Record<string, unknown>[] =>
  utils.UNSAFE_root
    .findAll((node: any) => typeof node.type === 'string' && node.props?.style)
    .map((node: any) => flatten(node.props.style));

afterEach(() => {
  mockWhatsappShell = false;
  jest.clearAllMocks();
});

describe('MyPrayersScreen — flag off (unchanged)', () => {
  beforeEach(() => {
    (useAuthenticatedQuery as jest.Mock).mockReturnValue(MINE);
  });

  it('keeps the colored badge family and the bordered 12pt-radius row', () => {
    const utils = render(<MyPrayersScreen />);
    expect(flatten(utils.getByText('Awaiting admin').props.style).color).toBe('#fff');
    const styles = hostStyles(utils as any);
    expect(styles.some((s) => s.backgroundColor === '#FF9500')).toBe(true);
    expect(styles.some((s) => s.backgroundColor === '#C0392B')).toBe(true);
    const row = styles.find((s) => s.borderRadius === 12);
    expect(row?.borderWidth).toBeGreaterThan(0);
  });

  it('keeps the 15pt body and 11pt badge text', () => {
    const utils = render(<MyPrayersScreen />);
    expect(flatten(utils.getByText(MINE[0].bodyText).props.style).fontSize).toBe(15);
    expect(flatten(utils.getByText('Anonymous').props.style).fontSize).toBe(11);
  });
});

describe('MyPrayersScreen — whatsapp-shell skin', () => {
  beforeEach(() => {
    mockWhatsappShell = true;
    (useAuthenticatedQuery as jest.Mock).mockReturnValue(MINE);
  });

  it('collapses every taxonomy chip into one neutral gray capsule (§7)', () => {
    const utils = render(<MyPrayersScreen />);
    for (const label of ['Awaiting admin', 'Anonymous', 'Resource added']) {
      const style = flatten(utils.getByText(label).props.style);
      expect(style.color).toBe('#666666');
      expect(style.fontSize).toBe(13);
    }
    const styles = hostStyles(utils as any);
    // None of the old hues survive.
    for (const hue of ['#FF9500', '#C0392B', '#007AFF', '#34C759']) {
      expect(styles.some((s) => s.backgroundColor === hue)).toBe(false);
    }
    expect(
      styles.filter((s) => s.height === 26 && s.backgroundColor === '#f5f5f5').length
    ).toBe(3);
  });

  it('flattens the rows: 24pt radius, no border, 17pt body', () => {
    const utils = render(<MyPrayersScreen />);
    expect(flatten(utils.getByText(MINE[0].bodyText).props.style).fontSize).toBe(17);
    const row = hostStyles(utils as any).find(
      (s) => s.borderRadius === 24 && s.padding === 16
    );
    expect(row).toBeDefined();
    expect(row!.borderWidth).toBe(0);
  });

  it('renders the empty state on the 17pt/15pt scale, in a flat card', () => {
    (useAuthenticatedQuery as jest.Mock).mockReturnValue([]);
    const utils = render(<MyPrayersScreen />);
    expect(flatten(utils.getByText('No prayers yet').props.style).fontSize).toBe(17);
    expect(
      flatten(utils.getByText("When you post a prayer request, it'll show up here.").props.style)
        .fontSize
    ).toBe(15);
    const card = hostStyles(utils as any).find((s) => s.borderRadius === 24);
    expect(card!.borderWidth).toBe(0);
  });
});

describe('PrayedHistoryScreen', () => {
  beforeEach(() => {
    (useAuthenticatedQuery as jest.Mock).mockReturnValue([]);
  });

  it('flag off: keeps the 18pt empty-state title', () => {
    const { getByText } = render(<PrayedHistoryScreen />);
    expect(flatten(getByText('Nothing here yet').props.style).fontSize).toBe(18);
  });

  it('flag on: 17pt title + 15pt gray body', () => {
    mockWhatsappShell = true;
    const { getByText } = render(<PrayedHistoryScreen />);
    expect(flatten(getByText('Nothing here yet').props.style).fontSize).toBe(17);
    expect(
      flatten(
        getByText(
          'Prayers you pray for in your community will show up here so you can revisit them.'
        ).props.style
      ).fontSize
    ).toBe(15);
  });
});
