/**
 * Unit tests for the fallback-avatar palette (WA-VISUAL-DELTAS.md S5.2).
 */
import {
  waAvatarHash,
  waAvatarHue,
  waAvatarPalette,
  waNeutralAvatarPalette,
  waAvatarInitials,
} from '../waAvatarColor';

/** Pull the `hsl(h, s%, l%)` numbers back out for assertions. */
function parseHsl(value: string): { h: number; s: number; l: number } {
  const match = value.match(/hsl\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)%,\s*(\d+(?:\.\d+)?)%\)/);
  if (!match) throw new Error(`not an hsl() color: ${value}`);
  return { h: Number(match[1]), s: Number(match[2]), l: Number(match[3]) };
}

describe('waAvatarHash', () => {
  it('is deterministic for the same seed', () => {
    expect(waAvatarHash('k1739abcdef')).toBe(waAvatarHash('k1739abcdef'));
  });

  it('differs for different seeds', () => {
    expect(waAvatarHash('alpha')).not.toBe(waAvatarHash('beta'));
  });

  it('stays a non-negative 32-bit integer', () => {
    for (const seed of ['', 'a', 'jd7abc', 'éè', 'x'.repeat(200)]) {
      const hash = waAvatarHash(seed);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('waAvatarHue', () => {
  it('spreads ids that share a long prefix across the wheel', () => {
    // The failure this guards: Convex ids for sibling rows differ only near
    // the end, and an un-avalanched FNV hash mapped them onto *adjacent*
    // hues — every avatar on the seeded Chats list came out purple.
    const ids = Array.from({ length: 12 }, (_, i) => `jd7bp2h9q4k5m3n8xyz${i}`);
    const hues = new Set(ids.map(waAvatarHue));
    expect(hues.size).toBeGreaterThanOrEqual(6);
  });

  it('never lands on WhatsApp green or iOS destructive red', () => {
    const ids = Array.from({ length: 400 }, (_, i) => `entity-${i}`);
    for (const hue of ids.map(waAvatarHue)) {
      // Green is the accent (S5.1) and red is the destructive color; an
      // entity avatar must not be mistakable for either signal.
      expect(hue < 130 || hue > 155).toBe(true);
      expect(hue > 8 && hue < 352).toBe(true);
    }
  });
});

describe('waAvatarPalette', () => {
  it('pairs a light fill with a darker glyph of the SAME hue', () => {
    const { background, foreground } = waAvatarPalette('jd7abc');
    const bg = parseHsl(background);
    const fg = parseHsl(foreground);
    expect(bg.h).toBe(fg.h);
    expect(bg.l).toBeGreaterThan(fg.l);
  });

  it('keeps saturation muted (S5.2: ~35-45%, never a brand-strength color)', () => {
    for (const seed of ['a', 'b', 'c', 'jd7abc', 'k9zzz']) {
      const { background, foreground } = waAvatarPalette(seed);
      expect(parseHsl(background).s).toBeLessThanOrEqual(45);
      expect(parseHsl(foreground).s).toBeLessThanOrEqual(45);
    }
  });

  it('inverts the lightness relationship in dark mode', () => {
    const { background, foreground } = waAvatarPalette('jd7abc', true);
    expect(parseHsl(background).l).toBeLessThan(parseHsl(foreground).l);
  });

  it('is stable for the same seed', () => {
    expect(waAvatarPalette('jd7abc')).toEqual(waAvatarPalette('jd7abc'));
  });
});

describe('waNeutralAvatarPalette', () => {
  it('is hue-less — a gray pair for structural glyphs, not entities', () => {
    const light = waNeutralAvatarPalette(false);
    const dark = waNeutralAvatarPalette(true);
    for (const { background, foreground } of [light, dark]) {
      expect(background).toMatch(/^#[0-9A-F]{6}$/i);
      expect(foreground).toMatch(/^#[0-9A-F]{6}$/i);
      // Near-equal RGB channels == no readable hue. The tolerance isn't zero
      // because the dark pair uses WhatsApp's own slightly blue-gray surface
      // ink rather than a mathematically neutral gray — it still reads gray,
      // and matching the dark theme's other surfaces matters more.
      const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const [r, g, b] = channels(background);
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(28);
    }
    expect(light).not.toEqual(dark);
  });
});

describe('waAvatarInitials', () => {
  it.each([
    ['Demo Community', 'DC'],
    ['Worship Team Leaders', 'WT'],
    ['Seyi', 'S'],
    ['  spaced   out  ', 'SO'],
    ['', '?'],
    [undefined, '?'],
    [null, '?'],
  ])('maps %p to %p', (input, expected) => {
    expect(waAvatarInitials(input as string | null | undefined)).toBe(expected);
  });
});
