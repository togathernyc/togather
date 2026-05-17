/**
 * EventListScreen
 *
 * The scheduler's plan list for a campus group — upcoming events, each with
 * a fill-progress bar (filled vs. needed slots) and a draft/published
 * status pill. A "+ New event" action creates a draft.
 *
 * Route: /(user)/leader-tools/[group_id]/scheduling
 *
 * Backend: scheduling.events.listEvents, scheduling.events.createEvent.
 */
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { EmptyState } from "@components/ui/EmptyState";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { formatEventDate } from "../utils/format";

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

export function EventListScreen() {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const groupId = group_id as Id<"groups">;

  const events = useAuthenticatedQuery(
    api.functions.scheduling.events.listEvents,
    groupId ? { groupId } : "skip",
  ) as EventRow[] | undefined;

  const createEvent = useAuthenticatedMutation(
    api.functions.scheduling.events.createEvent,
  );
  const [creating, setCreating] = useState(false);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const handleNewEvent = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      // Default a new draft to next Sunday at 9 AM — the scheduler tunes it
      // in the editor. Keeps "+ New event" a single tap to a usable draft.
      const date = nextSundayAtNine();
      const result = await createEvent({
        groupId,
        title: "Untitled event plan",
        eventDate: date.getTime(),
        times: [{ label: "9:00 AM", startsAt: date.getTime() }],
      });
      router.push(
        `/(user)/leader-tools/${groupId}/scheduling/event/${result.planId}` as any,
      );
    } finally {
      setCreating(false);
    }
  }, [creating, createEvent, groupId, router]);

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.surface },
      ]}
    >
      <View
        style={[
          styles.header,
          { backgroundColor: colors.surface, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity onPress={handleBack} hitSlop={12} style={styles.back}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Scheduling
        </Text>
        <TouchableOpacity
          onPress={handleNewEvent}
          hitSlop={12}
          style={styles.back}
          disabled={creating}
        >
          {creating ? (
            <ActivityIndicator size="small" color={primaryColor} />
          ) : (
            <Ionicons name="add" size={28} color={primaryColor} />
          )}
        </TouchableOpacity>
      </View>

      {events === undefined ? (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      ) : events.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon="calendar-outline"
            title="No upcoming event plans"
            message="Create an event plan to start scheduling volunteers."
            actionLabel="New event plan"
            onAction={handleNewEvent}
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 24 },
          ]}
        >
          {events.map((event) => {
            const { totalNeeded, totalFilled, totalConfirmed } =
              event.fillSummary;
            const confirmedPct =
              totalNeeded > 0 ? (totalConfirmed / totalNeeded) * 100 : 0;
            const filledPct =
              totalNeeded > 0 ? (totalFilled / totalNeeded) * 100 : 0;
            // Filled-but-not-yet-confirmed portion of the bar.
            const pendingPct = Math.max(0, filledPct - confirmedPct);
            const isPublished = event.status === "published";
            return (
              <Pressable
                key={event._id}
                onPress={() =>
                  router.push(
                    `/(user)/leader-tools/${groupId}/scheduling/event/${event._id}` as any,
                  )
                }
                style={({ pressed }) => [
                  styles.card,
                  { backgroundColor: colors.surfaceSecondary },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <View style={styles.cardTop}>
                  <View style={styles.cardTitleWrap}>
                    <Text
                      style={[styles.cardTitle, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {event.title}
                    </Text>
                    <Text
                      style={[styles.cardDate, { color: colors.textSecondary }]}
                    >
                      {formatEventDate(event.eventDate)}
                      {event.times.length > 0
                        ? ` · ${event.times.map((t) => t.label).join(", ")}`
                        : ""}
                    </Text>
                  </View>
                  <StatusPill
                    label={isPublished ? "Published" : "Draft"}
                    color={isPublished ? colors.success : colors.textSecondary}
                    bg={
                      isPublished
                        ? colors.success + "22"
                        : colors.border
                    }
                  />
                </View>
                <View style={styles.fillRow}>
                  <View
                    style={[styles.fillTrack, { backgroundColor: colors.border }]}
                  >
                    {/* Confirmed (accepted) — solid. */}
                    <View
                      style={{
                        width: `${confirmedPct}%`,
                        backgroundColor: colors.success,
                      }}
                    />
                    {/* Filled but awaiting a response — faded. */}
                    <View
                      style={{
                        width: `${pendingPct}%`,
                        backgroundColor: colors.success + "59",
                      }}
                    />
                  </View>
                  <View style={styles.fillTextWrap}>
                    <Text
                      style={[styles.fillText, { color: colors.textSecondary }]}
                    >
                      {totalFilled}/{totalNeeded} filled
                    </Text>
                    <Text
                      style={[styles.fillSubText, { color: colors.textSecondary }]}
                    >
                      {totalConfirmed} confirmed
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

function StatusPill({
  label,
  color,
  bg,
}: {
  label: string;
  color: string;
  bg: string;
}) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

/** Next Sunday at 9:00 AM local time. */
function nextSundayAtNine(): Date {
  const d = new Date();
  const daysUntilSunday = (7 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + daysUntilSunday);
  d.setHours(9, 0, 0, 0);
  return d;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  scrollContent: {
    padding: 16,
    gap: 12,
  },
  card: {
    borderRadius: 12,
    padding: 14,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  cardTitleWrap: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  cardDate: {
    fontSize: 13,
    marginTop: 2,
  },
  fillRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 14,
  },
  fillTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    flexDirection: "row",
    overflow: "hidden",
  },
  fillTextWrap: {
    alignItems: "flex-end",
  },
  fillText: {
    fontSize: 12,
    fontWeight: "500",
  },
  fillSubText: {
    fontSize: 11,
    marginTop: 1,
    opacity: 0.8,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 11,
    fontWeight: "700",
  },
});
