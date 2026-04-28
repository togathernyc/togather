import { useMemo } from "react";
import { View, StyleSheet } from "react-native";
import { Stack, usePathname } from "expo-router";
import { useIsDesktopWeb } from "../../hooks/useIsDesktopWeb";
import { ChatInboxScreen } from "@features/chat/components/ChatInboxScreen";
import { DesktopSideNav } from "@components/DesktopSideNav";
import { useTheme } from "@hooks/useTheme";

/**
 * Layout for inbox routes
 *
 * On mobile / narrow viewports: standard Stack navigation with slide animations.
 * On desktop web (>= 768px): iMessage-style split panel with conversation list
 * on the left and active chat on the right.
 *
 * Routes:
 * - /inbox - Inbox list (no animation from tabs)
 * - /inbox/[groupId] - Group chat (slide from right on mobile)
 * - /inbox/[chat_id] - Direct message (slide from right on mobile)
 */
export default function InboxLayout() {
  const isDesktopWeb = useIsDesktopWeb();
  const pathname = usePathname();
  const { colors } = useTheme();

  // Extract activeGroupId and activeChannelSlug from the current path
  // Pattern: /inbox/[groupId]/[channelSlug]
  const { activeGroupId, activeChannelSlug } = useMemo(() => {
    const match = pathname.match(/^\/inbox\/([^/]+)\/([^/]+)/);
    if (match) {
      return { activeGroupId: match[1], activeChannelSlug: match[2] };
    }
    return { activeGroupId: undefined, activeChannelSlug: undefined };
  }, [pathname]);

  if (isDesktopWeb) {
    return (
      <View style={desktopStyles.container}>
        <DesktopSideNav />

        {/* Sidebar: conversation list */}
        <View style={desktopStyles.sidebar}>
          <ChatInboxScreen
            sidebarMode
            activeGroupId={activeGroupId}
            activeChannelSlug={activeChannelSlug}
          />
        </View>

        {/* Divider */}
        <View style={[desktopStyles.divider, { backgroundColor: colors.border }]} />

        {/* Main panel: active chat rendered by Stack */}
        <View style={desktopStyles.mainPanel}>
          <Stack
            screenOptions={{
              headerShown: false,
              animation: "none",
            }}
          >
            <Stack.Screen name="index" options={{ animation: "none" }} />
            <Stack.Screen name="[groupId]" options={{ animation: "none" }} />
            <Stack.Screen name="[chat_id]" options={{ animation: "none" }} />
            <Stack.Screen name="dm" options={{ animation: "none" }} />
            <Stack.Screen name="new" options={{ animation: "none" }} />
          </Stack>
        </View>
      </View>
    );
  }

  // Mobile: standard stack navigation
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      {/* Inbox list - no animation since it's part of tabs */}
      <Stack.Screen name="index" options={{ animation: "none" }} />
      {/* Group chats - slide in from right for intuitive navigation */}
      <Stack.Screen name="[groupId]" options={{ animation: "slide_from_right" }} />
      {/* Direct messages - slide in from right */}
      <Stack.Screen name="[chat_id]" options={{ animation: "slide_from_right" }} />
      {/* Ad-hoc direct messages (1:1 + group_dm) */}
      <Stack.Screen name="dm" options={{ animation: "slide_from_right" }} />
      {/* New-chat picker - modal-style entry from the bottom */}
      <Stack.Screen name="new" options={{ animation: "slide_from_bottom" }} />
    </Stack>
  );
}

const desktopStyles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: "row",
  },
  sidebar: {
    width: 350,
    borderRightWidth: 0,
  },
  divider: {
    width: 1,
  },
  mainPanel: {
    flex: 1,
  },
});
