/**
 * MyScheduleScreen
 *
 * The volunteer's upcoming role assignments, grouped by date. A pinned
 * "Needs a response" section floats unconfirmed requests to the top with
 * Accept / Decline actions and a per-event bulk "Accept all". Declining
 * prompts an optional one-line note.
 *
 * Route: /(user)/my-schedule
 *
 * Backend: scheduling.mySchedule.myAssignments,
 * scheduling.assignments.respondToAssignment.
 */
import React, { useCallback, useMemo, useState } from "react";
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
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { EmptyState } from "@components/ui/EmptyState";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useEventModeStore } from "@/stores/eventModeStore";
import {
  formatDateHeading,
  dateKey,
  DEFAULT_ROLE_COLOR,
} from "../utils/format";
import { useRespondToAssignment } from "../hooks/useRespondToAssignment";
import { DeclineNoteModal } from "./DeclineNoteModal";

type MyAssignment = {
  _id: Id<"roleAssignments">;
  planId: Id<"eventPlans">;
  eventTitle: string;
  eventDate: number;
  eventStatus: string;
  roleName: string;
  roleColor?: string;
  teamName: string;
  status: string;
  timeLabel?: string;
  declineNote?: string;
};

export function MyScheduleScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const assignments = useAuthenticatedQuery(
    api.functions.scheduling.mySchedule.myAssignments,
    {},
  ) as MyAssignment[] | undefined;

  const { respond, declineWith, busyId } = useRespondToAssignment();
  const [declineTarget, setDeclineTarget] =
    useState<Id<"roleAssignments"> | null>(null);

  // Serving-mode entry point. Mirrors the inbox re-entry chip: only offered when
  // the backend says the user is eligible (a confirmed assignment on an event
  // within the serving window) and they aren't already in serving mode.
  const { community } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const isServingMode = useEventModeStore((s) => s.isServingMode);
  const enterServingMode = useEventModeStore((s) => s.enter);
  const eventTasksEnabled =
    (community?.churchFeatures as { eventTasksEnabled?: boolean } | undefined)
      ?.eventTasksEnabled === true;
  const servingEligibility = useAuthenticatedQuery(
    api.functions.scheduling.serving.getServingEligibility,
    eventTasksEnabled ? {} : "skip",
  ) as
    | {
        plans: { planId: string; title: string; startsAt: number }[];
      }
    | undefined;
  // Serving mode now spans every eligible plan at once (each tab shows all of
  // them as sections), so a single entry point covers them all. Hidden while
  // already serving.
  const servingPlans = isServingMode ? [] : servingEligibility?.plans ?? [];

  const handleEnterServing = useCallback(() => {
    enterServingMode();
    router.replace("/(tabs)/serving-tasks" as never);
  }, [enterServingMode, router]);

  // Pending requests pinned at top; the rest grouped by calendar day.
  const { pending, dateGroups } = useMemo(() => {
    const list = assignments ?? [];
    const pendingList = list.filter((a) => a.status === "unconfirmed");
    const rest = list.filter((a) => a.status !== "unconfirmed");
    const groups = new Map<string, MyAssignment[]>();
    for (const a of rest) {
      const key = dateKey(a.eventDate);
      const arr = groups.get(key) ?? [];
      arr.push(a);
      groups.set(key, arr);
    }
    return { pending: pendingList, dateGroups: Array.from(groups.values()) };
  }, [assignments]);

  // Group pending requests by event so a bulk "Accept all" can act per event.
  const pendingByEvent = useMemo(() => {
    const groups = new Map<string, MyAssignment[]>();
    for (const a of pending) {
      const arr = groups.get(a.planId as string) ?? [];
      arr.push(a);
      groups.set(a.planId as string, arr);
    }
    return Array.from(groups.values());
  }, [pending]);

  const handleAcceptAll = useCallback(
    async (group: MyAssignment[]) => {
      for (const a of group) {
        await respond(a._id, "confirmed");
      }
    },
    [respond],
  );

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const openDetail = useCallback(
    (id: Id<"roleAssignments">) => {
      router.push(`/scheduling/assignment/${id}` as any);
    },
    [router],
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
          My Schedule
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {servingPlans.length > 0 ? (
        <View style={styles.servingBannerGroup}>
          <Pressable
            onPress={handleEnterServing}
            style={({ pressed }) => [
              styles.servingBanner,
              { backgroundColor: primaryColor },
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Enter serving mode"
          >
            <Ionicons name="rocket-outline" size={20} color="#fff" />
            <View style={styles.servingBannerTextWrap}>
              <Text style={styles.servingBannerTitle} numberOfLines={1}>
                {servingPlans.length === 1
                  ? servingPlans[0].title
                  : `${servingPlans.length} events today`}
              </Text>
              <Text style={styles.servingBannerSub}>Enter serving mode</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#fff" />
          </Pressable>
        </View>
      ) : null}

      {assignments === undefined ? (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      ) : assignments.length === 0 ? (
        <View style={styles.centered}>
          <EmptyState
            icon="calendar-outline"
            title="Nothing scheduled"
            message="When a leader schedules you to serve, it'll show up here."
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 24 },
          ]}
        >
          {/* Needs a response — pinned */}
          {pendingByEvent.length > 0 && (
            <View style={styles.section}>
              <Text
                style={[styles.sectionLabel, { color: colors.destructive }]}
              >
                NEEDS A RESPONSE
              </Text>
              {pendingByEvent.map((group) => (
                <View
                  key={group[0].planId}
                  style={[
                    styles.eventBlock,
                    { backgroundColor: colors.surfaceSecondary },
                  ]}
                >
                  <View style={styles.eventBlockHeader}>
                    <View style={styles.eventBlockTitleWrap}>
                      <Text
                        style={[styles.eventTitle, { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {group[0].eventTitle}
                      </Text>
                      <Text
                        style={[
                          styles.eventDate,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {formatDateHeading(group[0].eventDate)}
                      </Text>
                    </View>
                    {group.length > 1 && (
                      <Pressable
                        onPress={() => handleAcceptAll(group)}
                        style={({ pressed }) => [
                          styles.acceptAllBtn,
                          { backgroundColor: colors.success },
                          pressed && { opacity: 0.8 },
                        ]}
                      >
                        <Text style={styles.acceptAllText}>Accept all</Text>
                      </Pressable>
                    )}
                  </View>
                  {group.map((a) => (
                    <PendingRow
                      key={a._id}
                      assignment={a}
                      busy={busyId === (a._id as string)}
                      onAccept={() => respond(a._id, "confirmed")}
                      onDecline={() => setDeclineTarget(a._id)}
                      onPress={() => openDetail(a._id)}
                    />
                  ))}
                </View>
              ))}
            </View>
          )}

          {/* Upcoming, grouped by date */}
          {dateGroups.map((group) => (
            <View key={group[0]._id} style={styles.section}>
              <Text
                style={[styles.sectionLabel, { color: colors.textSecondary }]}
              >
                {formatDateHeading(group[0].eventDate).toUpperCase()}
              </Text>
              {group.map((a) => (
                <UpcomingRow
                  key={a._id}
                  assignment={a}
                  onPress={() => openDetail(a._id)}
                  onOpenEvent={
                    eventTasksEnabled ? () => handleEnterServing() : undefined
                  }
                />
              ))}
            </View>
          ))}
        </ScrollView>
      )}

      <DeclineNoteModal
        visible={declineTarget !== null}
        onClose={() => setDeclineTarget(null)}
        onSubmit={async (note) => {
          if (declineTarget) await declineWith(declineTarget, note);
          setDeclineTarget(null);
        }}
      />
    </View>
  );
}

/** A pending request with Accept / Decline. */
function PendingRow({
  assignment,
  busy,
  onAccept,
  onDecline,
  onPress,
}: {
  assignment: MyAssignment;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.pendingRow, { borderTopColor: colors.border }]}>
      <Pressable onPress={onPress} style={styles.pendingTextWrap}>
        <View style={styles.roleLine}>
          <View
            style={[
              styles.dot,
              {
                backgroundColor:
                  assignment.roleColor ?? DEFAULT_ROLE_COLOR,
              },
            ]}
          />
          <Text style={[styles.roleName, { color: colors.text }]}>
            {assignment.roleName}
          </Text>
        </View>
        <Text style={[styles.subLine, { color: colors.textSecondary }]}>
          {assignment.teamName}
          {assignment.timeLabel ? ` · ${assignment.timeLabel}` : ""}
        </Text>
      </Pressable>
      <View style={styles.pendingActions}>
        <Pressable
          onPress={onDecline}
          disabled={busy}
          style={({ pressed }) => [
            styles.respondBtn,
            { backgroundColor: colors.surface, borderColor: colors.border },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={[styles.respondText, { color: colors.destructive }]}>
            Decline
          </Text>
        </Pressable>
        <Pressable
          onPress={onAccept}
          disabled={busy}
          style={({ pressed }) => [
            styles.respondBtn,
            { backgroundColor: colors.success, borderColor: colors.success },
            (busy || pressed) && { opacity: 0.7 },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={[styles.respondText, { color: "#fff" }]}>Accept</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

/** A confirmed/declined assignment row. */
function UpcomingRow({
  assignment,
  onPress,
  onOpenEvent,
}: {
  assignment: MyAssignment;
  onPress: () => void;
  /**
   * Enter event (serving) mode for this plan. Provided only when Event Tasks is
   * enabled. Unlike the day-of banner, this is always available on the row so a
   * leader can open + preview the event view ahead of the serving window.
   */
  onOpenEvent?: () => void;
}) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const isDeclined = assignment.status === "declined";
  const statusColor = isDeclined ? colors.destructive : colors.success;
  // The row is a View (not one big Pressable) so the "Open event" button and the
  // main tap target (open assignment detail) don't fire each other.
  return (
    <View style={[styles.upcomingRow, { backgroundColor: colors.surfaceSecondary }]}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.upcomingMain, pressed && { opacity: 0.7 }]}
      >
        <View
          style={[
            styles.dot,
            { backgroundColor: assignment.roleColor ?? DEFAULT_ROLE_COLOR },
          ]}
        />
        <View style={styles.upcomingTextWrap}>
          <Text style={[styles.roleName, { color: colors.text }]}>
            {assignment.roleName}
          </Text>
          <Text style={[styles.subLine, { color: colors.textSecondary }]}>
            {assignment.eventTitle} · {assignment.teamName}
            {assignment.timeLabel ? ` · ${assignment.timeLabel}` : ""}
          </Text>
        </View>
      </Pressable>
      {onOpenEvent && !isDeclined ? (
        <Pressable
          onPress={onOpenEvent}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Enter event mode for ${assignment.eventTitle}`}
          style={({ pressed }) => [
            styles.openEventBtn,
            { borderColor: primaryColor },
            pressed && { opacity: 0.6 },
          ]}
        >
          <Ionicons name="open-outline" size={14} color={primaryColor} />
          <Text style={[styles.openEventText, { color: primaryColor }]}>Event mode</Text>
        </Pressable>
      ) : null}
      <View style={[styles.statusPill, { backgroundColor: statusColor + "22" }]}>
        <Text style={[styles.statusPillText, { color: statusColor }]}>
          {isDeclined ? "Declined" : "Confirmed"}
        </Text>
      </View>
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
  servingBannerGroup: {
    gap: 8,
    marginTop: 12,
  },
  servingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
  },
  servingBannerTextWrap: {
    flex: 1,
  },
  servingBannerTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
  servingBannerSub: {
    fontSize: 13,
    color: "#fff",
    opacity: 0.9,
    marginTop: 2,
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    marginTop: 16,
    marginBottom: 8,
  },
  eventBlock: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  eventBlockHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  eventBlockTitleWrap: {
    flex: 1,
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  eventDate: {
    fontSize: 13,
    marginTop: 2,
  },
  acceptAllBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  acceptAllText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#fff",
  },
  pendingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 12,
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pendingTextWrap: {
    flex: 1,
  },
  roleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  roleName: {
    fontSize: 15,
    fontWeight: "600",
  },
  subLine: {
    fontSize: 13,
    marginTop: 3,
  },
  pendingActions: {
    flexDirection: "row",
    gap: 8,
  },
  respondBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 72,
    alignItems: "center",
  },
  respondText: {
    fontSize: 13,
    fontWeight: "600",
  },
  upcomingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  upcomingMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  upcomingTextWrap: {
    flex: 1,
  },
  openEventBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  openEventText: {
    fontSize: 12,
    fontWeight: "600",
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: "700",
  },
});
