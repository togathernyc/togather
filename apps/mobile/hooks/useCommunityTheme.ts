/**
 * useCommunityTheme - Hook for accessing community-specific theme colors
 *
 * Provides the community's custom primary and secondary colors if set,
 * falling back to the default app colors when not configured.
 *
 * Usage:
 * const { primaryColor, secondaryColor, accentLight, primaryColorDark } = useCommunityTheme();
 */
import { useMemo } from 'react';
import { useAuth } from '@providers/AuthProvider';
import { DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR } from '@utils/styles';

interface CommunityTheme {
  /** Primary accent color (for buttons, links, active states) */
  primaryColor: string;
  /** Secondary accent color (for secondary buttons, progress bars) */
  secondaryColor: string;
  /** Light version of primary color (for backgrounds, highlights) */
  accentLight: string;
  /** Darkened primary color for dark-mode chat bubbles */
  primaryColorDark: string;
  /** Whether the theme is using custom community colors vs defaults */
  isCustomTheme: boolean;
}

/**
 * Converts a hex color to an rgba string with the given opacity
 */
function hexToRgba(hex: string, opacity: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return `rgba(30, 132, 73, ${opacity})`; // Fallback to default green
  }
  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * Darkens a hex color by a given factor (0-1).
 * factor=0.4 means the result is 40% of the original brightness.
 */
export function darkenColor(hex: string, factor: number = 0.4): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '#005c4b'; // Fallback dark green
  const r = Math.round(parseInt(result[1], 16) * factor);
  const g = Math.round(parseInt(result[2], 16) * factor);
  const b = Math.round(parseInt(result[3], 16) * factor);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function useCommunityTheme(): CommunityTheme {
  const { user } = useAuth();

  return useMemo(() => {
    const primaryColor = user?.community_primary_color || DEFAULT_PRIMARY_COLOR;
    const secondaryColor = user?.community_secondary_color || DEFAULT_SECONDARY_COLOR;
    const isCustomTheme = !!(user?.community_primary_color || user?.community_secondary_color);

    return {
      primaryColor,
      secondaryColor,
      accentLight: hexToRgba(primaryColor, 0.1),
      primaryColorDark: darkenColor(primaryColor, 0.4),
      isCustomTheme,
    };
  }, [user?.community_primary_color, user?.community_secondary_color]);
}
