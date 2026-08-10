/**
 * StatusBarAwareContainer — the app's BOTTOM safe-area strip.
 *
 * `paddingBottom` here sits outside every screen's box and this container
 * paints it with its own background, so on the WhatsApp-shell chat room the
 * home-indicator band rendered as the app's root chrome instead of the chat's:
 * a hard WHITE band under the composer in light mode, a near-black band in dark
 * mode (owner's device reports, 2026-07-30).
 *
 * These tests pin the chat-route strip to the composer bar's own rendered tone
 * in BOTH themes, and pin every other route — and the whole app flag-off — to
 * the unchanged `colors.background`.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { StatusBarAwareContainer } from '../StatusBarAwareContainer';
import { darkColors, lightColors } from '../../../theme/colors';
import { waComposerBarOpaque } from '../../../features/chat/waChatChrome';

// iPhone 14/15 notch + home indicator.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

let mockSegments: string[] = [];
jest.mock('expo-router', () => ({
  useSegments: () => mockSegments,
}));

let mockIsDark = false;
jest.mock('@hooks/useTheme', () => ({
  useTheme: () => {
    const colors = require('../../../theme/colors');
    return {
      colors: mockIsDark ? colors.darkColors : colors.lightColors,
      isDark: mockIsDark,
    };
  },
}));

let mockShellEnabled = true;
jest.mock('@hooks/useWhatsappShell', () => ({
  useWhatsappShell: () => mockShellEnabled,
}));

jest.mock('@components/ui/StatusBar', () => ({
  StatusBar: () => null,
  useStatusBarVisible: () => false,
  STATUS_BAR_CONTENT_HEIGHT: 24,
}));

function renderContainer() {
  return render(
    <StatusBarAwareContainer>
      <Text>screen</Text>
    </StatusBarAwareContainer>
  );
}

function stripStyle(getByTestId: (id: string) => { props: { style: unknown } }) {
  return StyleSheet.flatten(getByTestId('root-inset-container').props.style) as {
    backgroundColor: string;
    paddingBottom: number;
  };
}

const GROUP_CHANNEL_ROUTE = ['inbox', '[groupId]', '[channelSlug]'];
const DM_ROUTE = ['inbox', 'dm', '[channelId]'];

describe('StatusBarAwareContainer bottom safe-area strip', () => {
  beforeEach(() => {
    mockSegments = GROUP_CHANNEL_ROUTE;
    mockIsDark = false;
    mockShellEnabled = true;
  });

  it('reserves the home-indicator inset', () => {
    const { getByTestId } = renderContainer();
    expect(stripStyle(getByTestId).paddingBottom).toBe(34);
  });

  it('paints the strip with the composer tone in light mode, not white', () => {
    const { getByTestId } = renderContainer();
    const style = stripStyle(getByTestId);
    expect(style.backgroundColor).toBe(waComposerBarOpaque(lightColors.chatWallpaper, false));
    expect(style.backgroundColor).toBe('#EFE9E1');
    // The reported bug, exactly.
    expect(style.backgroundColor.toLowerCase()).not.toBe('#ffffff');
    expect(style.backgroundColor.toLowerCase()).not.toBe(lightColors.background.toLowerCase());
  });

  it('paints the strip with the composer tone in dark mode, not the near-black root', () => {
    mockIsDark = true;
    const { getByTestId } = renderContainer();
    const style = stripStyle(getByTestId);
    expect(style.backgroundColor).toBe(waComposerBarOpaque(darkColors.chatWallpaper, true));
    expect(style.backgroundColor).toBe('#10191F');
    expect(style.backgroundColor.toLowerCase()).not.toBe(darkColors.background.toLowerCase());
  });

  it('covers ad-hoc DMs too', () => {
    mockSegments = DM_ROUTE;
    const { getByTestId } = renderContainer();
    expect(stripStyle(getByTestId).backgroundColor).toBe('#EFE9E1');
  });

  it.each([
    ['the inbox list', ['inbox']],
    ['the channel list', ['inbox', '[groupId]']],
    ['a channel sub-page', ['inbox', '[groupId]', 'channels']],
    ['a message thread', ['inbox', '[groupId]', 'thread', '[messageId]']],
    ['a tab screen', ['(tabs)', 'index']],
  ])('leaves %s on the root background', (_label, segments) => {
    mockSegments = segments as string[];
    const { getByTestId } = renderContainer();
    expect(stripStyle(getByTestId).backgroundColor).toBe(lightColors.background);
  });

  it('is unchanged on the chat route when the shell flag is off', () => {
    mockShellEnabled = false;
    const { getByTestId } = renderContainer();
    const style = stripStyle(getByTestId);
    expect(style.backgroundColor).toBe(lightColors.background);
    expect(style.paddingBottom).toBe(34);
  });

  it('still hands the landing page its edge-to-edge transparent background', () => {
    mockSegments = ['(auth)', 'landing'];
    const { getByTestId } = renderContainer();
    expect(stripStyle(getByTestId).backgroundColor).toBe('transparent');
  });
});
