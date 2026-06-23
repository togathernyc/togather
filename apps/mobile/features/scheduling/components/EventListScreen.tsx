/**
 * EventListScreen — the Schedule tab of the Rostering hub.
 *
 * The scheduler's plan list for a campus group — upcoming event plans, each
 * with a fill-progress bar (filled vs. needed slots) and a draft/published
 * status pill. A compact action header anchors the screen: one primary
 * "Open roster grid" (the daily build surface) plus lighter "New plan" and
 * "Collect availability" actions, so the hierarchy reads at a glance.
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
import { Button } from "@components/ui/Button";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { ActionMenuSheet } from "@components/ui/ActionMenuSheet";
import { confirmAsync } from "@/utils/platformAlert";
import { formatEventDate } from "../utils/format";
import { CenteredColumn } from "./CenteredColumn";

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
  const { primaryColor, accentLight } = useCommunityTheme();
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
  const quickStartRostering = useAuthenticatedMutation(
    api.functions.scheduling.quickStart.quickStartRostering,
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
  const [settingUp, setSettingUp] = useState(false);
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
      // in the editor. Keeps "New event plan" a single tap to a usable draft.
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

  // One-tap bootstrap for a brand-new group: creates a starter team + roles
  // and a draft plan, then drops the leader into the editor to own the date.
  // Idempotent on the backend — if rostering data already exists it no-ops and
  // we just stay in the (now-populated) hub on the next reactive render.
  const handleSetUpRostering = useCallback(async () => {
    if (settingUp) return;
    setSettingUp(true);
    try {
      const result = await quickStartRostering({ groupId });
      if (result.planId) {
        router.push(
          `/rostering/${groupId}/event/${result.planId}` as never,
        );
      }
      // alreadySetUp === true → nothing to navigate to; the list query
      // refreshes into the populated hub on its own.
    } catch (e) {
      const err = e as { data?: { message?: string }; message?: string };
      Alert.alert(
        "Couldn't set up rostering",
        err?.data?.message ?? err?.message ?? "Please try again.",
      );
    } finally {
      setSettingUp(false);
    }
  }, [settingUp, quickStartRostering, groupId, router]);

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

  const renderEventCard = (event: EventRow, highlight: boolean) => {
    const { totalNeeded, totalFilled, totalConfirmed } = event.fillSummary;
    const confirmedPct =
      totalNeeded > 0 ? (totalConfirmed / totalNeeded) * 100 : 0;
    const filledPct = totalNeeded > 0 ? (totalFilled / totalNeeded) * 100 : 0;
    // Filled-but-not-yet-confirmed portion of the bar.
    const pendingPct = Math.max(0, filledPct - confirmedPct);
    const isPublished = event.status === "published";
    const d = new Date(event.eventDate);
    const month = d
      .toLocaleDateString("en-US", { month: "short" })
      .toUpperCase();
    const day = d.getDate();
    const timesLabel = event.times.map((t) => t.label).join(", ");

    return (
      <TouchableOpacity
        key={event._id}
        onPress={() =>
          router.push(`/rostering/${groupId}/event/${event._id}` as never)
        }
        activeOpacity={0.8}
        style={[
          styles.card,
          { backgroundColor: colors.surfaceSecondary },
          highlight && {
            borderColor: primaryColor,
            backgroundColor: accentLight,
          },
        ]}
      >
        {/* Leading date chip — gives the list a calendar-like rhythm and makes
            each plan scannable at a glance. */}
        <View
          style={[
            styles.dateChip,
            {
              backgroundColor: highlight ? primaryColor : colors.surface,
              borderColor: highlight ? primaryColor : colors.border,
            },
          ]}
        >
          <Text
            style={[
              styles.dateChipMonth,
              { color: highlight ? "#fff" : colors.textSecondary },
            ]}
          >
            {month}
          </Text>
          <Text
            style={[
              styles.dateChipDay,
              { color: highlight ? "#fff" : colors.text },
            ]}
          >
            {day}
          </Text>
        </View>

        <View style={styles.cardBody}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.cardTitleWrap}>
              <Text
                style={[styles.cardTitle, { color: colors.text }]}
                numberOfLines={1}
              >
                {event.title}
              </Text>
              <Text
                style={[styles.cardDate, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {formatEventDate(event.eventDate)}
                {timesLabel ? ` · ${timesLabel}` : ""}
              </Text>
            </View>
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
          </View>

          <View style={styles.cardFooterRow}>
            <Text style={[styles.fillText, { color: colors.textSecondary }]}>
              <Text style={{ color: colors.text, fontWeight: "600" }}>
                {totalFilled}/{totalNeeded}
              </Text>{" "}
              filled · {totalConfirmed} confirmed
            </Text>
            <StatusPill
              label={isPublished ? "Published" : "Draft"}
              color={isPublished ? colors.success : colors.textSecondary}
              bg={isPublished ? colors.success + "22" : colors.border}
            />
          </View>
        </View>
      </TouchableOpacity>
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
    // Fresh group: lead with a one-tap "Set up rostering" that bootstraps a
    // starter team + roles + a draft plan, then drops the leader into the
    // editor. "New event plan" stays available as the secondary manual path.
    return (
      <View style={[styles.emptyWrap, { backgroundColor: colors.surface }]}>
        <Ionicons
          name="calendar-outline"
          size={64}
          color={colors.iconSecondary}
          style={styles.emptyIcon}
        />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          Set up rostering
        </Text>
        <Text style={[styles.emptyMessage, { color: colors.textSecondary }]}>
          Create a starter team with roles and a first event plan in one tap.
          You can rename and tune everything afterwards.
        </Text>
        <View style={styles.emptyActions}>
          <Button
            onPress={handleSetUpRostering}
            variant="primary"
            loading={settingUp}
            style={styles.emptyPrimaryButton}
          >
            Set up rostering
          </Button>
          <Pressable
            onPress={handleNewEvent}
            disabled={creating}
            style={styles.emptySecondary}
            accessibilityRole="button"
            accessibilityLabel="Create a blank event plan"
          >
            {creating ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : (
              <Text
                style={[
                  styles.emptySecondaryText,
                  { color: colors.textSecondary },
                ]}
              >
                Or create a blank event plan
              </Text>
            )}
          </Pressable>
        </View>
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
        <CenteredColumn style={styles.column}>
          {/* Action header — one clear primary (Open roster grid, the daily
              build surface) with two lighter supporting actions beneath it.
              Grouping them in a single card reads as intentional, not a row
              of competing buttons. */}
          <View
            style={[
              styles.actionCard,
              {
                backgroundColor: colors.surfaceSecondary,
                borderColor: colors.border,
              },
            ]}
          >
            <TouchableOpacity
              onPress={() => router.push(`/rostering/${groupId}/grid` as never)}
              activeOpacity={0.9}
              style={[styles.primaryButton, { backgroundColor: primaryColor }]}
              accessibilityRole="button"
              accessibilityLabel="Open the roster grid"
            >
              <Ionicons name="grid" size={18} color="#fff" />
              <Text style={styles.primaryButtonLabel}>Open roster grid</Text>
            </TouchableOpacity>

            <View style={styles.secondaryRow}>
              <TouchableOpacity
                onPress={handleNewEvent}
                disabled={creating}
                activeOpacity={0.7}
                style={[
                  styles.secondaryButton,
                  { backgroundColor: accentLight },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Create a new event plan"
              >
                {creating ? (
                  <ActivityIndicator size="small" color={primaryColor} />
                ) : (
                  <Ionicons name="add" size={18} color={primaryColor} />
                )}
                <Text
                  style={[styles.secondaryLabel, { color: primaryColor }]}
                  numberOfLines={1}
                >
                  New plan
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleShareLink}
                disabled={sharingLink}
                activeOpacity={0.7}
                style={[
                  styles.secondaryButton,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                  styles.secondaryButtonOutline,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Collect availability"
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
                <Text
                  style={[styles.secondaryLabel, { color: colors.text }]}
                  numberOfLines={1}
                >
                  Collect availability
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Upcoming */}
          {upcoming.length > 0 && (
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
              Upcoming
            </Text>
          )}
          {upcoming.map((e, i) => renderEventCard(e, i === 0))}

          {upcoming.length === 0 && past.length > 0 && (
            <Text style={[styles.noUpcoming, { color: colors.textSecondary }]}>
              No upcoming plans. Duplicate a past plan below to re-run it.
            </Text>
          )}

          {past.length > 0 && (
            <>
              <TouchableOpacity
                onPress={() => setShowPast((v) => !v)}
                activeOpacity={0.7}
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
                <Text
                  style={[styles.pastToggleText, { color: colors.textSecondary }]}
                >
                  Past plans ({past.length})
                </Text>
              </TouchableOpacity>
              {showPast && past.map((e) => renderEventCard(e, false))}
            </>
          )}
        </CenteredColumn>
      </ScrollView>
      <ActionMenuSheet
        visible={menuEvent !== null}
        title={menuEvent?.title}
        actions={
          menuEvent
            ? [
                {
                  label: "Duplicate",
                  onPress: () => void handleDuplicate(menuEvent),
                },
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
  emptyIcon: {
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 8,
  },
  emptyMessage: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
    maxWidth: 300,
  },
  emptyActions: {
    width: "100%",
    maxWidth: 300,
    alignItems: "center",
    gap: 16,
    marginTop: 24,
  },
  emptyPrimaryButton: {
    width: "100%",
  },
  emptySecondary: {
    minHeight: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  emptySecondaryText: {
    fontSize: 15,
    fontWeight: "500",
  },
  scrollContent: {
    padding: 16,
    gap: 12,
  },
  // On desktop, content children live inside CenteredColumn, so the row gap
  // must live here too (the contentContainer then has a single child). On
  // mobile CenteredColumn is a pass-through and `scrollContent`'s gap applies.
  column: {
    gap: 12,
  },

  // Action header — primary build action + lighter supporting actions.
  actionCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 14,
  },
  primaryButtonLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
  secondaryRow: {
    flexDirection: "row",
    gap: 8,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 8,
  },
  secondaryButtonOutline: {
    borderWidth: 1,
  },
  secondaryLabel: {
    fontSize: 14,
    fontWeight: "600",
  },

  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 4,
    marginBottom: -2,
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

  // Plan card
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "transparent",
    padding: 12,
  },
  dateChip: {
    width: 48,
    height: 52,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dateChipMonth: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  dateChipDay: {
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 24,
  },
  cardBody: {
    flex: 1,
    gap: 8,
  },
  cardHeaderRow: {
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
    marginTop: -2,
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
  },
  fillTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    flexDirection: "row",
    overflow: "hidden",
  },
  cardFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  fillText: {
    fontSize: 12,
    fontWeight: "500",
    flex: 1,
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
