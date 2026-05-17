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
}: {
  assignment: MyAssignment;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const isDeclined = assignment.status === "declined";
  const statusColor = isDeclined ? colors.destructive : colors.success;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.upcomingRow,
        { backgroundColor: colors.surfaceSecondary },
        pressed && { opacity: 0.8 },
      ]}
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
      <View style={[styles.statusPill, { backgroundColor: statusColor + "22" }]}>
        <Text style={[styles.statusPillText, { color: statusColor }]}>
          {isDeclined ? "Declined" : "Confirmed"}
        </Text>
      </View>
    </Pressable>
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
  upcomingTextWrap: {
    flex: 1,
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
