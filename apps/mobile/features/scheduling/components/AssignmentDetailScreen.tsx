/**
 * AssignmentDetailScreen
 *
 * The volunteer's single-assignment screen — the target of the push/SMS
 * request deep link (`/scheduling/assignment/[id]`). Shows the event date,
 * time, team, role, who else is on the team, and Accept / Decline. After
 * responding it settles into a confirmed/declined state.
 *
 * The assignment is located within `myAssignments` (which is scoped to the
 * caller) so no extra per-assignment query is needed; `getEvent` supplies
 * the rest of the team roster.
 *
 * Backend: scheduling.mySchedule.myAssignments,
 * scheduling.events.getEvent, scheduling.assignments.respondToAssignment.
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
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import {
  formatEventDateLong,
  assignmentStatusLabel,
  DEFAULT_ROLE_COLOR,
} from "../utils/format";
import { useRespondToAssignment } from "../hooks/useRespondToAssignment";
import { DeclineNoteModal } from "./DeclineNoteModal";

type MyAssignment = {
  _id: Id<"roleAssignments">;
  planId: Id<"eventPlans">;
  eventTitle: string;
  eventDate: number;
  roleName: string;
  roleColor?: string;
  teamName: string;
  status: string;
  timeLabel?: string;
  declineNote?: string;
};

type EventDoc = {
  roles: Array<{
    roleId: Id<"teamRoles">;
    teamId: Id<"teams">;
    roleName: string;
    assignments: Array<{
      _id: Id<"roleAssignments">;
      userName: string;
      status: string;
    }>;
  }>;
};

export function AssignmentDetailScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const assignmentId = id as Id<"roleAssignments">;

  const myAssignments = useAuthenticatedQuery(
    api.functions.scheduling.mySchedule.myAssignments,
    { includePast: true },
  ) as MyAssignment[] | undefined;

  const assignment = useMemo(
    () => myAssignments?.find((a) => a._id === assignmentId),
    [myAssignments, assignmentId],
  );

  const event = useAuthenticatedQuery(
    api.functions.scheduling.events.getEvent,
    assignment ? { planId: assignment.planId } : "skip",
  ) as EventDoc | null | undefined;

  const { respond, declineWith, busyId } = useRespondToAssignment();
  const [declineVisible, setDeclineVisible] = useState(false);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(user)/my-schedule" as any);
  }, [router]);

  // Teammates: every other assignment on the same event plan.
  const teammates = useMemo(() => {
    if (!event || !assignment) return [];
    const planRoles = event.roles;
    const seen = new Set<string>();
    const out: Array<{ name: string; role: string; status: string }> = [];
    for (const role of planRoles) {
      for (const a of role.assignments) {
        if (a._id === assignmentId) continue;
        const key = a._id as string;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ name: a.userName, role: role.roleName, status: a.status });
      }
    }
    return out;
  }, [event, assignment, assignmentId]);

  const busy = busyId === (assignmentId as string);

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
          Your assignment
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {myAssignments === undefined ? (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      ) : !assignment ? (
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            This assignment is no longer available.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 24 },
          ]}
        >
          {/* Role + event */}
          <View style={styles.roleHero}>
            <View
              style={[
                styles.heroDot,
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
          <Text style={[styles.eventTitle, { color: colors.text }]}>
            {assignment.eventTitle}
          </Text>

          {/* Detail rows */}
          <View
            style={[styles.group, { backgroundColor: colors.surfaceSecondary }]}
          >
            <DetailRow
              icon="calendar-outline"
              label="Date"
              value={formatEventDateLong(assignment.eventDate)}
              colors={colors}
            />
            {assignment.timeLabel ? (
              <DetailRow
                icon="time-outline"
                label="Time"
                value={assignment.timeLabel}
                colors={colors}
                bordered
              />
            ) : null}
            <DetailRow
              icon="people-outline"
              label="Team"
              value={assignment.teamName}
              colors={colors}
              bordered
            />
          </View>

          {/* Current status */}
          {assignment.status !== "unconfirmed" && (
            <View
              style={[
                styles.statusBanner,
                {
                  backgroundColor:
                    assignment.status === "confirmed"
                      ? colors.success + "22"
                      : colors.destructive + "22",
                },
              ]}
            >
              <Ionicons
                name={
                  assignment.status === "confirmed"
                    ? "checkmark-circle"
                    : "close-circle"
                }
                size={20}
                color={
                  assignment.status === "confirmed"
                    ? colors.success
                    : colors.destructive
                }
              />
              <Text
                style={[
                  styles.statusBannerText,
                  {
                    color:
                      assignment.status === "confirmed"
                        ? colors.success
                        : colors.destructive,
                  },
                ]}
              >
                You {assignment.status === "confirmed" ? "accepted" : "declined"}{" "}
                this request
                {assignment.declineNote ? ` — "${assignment.declineNote}"` : ""}
              </Text>
            </View>
          )}

          {/* Teammates */}
          {teammates.length > 0 && (
            <>
              <Text
                style={[styles.sectionLabel, { color: colors.textSecondary }]}
              >
                ON THIS EVENT PLAN
              </Text>
              <View
                style={[
                  styles.group,
                  { backgroundColor: colors.surfaceSecondary },
                ]}
              >
                {teammates.map((t, idx) => (
                  <View
                    key={`${t.name}-${idx}`}
                    style={[
                      styles.teammateRow,
                      idx > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.teammateName, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {t.name}
                    </Text>
                    <Text
                      style={[
                        styles.teammateRole,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {t.role}
                    </Text>
                    <Text
                      style={[
                        styles.teammateStatus,
                        {
                          color:
                            t.status === "confirmed"
                              ? colors.success
                              : t.status === "declined"
                                ? colors.destructive
                                : colors.textSecondary,
                        },
                      ]}
                    >
                      {assignmentStatusLabel(t.status)}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      )}

      {/* Respond bar — only while the request is still open */}
      {assignment && assignment.status === "unconfirmed" && (
        <View
          style={[
            styles.respondBar,
            {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
              paddingBottom: insets.bottom + 12,
            },
          ]}
        >
          <Pressable
            onPress={() => setDeclineVisible(true)}
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
            onPress={() => respond(assignment._id, "confirmed")}
            disabled={busy}
            style={({ pressed }) => [
              styles.respondBtn,
              styles.acceptBtn,
              { backgroundColor: colors.success },
              (busy || pressed) && { opacity: 0.8 },
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={[styles.respondText, { color: "#fff" }]}>Accept</Text>
            )}
          </Pressable>
        </View>
      )}

      <DeclineNoteModal
        visible={declineVisible}
        onClose={() => setDeclineVisible(false)}
        onSubmit={async (note) => {
          if (assignment) await declineWith(assignment._id, note);
          setDeclineVisible(false);
        }}
      />
    </View>
  );
}

function DetailRow({
  icon,
  label,
  value,
  colors,
  bordered,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>["colors"];
  bordered?: boolean;
}) {
  return (
    <View
      style={[
        styles.detailRow,
        bordered && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
        },
      ]}
    >
      <Ionicons name={icon} size={20} color={colors.icon} />
      <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <Text style={[styles.detailValue, { color: colors.text }]}>{value}</Text>
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
    padding: 24,
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
  },
  scrollContent: {
    padding: 16,
  },
  roleHero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  heroDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  roleName: {
    fontSize: 24,
    fontWeight: "700",
  },
  eventTitle: {
    fontSize: 16,
    marginTop: 4,
  },
  group: {
    borderRadius: 12,
    overflow: "hidden",
    marginTop: 16,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  detailLabel: {
    fontSize: 14,
    width: 56,
  },
  detailValue: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    textAlign: "right",
  },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    marginTop: 16,
  },
  statusBannerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    marginTop: 20,
    marginBottom: 8,
  },
  teammateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  teammateName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
  },
  teammateRole: {
    fontSize: 13,
  },
  teammateStatus: {
    fontSize: 12,
    fontWeight: "600",
    width: 72,
    textAlign: "right",
  },
  respondBar: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  respondBtn: {
    flex: 1,
    minHeight: 50,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptBtn: {
    borderWidth: 0,
  },
  respondText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
