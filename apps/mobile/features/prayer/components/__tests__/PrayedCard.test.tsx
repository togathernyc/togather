/**
 * PrayedCard + PrayedPrayerRail — the whatsapp-shell skin.
 *
 * The rail's bordered 13pt mini-cards and its white-on-green "Answered" chip
 * are exactly the pattern §7 bans (colored taxonomy chips, cards with their own
 * border/shadow language). Flag-on they become flat 24pt-radius cards on the S7
 * scale with neutral gray status capsules; flag-off nothing moves.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { PrayedCard } from '../PrayedCard';
import { PrayedPrayerRail } from '../PrayedPrayerRail';
import { useAuthenticatedQuery } from '@services/api/convex';

jest.mock('@services/api/convex', () => ({
  api: { functions: { prayers: { myPrayedFor: 'myPrayedFor' } } },
  useAuthenticatedQuery: jest.fn(),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
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

const ANSWERED = {
  id: 'prayer-1',
  bodyText: 'Pray for my brother, he starts treatment on Monday.',
  status: 'answered' as const,
  authorDisplayName: 'Sarah M.',
  prayedAt: Date.now() - 86_400_000,
  hasNewUpdate: true,
  crisisFlag: false,
};

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

beforeEach(() => {
  (useAuthenticatedQuery as jest.Mock).mockReturnValue([ANSWERED]);
});

afterEach(() => {
  mockWhatsappShell = false;
  jest.clearAllMocks();
});

describe('PrayedCard — flag off (unchanged)', () => {
  it('keeps the 240pt bordered 14pt-radius rail card', () => {
    const styles = hostStyles(
      render(<PrayedCard prayer={ANSWERED} onPress={jest.fn()} variant="rail" />) as any
    );
    const card = styles.find((s) => s.width === 240);
    expect(card).toBeDefined();
    expect(card!.borderRadius).toBe(14);
    expect(card!.borderWidth).toBeGreaterThan(0);
  });

  it('keeps the green "Answered" chip with white text', () => {
    const utils = render(
      <PrayedCard prayer={ANSWERED} onPress={jest.fn()} variant="rail" />
    );
    expect(flatten(utils.getByText('Answered').props.style).color).toBe('#fff');
    expect(
      hostStyles(utils as any).some((s) => s.backgroundColor === '#34C759')
    ).toBe(true);
  });

  it('keeps the 13pt name and the 13pt body', () => {
    const { getByText } = render(
      <PrayedCard prayer={ANSWERED} onPress={jest.fn()} variant="rail" />
    );
    expect(flatten(getByText('Sarah M.').props.style).fontSize).toBe(13);
    expect(flatten(getByText(ANSWERED.bodyText).props.style).fontSize).toBe(13);
  });
});

describe('PrayedCard — whatsapp-shell skin', () => {
  beforeEach(() => {
    mockWhatsappShell = true;
  });

  it('flattens the rail card: wider, 24pt radius, no border', () => {
    const styles = hostStyles(
      render(<PrayedCard prayer={ANSWERED} onPress={jest.fn()} variant="rail" />) as any
    );
    const card = styles.find((s) => s.width === 264);
    expect(card).toBeDefined();
    expect(card!.borderRadius).toBe(24);
    expect(card!.borderWidth).toBe(0);
  });

  it('flattens the list card too (24pt radius, no border)', () => {
    const styles = hostStyles(
      render(<PrayedCard prayer={ANSWERED} onPress={jest.fn()} variant="list" />) as any
    );
    const card = styles.find((s) => s.borderRadius === 24 && s.padding === 16);
    expect(card).toBeDefined();
    expect(card!.borderWidth).toBe(0);
  });

  it('renders "Answered" as a neutral gray capsule, never a green chip (§7)', () => {
    const utils = render(
      <PrayedCard prayer={ANSWERED} onPress={jest.fn()} variant="rail" />
    );
    const label = flatten(utils.getByText('Answered').props.style);
    expect(label.color).toBe('#666666');
    expect(label.fontSize).toBe(13);
    const styles = hostStyles(utils as any);
    expect(styles.some((s) => s.backgroundColor === '#34C759')).toBe(false);
    const capsule = styles.find((s) => s.height === 26 && s.borderRadius === 13);
    expect(capsule?.backgroundColor).toBe('#f5f5f5');
  });

  it('gives "Archived" the same neutral capsule — hue never carries meaning', () => {
    const utils = render(
      <PrayedCard
        prayer={{ ...ANSWERED, status: 'archived' }}
        onPress={jest.fn()}
        variant="rail"
      />
    );
    expect(flatten(utils.getByText('Archived').props.style).color).toBe('#666666');
    const capsule = hostStyles(utils as any).find(
      (s) => s.height === 26 && s.borderRadius === 13
    );
    expect(capsule?.backgroundColor).toBe('#f5f5f5');
  });

  it('puts name/body/meta on the 17/15/13 scale', () => {
    const { getByText } = render(
      <PrayedCard prayer={ANSWERED} onPress={jest.fn()} variant="rail" />
    );
    const name = flatten(getByText('Sarah M.').props.style);
    expect(name.fontSize).toBe(17);
    expect(name.fontWeight).toBe('600');
    expect(flatten(getByText(ANSWERED.bodyText).props.style).fontSize).toBe(15);
    expect(flatten(getByText('You prayed 1d ago').props.style).fontSize).toBe(13);
  });

  it('paints the update dot with the community accent, not iOS green (S5.1)', () => {
    const styles = hostStyles(
      render(<PrayedCard prayer={ANSWERED} onPress={jest.fn()} variant="rail" />) as any
    );
    const dot = styles.find((s) => s.width === 8 && s.height === 8);
    expect(dot?.backgroundColor).toBe('#25D366');
  });
});

describe('PrayedPrayerRail', () => {
  it('flag off: keeps the 14pt bold rail title and 13pt "See all"', () => {
    const { getByText } = render(<PrayedPrayerRail communityId={'c1' as never} />);
    const title = flatten(getByText("Prayers you've prayed").props.style);
    expect(title.fontSize).toBe(14);
    expect(title.fontWeight).toBe('700');
    expect(flatten(getByText('See all').props.style).fontSize).toBe(13);
  });

  it('flag on: sentence-case 20pt gray section header + 15pt accent link', () => {
    mockWhatsappShell = true;
    const { getByText } = render(<PrayedPrayerRail communityId={'c1' as never} />);
    const title = flatten(getByText("Prayers you've prayed").props.style);
    expect(title.fontSize).toBe(20);
    expect(title.fontWeight).toBe('600');
    expect(title.textTransform).toBeUndefined();
    expect(title.color).toBe('#666666');
    const seeAll = flatten(getByText('See all').props.style);
    expect(seeAll.fontSize).toBe(15);
    expect(seeAll.color).toBe('#25D366');
  });

  it('keeps the "See all" history affordance in both states', () => {
    const { getByLabelText } = render(<PrayedPrayerRail communityId={'c1' as never} />);
    expect(getByLabelText("See all prayers you've prayed for")).toBeTruthy();
    mockWhatsappShell = true;
    const wa = render(<PrayedPrayerRail communityId={'c1' as never} />);
    expect(wa.getByLabelText("See all prayers you've prayed for")).toBeTruthy();
  });
});
