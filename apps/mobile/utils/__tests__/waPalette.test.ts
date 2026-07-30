import {
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  isValidHex,
  waAccentPalette,
} from '../waPalette';

describe('isValidHex', () => {
  test('accepts 6-digit hex with or without #', () => {
    expect(isValidHex('#25D366')).toBe(true);
    expect(isValidHex('25D366')).toBe(true);
    expect(isValidHex('#fff000')).toBe(true);
  });

  test('rejects malformed input', () => {
    expect(isValidHex('not-a-color')).toBe(false);
    expect(isValidHex('#fff')).toBe(false); // 3-digit shorthand unsupported
    expect(isValidHex('')).toBe(false);
    // @ts-expect-error - exercising runtime guard against non-string input
    expect(isValidHex(undefined)).toBe(false);
  });
});

describe('hexToRgb / rgbToHex round trip', () => {
  test('parses known colors', () => {
    expect(hexToRgb('#25D366')).toEqual({ r: 37, g: 211, b: 102 });
    expect(hexToRgb('000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  test('returns null for invalid input', () => {
    expect(hexToRgb('nope')).toBeNull();
  });

  test('round-trips back to the same hex', () => {
    expect(rgbToHex(hexToRgb('#25D366')!)).toBe('#25d366');
  });
});

describe('rgbToHsl / hslToRgb round trip', () => {
  test('WhatsApp green measures into the green hue family', () => {
    const hsl = rgbToHsl(hexToRgb('#25D366')!);
    expect(hsl.h).toBeGreaterThan(100);
    expect(hsl.h).toBeLessThan(180);
    expect(hsl.s).toBeGreaterThan(50);
  });

  test('round-trips a color through HSL and back to (near) the same RGB', () => {
    const rgb = hexToRgb('#1E8449')!;
    const roundTripped = hslToRgb(rgbToHsl(rgb));
    expect(Math.round(roundTripped.r)).toBeCloseTo(rgb.r, 0);
    expect(Math.round(roundTripped.g)).toBeCloseTo(rgb.g, 0);
    expect(Math.round(roundTripped.b)).toBeCloseTo(rgb.b, 0);
  });
});

describe('waAccentPalette', () => {
  test('light mode: accent is the primary color unchanged', () => {
    const palette = waAccentPalette('#25D366', false);
    expect(palette.accent.toLowerCase()).toBe('#25d366');
    expect(palette.unread).toBe(palette.accent);
    expect(palette.timestampUnread).toBe(palette.accent);
  });

  test('light mode: bubbleOutgoing is a pale tint, not the full-saturation brand color', () => {
    const palette = waAccentPalette('#25D366', false);
    expect(palette.bubbleOutgoing.toLowerCase()).not.toBe('#25d366');
    const { h, s, l } = rgbToHsl(hexToRgb(palette.bubbleOutgoing)!);
    // Stays in the green family but reads as a near-white pastel (§1.3: "not
    // the full-saturation brand color").
    expect(h).toBeGreaterThan(60);
    expect(h).toBeLessThan(180);
    expect(l).toBeGreaterThan(85);
  });

  test('dark mode: WhatsApp green in -> darker, more saturated green-family accent out', () => {
    const light = waAccentPalette('#25D366', false);
    const dark = waAccentPalette('#25D366', true);

    expect(dark.accent).not.toBe(light.accent);
    expect(dark.darkAdjustedAccent).toBe(dark.accent);

    const lightHsl = rgbToHsl(hexToRgb(light.accent)!);
    const darkHsl = rgbToHsl(hexToRgb(dark.accent)!);
    // Hue is preserved (§1.2: "lightness/saturation adjustment", not a hue
    // rotation) — stays in the same green family as the input.
    expect(Math.abs(darkHsl.h - lightHsl.h)).toBeLessThan(5);
    expect(darkHsl.s).toBeGreaterThanOrEqual(lightHsl.s);
  });

  test('dark mode: bubbleOutgoing is a saturated dark tint, not a light tint', () => {
    const dark = waAccentPalette('#25D366', true);
    const { s, l } = rgbToHsl(hexToRgb(dark.bubbleOutgoing)!);
    expect(l).toBeLessThan(35);
    expect(s).toBeGreaterThan(50);
  });

  test('bubbleOutgoingText is always undefined per §1.6 (bubble text never inverts)', () => {
    expect(waAccentPalette('#25D366', false).bubbleOutgoingText).toBeUndefined();
    expect(waAccentPalette('#25D366', true).bubbleOutgoingText).toBeUndefined();
  });

  test('falls back to the raw input across every field on invalid hex', () => {
    const palette = waAccentPalette('not-a-color', false);
    expect(palette).toEqual({
      accent: 'not-a-color',
      bubbleOutgoing: 'not-a-color',
      unread: 'not-a-color',
      timestampUnread: 'not-a-color',
      darkAdjustedAccent: 'not-a-color',
    });

    const darkPalette = waAccentPalette('not-a-color', true);
    expect(darkPalette.accent).toBe('not-a-color');
  });

  test('handles an arbitrary non-green brand color (e.g. Knicks orange) without throwing', () => {
    expect(() => waAccentPalette('#F58426', false)).not.toThrow();
    expect(() => waAccentPalette('#F58426', true)).not.toThrow();
    const dark = waAccentPalette('#F58426', true);
    expect(isValidHexColorString(dark.accent)).toBe(true);
    expect(isValidHexColorString(dark.bubbleOutgoing)).toBe(true);
  });
});

function isValidHexColorString(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}
