/**
 * waPalette — WhatsApp-shell brand-accent color math.
 *
 * Implements the brand-accent substitution rule from
 * `docs/plans/church-migration-ui-redesign/WHATSAPP-DESIGN-SYSTEM.md` §1: a
 * community's `primaryColor` replaces WhatsApp green everywhere green is an
 * *accent* (§1.3), while the tint/shift formulas below reproduce WhatsApp's
 * own light→dark and bubble-fill transforms so any brand color behaves the
 * way `#25D366` does in the reference app.
 *
 * Pure color math only — no theme/React/Convex imports. Presentational
 * components (`components/wa/*`) and screens pass the result of
 * `waAccentPalette()` in as props; nothing in here reads community state.
 *
 * Spec-vs-measurement note (see `waAccentPalette` JSDoc): §1.2's prose
 * describes the dark-mode accent shift as "higher lightness, slightly
 * desaturated," but WhatsApp's own named reference colors (`#25D366` light →
 * `#00A884` dark) measure the opposite on both HSL lightness and W3C relative
 * luminance — `#00A884` is darker and more saturated, not lighter. This
 * module trusts the concrete hex pair over the adjectives and calibrates its
 * shift constants against the measured delta.
 */

// --- Hex/RGB/HSL primitives -------------------------------------------------

const HEX_RE = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** True when `hex` is a parseable 6-digit hex color (`#` optional). */
export function isValidHex(hex: string): boolean {
  return typeof hex === 'string' && HEX_RE.test(hex.trim());
}

/** Parses a 6-digit hex color to 0-255 RGB. Returns `null` for invalid input. */
export function hexToRgb(hex: string): Rgb | null {
  const match = HEX_RE.exec(hex?.trim() ?? '');
  if (!match) return null;
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function channelToHex(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

/** Formats 0-255 RGB channels as a `#rrggbb` hex string. */
export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

/** Converts RGB (0-255) to HSL (h: 0-360, s/l: 0-100). */
export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l: l * 100 };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case rn:
      h = (gn - bn) / d + (gn < bn ? 6 : 0);
      break;
    case gn:
      h = (bn - rn) / d + 2;
      break;
    default:
      h = (rn - gn) / d + 4;
  }
  return { h: (h / 6) * 360, s: s * 100, l: l * 100 };
}

/** Converts HSL (h: 0-360, s/l: 0-100) to 0-255 RGB. */
export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hn = ((h % 360) + 360) % 360 / 360;
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;

  if (sn === 0) {
    const gray = ln * 255;
    return { r: gray, g: gray, b: gray };
  }

  const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  return {
    r: hue2rgb(p, q, hn + 1 / 3) * 255,
    g: hue2rgb(p, q, hn) * 255,
    b: hue2rgb(p, q, hn - 1 / 3) * 255,
  };
}

// --- WhatsApp-shell accent derivation (spec §1) -----------------------------

/**
 * §1.6 light-mode outgoing bubble. A white-mix of the brand color desaturates
 * (a forest-green brand came out gray-sage next to WhatsApp's `#D9FDD3`);
 * WhatsApp instead keeps the bubble's lightness essentially constant (~92)
 * and lets hue+saturation carry the brand. Calibrated against `#25D366` →
 * `#D9FDD3` (S 70→85, L 49→92): saturation gets a fixed boost, lightness is
 * pinned into a narrow light band regardless of the brand's own lightness.
 */
const BUBBLE_OUTGOING_LIGHT_SATURATION_BOOST = 15;
const BUBBLE_OUTGOING_LIGHT_MIN_LIGHTNESS = 90;
const BUBBLE_OUTGOING_LIGHT_MAX_LIGHTNESS = 93;

/**
 * Dark-mode accent shift, calibrated against the measured `#25D366` →
 * `#00A884` delta (HSL: S 70.2→100, L 48.6→32.9 — a ratio of ~0.68). Hue is
 * left untouched per §1.2's instruction to apply "an equivalent HSL
 * lightness/saturation adjustment," not a hue rotation, so this generalizes
 * to brand colors of any hue rather than only reproducing WhatsApp's own
 * green→teal shift.
 */
const DARK_ACCENT_SATURATION_BOOST = 25;
const DARK_ACCENT_LIGHTNESS_FACTOR = 0.68;
const DARK_ACCENT_MIN_LIGHTNESS = 28;
const DARK_ACCENT_MAX_LIGHTNESS = 55;

/**
 * Dark-mode *outgoing bubble* shift — deliberately darker/more saturated than
 * the dark-mode accent shift above ("a saturated dark tint, not a light tint,
 * because dark-mode outgoing bubbles need to read as 'filled'," §1.6).
 * Calibrated against `#25D366` → `#005C4B` (L 48.6→18.0, ratio ~0.37; S
 * 70.2→100).
 */
const DARK_BUBBLE_SATURATION_BOOST = 30;
const DARK_BUBBLE_LIGHTNESS_FACTOR = 0.37;
const DARK_BUBBLE_MIN_LIGHTNESS = 12;
const DARK_BUBBLE_MAX_LIGHTNESS = 30;

