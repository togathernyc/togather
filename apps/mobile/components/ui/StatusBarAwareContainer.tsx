/**
 * Container that adds bottom safe area padding + extra space for the
 * status bar banner when it's visible. This keeps ALL screens (tabs,
 * chat, modals) above the banner without per-screen fixes.
 *
 * ## Why it knows about the chat room
 *
 * The `paddingBottom` here sits *outside* every screen's box, and this view
 * paints it with its own `colors.background`. On a normal screen that's
 * invisible — the screen is the same opaque surface. On the WhatsApp-shell
 * chat room it is not: the composer bar is a translucent warm fill over the
 * cream wallpaper, so the reserved home-indicator strip below it rendered as a
 * hard WHITE band in light mode and as a near-black band (against the lighter
 * chat chrome) in dark mode — the page read as stacked colors rather than one
 * surface (owner's device reports, 2026-07-30).
 *
 * The wallpaper layer can't fix it from inside the screen: it's clipped by this
 * padding. So flag-on, on the two chat-room routes, this strip takes the
 * composer bar's own rendered tone, flattened to an opaque color because
 * there's no wallpaper beneath it to blend with. Everything else — every other
 * route, and the whole app flag-off — is untouched.
 *
 * (The matching strip at the *top* of the chat page belongs to the screen's own
 * `paddingTop`; see `features/chat/components/ChatRoomSurface`.)
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useWhatsappShell } from "@hooks/useWhatsappShell";
import { waComposerBarOpaque } from "@features/chat/waChatChrome";
import {
  StatusBar as BottomStatusBar,
  useStatusBarVisible,
  STATUS_BAR_CONTENT_HEIGHT,
} from "@components/ui/StatusBar";

/**
 * The two routes that mount `ConvexChatRoomScreen`:
 * `inbox/[groupId]/[channelSlug]` (group channel) and `inbox/dm/[channelId]`
 * (ad-hoc DM). Deeper routes under them — thread, info, members — are ordinary
 * screens and must keep the default background.
 */
function isChatRoomRoute(segments: string[]): boolean {
  return (
    segments.length === 3 &&
    segments[0] === "inbox" &&
    (segments[2] === "[channelSlug]" || segments[2] === "[channelId]")
  );
}

export function StatusBarAwareContainer({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const isStatusBarVisible = useStatusBarVisible();
  const segments = useSegments();
  const { colors, isDark } = useTheme();
  const whatsappShellEnabled = useWhatsappShell();

  // Landing page needs edge-to-edge design with dark background
  const segmentArray = segments as string[];
  const isLandingPage =
    segmentArray.includes("landing") ||
    (segmentArray[0] === "(auth)" && segmentArray[1] === "landing");
  const isWaChatRoom = whatsappShellEnabled && isChatRoomRoute(segmentArray);

  // Keep padding consistent to prevent jank
  const bottomPadding = insets.bottom + (isStatusBarVisible ? STATUS_BAR_CONTENT_HEIGHT : 0);

  const backgroundColor = isLandingPage
    ? "transparent"
    : isWaChatRoom
      ? waComposerBarOpaque(colors.chatWallpaper, isDark)
      : colors.background;

  return (
    <>
      {/* Background layer for landing page - matches image bottom fade */}
      {isLandingPage && (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.landing }]} />
      )}
      <View testID="root-inset-container" style={{ flex: 1, backgroundColor, paddingBottom: bottomPadding }}>
        {children}
      </View>
      <BottomStatusBar />
    </>
  );
}
