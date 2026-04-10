/**
 * LeaderAttendancePanel
 *
 * Inline panel shown on the event page for leaders of past events.
 * Lets a leader mark attendance (attended / no-show) for each RSVP
 * and record how many of a guest's plus-ones actually showed up.
 *
 * Reads apps/convex/functions/meetings/attendance.ts:listAttendanceForLeader
 * and writes via markAttendance.
 */

import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useQuery,
  useAuthenticatedMutation,
  useStoredAuthToken,
  api,
  Id,
} from "@services/api/convex";
import { Avatar } from "@components/ui/Avatar";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useTheme } from "@hooks/useTheme";
import { GuestStepper } from "./EventRsvpSection";

interface LeaderAttendancePanelProps {
  meetingId: string;
}

// Attendance status codes — mirrors backend convention:
// 1 = attended, 0 = did not attend. null/undefined = not yet marked.
const ATTENDED = 1;
const NO_SHOW = 0;

export function LeaderAttendancePanel({ meetingId }: LeaderAttendancePanelProps) {
  const { colors } = useTheme();
  const token = useStoredAuthToken();
  const data = useQuery(
    api.functions.meetings.attendance.listAttendanceForLeader,
    meetingId && token
      ? { meetingId: meetingId as Id<"meetings">, token }
      : "skip"
  );

  const markAttendance = useAuthenticatedMutation(
    api.functions.meetings.attendance.markAttendance
  );

  // Per-row optimistic loading state, keyed by userId.
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  const handleSetStatus = useCallback(
    async (
      userId: Id<"users">,
      status: number,
      guestAttendedCount?: number,
    ) => {
      setPendingUserId(userId);
      try {
        await markAttendance({
          meetingId: meetingId as Id<"meetings">,
          userId,
          status,
          ...(guestAttendedCount !== undefined ? { guestAttendedCount } : {}),
        });
      } finally {
        setPendingUserId(null);
      }
    },
    [markAttendance, meetingId]
  );

  if (data === undefined) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
        <View style={styles.headerRow}>
          <Ionicons name="checkmark-done-outline" size={20} color={colors.text} />
          <Text style={[styles.title, { color: colors.text }]}>Attendance</Text>
        </View>
        <ActivityIndicator
          size="small"
          color={DEFAULT_PRIMARY_COLOR}
          style={{ marginTop: 12 }}
        />
      </View>
    );
  }

  // Query returned null/error — likely not a leader. Render nothing.
  if (data === null) return null;

  const { rows, summary, maxGuestsPerRsvp } = data;

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <View style={styles.headerRow}>
        <Ionicons name="checkmark-done-outline" size={20} color={colors.text} />
        <Text style={[styles.title, { color: colors.text }]}>Attendance</Text>
      </View>

      <Text style={[styles.summary, { color: colors.textSecondary }]}>
        {summary.rsvpCount} RSVP'd
        {summary.rsvpGuestCount > 0 ? ` (+${summary.rsvpGuestCount} guests)` : ""} ·{" "}
        {summary.attendedCount} attended
        {summary.attendedGuestCount > 0 ? ` (+${summary.attendedGuestCount})` : ""}
        {summary.noShowCount > 0 ? ` · ${summary.noShowCount} no-show` : ""}
        {summary.unmarkedCount > 0 ? ` · ${summary.unmarkedCount} unmarked` : ""}
      </Text>

      {rows.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          No RSVPs for this event.
        </Text>
      ) : (
        <View style={styles.list}>
          {rows.map((row) => {
            if (!row.user) return null;
            const isPending = pendingUserId === row.userId;
            const isAttended = row.attendanceStatus === ATTENDED;
            const isNoShow = row.attendanceStatus === NO_SHOW;
            const guestAttendedCount = row.guestAttendedCount ?? 0;

            return (
              <View
                key={row.rsvpId}
                style={[styles.row, { backgroundColor: colors.surface }]}
              >
                <Avatar
                  name={`${row.user.firstName} ${row.user.lastName}`}
                  imageUrl={row.user.profileImage || undefined}
                  size={40}
                />
                <View style={styles.rowInfo}>
                  <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
                    {row.user.firstName} {row.user.lastName}
                  </Text>
                  <Text
                    style={[styles.rowMeta, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {row.rsvpOptionLabel ?? "RSVP'd"}
                    {row.isGoing && row.guestCount > 0
                      ? ` · +${row.guestCount} guest${row.guestCount === 1 ? "" : "s"}`
                      : ""}
                  </Text>

                  {isAttended && row.isGoing && row.guestCount > 0 && (
                    <View style={styles.guestStepperWrapper}>
                      <GuestStepper
                        value={guestAttendedCount}
                        onChange={(next) =>
                          handleSetStatus(row.userId, ATTENDED, next)
                        }
                        max={Math.min(row.guestCount, maxGuestsPerRsvp)}
                        disabled={isPending}
                        label="Guests here"
                        compact
                      />
                    </View>
                  )}
                </View>

                <View style={styles.toggleGroup}>
                  <TouchableOpacity
                    testID={`attendance-present-${row.userId}`}
                    style={[
                      styles.toggleButton,
                      isAttended && styles.toggleButtonAttended,
                    ]}
                    onPress={() =>
                      handleSetStatus(
                        row.userId,
                        ATTENDED,
                        // Default to bringing everyone they said they'd bring
                        row.isGoing && row.guestCount > 0 && !isAttended
                          ? row.guestCount
                          : undefined
                      )
                    }
                    disabled={isPending}
                  >
                    {isPending && !isAttended ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Ionicons
                        name="checkmark"
                        size={18}
                        color={isAttended ? "#fff" : DEFAULT_PRIMARY_COLOR}
                      />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID={`attendance-absent-${row.userId}`}
                    style={[
                      styles.toggleButton,
                      isNoShow && styles.toggleButtonNoShow,
                    ]}
                    onPress={() => handleSetStatus(row.userId, NO_SHOW)}
                    disabled={isPending}
                  >
                    {isPending && !isNoShow ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Ionicons
                        name="close"
                        size={18}
                        color={isNoShow ? "#fff" : colors.textSecondary}
                      />
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
  },
  summary: {
    fontSize: 13,
    marginTop: 4,
    marginBottom: 12,
  },
  empty: {
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 16,
  },
  list: {
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 10,
    gap: 12,
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: 15,
    fontWeight: "600",
  },
  rowMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  guestStepperWrapper: {
    marginTop: 8,
  },
  toggleGroup: {
    flexDirection: "row",
    gap: 6,
  },
  toggleButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "rgba(0,0,0,0.1)",
  },
  toggleButtonAttended: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    borderColor: DEFAULT_PRIMARY_COLOR,
  },
  toggleButtonNoShow: {
    backgroundColor: "#9CA3AF",
    borderColor: "#9CA3AF",
  },
});
