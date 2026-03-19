/**
 * ThemeProvider - Provides theme colors based on system appearance or user preference.
 *
 * Supports three modes:
 * - 'auto': follows the device's dark/light setting (default)
 * - 'light': forces light mode
 * - 'dark': forces dark mode
 *
 * User preference is persisted to AsyncStorage.
 * All components access theme via `useTheme()` hook.
 */
import React, { createContext, useMemo, useState, useEffect, useCallback } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lightColors, darkColors, type ThemeColors } from '@/theme/colors';

export type ColorScheme = 'light' | 'dark';
export type ThemePreference = 'auto' | 'light' | 'dark';

const THEME_STORAGE_KEY = '@togather/theme-preference';

export interface ThemeContextValue {
  colors: ThemeColors;
  isDark: boolean;
  colorScheme: ColorScheme;
  /** The user's preference: 'auto' follows system, 'light'/'dark' forces that mode */
  preference: ThemePreference;
  /** Update the theme preference (persisted to storage) */
  setPreference: (pref: ThemePreference) => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
  colors: lightColors,
  isDark: false,
  colorScheme: 'light',
  preference: 'auto',
  setPreference: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('auto');

  // Load saved preference on mount
  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'auto') {
        setPreferenceState(stored);
      }
    });
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    AsyncStorage.setItem(THEME_STORAGE_KEY, pref);
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const effectiveScheme: ColorScheme =
      preference === 'auto'
        ? (systemScheme === 'dark' ? 'dark' : 'light')
        : preference;

    return {
      colors: effectiveScheme === 'dark' ? darkColors : lightColors,
      isDark: effectiveScheme === 'dark',
      colorScheme: effectiveScheme,
      preference,
      setPreference,
    };
  }, [systemScheme, preference, setPreference]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}
