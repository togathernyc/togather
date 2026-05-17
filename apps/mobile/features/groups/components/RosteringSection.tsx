/**
 * RosteringSection
 *
 * Leader-only horizontal scroll list of the group's event plans on the group
 * page. Sits directly below UpcomingEventsSection and mirrors its aesthetic.
 *
 * Each card shows the plan title, date/time, a draft/published status pill,
 * and a compact confirmed/filled fill bar (the two-segment bar from
 * EventListScreen). A trailing "+" card creates a draft plan and routes
 * straight to its editor.
 *
 * Hidden when the group has no event plans — leaders can still start
 * rostering via Group Actions → Rostering.
 */
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
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

/** Next Sunday at 9:00 AM local time — sensible default for a new draft. */
function nextSundayAtNine(): Date {
  const d = new Date();
  const daysUntilSunday = (7 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + daysUntilSunday);
  d.setHours(9, 0, 0, 0);
  return d;
}

export function RosteringSection({ groupId }: Props) {
  const router = useRouter();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  const events = useAuthenticatedQuery(
    api.functions.scheduling.events.listEvents,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  ) as EventRow[] | undefined;

  const createEvent = useAuthenticatedMutation(
    api.functions.scheduling.events.createEvent,
  );
  const [creating, setCreating] = useState(false);

  const handleNewEvent = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      // Default a new draft to next Sunday at 9 AM — the scheduler tunes it
      // in the editor. Keeps "New event plan" a single tap to a usable draft.
      const date = nextSundayAtNine();
      const result = await createEvent({
        groupId: groupId as Id<"groups">,
        title: "Untitled event plan",
        eventDate: date.getTime(),
        times: [{ label: "9:00 AM", startsAt: date.getTime() }],
      });
      router.push(`/rostering/${groupId}/event/${result.planId}` as any);
    } finally {
      setCreating(false);
    }
  }, [creating, createEvent, groupId, router]);

  // Don't render while loading, or when the group has no event plans —
  // leaders can still start rostering via Group Actions → Rostering.
  if (events === undefined) return null;
  if (events.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={[styles.header, { color: colors.textSecondary }]}>
        ROSTERING
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
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
                  `/rostering/${groupId}/event/${event._id}` as any,
                )
              }
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: colors.surfaceSecondary,
                  borderColor: colors.border,
                },
                pressed && { opacity: 0.85 },
              ]}
            >
              <View style={styles.cardTopRow}>
                <Text
                  style={[styles.cardTitle, { color: colors.text }]}
                  numberOfLines={2}
                >
                  {event.title}
                </Text>
                <View
                  style={[
                    styles.pill,
                    {
                      backgroundColor: isPublished
                        ? colors.success + "22"
                        : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.pillText,
                      {
                        color: isPublished
                          ? colors.success
                          : colors.textSecondary,
                      },
                    ]}
                  >
                    {isPublished ? "Published" : "Draft"}
                  </Text>
                </View>
              </View>
              <Text
                style={[styles.cardDate, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {formatEventDate(event.eventDate)}
                {event.times.length > 0
                  ? ` · ${event.times.map((t) => t.label).join(", ")}`
                  : ""}
              </Text>
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
              <Text
                style={[styles.fillText, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {totalFilled}/{totalNeeded} filled · {totalConfirmed} confirmed
              </Text>
            </Pressable>
          );
        })}

        {/* Trailing "+" card — creates a draft plan and opens its editor. */}
        <Pressable
          onPress={handleNewEvent}
          disabled={creating}
          style={({ pressed }) => [
            styles.newCard,
            { borderColor: colors.border },
            pressed && { opacity: 0.85 },
          ]}
        >
          {creating ? (
            <ActivityIndicator size="small" color={primaryColor} />
          ) : (
            <Ionicons name="add" size={28} color={primaryColor} />
          )}
          <Text
            style={[styles.newCardLabel, { color: colors.textSecondary }]}
          >
            New event plan
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 24,
    gap: 8,
  },
  header: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    paddingHorizontal: 16,
  },
  scrollContent: {
    paddingHorizontal: 12,
    gap: 12,
  },
  card: {
    width: 200,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 8,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 18,
  },
  cardDate: {
    fontSize: 12,
  },
  fillTrack: {
    height: 6,
    borderRadius: 3,
    flexDirection: "row",
    overflow: "hidden",
    marginTop: 2,
  },
  fillText: {
    fontSize: 11,
    fontWeight: "500",
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 10,
    fontWeight: "700",
  },
  newCard: {
    width: 120,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 12,
  },
  newCardLabel: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
});
