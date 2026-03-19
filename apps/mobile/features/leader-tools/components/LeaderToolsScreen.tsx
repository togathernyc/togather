import React, { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { DragHandle } from "@components/ui/DragHandle";
import { useTheme } from "@hooks/useTheme";

/**
 * Leader Tools landing page is deprecated.
 * Access leader tools (Events, Attendance, Members) via the group chat kebab menu.
 * This page redirects users to the inbox.
 */
export function LeaderToolsScreen() {
  const { colors } = useTheme();
  const router = useRouter();

  useEffect(() => {
    // Redirect to inbox - leader tools are accessed via group chat menu
    router.replace("/inbox");
  }, [router]);

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <DragHandle />
      <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
