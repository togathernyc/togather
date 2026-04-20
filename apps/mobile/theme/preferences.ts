/**
 * The full set of values the user can store in the theme preference.
 *   - auto/light/dark: system-font themes backed by lightColors/darkColors.
 *   - hearth/console/conservatory: full design themes (palette + fonts).
 *
 * Kept in a separate file from ThemeProvider so both the provider and font
 * loader can import it without a circular dependency.
 */
export type ThemePreference = 'auto' | 'light' | 'dark' | 'hearth' | 'console' | 'conservatory';

export const ALL_THEME_PREFERENCES: ThemePreference[] = [
  'auto',
  'light',
  'dark',
  'hearth',
  'console',
  'conservatory',
];

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && ALL_THEME_PREFERENCES.includes(value as ThemePreference);
}
