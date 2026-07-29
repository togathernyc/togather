/**
 * entityAvatarColor — muted per-entity fallback-avatar fills.
 *
 * WA-VISUAL-DELTAS.md S5.2 kill-list: "all-green fallback avatars everywhere
 * (WA fallback avatars are muted pastel per-entity hues, not brand green)".
 * Painting every photo-less group with the community's accent turns the
 * community landing into a wall of brand color, which is the loudest single
 * violation of S5's "green only on the CTA / badges / action links" rule.
 *
 * So: hash the entity's stable id to a hue and hold saturation/lightness
 * fixed. Same entity → same color on every render and every device (no
 * randomness, no state), different entities → different hues. Lightness is
 * picked so `AppImage`'s white initials text (`colors.textInverse`) still
 * clears contrast — these are muted mid-tones, not pastels light enough to
 * wash the initials out.
 */
import { hslToRgb, rgbToHex } from '@utils/waPalette';

/** Saturation/lightness pair for light mode — muted, white initials readable. */
const LIGHT_SATURATION = 32;
const LIGHT_LIGHTNESS = 48;
/** Dark mode drops lightness so the disc reads as a filled shape, not a glow. */
const DARK_SATURATION = 28;
const DARK_LIGHTNESS = 38;

/**
 * FNV-1a over the id string. Any stable string hash works here; FNV-1a is
 * chosen because it's 4 lines, has no dependencies, and spreads short
 * Convex ids (which share long prefixes) across the hue wheel far better
 * than a naive char-sum would.
 */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    // 16777619 (FNV prime) via shifts, kept in 32-bit unsigned range.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Deterministic muted fill for an entity's fallback avatar.
 *
 * @param id Stable entity id (Convex `_id`, slug — anything that doesn't
 *   change between renders). Empty/missing ids fall back to a fixed neutral
 *   hue rather than throwing.
 */
export function entityAvatarColor(id: string | null | undefined, isDark = false): string {
  const seed = typeof id === 'string' && id.length > 0 ? id : 'entity';
  const hue = hashString(seed) % 360;
  const rgb = hslToRgb({
    h: hue,
    s: isDark ? DARK_SATURATION : LIGHT_SATURATION,
    l: isDark ? DARK_LIGHTNESS : LIGHT_LIGHTNESS,
  });
  return rgbToHex(rgb);
}
