/**
 * ChatRoomSurface — the chat room's root box: keyboard avoidance, the
 * tap-to-dismiss backdrop, and (flag-on) the wallpaper layer behind everything.
 *
 * Extracted from `ConvexChatRoomScreen` so the *edges* of the chat page can be
 * tested on their own. They are where the WhatsApp shell kept leaking the
 * app's root chrome:
 *
 * - The status-bar strip is this view's `paddingTop`. Padding sits outside the
 *   children's box, so `ChatWallpaper`'s `absoluteFill` (which lives inside the
 *   `Pressable` below) physically cannot reach it — whatever this view's own
 *   `backgroundColor` is, is what the user sees up there.
 * - Flag-on that used to be `colors.chatWallpaper`. In light mode that reads
 *   fine; in dark mode the wallpaper base is near-black while the nav header
 *   right below it is the *lighter* translucent chrome, so the page read as
 *   three stacked colors (owner's dark-mode device screenshot, 2026-07-30).
 *
 * So flag-on the strip takes the header's own rendered tone, flattened to an
 * opaque color (`waChatChromeOpaque`) because there's no wallpaper underneath
 * for a translucent fill to blend with. The header then continues to the
 * screen edge instead of banding.
 *
 * The matching strip at the *bottom* (below the composer) is `paddingBottom` on
 * the app-wide root container — see `components/ui/StatusBarAwareContainer`.
 *
 * Flag-off this renders exactly what it always did: `colors.surface`.
 */
import React from 'react';
import { KeyboardAvoidingView, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@hooks/useTheme';
import { waChatChromeOpaque } from '../waChatChrome';
import { ChatWallpaper } from './ChatWallpaper';

interface ChatRoomSurfaceProps {
  whatsappShellEnabled: boolean;
  /** Tap-anywhere-to-dismiss handler; omitted on web, where it fights focus. */
  onPress?: () => void;
  children: React.ReactNode;
}

export function ChatRoomSurface({
  whatsappShellEnabled,
  onPress,
  children,
}: ChatRoomSurfaceProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView
      testID="chat-room-surface"
      style={[
        styles.fill,
        { paddingTop: insets.top, backgroundColor: colors.surface },
        whatsappShellEnabled && {
          backgroundColor: waChatChromeOpaque(colors.chatWallpaper, isDark),
        },
      ]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <Pressable
        style={[
          styles.fill,
          { backgroundColor: colors.surface },
          whatsappShellEnabled && styles.transparent,
        ]}
        onPress={onPress}
      >
        {/* §S4.1 "applied to the whole thread area and under the translucent
            nav/composer" — one non-interactive layer behind every child, so
            the header, tab strip, list and composer all sit on the same
            wallpaper instead of each painting its own background. */}
        {whatsappShellEnabled && <ChatWallpaper />}
        {children}
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  // §S4.1 — every flag-on layer between the wallpaper and the content must be
  // see-through, or the pattern gets painted over.
  transparent: {
    backgroundColor: 'transparent',
  },
});
