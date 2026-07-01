/**
 * ServingPlanSwitcher
 *
 * When a volunteer is confirmed on more than one event that's active at the same
 * time (e.g. two campuses on the same morning), serving mode can only focus one
 * plan at a time. This compact pill row — shown at the top of the serving Tasks
 * and Runsheet tabs — lists every active plan and lets them switch which event
 * they're serving without leaving serving mode. Switching updates
 * `useEventModeStore().activePlanId`, which re-scopes tasks, the runsheet, and
 * the filtered inbox reactively.
 *
 * Renders nothing unless the user is serving and has 2+ active plans, so the
 * common single-event case is unaffected.
 */
import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useEventModeStore } from "@/stores/eventModeStore";

type SwitcherPlan = { planId: string; title: string; startsAt: number };

export function ServingPlanSwitcher() {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const isServingMode = useEventModeStore((s) => s.isServingMode);
  const activePlanId = useEventModeStore((s) => s.activePlanId);
  const enter = useEventModeStore((s) => s.enter);

  const eligibility = useAuthenticatedQuery(
    api.functions.scheduling.serving.getServingEligibility,
    isServingMode ? {} : "skip",
  ) as { plans: SwitcherPlan[] } | null | undefined;

  const plans = eligibility?.plans ?? [];
  // Only relevant when serving more than one active event at once.
  if (!isServingMode || plans.length < 2) return null;

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        SERVING
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {plans.map((plan) => {
          const active = plan.planId === activePlanId;
          return (
            <Pressable
              key={plan.planId}
              onPress={() => {
                if (!active) enter(plan.planId);
              }}
              style={[
                styles.pill,
                {
                  borderColor: active ? primaryColor : colors.border,
                  backgroundColor: active ? primaryColor + "14" : "transparent",
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Serve ${plan.title}`}
            >
              <Text
                style={[
                  styles.pillText,
                  { color: active ? primaryColor : colors.text },
                ]}
                numberOfLines={1}
              >
                {plan.title}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 16,
  },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    maxWidth: 220,
  },
  pillText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
