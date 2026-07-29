/**
 * entityAvatarColor — the muted per-entity fallback-avatar fill (S5.2).
 *
 * The properties that matter for the community landing: stable per id,
 * different across ids, never the brand accent, and dark enough that
 * AppImage's white initials stay legible.
 */
import { entityAvatarColor } from '../entityAvatarColor';
import { hexToRgb, rgbToHsl } from '@utils/waPalette';

describe('entityAvatarColor', () => {
  it('is deterministic for the same id', () => {
    expect(entityAvatarColor('group_abc')).toBe(entityAvatarColor('group_abc'));
    expect(entityAvatarColor('group_abc', true)).toBe(entityAvatarColor('group_abc', true));
  });

  it('spreads different ids across different hues', () => {
    const ids = ['j57a1', 'j57a2', 'j57a3', 'j57b9', 'k12zz', 'zzzzz'];
    const hues = ids.map((id) => {
      const rgb = hexToRgb(entityAvatarColor(id))!;
      return Math.round(rgbToHsl(rgb).h);
    });
    // No two of this sample collide — a char-sum hash would collapse the
    // near-identical Convex-style ids above onto the same hue.
    expect(new Set(hues).size).toBe(ids.length);
  });

  it('returns a valid hex for empty / missing ids instead of throwing', () => {
    expect(entityAvatarColor('')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(entityAvatarColor(null)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(entityAvatarColor(undefined)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('stays muted and mid-tone so white initials stay legible', () => {
    for (const id of ['a', 'bb', 'ccc', 'dddd', 'eeeee', 'ffffff']) {
      const { s, l } = rgbToHsl(hexToRgb(entityAvatarColor(id))!);
      // Muted: never a saturated brand-strength hue.
      expect(s).toBeLessThanOrEqual(40);
      // Mid-tone: dark enough for white text, light enough to read as a fill.
      expect(l).toBeGreaterThan(40);
      expect(l).toBeLessThan(60);
    }
  });

  it('darkens in dark mode', () => {
    const light = rgbToHsl(hexToRgb(entityAvatarColor('group_abc', false))!);
    const dark = rgbToHsl(hexToRgb(entityAvatarColor('group_abc', true))!);
    expect(dark.l).toBeLessThan(light.l);
    // Same hue in both modes — only the tone shifts.
    expect(Math.round(dark.h)).toBe(Math.round(light.h));
  });
});
