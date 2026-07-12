/**
 * ServingRunsheetScreen
 *
 * The "Runsheet" tab of serving mode. Serving mode spans every plan the user is
 * serving today, so this stacks one read-only run-sheet SECTION per eligible
 * plan (soonest-first), each headed by the plan's title. It reuses the existing
 * `PlanRunSheet` view (`canEdit={false}`) in its embedded (parent-scrolled)
 * mode, so servers see the exact order-of-service their leaders authored in
 * Rostering. Editing still lives in Rostering.
 *
 * The eligible plans come from `getServingEligibility` (cached for offline via
 * `useCachedServingPlans`); each `PlanRunSheet` caches its own event + items per
 * planId (see servingRunSheetCache / ADR-028), so the whole tab works offline.
 */
import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { PlanRunSheet } from "@features/leader-tools/components/NativeRunSheetView";
import { useEventModeStore } from "@/stores/eventModeStore";
import { useCachedServingPlans } from "../hooks/useCachedServingPlans";

type EligibilityResult = {
  plans: Array<{
    planId: string;
    groupId: string;
    title: string;
    startsAt: number;
    endsAt: number;
  }>;
};

function formatPlanDate(startsAt: number): string {
  return new Date(startsAt).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function ServingRunsheetScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isServingMode = useEventModeStore((s) => s.isServingMode);

  const eligibility = useAuthenticatedQuery(
    api.functions.scheduling.serving.getServingEligibility,
    isServingMode ? {} : "skip",
  ) as EligibilityResult | null | undefined;

  const plans = useCachedServingPlans(eligibility?.plans);

  // This tool renders inside the `(user)` modal route group; pushing a
  // `/rostering/...` card from inside the modal lands it behind the modal on
  // iOS, so dismiss the modal stack first, then navigate (mirrors
  // NativeRunSheetView's own navigation).
  const navigateToRostering = (path: string) => {
    if (router.canDismiss?.()) router.dismissAll();
    router.push(path as never);
  };

  if (!isServingMode) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          Not currently serving on an event.
        </Text>
      </View>
    );
  }

  // Still loading the eligible plans (only when we have no cached fallback yet).
  if (eligibility === undefined && plans.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="list-outline" size={28} color={colors.textTertiary} />
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          Loading run sheets…
        </Text>
      </View>
    );
  }

  if (plans.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="list-outline" size={28} color={colors.textTertiary} />
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          No run sheet available.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{
        paddingTop: insets.top,
        paddingBottom: insets.bottom + 24,
      }}
    >
      {plans.map((plan) => (
        <View key={plan.planId} style={styles.planSection}>
          <View style={styles.planHeader}>
            <Text
              style={[styles.planTitle, { color: colors.text }]}
              numberOfLines={1}
            >
              {plan.title}
            </Text>
            <Text style={[styles.planDate, { color: colors.textTertiary }]}>
              {formatPlanDate(plan.startsAt)}
            </Text>
          </View>
          <PlanRunSheet
            embedded
            planId={plan.planId as Id<"eventPlans">}
            groupId={plan.groupId as Id<"groups">}
            canEdit={false}
            onEdit={() =>
              navigateToRostering(
                `/rostering/${plan.groupId}/run-sheet/${plan.planId}`,
              )
            }
            onRehearse={() =>
              navigateToRostering(
                `/rostering/${plan.groupId}/run-sheet/rehearse/${plan.planId}`,
              )
            }
          />
        </View>
      ))}
    </ScrollView>
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
  planSection: { paddingTop: 20 },
  planHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  planTitle: { fontSize: 16, fontWeight: "700", flexShrink: 1 },
  planDate: { fontSize: 13, fontWeight: "500" },
});
