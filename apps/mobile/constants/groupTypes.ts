/**
 * Shared group type color constants.
 * Single source of truth for all group type colors across the app.
 *
 * Colors are dynamically generated based on group type ID to support
 * communities with custom group types. IDs are database-specific per community.
 */
import { DEFAULT_PRIMARY_COLOR, colors } from '../utils/styles';

/**
 * Default color for unknown group types (defined first for use in functions)
 */
export const DEFAULT_GROUP_COLOR = DEFAULT_PRIMARY_COLOR;

/**
 * Default color scheme for unknown group types
 */
export const DEFAULT_GROUP_COLOR_SCHEME = { bg: colors.accentLight, color: DEFAULT_PRIMARY_COLOR };

/**
 * Palette of distinct colors for group types.
 * These colors are visually distinct and work well for map markers and badges.
 */
const COLOR_PALETTE = [
  '#4CAF50', // Green
  '#F56848', // Orange/Red
  DEFAULT_PRIMARY_COLOR, // Accent (was Purple)
  '#0A84FF', // Blue
  '#FF9500', // Amber
  '#FF2D55', // Pink/Red
  '#5856D6', // Indigo
  '#00C7BE', // Teal
  '#AF52DE', // Purple Light
  '#32ADE6', // Cyan
];

/**
 * Convert hex color to rgba with specified alpha.
 */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Get a deterministic color for a group type ID.
 * Uses modulo to cycle through the palette for any ID.
 * Accepts both string and number IDs for Convex compatibility.
 */
export function getGroupTypeColor(typeId: string | number | undefined | null): string {
  if (typeId == null) return DEFAULT_GROUP_COLOR;
  const numericId = typeof typeId === 'string' ? parseInt(typeId, 10) : typeId;
  if (isNaN(numericId) || numericId < 1) return DEFAULT_GROUP_COLOR;
  // Use 1-indexed ID to map to palette (ID 1 -> index 0, ID 2 -> index 1, etc.)
  const index = (numericId - 1) % COLOR_PALETTE.length;
  return COLOR_PALETTE[index];
}

/**
 * Get a color scheme (background + text color) for a group type.
 * Generates a light background version of the primary color.
 */
export function getGroupTypeColorScheme(typeId: number | string | undefined | null): { bg: string; color: string } {
  const numericId = typeof typeId === 'string' ? parseInt(typeId, 10) : typeId;
  if (numericId == null || isNaN(numericId) || numericId < 1) return DEFAULT_GROUP_COLOR_SCHEME;

  const color = getGroupTypeColor(numericId);
  // Create a light background by adding alpha
  const bg = hexToRgba(color, 0.1);
  return { bg, color };
}

/**
 * Legacy lookup table for backward compatibility.
 * Maps known IDs to colors (first 4 match original implementation).
 * For new/unknown IDs, use getGroupTypeColor() instead.
 */
export const GROUP_TYPE_COLORS: Record<number, string> = {
  1: COLOR_PALETTE[0], // Green
  2: COLOR_PALETTE[1], // Orange/Red
  3: COLOR_PALETTE[2], // Purple
  4: COLOR_PALETTE[3], // Blue
  5: COLOR_PALETTE[4], // Amber
  6: COLOR_PALETTE[5], // Pink/Red
  7: COLOR_PALETTE[6], // Indigo
  8: COLOR_PALETTE[7], // Teal
  9: COLOR_PALETTE[8], // Purple Light
  10: COLOR_PALETTE[9], // Cyan
};

/**
 * Legacy color schemes for backward compatibility.
 * For dynamic lookup, use getGroupTypeColorScheme() instead.
 */
export const GROUP_TYPE_COLOR_SCHEMES: Record<string, { bg: string; color: string }> = {
  '1': { bg: 'rgba(76, 175, 80, 0.1)', color: '#4CAF50' },
  '2': { bg: 'rgba(245, 104, 72, 0.1)', color: '#F56848' },
  '3': { bg: colors.accentLight, color: DEFAULT_PRIMARY_COLOR },
  '4': { bg: 'rgba(10, 132, 255, 0.1)', color: '#0A84FF' },
  '5': { bg: 'rgba(255, 149, 0, 0.1)', color: '#FF9500' },
  '6': { bg: 'rgba(255, 45, 85, 0.1)', color: '#FF2D55' },
  '7': { bg: 'rgba(88, 86, 214, 0.1)', color: '#5856D6' },
  '8': { bg: 'rgba(0, 199, 190, 0.1)', color: '#00C7BE' },
  '9': { bg: 'rgba(175, 82, 222, 0.1)', color: '#AF52DE' },
  '10': { bg: 'rgba(50, 173, 230, 0.1)', color: '#32ADE6' },
};
