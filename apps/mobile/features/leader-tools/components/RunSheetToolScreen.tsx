/**
 * RunSheetToolScreen
 *
 * Entry point for the leader-tools "Run Sheet" tool. Branches on the group's
 * configured run sheet source (ADR-026):
 *   - "native" → the group's upcoming event plan run sheets (NativeRunSheetView)
 *   - "pco" (default) → the legacy Planning Center run sheet (RunSheetScreen)
 *
 * The source is set in Run Sheet Settings. Kept as a thin wrapper so the PCO
 * screen's hook-heavy body is never conditionally mounted mid-render.
 */
import React from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTheme } from "@hooks/useTheme";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { RunSheetScreen } from "./RunSheetScreen";
import { NativeRunSheetView } from "./NativeRunSheetView";

export function RunSheetToolScreen() {
  const { colors } = useTheme();
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const groupId = group_id as Id<"groups">;

  const groupData = useAuthenticatedQuery(
    api.functions.groups.queries.getById,
    group_id ? { groupId } : "skip",
  ) as { runSheetSource?: string; userRole?: string } | null | undefined;

  if (groupData === undefined) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.surface }]}>
        <ActivityIndicator size="small" color={colors.text} />
      </View>
    );
  }

  if (groupData?.runSheetSource === "native") {
    return (
      <NativeRunSheetView
        groupId={groupId}
        canEdit={groupData?.userRole === "leader" || groupData?.userRole === "admin"}
      />
    );
  }

  // Default / legacy: Planning Center run sheet.
  return <RunSheetScreen />;
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
});
