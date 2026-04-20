import React, { useContext } from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ThemeProvider, ThemeContext, type ThemeContextValue } from '../ThemeProvider';
import {
  hearthColors,
  consoleColors,
  conservatoryColors,
  lightColors,
  darkColors,
} from '@/theme/colors';
import { hearthFonts, consoleFonts, conservatoryFonts, defaultFonts } from '@/theme/fonts';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

// Font loader is a real module but its native side-effects (expo-font) are not
// available in the jest env. Stub it to resolve immediately.
jest.mock('@/theme/fontLoader', () => ({
  useThemeFonts: () => ({ loaded: true }),
}));

const getItemMock = AsyncStorage.getItem as jest.Mock;
const setItemMock = AsyncStorage.setItem as jest.Mock;

function TestConsumer({ onValue }: { onValue: (ctx: ThemeContextValue) => void }) {
  const ctx = useContext(ThemeContext);
  onValue(ctx);
  return <Text>ok</Text>;
}

async function mountWithStoredPreference(stored: string | null) {
  getItemMock.mockResolvedValueOnce(stored);
  let captured: ThemeContextValue | undefined;
  const result = render(
    <ThemeProvider>
      <TestConsumer onValue={(v) => (captured = v)} />
    </ThemeProvider>,
  );
  // Flush effects that read AsyncStorage
  await waitFor(() => expect(getItemMock).toHaveBeenCalled());
  return { result, read: () => captured! };
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('defaults to auto + lightColors + defaultFonts when no stored preference', async () => {
    const { read } = await mountWithStoredPreference(null);
    await waitFor(() => {
      const ctx = read();
      expect(ctx.preference).toBe('auto');
      expect(ctx.colors).toBe(lightColors);
      expect(ctx.fonts).toBe(defaultFonts);
    });
  });

  test.each([
    ['hearth', hearthColors, hearthFonts, true],
    ['console', consoleColors, consoleFonts, false],
    ['conservatory', conservatoryColors, conservatoryFonts, false],
    ['light', lightColors, defaultFonts, false],
    ['dark', darkColors, defaultFonts, true],
  ])('loads stored preference %s → expected palette + fonts', async (pref, expectedColors, expectedFonts, expectedIsDark) => {
    const { read } = await mountWithStoredPreference(pref);
    await waitFor(() => {
      const ctx = read();
      expect(ctx.preference).toBe(pref);
      expect(ctx.colors).toBe(expectedColors);
      expect(ctx.fonts).toBe(expectedFonts);
      expect(ctx.isDark).toBe(expectedIsDark);
    });
  });

  test('ignores unknown stored values (falls back to auto)', async () => {
    const { read } = await mountWithStoredPreference('totally-bogus-theme');
    await waitFor(() => {
      expect(read().preference).toBe('auto');
    });
  });

  test('setPreference persists to AsyncStorage', async () => {
    const { read } = await mountWithStoredPreference(null);
    await waitFor(() => expect(read()).toBeDefined());

    act(() => {
      read().setPreference('hearth');
    });

    expect(setItemMock).toHaveBeenCalledWith('@togather/theme-preference', 'hearth');
    await waitFor(() => {
      expect(read().colors).toBe(hearthColors);
      expect(read().fonts).toBe(hearthFonts);
    });
  });

  test('applies body font to Text.defaultProps for the active theme', async () => {
    const { read } = await mountWithStoredPreference('hearth');
    await waitFor(() => expect(read().colors).toBe(hearthColors));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const defaultStyle = (Text as any).defaultProps?.style;
    const flat = Array.isArray(defaultStyle) ? Object.assign({}, ...defaultStyle) : defaultStyle;
    expect(flat?.fontFamily).toBe(hearthFonts.body);
  });

  test('switching theme updates Text.defaultProps body font', async () => {
    const { read } = await mountWithStoredPreference('hearth');
    await waitFor(() => expect(read().colors).toBe(hearthColors));

    act(() => {
      read().setPreference('console');
    });

    await waitFor(() => expect(read().colors).toBe(consoleColors));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const defaultStyle = (Text as any).defaultProps?.style;
    const flat = Array.isArray(defaultStyle) ? Object.assign({}, ...defaultStyle) : defaultStyle;
    expect(flat?.fontFamily).toBe(consoleFonts.body);
  });
});
