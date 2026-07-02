/**
 * ServingExitScreen
 *
 * The "Exit" tab of serving mode. Selecting it drops the user out of serving
 * mode (`useEventModeStore().exit()`) and routes them back to the normal Inbox
 * tab. It renders nothing meaningful — it's an action, not a screen — so it
 * shows a brief spinner while the exit + redirect happen.
 *
 * `useFocusEffect` (rather than `useEffect`) so re-tapping the tab after a prior
 * exit re-runs the action, and the exit doesn't fire while the tab is merely
 * mounted-but-unfocused.
 */
import React, { useCallback } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useTheme } from "@hooks/useTheme";
import { useEventModeStore } from "@/stores/eventModeStore";

export function ServingExitScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const exit = useEventModeStore((s) => s.exit);

  useFocusEffect(
    useCallback(() => {
      // Navigate off the Exit tab to Inbox — a tab visible in BOTH serving and
      // normal mode — before dropping serving mode. Flipping the store while
      // still focused on the Exit tab (which then becomes `href: null`) leaves
      // the Tabs navigator focused on a now-hidden route and the tab bar stuck
      // in the serving layout. Deferring the store update to the next tick lets
      // the navigation commit first, so the store-driven re-render of the tab
      // bar re-evaluates every href with Inbox already focused and cleanly
      // restores the normal tab bar.
      router.replace("/(tabs)/chat");
      const t = setTimeout(() => exit(), 0);
      return () => clearTimeout(t);
    }, [exit, router]),
  );

  return (
    <View style={[styles.centered, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="small" color={colors.text} />
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
});
