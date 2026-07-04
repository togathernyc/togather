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
import React, { useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { useConnectionStatus } from "@providers/ConnectionProvider";
import { useServingRunSheetCache } from "@/stores/servingRunSheetCache";
import { NativeRunSheetView } from "@features/leader-tools/components/NativeRunSheetView";
import { useEventModeStore } from "@/stores/eventModeStore";
import { ServingPlanSwitcher } from "./ServingPlanSwitcher";

export function ServingRunsheetScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { isNetworkAvailable } = useConnectionStatus();
  // Subscribe so AsyncStorage rehydration re-renders us on a cold offline launch.
  const runSheetCache = useServingRunSheetCache();
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

  // Cache-on-load so serving mode can resolve the owning group + item count
  // offline. This `getEvent` shares the serving run sheet cache with
  // PlanRunSheet (same shape, keyed by planId; stale-while-revalidate, ADR-028).
  useEffect(() => {
    if (activePlanId && event !== undefined) {
      useServingRunSheetCache.getState().setEvent(activePlanId, event);
    }
  }, [activePlanId, event]);

  // Offline fallback: with no radio the live query can't resolve, so read the
  // last-cached event. Web always reports online and waits for live data, so
  // `effEvent === event` there (and whenever online).
  const effEvent =
    event ??
    (activePlanId && !isNetworkAvailable
      ? ((runSheetCache.getEventStale(activePlanId) as
          | { groupId: string; items: unknown[] }
          | null) ?? undefined)
      : undefined);

  const groupId = effEvent?.groupId as Id<"groups"> | undefined;

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
  if (activePlanId && effEvent === undefined) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="small" color={colors.text} />
      </View>
    );
  }

  // Genuinely nothing to show: no active plan, the plan was deleted, or it has
  // no run sheet items — as opposed to merely being outside the serving window.
  const hasItems = !!effEvent && effEvent.items.length > 0;
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
