/**
 * waRoleInk — WCAG AA verification for every authored role colour.
 *
 * The run sheet renders a role NAME in its authored hue at 15pt/600, which is
 * ~11.25pt — under WCAG's 14pt-bold / 18pt large-text threshold, so the 4.5:1
 * normal-text ratio applies, not 3:1.
 *
 * Ratios are COMPUTED here (real relative-luminance math on the real hsl()
 * strings the helper emits), never hardcoded — a hardcoded expectation would
 * pass even if the helper's own maths drifted.
 */
import { waRoleInk, waHexToHueSaturation } from '../waRoleInk';
import { ROLE_COLORS, DEFAULT_ROLE_COLOR } from '@features/scheduling/utils/format';
import {
  lightColors,
  darkColors,
  knicksLightColors,
  knicksDarkColors,
} from '@/theme/colors';

/** WCAG 2.x relative luminance of an sRGB triple. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function parseHex(hex: string): [number, number, number] {
  let raw = hex.replace('#', '');
  if (raw.length === 3) raw = raw.split('').map((c) => c + c).join('');
  const int = parseInt(raw, 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

/** `hsl(h, s%, l%)` → sRGB, matching what the platform renderer does. */
function parseHsl(value: string): [number, number, number] {
  const m = value.match(/hsl\((-?[\d.]+),\s*([\d.]+)%,\s*([\d.]+)%\)/);
  if (!m) throw new Error(`not an hsl() string: ${value}`);
  const h = ((Number(m[1]) % 360) + 360) % 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m0 = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m0) * 255)) as [number, number, number];
}

function contrastRatio(ink: string, fillHex: string): number {
  const a = relativeLuminance(parseHsl(ink));
  const b = relativeLuminance(parseHex(fillHex));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const AA_NORMAL_TEXT = 4.5;

/** Every authored role colour the app can hand the run sheet. */
const AUTHORED = [...ROLE_COLORS, DEFAULT_ROLE_COLOR];

/**
 * Every fill a run sheet role line can land on, per palette: the normal row
 * (`surfaceGrouped` flag-on, `surfaceSecondary` flag-off) and the
 * happening-now row.
 */
const SURFACES = [
  { name: 'light', isDark: false, colors: lightColors },
  { name: 'dark', isDark: true, colors: darkColors },
  { name: 'knicks light', isDark: false, colors: knicksLightColors },
  { name: 'knicks dark', isDark: true, colors: knicksDarkColors },
];

describe('waRoleInk', () => {
  it.each(SURFACES)(
    'clears WCAG AA (4.5:1) for every role colour on every $name row fill',
    ({ isDark, colors }) => {
      const fills = [
        colors.surfaceGrouped,
        colors.surfaceSecondary,
        colors.runSheetCurrentItem,
      ];
      // Collect every (colour, fill) ratio, then assert on the whole table, so
      // a failure names ALL the offenders instead of only the first.
      const failures = AUTHORED.flatMap((authored) => {
        const ink = waRoleInk(authored, isDark);
        return fills
          .map((fill) => ({
            authored,
            fill,
            ratio: Number(contrastRatio(ink, fill).toFixed(2)),
          }))
          .filter((r) => r.ratio < AA_NORMAL_TEXT);
      });
      expect(failures).toEqual([]);
      // …and prove the table wasn't empty for the wrong reason.
      expect(AUTHORED).toHaveLength(9);
      expect(fills).toHaveLength(3);
    },
  );

  it('fails AA when handed the RAW authored hex — this is the bug it fixes', () => {
    // Sanity check on the measurement itself: the same maths must show the
    // untreated palette failing, or the assertion above proves nothing.
    const rawAmber = relativeLuminance(parseHex('#FFB224'));
    const surface = relativeLuminance(parseHex(lightColors.surfaceSecondary));
    const ratio =
      (Math.max(rawAmber, surface) + 0.05) / (Math.min(rawAmber, surface) + 0.05);
    expect(ratio).toBeLessThan(AA_NORMAL_TEXT);
  });

  it('keeps the authored hue rather than hashing onto a fixed palette', () => {
    // The whole point of the deviation logged in the PR body: a role's colour
    // is continuous with the swatch its leader picked in Rostering.
    for (const authored of ROLE_COLORS) {
      const authoredHue = waHexToHueSaturation(authored).hue;
      const inkHue = waHexToHueSaturation(
        // Re-read the hue back out of the emitted hsl() by round-tripping it.
        rgbToHex(parseHsl(waRoleInk(authored, false))),
      ).hue;
      // Within a degree of rounding — never re-assigned to some other hue.
      expect(Math.abs(inkHue - authoredHue)).toBeLessThan(2);
    }
  });

  it('does not boost a near-neutral role into a hue it never had', () => {
    // `DEFAULT_ROLE_COLOR` is ~7% saturated; the cap is a min(), not a floor.
    const { saturation } = waHexToHueSaturation(DEFAULT_ROLE_COLOR);
    expect(saturation).toBeLessThan(15);
    expect(waRoleInk(DEFAULT_ROLE_COLOR, false)).toContain(
      `${Math.round(saturation)}%`,
    );
  });

  it('flips between themes so neither is the compromised one', () => {
    // Light ink is dark, dark ink is light — the raw palette can only be one.
    const light = parseHsl(waRoleInk('#12A594', false));
    const dark = parseHsl(waRoleInk('#12A594', true));
    expect(relativeLuminance(light)).toBeLessThan(relativeLuminance(dark));
  });

  it('survives malformed input without throwing', () => {
    expect(() => waRoleInk('', false)).not.toThrow();
    expect(() => waRoleInk('#zzz', true)).not.toThrow();
    expect(waRoleInk('#fff', false)).toContain('hsl(');
  });
});

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
