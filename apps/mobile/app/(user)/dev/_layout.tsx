/**
 * Layout for the Contribute dev-dashboard routes (`/dev`).
 *
 * On phones / narrow viewports: a plain Stack — the list, a conversation, and
 * the compose form are each their own full-screen route, exactly as before.
 *
 * On desktop web (>= 768px): a persistent two-pane split, mirroring the inbox
 * layout (app/inbox/_layout.tsx). The conversation sidebar (ContributeListScreen)
 * is mounted ONCE here on the left and never unmounts as you move between `/dev`,
 * `/dev/[id]`, and `/dev/submit`; only the routed right pane swaps. Mounting the
 * sidebar in the layout — rather than rebuilding it per screen — is what keeps
 * its selected status tab from resetting on navigation, and lets the compose
 * form open in the right pane with the list still visible.
 *
 * The other standalone dev tools that also live under `/dev` (feature-flags,
 * theme-gallery, …) are NOT conversation surfaces, so they render full-screen
 * without the sidebar — see parseDevRoute.
 */
import { useCallback, useMemo } from "react";
import { View, StyleSheet } from "react-native";
import { Stack, usePathname, useRouter } from "expo-router";
import { useIsDesktopWeb } from "@hooks/useIsDesktopWeb";
import { useTheme } from "@hooks/useTheme";
import { ContributeListScreen } from "@features/contribute/components/ContributeListScreen";
import { parseDevRoute } from "@features/contribute/utils/devRoute";
import type { Id } from "@services/api/convex";

export default function DevLayout() {
  const isDesktopWeb = useIsDesktopWeb();
  const pathname = usePathname();
  const router = useRouter();
  const { colors } = useTheme();

  // The URL is the single source of truth for what the right pane shows, so
  // refresh, deep links, and resizing across the breakpoint all agree.
  const { selectedId, composing, isConversationRoute } = useMemo(
    () => parseDevRoute(pathname),
    [pathname],
  );

  const handleSelect = useCallback(
    (id: Id<"devBugs">) => {
      // replace (not push) so switching conversations swaps the pane without
      // stacking a deep back history in the right-pane navigator.
      router.replace(`/(user)/dev/${id}`);
    },
    [router],
  );

  // Split view only wraps the conversation surfaces. Standalone dev tools and
  // phones fall through to the plain stack below.
  if (isDesktopWeb && isConversationRoute) {
    return (
      <View style={styles.container}>
        <View style={styles.sidebar}>
          <ContributeListScreen
            embedded
            selectedId={selectedId}
            composing={composing}
            onSelectConversation={handleSelect}
          />
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <View style={styles.mainPanel}>
          <Stack screenOptions={{ headerShown: false, animation: "none" }}>
            <Stack.Screen name="index" options={{ animation: "none" }} />
            <Stack.Screen name="[id]" options={{ animation: "none" }} />
            <Stack.Screen name="submit" options={{ animation: "none" }} />
          </Stack>
        </View>
      </View>
    );
  }

  // Phone / narrow web, and desktop standalone dev tools: plain stack.
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ animation: "none" }} />
      <Stack.Screen name="[id]" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="submit" options={{ animation: "slide_from_bottom" }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: "row",
  },
  sidebar: {
    width: 340,
  },
  divider: {
    width: 1,
  },
  mainPanel: {
    flex: 1,
  },
});
