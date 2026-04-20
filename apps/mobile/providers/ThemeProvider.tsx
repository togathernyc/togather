/**
 * ThemeProvider — provides theme colors and fonts based on system appearance or user preference.
 *
 * Preferences:
 *   - 'auto': follows the device's dark/light setting (default) — system fonts
 *   - 'light' / 'dark': forces that system mode — system fonts
 *   - 'hearth' / 'console' / 'conservatory': full design themes — palette + web fonts
 *
 * Persistence: AsyncStorage (@togather/theme-preference).
 * All components access theme via `useTheme()` hook.
 */
import React, { createContext, useMemo, useState, useEffect, useCallback } from 'react';
import { Text, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  lightColors,
  darkColors,
  hearthColors,
  consoleColors,
  conservatoryColors,
  type ThemeColors,
} from '@/theme/colors';
import {
  defaultFonts,
  hearthFonts,
  consoleFonts,
  conservatoryFonts,
  type ThemeFonts,
} from '@/theme/fonts';
import { useThemeFonts } from '@/theme/fontLoader';
import { isThemePreference, type ThemePreference } from '@/theme/preferences';

export type { ThemePreference } from '@/theme/preferences';
export type ColorScheme = 'light' | 'dark';

const THEME_STORAGE_KEY = '@togather/theme-preference';

export interface ThemeContextValue {
  colors: ThemeColors;
  fonts: ThemeFonts;
  isDark: boolean;
  colorScheme: ColorScheme;
  /** The user's preference. 'auto' follows system; named design themes force their look. */
  preference: ThemePreference;
  /** Update the theme preference (persisted to storage). */
  setPreference: (pref: ThemePreference) => void;
  /** True while the native font pack for a design theme is still loading. */
  fontsLoading: boolean;
}

export const ThemeContext = createContext<ThemeContextValue>({
  colors: lightColors,
  fonts: defaultFonts,
  isDark: false,
  colorScheme: 'light',
  preference: 'auto',
  setPreference: () => {},
  fontsLoading: false,
});

type ResolvedTheme = {
  colors: ThemeColors;
  fonts: ThemeFonts;
  isDark: boolean;
  colorScheme: ColorScheme;
};

function resolveTheme(
  preference: ThemePreference,
  systemScheme: ColorScheme | null | undefined,
): ResolvedTheme {
  switch (preference) {
    case 'hearth':
      return { colors: hearthColors, fonts: hearthFonts, isDark: true, colorScheme: 'dark' };
    case 'console':
      return { colors: consoleColors, fonts: consoleFonts, isDark: false, colorScheme: 'light' };
    case 'conservatory':
      return { colors: conservatoryColors, fonts: conservatoryFonts, isDark: false, colorScheme: 'light' };
    case 'light':
      return { colors: lightColors, fonts: defaultFonts, isDark: false, colorScheme: 'light' };
    case 'dark':
      return { colors: darkColors, fonts: defaultFonts, isDark: true, colorScheme: 'dark' };
    case 'auto':
    default: {
      const isDark = systemScheme === 'dark';
      return {
        colors: isDark ? darkColors : lightColors,
        fonts: defaultFonts,
        isDark,
        colorScheme: isDark ? 'dark' : 'light',
      };
    }
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('auto');

  // Load saved preference on mount
  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY).then((stored) => {
      if (isThemePreference(stored)) {
        setPreferenceState(stored);
      }
    });
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    AsyncStorage.setItem(THEME_STORAGE_KEY, pref);
  }, []);

  const resolved = useMemo(() => resolveTheme(preference, systemScheme), [preference, systemScheme]);

  // Kick off font loading (no-op for auto/light/dark)
  const { loaded: fontsLoaded } = useThemeFonts(preference);

  // Propagate body font to every <Text> via defaultProps. Safe app-wide because
  // no existing component sets its own `fontFamily` (voting gallery aside).
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const TextAny = Text as any;
    const prev = TextAny.defaultProps?.style;
    TextAny.defaultProps = {
      ...(TextAny.defaultProps ?? {}),
      style: [{ fontFamily: resolved.fonts.body }],
    };
    return () => {
      TextAny.defaultProps = {
        ...(TextAny.defaultProps ?? {}),
        style: prev,
      };
    };
  }, [resolved.fonts.body]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors: resolved.colors,
      fonts: resolved.fonts,
      isDark: resolved.isDark,
      colorScheme: resolved.colorScheme,
      preference,
      setPreference,
      fontsLoading: !fontsLoaded,
    }),
    [resolved, preference, setPreference, fontsLoaded],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