function shiftHsl(
  hex: string,
  { saturationBoost, lightnessFactor, minLightness, maxLightness }: {
    saturationBoost: number;
    lightnessFactor: number;
    minLightness: number;
    maxLightness: number;
  }
): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const hsl = rgbToHsl(rgb);
  return rgbToHex(
    hslToRgb({
      h: hsl.h,
      s: clamp(hsl.s + saturationBoost, 0, 100),
      l: clamp(hsl.l * lightnessFactor, minLightness, maxLightness),
    })
  );
}

/** §1.2 dark-mode accent: same hue, boosted saturation, clamped-down lightness. */
function darkAdjustedAccentOf(hex: string): string {
  return shiftHsl(hex, {
    saturationBoost: DARK_ACCENT_SATURATION_BOOST,
    lightnessFactor: DARK_ACCENT_LIGHTNESS_FACTOR,
    minLightness: DARK_ACCENT_MIN_LIGHTNESS,
    maxLightness: DARK_ACCENT_MAX_LIGHTNESS,
  });
}

/** §1.6 dark-mode outgoing bubble: darker/more saturated "filled" tint. */
function darkBubbleTintOf(hex: string): string {
  return shiftHsl(hex, {
    saturationBoost: DARK_BUBBLE_SATURATION_BOOST,
    lightnessFactor: DARK_BUBBLE_LIGHTNESS_FACTOR,
    minLightness: DARK_BUBBLE_MIN_LIGHTNESS,
    maxLightness: DARK_BUBBLE_MAX_LIGHTNESS,
  });
}

export interface WaAccentPalette {
  /** The accent to use for this mode: `primaryColor` in light mode,
   *  `darkAdjustedAccent` in dark mode (§1.3: unread badge, FAB, active tab,
   *  toggle-on track, in-bubble links, etc). */
  accent: string;
  /** §1.6 outgoing bubble fill: light tint over white in light mode, a
   *  saturated dark tint in dark mode — never the full-saturation brand color
   *  in either mode. */
  bubbleOutgoing: string;
  /**
   * Bubble text color override, if the outgoing fill ever needed inverted
   * text. §1.6 is explicit that it never does ("bubble fill never gets dark
   * enough/light enough to need inverted text" — `text.primary` in both
   * modes), so this is always `undefined`: callers should use their theme's
   * `text` token directly rather than a value from this palette.
   */
  bubbleOutgoingText?: string;
  /** §1.3 unread badge fill / unread row title weight color — same value as
   *  `accent`; kept as a separate field so call sites can name the semantic
   *  role they need rather than reasoning about which accent shade to use. */
  unread: string;
  /** §1.3/§2 unread row timestamp color — same value as `accent` (read rows
   *  use `text.tertiary` instead; see `theme/colors.ts`, not this palette). */
  timestampUnread: string;
  /** The raw §1.2 dark-mode-shifted accent, always computed regardless of
   *  `isDark` — what `accent` resolves to when `isDark` is true. */
  darkAdjustedAccent: string;
}

/**
 * Derives every WhatsApp-shell accent role from a community's `primaryColor`,
 * per WHATSAPP-DESIGN-SYSTEM.md §1.3 (brand-accent substitution table), §1.2
 * (dark-mode accent shift), and §1.6 (bubble fill).
 *
 * Pure function — presentational only. Callers (e.g. `components/wa/*`) pass
 * `useCommunityTheme().primaryColor` and `useTheme().isDark` in as arguments
 * rather than this module reading community/theme state itself.
 *
 * On an invalid/unparseable `primaryColor`, every field falls back to the
 * input string unchanged so callers still get a paintable (if un-derived)
 * color instead of a crash.
 */
export function waAccentPalette(primaryColor: string, isDark: boolean): WaAccentPalette {
  if (!isValidHex(primaryColor)) {
    return {
      accent: primaryColor,
      bubbleOutgoing: primaryColor,
      unread: primaryColor,
      timestampUnread: primaryColor,
      darkAdjustedAccent: primaryColor,
    };
  }

  const darkAdjustedAccent = darkAdjustedAccentOf(primaryColor);
  const accent = isDark ? darkAdjustedAccent : primaryColor;
  const bubbleOutgoing = isDark
    ? darkBubbleTintOf(primaryColor)
    : shiftHsl(primaryColor, {
        saturationBoost: BUBBLE_OUTGOING_LIGHT_SATURATION_BOOST,
        lightnessFactor: 10, // pin into the clamp band below
        minLightness: BUBBLE_OUTGOING_LIGHT_MIN_LIGHTNESS,
        maxLightness: BUBBLE_OUTGOING_LIGHT_MAX_LIGHTNESS,
      });

  return {
    accent,
    bubbleOutgoing,
    unread: accent,
    timestampUnread: accent,
    darkAdjustedAccent,
  };
}
