/**
 * RosteringSection
 *
 * Leader-only single entry row on the group page that opens the Rostering hub
 * (/rostering/[group_id]). It sits below UpcomingEventsSection and matches the
 * aesthetic of the sibling Check-in / Add people tiles.
 *
 * The row carries a light status summary (plan count · next date · fill),
 * sourced from the same listEvents query the hub uses, so a leader can see at a
 * glance whether anything needs attention before tapping in. The hub is the one
 * home for everything else — the plan list, the roster grid, availability
 * collection — so this screen exposes exactly one door, not a parallel façade.
 *
 * Hidden while loading. When the group has no event plans yet it still renders
 * a "Start rostering" row so leaders have an entry point to create the first
 * plan inside the hub.
 */
import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { formatEventDate } from "../../scheduling/utils/format";

interface Props {
  groupId: string;
}

type EventRow = {
  _id: Id<"eventPlans">;
  title: string;
  eventDate: number;
  times: Array<{ label: string; startsAt: number }>;
  status: string;
  fillSummary: {
    totalNeeded: number;
    totalFilled: number;
    totalConfirmed: number;
  };
};

/**
 * Build the one-line status summary shown under "Rostering".
 *
 * Combines plan count, the next upcoming date, and the aggregate fill across
 * upcoming plans (e.g. "3 plans · next Sun Jul 5 · 7/42 filled"). Falls back to
 * a gentle prompt when there are no plans yet.
 */
function buildSummary(events: EventRow[]): string {
  if (events.length === 0) return "Plan who serves and when";

  const planLabel = `${events.length} ${events.length === 1 ? "plan" : "plans"}`;

  const now = Date.now();
  const upcoming = events
    .filter((e) => e.eventDate >= now)
    .sort((a, b) => a.eventDate - b.eventDate);

  const parts = [planLabel];

  if (upcoming.length > 0) {
    parts.push(`next ${formatEventDate(upcoming[0].eventDate)}`);

    // Aggregate fill across upcoming plans — the leader's "is anything still
    // open?" glance. Past plans are excluded so the number stays actionable.
    const totals = upcoming.reduce(
      (acc, e) => {
        acc.filled += e.fillSummary.totalFilled;
        acc.needed += e.fillSummary.totalNeeded;
        return acc;
      },
      { filled: 0, needed: 0 },
    );
    if (totals.needed > 0) {
      parts.push(`${totals.filled}/${totals.needed} filled`);
    }
  }

  return parts.join(" · ");
}

export function RosteringSection({ groupId }: Props) {
  const router = useRouter();
  const { colors } = useTheme();

  const events = useAuthenticatedQuery(
    api.functions.scheduling.events.listEvents,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  ) as EventRow[] | undefined;

  // Don't render while loading — avoids a flash of the empty-state copy before
  // the plan count resolves.
  if (events === undefined) return null;

  const summary = buildSummary(events);

  return (
    <View style={styles.section}>
      <TouchableOpacity
        onPress={() => router.push(`/rostering/${groupId}` as any)}
        activeOpacity={0.7}
        style={[styles.tile, { backgroundColor: colors.surfaceSecondary }]}
        accessibilityRole="button"
        accessibilityLabel="Rostering"
      >
        <View style={[styles.icon, { backgroundColor: colors.link + "1A" }]}>
          <Ionicons name="calendar-outline" size={18} color={colors.link} />
        </View>
        <View style={styles.textWrap}>
          <Text style={[styles.label, { color: colors.text }]}>Rostering</Text>
          <Text
            style={[styles.summary, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {summary}
          </Text>
        </View>
        <Ionicons
          name="chevron-forward"
          size={18}
          color={colors.textTertiary}
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 12,
    marginTop: 4,
  },
  tile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    minHeight: 48,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  textWrap: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: "500",
  },
  summary: {
    fontSize: 12,
    marginTop: 2,
  },
});
