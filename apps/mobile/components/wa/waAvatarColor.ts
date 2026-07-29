/**
 * waAvatarColor — per-entity fallback-avatar palettes (WA-VISUAL-DELTAS.md
 * S5.2).
 *
 * WhatsApp never paints a fallback avatar in its brand green. Every
 * photo-less chat gets a **muted pastel disc** whose hue is derived from the
 * entity itself: a light, low-saturation fill with a darker glyph/initials of
 * the *same* hue. That's what makes a photo-less WhatsApp list read as calm
 * and varied instead of as a column of brand-colored blobs — which is exactly
 * how Togather's list read before this pass (`AppImage`'s built-in
 * `getColorFromName` palette is 2/5 brand green, and it paints the initials
 * white).
 *
 * Two palettes live here:
 * - {@link waAvatarPalette} — the per-entity pastel, for anything that stands
 *   for a *someone/something* (a person, a group, a community, an event).
 * - {@link waNeutralAvatarPalette} — a hue-less light-gray disc with a
 *   dark-gray glyph, for structural discs that aren't an entity at all
 *   (channel "#" discs, the "N more channels" expander, system rows). S5.2
 *   calls these out separately: "Channel '#' discs: neutral light-gray fill,
 *   dark-gray glyph."
 *
 * This module is the canonical implementation for the whole app. WS-E's
 * parallel `features/community/utils/entityAvatarColor.ts` was folded into it
 * at integration (and deleted) rather than the other way round, since this one
 * lives in the shared `components/wa` kit and its hash has the avalanche
 * finalizer that Convex-id seeds need.
 */

export interface WaAvatarPalette {
  /** Disc fill — light and low-saturation. */
  background: string;
  /** Initials / glyph ink — the same hue, darkened for contrast. */
  foreground: string;
}

/**
 * Hue wheel for fallback discs. Hand-picked (rather than `hash % 360`) so no
 * entity can land on a hue that reads as a UI signal: WhatsApp green (~142)
 * and iOS destructive red (~0) are deliberately absent, and the neighbours
 * either side of them are pulled clear.
 */
const WA_AVATAR_HUES = [
  14, // clay
  28, // apricot
  42, // sand
  68, // olive
  96, // moss
  172, // teal
  192, // sky
  210, // steel blue
  228, // periwinkle
  254, // iris
  278, // violet
  300, // orchid
  322, // rose
  344, // dusty pink
] as const;

/**
 * Stable string hash (FNV-1a, 32-bit). Deterministic across platforms and
 * runs — the same entity id must always produce the same disc, in the app and
 * in tests, on every device.
 */
export function waAvatarHash(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in range without 64-bit math.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Avalanche (xorshift-multiply finalizer). FNV-1a's *low* bits barely move
  // for inputs that share a long prefix and differ only near the end — which
  // is exactly the shape of a Convex id. Without this, a screen full of
  // sibling ids landed on adjacent hues and every fallback avatar came out
  // some shade of purple (observed on the seeded Chats list). The finalizer
  // spreads those differences across the whole word before the modulo.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** The hue this seed maps to. Exposed for tests and for callers tinting
 *  something other than a disc (e.g. a squircle cover). */
export function waAvatarHue(seed: string): number {
  return WA_AVATAR_HUES[waAvatarHash(seed) % WA_AVATAR_HUES.length];
}

/**
 * Muted pastel fill + darker same-hue ink for an entity's fallback avatar.
 *
 * Saturation sits in the 35-45% band the delta list calls for: enough for the
 * hue to register, far short of anything that competes with the one green
 * accent a screen is allowed (S5.1).
 *
 * @param seed Stable entity identity — prefer a Convex id over a display
 *   name so a rename doesn't re-color the avatar.
 */
export function waAvatarPalette(seed: string, isDark = false): WaAvatarPalette {
  const hue = waAvatarHue(seed);
  return isDark
    ? { background: `hsl(${hue}, 26%, 27%)`, foreground: `hsl(${hue}, 40%, 76%)` }
    : { background: `hsl(${hue}, 42%, 88%)`, foreground: `hsl(${hue}, 45%, 34%)` };
}

/**
 * Hue-less disc for structural glyphs (channel "#", the channels expander,
 * system rows) — light-gray fill, dark-gray glyph, no entity identity implied.
 */
export function waNeutralAvatarPalette(isDark = false): WaAvatarPalette {
  return isDark
    ? { background: '#2A3942', foreground: '#AEBAC1' }
    : { background: '#E9EBED', foreground: '#5E6B72' };
}

/**
 * Initials for a fallback disc — first letters of the first two words, or the
 * single leading letter. Mirrors `AppImage`'s own `getInitials` so swapping a
 * row onto this palette never changes the letters it shows.
 */
export function waAvatarInitials(name?: string | null): string {
  if (!name || typeof name !== 'string') return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? '?'}${parts[1][0] ?? ''}`.toUpperCase();
  }
  return trimmed[0]?.toUpperCase() ?? '?';
}
