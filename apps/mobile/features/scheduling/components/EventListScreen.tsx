/**
 * EventListScreen — the Schedule tab of the Rostering hub.
 *
 * The scheduler's plan list for a campus group — upcoming event plans, each
 * with a fill-progress bar (filled vs. needed slots) and a draft/published
 * status pill. A "+ New event plan" row creates a draft.
 *
 * Rendered headerless: the Rostering hub layout supplies the screen header
 * and top tab bar. Route: /rostering/[group_id]. See ADR-024.
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
  ActionSheetIOS,
  Alert,
  Platform,
  Share,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DOMAIN_CONFIG } from "@togather/shared";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { EmptyState } from "@components/ui/EmptyState";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { ActionMenuSheet } from "@components/ui/ActionMenuSheet";
import { confirmAsync } from "@/utils/platformAlert";
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

  // Fetch past plans too so leaders can review and re-run them (duplicate
  // copies the roster shape + run sheet). They're split out into a collapsed
  // "Past plans" section below so the default view stays focused on upcoming.
  const events = useAuthenticatedQuery(
    api.functions.scheduling.events.listEvents,
    groupId ? { groupId, includePast: true } : "skip",
  ) as EventRow[] | undefined;

  const createEvent = useAuthenticatedMutation(
    api.functions.scheduling.events.createEvent,
  );
  const duplicateEvent = useAuthenticatedMutation(
    api.functions.scheduling.events.duplicateEvent,
  );
  const deleteEvent = useAuthenticatedMutation(
    api.functions.scheduling.events.deleteEvent,
  );
  const createAvailabilityLink = useAuthenticatedMutation(
    api.functions.scheduling.publicAvailability.createAvailabilityLink,
  );
  const [creating, setCreating] = useState(false);
  const [sharingLink, setSharingLink] = useState(false);
  const [showPast, setShowPast] = useState(false);
  // Web ⋯ menu target (ActionSheetIOS/Alert don't work on web).
  const [menuEvent, setMenuEvent] = useState<EventRow | null>(null);

  // Generate a public, app-optional availability link and hand it to the OS
  // share sheet. People can open it in a browser (no app needed) and their
  // response is matched to their account when they later sign up.
  const handleShareLink = useCallback(async () => {
    if (sharingLink) return;
    setSharingLink(true);
    try {
      const { publicToken } = await createAvailabilityLink({ groupId });
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
      // in the editor. Keeps "+ New event plan" a single tap to a usable draft.
      const date = nextSundayAtNine();
      const result = await createEvent({
        groupId,
        title: "Untitled event plan",
        eventDate: date.getTime(),
        times: [{ label: "9:00 AM", startsAt: date.getTime() }],
      });
      router.push(`/rostering/${groupId}/event/${result.planId}` as never);
    } finally {
      setCreating(false);
    }
  }, [creating, createEvent, groupId, router]);

  const handleDuplicate = useCallback(
    async (event: EventRow) => {
      const result = await duplicateEvent({ planId: event._id });
      router.push(`/rostering/${groupId}/event/${result.planId}` as never);
    },
    [duplicateEvent, groupId, router],
  );

  const handleDelete = useCallback(
    async (event: EventRow) => {
      const ok = await confirmAsync({
        title: "Delete event plan?",
        message: `"${event.title}" and its roster will be permanently deleted.`,
        confirmText: "Delete",
        destructive: true,
      });
      if (ok) void deleteEvent({ planId: event._id });
    },
    [deleteEvent],
  );

  // Contextual ⋯ menu for an event card — Duplicate / Delete. ActionSheetIOS is
  // iOS-only and Alert.alert is a no-op on web, so web uses ActionMenuSheet.
  const handleEventMenu = useCallback(
    (event: EventRow) => {
      if (Platform.OS === "ios") {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title: event.title,
            options: ["Cancel", "Duplicate", "Delete"],
            cancelButtonIndex: 0,
            destructiveButtonIndex: 2,
          },
          (buttonIndex) => {
            if (buttonIndex === 1) void handleDuplicate(event);
            else if (buttonIndex === 2) void handleDelete(event);
          },
        );
      } else if (Platform.OS === "android") {
        Alert.alert(event.title, undefined, [
          { text: "Cancel", style: "cancel" },
          { text: "Duplicate", onPress: () => void handleDuplicate(event) },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => void handleDelete(event),
          },
        ]);
      } else {
        setMenuEvent(event);
      }
    },
    [handleDuplicate, handleDelete],
  );

  const renderEventCard = (event: EventRow) => {
    const { totalNeeded, totalFilled, totalConfirmed } = event.fillSummary;
    const confirmedPct =
      totalNeeded > 0 ? (totalConfirmed / totalNeeded) * 100 : 0;
    const filledPct = totalNeeded > 0 ? (totalFilled / totalNeeded) * 100 : 0;
    // Filled-but-not-yet-confirmed portion of the bar.
    const pendingPct = Math.max(0, filledPct - confirmedPct);
    const isPublished = event.status === "published";
    return (
      <Pressable
        key={event._id}
        onPress={() =>
          router.push(`/rostering/${groupId}/event/${event._id}` as never)
        }
        style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}
      >
        <View style={styles.cardTop}>
          <View style={styles.cardTitleWrap}>
            <Text
              style={[styles.cardTitle, { color: colors.text }]}
              numberOfLines={1}
            >
              {event.title}
            </Text>
            <Text style={[styles.cardDate, { color: colors.textSecondary }]}>
              {formatEventDate(event.eventDate)}
              {event.times.length > 0
                ? ` · ${event.times.map((t) => t.label).join(", ")}`
                : ""}
            </Text>
          </View>
          <StatusPill
            label={isPublished ? "Published" : "Draft"}
            color={isPublished ? colors.success : colors.textSecondary}
            bg={isPublished ? colors.success + "22" : colors.border}
          />
          <TouchableOpacity
            onPress={(e) => {
              // Keep the ⋯ tap distinct from the card's open-editor press.
              e.stopPropagation();
              handleEventMenu(event);
            }}
            hitSlop={12}
            style={styles.menuButton}
            accessibilityLabel="Event plan options"
          >
            <Ionicons
              name="ellipsis-horizontal"
              size={20}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        </View>
        <View style={styles.fillRow}>
          <View style={[styles.fillTrack, { backgroundColor: colors.border }]}>
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
            <Text style={[styles.fillText, { color: colors.textSecondary }]}>
              {totalFilled}/{totalNeeded} filled
            </Text>
            <Text style={[styles.fillSubText, { color: colors.textSecondary }]}>
              {totalConfirmed} confirmed
            </Text>
          </View>
        </View>
      </Pressable>
    );
  };

  if (events === undefined) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.surface }]}>
        <ActivityIndicator size="small" color={colors.text} />
      </View>
    );
  }

  if (events.length === 0) {
    return (
      <View style={[styles.emptyWrap, { backgroundColor: colors.surface }]}>
        <EmptyState
          icon="calendar-outline"
          title="No upcoming event plans"
          message="Create an event plan to start scheduling volunteers."
          actionLabel="New event plan"
          onAction={handleNewEvent}
        />
      </View>
    );
  }

  // Split into upcoming vs. past around the start of today. `events` arrives
  // sorted ascending; past is reversed so the most recent shows first.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const cutoff = todayStart.getTime();
  const upcoming = events.filter((e) => e.eventDate >= cutoff);
  const past = events.filter((e) => e.eventDate < cutoff).reverse();

  return (
    <>
    <ScrollView
      style={{ backgroundColor: colors.surface }}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: insets.bottom + 24 },
      ]}
    >
      <Pressable
        onPress={handleNewEvent}
        disabled={creating}
        style={[styles.newRow, { borderColor: primaryColor }]}
        accessibilityRole="button"
      >
        {creating ? (
          <ActivityIndicator size="small" color={primaryColor} />
        ) : (
          <Ionicons name="add" size={20} color={primaryColor} />
        )}
        <Text style={[styles.newLabel, { color: primaryColor }]}>
          New event plan
        </Text>
      </Pressable>

      <Pressable
        onPress={handleShareLink}
        disabled={sharingLink}
        style={styles.shareRow}
        accessibilityRole="button"
        accessibilityLabel="Share an availability link"
      >
        {sharingLink ? (
          <ActivityIndicator size="small" color={colors.textSecondary} />
        ) : (
          <Ionicons
            name="share-outline"
            size={18}
            color={colors.textSecondary}
          />
        )}
        <Text style={[styles.shareLabel, { color: colors.textSecondary }]}>
          Share availability link
        </Text>
      </Pressable>

      <Pressable
        onPress={() => router.push(`/rostering/${groupId}/grid` as never)}
        style={styles.shareRow}
        accessibilityRole="button"
        accessibilityLabel="Open the roster grid"
      >
        <Ionicons
          name="git-network-outline"
          size={18}
          color={colors.textSecondary}
        />
        <Text style={[styles.shareLabel, { color: colors.textSecondary }]}>
          Roster grid
        </Text>
      </Pressable>

      {upcoming.map(renderEventCard)}

      {upcoming.length === 0 && past.length > 0 && (
        <Text style={[styles.noUpcoming, { color: colors.textSecondary }]}>
          No upcoming plans. Duplicate a past plan below to re-run it.
        </Text>
      )}

      {past.length > 0 && (
        <>
          <Pressable
            onPress={() => setShowPast((v) => !v)}
            style={styles.pastToggle}
            accessibilityRole="button"
            accessibilityLabel={
              showPast ? "Hide past plans" : "Show past plans"
            }
          >
            <Ionicons
              name={showPast ? "chevron-down" : "chevron-forward"}
              size={16}
              color={colors.textSecondary}
            />
            <Text style={[styles.pastToggleText, { color: colors.textSecondary }]}>
              Past plans ({past.length})
            </Text>
          </Pressable>
          {showPast && past.map(renderEventCard)}
        </>
      )}
    </ScrollView>
    <ActionMenuSheet
      visible={menuEvent !== null}
      title={menuEvent?.title}
      actions={
        menuEvent
          ? [
              { label: "Duplicate", onPress: () => void handleDuplicate(menuEvent) },
              {
                label: "Delete",
                destructive: true,
                onPress: () => void handleDelete(menuEvent),
              },
            ]
          : []
      }
      onClose={() => setMenuEvent(null)}
    />
    </>
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
  newRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 12,
    paddingVertical: 14,
  },
  newLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  shareRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 4,
  },
  shareLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  pastToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  pastToggleText: {
    fontSize: 14,
    fontWeight: "600",
  },
  noUpcoming: {
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 8,
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
  menuButton: {
    padding: 2,
    marginLeft: 2,
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
