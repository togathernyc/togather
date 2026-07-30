/**
 * Visual harness for the WA-restyled Attendance screen.
 *
 * The real screen reads its event list and report from Convex, so it can't be
 * screenshotted without a backend. This route composes the same presentational
 * pieces (`WaSubScreenHeader`, `EventCard`, `AttendanceViewMode`, the accent
 * action row) over fixture data, so `pnpm --filter mobile web` + Playwright can
 * confirm the layout — see CLAUDE.md's "Visual Verification".
 *
 * `?state=empty` renders the no-event-selected state; `?state=fresh` renders a
 * selected event nobody has recorded attendance for yet.
 */
import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { DragHandle } from "@components/ui/DragHandle";
import { useTheme } from "@hooks/useTheme";
import { WaSubScreenHeader } from "@components/wa/WaScreenHeader";
import { WaSectionLabel } from "@components/wa/WaSectionLabel";
import { WaInsetGroup } from "@components/wa/WaInsetGroup";
import { WaCell } from "@components/wa/WaCell";
import { WA_GROUP_MARGIN, WA_GROUP_SPACING } from "@components/wa/metrics";
import { EventCard } from "@features/leader-tools/components/EventsList";
import { AttendanceViewMode } from "@features/leader-tools/components/AttendanceViewMode";

const ACCENT = "#1F7A3D";

const EVENTS = [
  {
    date: "2026-07-05T15:00:00.000Z",
    meetingId: "m1",
    name: "Brooklyn 10am & 12pm Service",
    groupTypeName: "Meeting",
    coverImageUrl: null,
    isPast: true,
    rsvpCount: 0,
    attendanceCount: 48,
  },
  {
    date: "2026-07-12T15:00:00.000Z",
    meetingId: "m2",
    name: "Manhattan 10am & 12pm Service",
    groupTypeName: "Meeting",
    coverImageUrl: null,
    isPast: true,
    rsvpCount: 0,
    attendanceCount: 36,
  },
  {
    date: "2026-07-19T23:00:00.000Z",
    meetingId: "m3",
    name: "Dinner Party",
    groupTypeName: "Meeting",
    coverImageUrl: null,
    isPast: true,
    rsvpCount: 0,
    attendanceCount: 12,
  },
  {
    date: "2026-07-26T23:00:00.000Z",
    meetingId: "m4",
    name: "ALLIN",
    groupTypeName: "Meeting",
    coverImageUrl: null,
    isPast: true,
    rsvpCount: 0,
    attendanceCount: 0,
  },
];

const REPORT = {
  attendances: [
    {
      _id: "a1",
      status: 1,
      user: { _id: "u1", first_name: "Jane", last_name: "Smith" },
    },
    {
      _id: "a2",
      status: 1,
      user: { _id: "u2", first_name: "Marcus", last_name: "Bell" },
    },
    {
      _id: "a3",
      status: 1,
      user: { _id: "u3", first_name: "Priya", last_name: "Nair" },
    },
  ],
  guests: [
    { id: "g1", first_name: "Guest 1" },
    { id: "g2", first_name: "Guest 2" },
    { id: "g3", first_name: "Rae", last_name: "Nolan", phone_number: "(555) 010-0199" },
  ],
  stats: { member_count: 3, guest_count: 3, total_count: 6, prev_diff: 2 },
  note: "Rainy morning, smaller crowd than usual.",
};

export default function AttendanceUiTestScreen() {
  const { colors } = useTheme();
  const { state } = useLocalSearchParams<{ state?: string }>();
  const isEmpty = state === "empty";
  const isFresh = state === "fresh";
  const report = isFresh
    ? {
        attendances: [],
        guests: [],
        stats: { member_count: 0, guest_count: 0, total_count: 0, prev_diff: 0 },
        note: null,
      }
    : REPORT;

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundGrouped }]}>
      <DragHandle />
      <WaSubScreenHeader title="Attendance" onBack={() => {}} accent={ACCENT} style={styles.header} />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.eventsSection}>
          <WaSectionLabel variant="header">Events</WaSectionLabel>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.eventsStrip}
          >
            {EVENTS.map((event, index) => (
              <EventCard
                key={event.meetingId}
                event={event}
                isSelected={!isEmpty && index === EVENTS.length - 2}
                onPress={() => {}}
              />
            ))}
          </ScrollView>
        </View>

        {isEmpty ? (
          <View style={styles.emptyState}>
            <Ionicons name="calendar-outline" size={28} color={colors.textTertiary} />
            <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>
              Select an event to view attendance
            </Text>
          </View>
        ) : (
          <View style={styles.report}>
            <AttendanceViewMode
              isFutureEvent={false}
              report={report}
              submittedDate={isFresh ? undefined : "2026-07-19T23:30:00.000Z"}
              submittedBy={
                isFresh ? undefined : { first_name: "Jane", last_name: "Smith" }
              }
            />
            <View style={styles.actionSection}>
              <WaInsetGroup>
                <WaCell
                  variant="action"
                  title={isFresh ? "Take attendance" : "Edit attendance"}
                  accent={ACCENT}
                  onPress={() => {}}
                />
              </WaInsetGroup>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingTop: 4 },
  scrollView: { flex: 1 },
  scrollContent: { paddingTop: 8, paddingBottom: 32 },
  eventsSection: { marginBottom: 20 },
  eventsStrip: { paddingHorizontal: WA_GROUP_MARGIN, paddingTop: 8, gap: 12 },
  report: { paddingTop: 4 },
  actionSection: { marginBottom: WA_GROUP_SPACING },
  emptyState: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: WA_GROUP_MARGIN,
    paddingTop: 24,
  },
  emptyStateText: { fontSize: 15, textAlign: "center" },
});
