/**
 * Common spacing constants
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

/**
 * Default community colors
 *
 * These are the default accent colors used when a community hasn't set custom colors.
 * To change the default colors for new communities, update these values.
 */
export const DEFAULT_PRIMARY_COLOR = '#1E8449';
export const DEFAULT_SECONDARY_COLOR = '#1E8449';

/**
 * Common colors
 *
 * For dynamic/inline styles that can use hooks, use `useCommunityTheme()` hook:
 *   const { primaryColor } = useCommunityTheme();
 *
 * For static StyleSheet.create() styles, use `DEFAULT_PRIMARY_COLOR` constant.
 *
 * Note: `colors.accent` is deprecated. Use `DEFAULT_PRIMARY_COLOR` or `primaryColor`
 * from the `useCommunityTheme` hook instead.
 */
export const colors = {
  // Brand accent color - the main color used throughout the app
  accent: DEFAULT_PRIMARY_COLOR,
  accentLight: 'rgba(30, 132, 73, 0.1)',

  primary: '#007AFF',
  primaryDark: '#0056CC',
  secondary: DEFAULT_SECONDARY_COLOR,
  background: '#f5f5f5',
  surface: '#ffffff',
  text: '#333333',
  textSecondary: '#666666',
  textTertiary: '#999999',
  border: '#e0e0e0',
  error: '#FF3B30',
  success: '#34C759',
  warning: '#FF9500',
};

/**
 * Common typography
 */
export const typography = {
  h1: {
    fontSize: 32,
    fontWeight: '700' as const,
    lineHeight: 40,
  },
  h2: {
    fontSize: 24,
    fontWeight: '700' as const,
    lineHeight: 32,
  },
  h3: {
    fontSize: 20,
    fontWeight: '600' as const,
    lineHeight: 28,
  },
  body: {
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 24,
  },
  bodySmall: {
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
  },
};
