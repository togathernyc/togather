/**
 * useTheme - Convenience hook for accessing theme colors.
 *
 * Returns `{ colors, isDark, colorScheme }` from ThemeProvider.
 */
import { useContext } from 'react';
import { ThemeContext, type ThemeContextValue } from '@providers/ThemeProvider';

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
