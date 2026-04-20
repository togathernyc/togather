import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { ThemedHeading } from '../ThemedHeading';
import { ThemeContext } from '@providers/ThemeProvider';
import {
  hearthColors,
  consoleColors,
  conservatoryColors,
  lightColors,
} from '@/theme/colors';
import { hearthFonts, consoleFonts, conservatoryFonts, defaultFonts } from '@/theme/fonts';

function renderWithTheme(
  ui: React.ReactElement,
  theme: {
    colors: typeof lightColors;
    fonts: typeof defaultFonts;
    preference: 'auto' | 'light' | 'dark' | 'hearth' | 'console' | 'conservatory';
    isDark: boolean;
  },
) {
  return render(
    <ThemeContext.Provider
      value={{
        colors: theme.colors,
        fonts: theme.fonts,
        isDark: theme.isDark,
        colorScheme: theme.isDark ? 'dark' : 'light',
        preference: theme.preference,
        setPreference: () => {},
        fontsLoading: false,
      }}
    >
      {ui}
    </ThemeContext.Provider>,
  );
}

function findStyleFontFamily(el: any): string | undefined {
  const s = el.props.style;
  const arr = Array.isArray(s) ? s.flat(Infinity) : [s];
  const match = arr.find((x) => x && typeof x === 'object' && 'fontFamily' in x);
  return match?.fontFamily;
}

describe('ThemedHeading', () => {
  test('uses theme display font (Hearth)', () => {
    const { UNSAFE_getByType } = renderWithTheme(
      <ThemedHeading>Hello</ThemedHeading>,
      { colors: hearthColors, fonts: hearthFonts, preference: 'hearth', isDark: true },
    );
    expect(findStyleFontFamily(UNSAFE_getByType(Text))).toBe(hearthFonts.display);
  });

  test('uses theme display font (Console)', () => {
    const { UNSAFE_getByType } = renderWithTheme(
      <ThemedHeading>Hello</ThemedHeading>,
      { colors: consoleColors, fonts: consoleFonts, preference: 'console', isDark: false },
    );
    expect(findStyleFontFamily(UNSAFE_getByType(Text))).toBe(consoleFonts.display);
  });

  test('uses theme display font (Conservatory)', () => {
    const { UNSAFE_getByType } = renderWithTheme(
      <ThemedHeading>Hello</ThemedHeading>,
      { colors: conservatoryColors, fonts: conservatoryFonts, preference: 'conservatory', isDark: false },
    );
    expect(findStyleFontFamily(UNSAFE_getByType(Text))).toBe(conservatoryFonts.display);
  });

  test('falls back to system font for default themes', () => {
    const { UNSAFE_getByType } = renderWithTheme(
      <ThemedHeading>Hello</ThemedHeading>,
      { colors: lightColors, fonts: defaultFonts, preference: 'light', isDark: false },
    );
    expect(findStyleFontFamily(UNSAFE_getByType(Text))).toBe(defaultFonts.display);
  });

  test('caller style wins over theme style', () => {
    const { UNSAFE_getByType } = renderWithTheme(
      <ThemedHeading style={{ color: '#ff00ff' }}>Hi</ThemedHeading>,
      { colors: hearthColors, fonts: hearthFonts, preference: 'hearth', isDark: true },
    );
    const styles = (UNSAFE_getByType(Text).props.style as any[]).flat(Infinity);
    // theme font present, caller color override present
    expect(styles.find((s) => s?.fontFamily)?.fontFamily).toBe(hearthFonts.display);
    expect(styles.find((s) => s?.color === '#ff00ff')).toBeTruthy();
  });
});
