/**
 * waPastelAvatar — the muted per-entity fallback hue WhatsApp uses when an
 * entity has no photo.
 *
 * WA-VISUAL-DELTAS.md S5.2 kill-list: "all-green fallback avatars everywhere
 * (WA fallback avatars are muted pastel per-entity hues, not brand green)".
 * Togather's shared `AppImage` initials placeholder hashes a name onto a
 * 5-entry palette that is 2/5 brand green and otherwise fully-saturated
 * accents — on a hero-sized disc that reads as a solid brand blob, which is
 * exactly the signal S5.1 reserves for CTAs and unread badges.
 *
 * This is deliberately NOT wired into `AppImage`: that component renders on
 * flag-off surfaces too, and flag-off output must stay byte-identical. Flag-on
 * hero/entity avatars opt in by passing the returned `background` explicitly.
 *
 * Pure color math — no React, no theme, no community state.
 */

/**
 * Muted pastels, evenly spaced around the wheel and deliberately low-chroma so
 * a 100pt disc reads as a neutral placeholder rather than a colored button.
 * No green near the brand hue is included.
 */
const WA_PASTEL_LIGHT = [
  '#D8D2E8', // lilac
  '#E7D4C8', // clay
  '#CFDCE6', // slate blue
  '#E6DCC2', // sand
  '#DCD3CB', // warm gray
  '#CCDCD8', // sage
  '#E4D0D6', // dusty rose
  '#D2D9E8', // periwinkle
] as const;

/** Dark-mode counterparts — same hues, dropped in lightness so white ink reads. */
const WA_PASTEL_DARK = [
  '#4A4358', // lilac
  '#5A4740', // clay
  '#3C4C58', // slate blue
  '#544D3A', // sand
  '#4A443E', // warm gray
  '#3A4B48', // sage
  '#54414A', // dusty rose
  '#414A5C', // periwinkle
] as const;

/** Deterministic index for a name — stable across renders and devices. */
function hashIndex(name: string, buckets: number): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) % 1_000_003;
  }
  return hash % buckets;
}

export interface WaPastelAvatar {
  /** Disc fill. */
  background: string;
  /** Initial/glyph ink that reads on `background`. */
  ink: string;
}

/**
 * A muted pastel disc fill + readable ink for `name`, stable for a given name.
 * Empty/missing names fall back to the neutral warm gray.
 */
export function waPastelAvatar(name: string | null | undefined, isDark = false): WaPastelAvatar {
  const palette = isDark ? WA_PASTEL_DARK : WA_PASTEL_LIGHT;
  const ink = isDark ? '#F2F2F2' : '#3A3A3C';
  const trimmed = (name ?? '').trim();
  if (!trimmed) return { background: palette[4], ink };
  return { background: palette[hashIndex(trimmed, palette.length)], ink };
}
