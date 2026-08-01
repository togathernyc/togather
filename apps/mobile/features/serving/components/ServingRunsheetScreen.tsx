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
import { useWhatsappShell } from "@hooks/useWhatsappShell";
import {
  WA_GROUP_MARGIN,
  WA_GROUP_SPACING,
  WA_SECTION_HEADER_GAP,
  WA_TYPE_SECTION_HEADER,
  WA_TYPE_SUBTITLE,
  WA_WEIGHT_REGULAR,
  WA_WEIGHT_SEMIBOLD,
} from "@components/wa";
import { PlanRunSheet } from "@features/leader-tools/components/NativeRunSheetView";
import { useEventModeStore } from "@/stores/eventModeStore";
import { useServingPlans } from "../hooks/useServingPlans";
import { planSubtitle } from "../utils/servingProvenance";

type ServingPlan = {
  planId: string;
  groupId: string;
  /** The campus that rostered the viewer — the section header's subtitle. */
  groupName?: string;
  title: string;
  startsAt: number;
  endsAt: number;
  /** The viewer's own teams on this plan. */
  teamNames?: string[];
};

type EligibilityResult = {
  plans: ServingPlan[];
  /** Future plans openable early to prepare — see `useServingPlans`. */
  upcomingPlans: ServingPlan[];
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
  // Flag-on restyle only (WHATSAPP-DESIGN-SYSTEM.md §7). Note the run sheet
  // itself is `PlanRunSheet` (leader-tools) — this screen only owns the
  // per-plan section headers around it.
  const wa = useWhatsappShell();
  const router = useRouter();
  const isServingMode = useEventModeStore((s) => s.isServingMode);
  const previewPlanId = useEventModeStore((s) => s.previewPlanId);

  const eligibility = useAuthenticatedQuery(
    api.functions.scheduling.serving.getServingEligibility,
    isServingMode ? {} : "skip",
  ) as EligibilityResult | null | undefined;

  // Today's plans, or the single upcoming plan opened early for preview.
  const plans = useServingPlans(eligibility);

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
        <Text
          style={[styles.emptyText, wa && waStyles.emptyText, { color: colors.textSecondary }]}
        >
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
        <Text
          style={[styles.emptyText, wa && waStyles.emptyText, { color: colors.textSecondary }]}
        >
          Loading run sheets…
        </Text>
      </View>
    );
  }

  if (plans.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="list-outline" size={28} color={colors.textTertiary} />
        <Text
          style={[styles.emptyText, wa && waStyles.emptyText, { color: colors.textSecondary }]}
        >
          {previewPlanId
            ? "This event isn't available to preview anymore."
            : "No run sheet available."}
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
      {plans.map((plan) => {
        const subtitle = planSubtitle(plan.groupName, plan.teamNames);
        return (
        <View key={plan.planId} style={[styles.planSection, wa && waStyles.planSection]}>
          <View style={[styles.planHeader, wa && waStyles.planHeader]}>
            <View style={styles.planHeaderRow}>
              <Text
                style={[styles.planTitle, wa && waStyles.planTitle, { color: colors.text }]}
                numberOfLines={1}
              >
                {plan.title}
              </Text>
              <Text
                style={[
                  styles.planDate,
                  wa && waStyles.planDate,
                  { color: colors.textTertiary },
                ]}
              >
                {formatPlanDate(plan.startsAt)}
              </Text>
            </View>
            {/* Which campus/teams this section is — without it two same-day
                plans stack under identical headers. */}
            {subtitle ? (
              <Text
                style={[
                  styles.planGroup,
                  wa && waStyles.planGroup,
                  { color: colors.textSecondary },
                ]}
                numberOfLines={1}
              >
                {subtitle}
              </Text>
            ) : null}
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
        );
      })}
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
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  planHeaderRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  planTitle: { fontSize: 16, fontWeight: "700", flexShrink: 1 },
  planDate: { fontSize: 13, fontWeight: "500" },
  planGroup: { fontSize: 13, fontWeight: "600", marginTop: 2 },
});

/**
 * `whatsapp-shell` (flag-on) overrides, applied as
 * `[styles.x, wa && waStyles.x]` so flag-off is byte-identical.
 *
 * This screen is thin — one section header per plan wrapped around
 * `PlanRunSheet`. The header moves onto the §2 landing-section-header role
 * (~20pt semibold sentence-case) with a 15pt gray date beside it, and the
 * inter-plan gap onto `WA_GROUP_SPACING`.
 */
const waStyles = StyleSheet.create({
  emptyText: { fontSize: WA_TYPE_SUBTITLE },
  planSection: { paddingTop: WA_GROUP_SPACING },
  planHeader: {
    paddingHorizontal: WA_GROUP_MARGIN,
    marginBottom: WA_SECTION_HEADER_GAP,
  },
  planTitle: { fontSize: WA_TYPE_SECTION_HEADER, fontWeight: WA_WEIGHT_SEMIBOLD },
  planDate: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_REGULAR },
  planGroup: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_SEMIBOLD },
});
