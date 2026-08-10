/**
 * MyAvailabilityScreen
 *
 * A group member's upcoming event plans, where they mark whether they're
 * available to serve on each date. Being available is just a signal — leaders
 * use it to build the schedule; it doesn't mean the member is scheduled yet.
 *
 * Route: /rostering/[group_id]/availability
 *
 * Backend: scheduling.availability.myUpcomingAvailability,
 * scheduling.availability.setMyAvailability,
 * scheduling.availability.clearMyAvailability.
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
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { EmptyState } from "@components/ui/EmptyState";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { formatEventDate } from "../utils/format";

type AvailabilityStatus = "available" | "unavailable";

type AvailabilityEvent = {
  _id: Id<"eventPlans">;
  title: string;
  eventDate: number;
  times: Array<{ label: string; startsAt: number }>;
  status: string;
  myStatus: AvailabilityStatus | null;
  myNote?: string;
};

export function MyAvailabilityScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const groupId = group_id as Id<"groups">;

  const events = useAuthenticatedQuery(
    api.functions.scheduling.availability.myUpcomingAvailability,
    groupId ? { groupId } : "skip",
  ) as AvailabilityEvent[] | undefined;

  const setMyAvailability = useAuthenticatedMutation(
    api.functions.scheduling.availability.setMyAvailability,
  );
  const clearMyAvailability = useAuthenticatedMutation(
    api.functions.scheduling.availability.clearMyAvailability,
  );

  const [busyPlanId, setBusyPlanId] = useState<Id<"eventPlans"> | null>(null);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const onSetStatus = useCallback(
    async (event: AvailabilityEvent, status: AvailabilityStatus) => {
      if (busyPlanId) return;
      setBusyPlanId(event._id);
      try {
        // Tapping the already-selected status clears it (toggle off).
        if (event.myStatus === status) {
          await clearMyAvailability({ planId: event._id });
        } else {
          await setMyAvailability({ planId: event._id, status });
        }
      } catch (err) {
        const e = err as { data?: { message?: string }; message?: string };
        Alert.alert(
          "Couldn't update availability",
          e.data?.message ?? e.message ?? "Please try again.",
        );
      } finally {
        setBusyPlanId(null);
      }
    },
    [busyPlanId, clearMyAvailability, setMyAvailability],
  );

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.surface },
      ]}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={handleBack} hitSlop={12} style={styles.back}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          My Availability
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {events === undefined ? (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      ) : events.length === 0 ? (
        <View style={styles.centered}>
          <EmptyState
            icon="calendar-outline"
            title="No upcoming events"
            message="When your group schedules events, you can mark your availability here."
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 24 },
          ]}
        >
          <Text style={[styles.intro, { color: colors.textSecondary }]}>
            Mark the dates you're available to serve. Leaders use this to build
            the schedule — being available doesn't mean you're scheduled yet.
          </Text>

          {events.map((event) => {
            const busy = busyPlanId === event._id;
            const isAvailable = event.myStatus === "available";
            const isUnavailable = event.myStatus === "unavailable";
            const timeLabels = event.times.map((t) => t.label).join(", ");
            return (
              <View
                key={event._id}
                style={[
                  styles.card,
                  { backgroundColor: colors.surfaceSecondary },
                ]}
              >
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
                  {timeLabels ? ` · ${timeLabels}` : ""}
                </Text>

                {busy ? (
                  <View style={styles.busyRow}>
                    <ActivityIndicator size="small" color={colors.text} />
                  </View>
                ) : (
                  <View style={styles.pillRow}>
                    <Pressable
                      onPress={() => onSetStatus(event, "available")}
                      style={({ pressed }) => [
                        styles.pill,
                        isAvailable
                          ? { backgroundColor: colors.success, borderColor: colors.success }
                          : { backgroundColor: "transparent", borderColor: colors.border },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          { color: isAvailable ? "#fff" : colors.textSecondary },
                        ]}
                      >
                        Available
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => onSetStatus(event, "unavailable")}
                      style={({ pressed }) => [
                        styles.pill,
                        isUnavailable
                          ? { backgroundColor: colors.destructive, borderColor: colors.destructive }
                          : { backgroundColor: "transparent", borderColor: colors.border },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          {
                            color: isUnavailable ? "#fff" : colors.textSecondary,
                          },
                        ]}
                      >
                        Can't make it
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
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
  headerSpacer: {
    width: 36,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    padding: 16,
  },
  intro: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 16,
  },
  card: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  cardDate: {
    fontSize: 13,
    marginTop: 2,
  },
  busyRow: {
    marginTop: 14,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  pillRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  pill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
  },
  pillText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
