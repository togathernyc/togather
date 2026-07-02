/**
 * ServingRunsheetScreen
 *
 * The "Runsheet" tab of serving mode. Reuses the existing read-only native run
 * sheet view (`NativeRunSheetView`) for the plan's owning group, so servers see
 * the exact order-of-service their leaders authored in Rostering. It's strictly
 * read-only here (`canEdit={false}`) — editing lives in Rostering.
 *
 * The active plan is tracked in `useEventModeStore.activePlanId`; the owning
 * group id is resolved directly from that plan via `getEvent`, independent of
 * the serving-eligibility window (so previewing an event outside the ~12h
 * window still shows its run sheet).
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

  // Resolve the owning group directly from the active plan — NOT from the
  // serving-eligibility window, which only surfaces plans within ~12h of the
  // event. The volunteer is a confirmed group member, so `getEvent` passes
  // `requireGroupMember` and returns the plan's `groupId` regardless of window.
  const event = useAuthenticatedQuery(
    api.functions.scheduling.events.getEvent,
    isServingMode && activePlanId
      ? { planId: activePlanId as Id<"eventPlans"> }
      : "skip",
  ) as
    | { groupId: string; items: unknown[] }
    | null
    | undefined;

  const groupId = event?.groupId as Id<"groups"> | undefined;

  if (!isServingMode) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          Not currently serving on an event.
        </Text>
      </View>
    );
  }

  // Still loading the plan (only while we actually have a plan to load).
  if (activePlanId && event === undefined) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="small" color={colors.text} />
      </View>
    );
  }

  // Genuinely nothing to show: no active plan, the plan was deleted, or it has
  // no run sheet items — as opposed to merely being outside the serving window.
  const hasItems = !!event && event.items.length > 0;
  if (!groupId || !hasItems) {
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
      <NativeRunSheetView
        groupId={groupId}
        canEdit={false}
        initialPlanId={
          (activePlanId as Id<"eventPlans"> | null) ?? undefined
        }
      />
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
