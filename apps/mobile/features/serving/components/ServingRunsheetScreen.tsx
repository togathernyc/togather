/**
 * ServingRunsheetScreen
 *
 * The "Runsheet" tab of serving mode. Reuses the existing read-only native run
 * sheet view (`NativeRunSheetView`) for the plan's owning group, so servers see
 * the exact order-of-service their leaders authored in Rostering. It's strictly
 * read-only here (`canEdit={false}`) — editing lives in Rostering.
 *
 * The owning group id comes from `getServingEligibility().activePlan`; the
 * active plan itself is tracked in `useEventModeStore`.
 */
import React from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { NativeRunSheetView } from "@features/leader-tools/components/NativeRunSheetView";
import { useEventModeStore } from "@/stores/eventModeStore";
import { ServingPlanSwitcher } from "./ServingPlanSwitcher";

export function ServingRunsheetScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const isServingMode = useEventModeStore((s) => s.isServingMode);
  const activePlanId = useEventModeStore((s) => s.activePlanId);

  // The owning group id isn't stored client-side; resolve it from serving
  // eligibility. Prefer the plan the user has switched to (activePlanId), so the
  // run sheet follows the ServingPlanSwitcher; fall back to the soonest plan.
  const eligibility = useAuthenticatedQuery(
    api.functions.scheduling.serving.getServingEligibility,
    isServingMode ? {} : "skip",
  ) as
    | {
        activePlan: { groupId: string } | null;
        plans: { planId: string; groupId: string }[];
      }
    | null
    | undefined;

  const groupId = (eligibility?.plans?.find((p) => p.planId === activePlanId)
    ?.groupId ?? eligibility?.activePlan?.groupId) as Id<"groups"> | undefined;

  if (!isServingMode) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          Not currently serving on an event.
        </Text>
      </View>
    );
  }

  if (eligibility === undefined) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="small" color={colors.text} />
      </View>
    );
  }

  if (!groupId) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="list-outline" size={28} color={colors.textTertiary} />
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          No run sheet available for this event.
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <ServingPlanSwitcher />
      <NativeRunSheetView groupId={groupId} canEdit={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 8,
  },
  emptyText: { fontSize: 15, textAlign: "center" },
});
