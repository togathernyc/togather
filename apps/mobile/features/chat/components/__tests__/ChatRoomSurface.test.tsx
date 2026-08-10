/**
 * ChatRoomSurface — the chat page's TOP safe-area strip.
 *
 * The status-bar zone is this view's `paddingTop`, which sits outside the
 * children's box, so the wallpaper layer can never reach it: the surface's own
 * `backgroundColor` is what the user sees up there. Flag-on it used to be the
 * wallpaper base color, which in dark mode is near-black while the nav header
 * immediately below is the *lighter* translucent chrome — the page read as
 * three stacked colors (owner's dark-mode device screenshot, 2026-07-30).
 *
 * These tests pin the strip to the header's own rendered tone in BOTH themes,
 * and pin flag-off to the untouched `colors.surface`.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { ChatRoomSurface } from '../ChatRoomSurface';
import { darkColors, lightColors } from '../../../../theme/colors';
import { waChatChromeOpaque } from '../../waChatChrome';

// iPhone 14/15 notch + home indicator.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));

let mockIsDark = false;
jest.mock('@hooks/useTheme', () => ({
  useTheme: () => {
    // Required lazily: jest.mock factories run before module scope.
    const colors = require('../../../../theme/colors');
    return {
      colors: mockIsDark ? colors.darkColors : colors.lightColors,
      isDark: mockIsDark,
    };
  },
}));

function renderSurface(whatsappShellEnabled: boolean) {
  return render(
    <ChatRoomSurface whatsappShellEnabled={whatsappShellEnabled}>
      <Text>thread</Text>
    </ChatRoomSurface>
  );
}

function surfaceStyle(getByTestId: (id: string) => { props: { style: unknown } }) {
  return StyleSheet.flatten(getByTestId('chat-room-surface').props.style) as {
    backgroundColor: string;
    paddingTop: number;
  };
}

describe('ChatRoomSurface top safe-area strip', () => {
  afterEach(() => {
    mockIsDark = false;
  });

  it('reserves the status-bar inset', () => {
    const { getByTestId } = renderSurface(true);
    expect(surfaceStyle(getByTestId).paddingTop).toBe(59);
  });

  it('paints the strip with the header tone in light mode', () => {
    const { getByTestId } = renderSurface(true);
    const style = surfaceStyle(getByTestId);
    expect(style.backgroundColor).toBe(waChatChromeOpaque(lightColors.chatWallpaper, false));
    expect(style.backgroundColor).toBe('#EFE9E1');
    // The bug: a strip painted with a root chrome color instead of the chat's.
    expect(style.backgroundColor.toLowerCase()).not.toBe(lightColors.background.toLowerCase());
  });

  it('paints the strip with the header tone in dark mode, not the near-black base', () => {
    mockIsDark = true;
    const { getByTestId } = renderSurface(true);
    const style = surfaceStyle(getByTestId);
    expect(style.backgroundColor).toBe(waChatChromeOpaque(darkColors.chatWallpaper, true));
    expect(style.backgroundColor).toBe('#101A20');
    expect(style.backgroundColor.toLowerCase()).not.toBe(darkColors.background.toLowerCase());
    expect(style.backgroundColor.toLowerCase()).not.toBe(
      darkColors.chatWallpaper.toLowerCase()
    );
  });

  it('drops the wallpaper layer behind everything when the shell is on', () => {
    const { getByTestId } = renderSurface(true);
    expect(getByTestId('chat-wallpaper')).toBeTruthy();
  });

  it('renders the untouched surface color with no wallpaper when the shell is off', () => {
    const { getByTestId, queryByTestId } = renderSurface(false);
    expect(surfaceStyle(getByTestId).backgroundColor).toBe(lightColors.surface);
    expect(queryByTestId('chat-wallpaper')).toBeNull();
  });
});
