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
  Share,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { DOMAIN_CONFIG } from "@togather/shared";
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
  const createAvailabilityLink = useAuthenticatedMutation(
    api.functions.scheduling.publicAvailability.createAvailabilityLink,
  );
  const [creating, setCreating] = useState(false);
  const [sharingLink, setSharingLink] = useState(false);

  const goToRostering = useCallback(() => {
    router.push(`/rostering/${groupId}` as any);
  }, [router, groupId]);

  const goToAvailability = useCallback(() => {
    router.push(`/rostering/${groupId}/availability` as any);
  }, [router, groupId]);

  const goToRosterGrid = useCallback(() => {
    router.push(`/rostering/${groupId}/grid` as any);
  }, [router, groupId]);

  // Generate a public, app-optional availability link and hand it to the OS
  // share sheet — people can respond in a browser without the app.
  const handleShareLink = useCallback(async () => {
    if (sharingLink) return;
    setSharingLink(true);
    try {
      const { publicToken } = await createAvailabilityLink({
        groupId: groupId as Id<"groups">,
      });
      const url = DOMAIN_CONFIG.availabilityLinkUrl(publicToken);
      await Share.share({
        message: `Let us know when you can serve: ${url}`,
      });
    } catch (e) {
      const err = e as { data?: { message?: string }; message?: string };
      Alert.alert(
        "Couldn't create link",
        err?.data?.message ??
          err?.message ??
          "Add an upcoming event plan first, then try again.",
      );
    } finally {
      setSharingLink(false);
    }
  }, [sharingLink, createAvailabilityLink, groupId]);

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

      {/* Quick actions into the rest of the rostering surface. */}
      <View style={styles.actions}>
        <ActionButton
          icon="options-outline"
          label="Rostering settings"
          color={colors.text}
          borderColor={colors.border}
          onPress={goToRostering}
        />
        <ActionButton
          icon="share-outline"
          label={sharingLink ? "Sharing…" : "Share availability link"}
          color={colors.text}
          borderColor={colors.border}
          onPress={handleShareLink}
          disabled={sharingLink}
        />
        <ActionButton
          icon="calendar-outline"
          label="Availability"
          color={colors.text}
          borderColor={colors.border}
          onPress={goToAvailability}
        />
        <ActionButton
          icon="grid-outline"
          label="Roster grid"
          color={colors.text}
          borderColor={colors.border}
          onPress={goToRosterGrid}
        />
      </View>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  color,
  borderColor,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  borderColor: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionBtn,
        { borderColor },
        pressed && { opacity: 0.7 },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[styles.actionLabel, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
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
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
});
