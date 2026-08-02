/**
 * waRoleInk — readable text ink derived from an AUTHORED entity color.
 *
 * Some Togather entities carry a colour their leader picked by hand — a team
 * role's swatch in Rostering is the canonical case (`ROLE_COLORS` in
 * `features/scheduling/utils/format.ts`). Those hexes were chosen to read as
 * *fills* (a swatch dot, a translucent chip wash), where contrast rules barely
 * bite. Used directly as TEXT they mostly fail WCAG AA: amber `#FFB224` lands
 * at 1.65:1 on a light row, and violet `#6E56CF` at 2.83:1 on a dark one.
 *
 * So flag-on surfaces that want to keep the authored identity as ink derive it
 * here instead of using the raw hex: keep the author's HUE, then pin lightness
 * (and cap saturation) to a band that clears 4.5:1 in the theme it's rendering
 * in. Two roles that look different in Rostering still look different here, and
 * the same role is still recognisably "the teal one" — but it's legible.
 *
 * The targets are `waAvatarColor`'s foreground band, reused rather than
 * reinvented so the two derivations agree:
 *   - saturation caps: 45% light / 40% dark — verbatim from `waAvatarPalette`.
 *   - dark lightness 76% — verbatim.
 *   - light lightness **32%, not `waAvatarPalette`'s 34%**. At 34 the teal
 *     `#12A594` lands at 4.41:1 on `surfaceSecondary` — under AA. 32 pulls the
 *     worst case to 4.90:1 across every fill the run sheet paints, in all four
 *     palettes. (`waAvatarPalette`'s 34 is fine where it's used: its ink always
 *     sits on its OWN pastel disc, never on a near-white row.)
 *
 * The cap is a `min`, never a floor: a role authored as a near-neutral gray
 * (`DEFAULT_ROLE_COLOR` `#6E7781`, saturation ~7%) stays gray instead of being
 * boosted into a hue it never had.
 *
 * Contrast is verified for real — `__tests__/waRoleInk.test.ts` computes WCAG
 * ratios for every `ROLE_COLORS` value plus the default against every fill the
 * run sheet uses, in both themes.
 */

/** Saturation cap for light-mode ink (`waAvatarPalette`'s light foreground). */
const LIGHT_SATURATION_CAP = 45;
/** Lightness for light-mode ink — see the module note on why this is 32, not 34. */
const LIGHT_LIGHTNESS = 32;
/** Saturation cap for dark-mode ink (`waAvatarPalette`'s dark foreground). */
const DARK_SATURATION_CAP = 40;
/** Lightness for dark-mode ink (`waAvatarPalette`'s dark foreground). */
const DARK_LIGHTNESS = 76;

/** Hue (0-360) and saturation (0-100) of a `#rgb`/`#rrggbb` color. */
export function waHexToHueSaturation(hex: string): { hue: number; saturation: number } {
  let raw = hex.replace('#', '').trim();
  if (raw.length === 3) {
    raw = raw
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const int = parseInt(raw, 16);
  if (raw.length !== 6 || Number.isNaN(int)) return { hue: 0, saturation: 0 };

  const r = ((int >> 16) & 0xff) / 255;
  const g = ((int >> 8) & 0xff) / 255;
  const b = (int & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta === 0) return { hue: 0, saturation: 0 };

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);

  return { hue: ((hue % 360) + 360) % 360, saturation: saturation * 100 };
}

/**
 * The authored color's hue, re-lit as readable text ink for the current theme.
 *
 * @param hex The colour the leader authored (e.g. a role's swatch).
 * @param isDark Whether the surface is rendering the dark palette.
 */
export function waRoleInk(hex: string, isDark: boolean): string {
  const { hue, saturation } = waHexToHueSaturation(hex);
  return isDark
    ? `hsl(${Math.round(hue)}, ${Math.round(Math.min(saturation, DARK_SATURATION_CAP))}%, ${DARK_LIGHTNESS}%)`
    : `hsl(${Math.round(hue)}, ${Math.round(Math.min(saturation, LIGHT_SATURATION_CAP))}%, ${LIGHT_LIGHTNESS}%)`;
}
