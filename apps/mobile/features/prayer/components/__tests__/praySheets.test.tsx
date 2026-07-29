/**
 * PraySession + AddPrayerSheet — the whatsapp-shell skin.
 *
 * These two modals are the pray-flow's visible chrome from the Prayer tab, so
 * they move onto the S7 type scale and take WhatsApp's sheet anatomy (§6): drag
 * handle, centered 17pt title, X-in-circle dismiss, fill-only input, accent CTA
 * as a fully-rounded pill. Flag-off assertions pin today's rendering.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { PraySession } from '../PraySession';
import { AddPrayerSheet } from '../AddPrayerSheet';

jest.mock('@services/api/convex', () => ({
  api: {
    functions: {
      prayers: {
        recordPrayerSession: 'recordPrayerSession',
        createPrayer: 'createPrayer',
      },
    },
  },
  useAuthenticatedMutation: () => jest.fn(),
}));

jest.mock('@providers/AuthProvider', () => ({
  useAuth: () => ({
    community: { id: 'community-1' },
    user: { first_name: 'Sam', last_name: 'Reed' },
  }),
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
      inputBackground: '#f5f5f5',
      inputBorder: '#e0e0e0',
      inputPlaceholder: '#999999',
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

const PRAYER = {
  id: 'prayer-1' as never,
  bodyText: 'Pray for my brother, he starts treatment on Monday.',
  prayedForCount: 2,
  createdAt: Date.now(),
  authorDisplayName: 'Sarah M.',
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

afterEach(() => {
  mockWhatsappShell = false;
  jest.clearAllMocks();
});

const renderSession = () =>
  render(
    <PraySession prayer={PRAYER} visible onClose={jest.fn()} onPrayed={jest.fn()} />
  );

describe('PraySession — flag off (unchanged)', () => {
  it('keeps the 20pt title, 16pt body, 36pt timer and 12pt-radius CTA', () => {
    const utils = renderSession();
    expect(flatten(utils.getByText('Praying').props.style).fontSize).toBe(20);
    expect(flatten(utils.getByText(PRAYER.bodyText).props.style).fontSize).toBe(16);
    expect(flatten(utils.getByText('3:00').props.style).fontSize).toBe(36);
    expect(flatten(utils.getByText('I prayed, mark done').props.style).fontSize).toBe(16);
    expect(hostStyles(utils as any).some((s) => s.borderRadius === 12)).toBe(true);
  });
});

describe('PraySession — whatsapp-shell skin', () => {
  beforeEach(() => {
    mockWhatsappShell = true;
  });

  it('moves the sheet onto the S7 scale (22pt header block, 17pt body)', () => {
    const utils = renderSession();
    const title = flatten(utils.getByText('Praying').props.style);
    expect(title.fontSize).toBe(22);
    expect(title.fontWeight).toBe('700');
    expect(flatten(utils.getByText(PRAYER.bodyText).props.style).fontSize).toBe(17);
  });

  it('sets the timer numeral at the 34pt heavy large-title size', () => {
    const timer = flatten(renderSession().getByText('3:00').props.style);
    expect(timer.fontSize).toBe(34);
    expect(timer.fontWeight).toBe('800');
  });

  it('renders the done CTA as a fully-rounded 17pt accent pill', () => {
    const utils = renderSession();
    expect(flatten(utils.getByText('I prayed, mark done').props.style).fontSize).toBe(17);
    expect(
      hostStyles(utils as any).some(
        (s) => s.borderRadius === 26 && s.backgroundColor === '#25D366'
      )
    ).toBe(true);
  });

  it('rounds the sheet to the WA card radius', () => {
    expect(
      hostStyles(renderSession() as any).some((s) => s.borderRadius === 24)
    ).toBe(true);
  });
});

describe('AddPrayerSheet — flag off (unchanged)', () => {
  it('keeps the 18pt leading-aligned title and the bordered 12pt-radius input', () => {
    const utils = render(
      <AddPrayerSheet visible onClose={jest.fn()} onPosted={jest.fn()} />
    );
    const title = flatten(utils.getByText('Share a prayer request').props.style);
    expect(title.fontSize).toBe(18);
    expect(title.textAlign).toBeUndefined();
    const input = hostStyles(utils as any).find((s) => s.minHeight === 120);
    expect(input?.borderWidth).toBe(1);
    expect(input?.borderRadius).toBe(12);
    expect(flatten(utils.getByText('Post Prayer').props.style).fontSize).toBe(16);
  });
});

describe('AddPrayerSheet — whatsapp-shell skin', () => {
  beforeEach(() => {
    mockWhatsappShell = true;
  });

  it('adopts §6 sheet anatomy: drag handle + centered 17pt title + X circle', () => {
    const utils = render(
      <AddPrayerSheet visible onClose={jest.fn()} onPosted={jest.fn()} />
    );
    const title = flatten(utils.getByText('Share a prayer request').props.style);
    expect(title.fontSize).toBe(17);
    expect(title.fontWeight).toBe('600');
    expect(title.textAlign).toBe('center');
    const styles = hostStyles(utils as any);
    // 36x5 drag handle...
    expect(styles.some((s) => s.width === 36 && s.height === 5)).toBe(true);
    // ...and the 36pt circular dismiss.
    expect(styles.some((s) => s.width === 36 && s.borderRadius === 18)).toBe(true);
    expect(utils.getByLabelText('Close')).toBeTruthy();
  });

  it('makes the composer field fill-only (no hairline border)', () => {
    const input = hostStyles(
      render(<AddPrayerSheet visible onClose={jest.fn()} onPosted={jest.fn()} />) as any
    ).find((s) => s.minHeight === 120);
    expect(input?.borderWidth).toBe(0);
    expect(input?.borderRadius).toBe(18);
    expect(input?.fontSize).toBe(17);
  });

  it('renders the post CTA as a fully-rounded 17pt accent pill', () => {
    const utils = render(
      <AddPrayerSheet visible onClose={jest.fn()} onPosted={jest.fn()} />
    );
    expect(flatten(utils.getByText('Post Prayer').props.style).fontSize).toBe(17);
    expect(
      hostStyles(utils as any).some(
        (s) => s.borderRadius === 26 && s.backgroundColor === '#25D366'
      )
    ).toBe(true);
  });

  it('keeps the anonymity affordance and its preview line', () => {
    const utils = render(
      <AddPrayerSheet visible onClose={jest.fn()} onPosted={jest.fn()} />
    );
    expect(flatten(utils.getByText('Post anonymously').props.style).fontSize).toBe(17);
    expect(utils.getByText('Shown as: Sam R.')).toBeTruthy();
  });
});
