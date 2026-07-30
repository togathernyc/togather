import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { format } from "date-fns";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { WaInsetGroup } from "@components/wa/WaInsetGroup";
import { WaCell } from "@components/wa/WaCell";
import { WaRow } from "@components/wa/WaRow";
import { WA_GROUP_SPACING, WA_CELL_PADDING } from "@components/wa/metrics";

interface AttendanceViewModeProps {
  isFutureEvent: boolean;
  report?: any;
  submittedDate?: string;
  submittedBy?: {
    first_name: string;
    last_name: string;
  };
}

// Helper to check if a guest is anonymous (named like "Guest 1", "Guest 2")
const isAnonymousGuest = (guest: any) => {
  return guest.first_name?.startsWith("Guest ") && !guest.last_name;
};

/**
 * The read-only attendance report.
 *
 * WHATSAPP-DESIGN-SYSTEM.md §3.2: one `WaInsetGroup` per section, people as
 * `WaRow`s. The headline numbers sit in a single three-metric strip inside the
 * summary card rather than the old pair of half-width stat tiles — same facts,
 * roughly a third of the height, and "who attended" starts above the fold.
 * Empty facts (no note, no change, no guests) render nothing at all instead of
 * a placeholder box; a report of an event nobody has recorded yet is a short
 * card, not a screen of zeros.
 */
export function AttendanceViewMode({
  isFutureEvent,
  report,
  submittedDate,
  submittedBy,
}: AttendanceViewModeProps) {
  const { colors } = useTheme();
  if (isFutureEvent) {
    return (
      <View style={styles.section}>
        <WaInsetGroup>
          <View style={styles.messageRow}>
            <Ionicons
              name="time-outline"
              size={22}
              color={colors.textSecondary}
            />
            <Text style={[styles.messageText, { color: colors.textSecondary }]}>
              Wait until the day of the event or after to take attendance
            </Text>
          </View>
        </WaInsetGroup>
      </View>
    );
  }

  // Use new format: attendances array with status field
  const attendanceList = report?.attendances || [];
  const guestList = report?.guests || [];

  // Filter members who attended (status=1 means present)
  const attendedMembers = attendanceList.filter(
    (member: any) => member.status === 1
  );

  // Separate anonymous and named guests
  const anonymousGuests = guestList.filter(isAnonymousGuest);
  const namedGuests = guestList.filter((g: any) => !isAnonymousGuest(g));

  // Use stats object directly
  const memberCount = report?.stats?.member_count ?? 0;
  const guestCount = report?.stats?.guest_count ?? 0;
  const totalAttended = report?.stats?.total_count ?? 0;
  const change = report?.stats?.prev_diff ?? 0;

  const note = report?.note;
  const submissionFooter = submittedDate
    ? `Submitted ${format(new Date(submittedDate), "MMM d, yyyy")}${
        submittedBy ? ` by ${submittedBy.first_name} ${submittedBy.last_name}` : ""
      }`
    : undefined;

  return (
    <>
      {/* Headline numbers */}
      <View style={styles.section}>
        <WaInsetGroup header="Attendance" footer={submissionFooter} separatorInset={0}>
          <View style={styles.statsStrip}>
            <Stat label="Total" value={String(totalAttended)} color={colors.text} />
            <View style={[styles.statDivider, { backgroundColor: colors.separator }]} />
            <Stat label="Members" value={String(memberCount)} color={colors.text} />
            <View style={[styles.statDivider, { backgroundColor: colors.separator }]} />
            <Stat label="Guests" value={String(guestCount)} color={colors.text} />
            {change !== 0 && (
              <>
                <View style={[styles.statDivider, { backgroundColor: colors.separator }]} />
                <Stat
                  label="vs last"
                  value={`${change > 0 ? "+" : ""}${change}`}
                  color={change > 0 ? colors.success : colors.destructive}
                />
              </>
            )}
          </View>
          {note ? <WaCell variant="footer" title={note} /> : null}
        </WaInsetGroup>
      </View>

      {/* Guests */}
      {guestList.length > 0 && (
        <View style={styles.section}>
          <WaInsetGroup header="Guests" separatorInset={WA_CELL_PADDING + 40 + 12}>
            {anonymousGuests.length > 0 && (
              <WaRow
                avatar={{ label: "Guests", size: 40 }}
                title="Anonymous guests"
                subtitle={`${anonymousGuests.length} guest${
                  anonymousGuests.length !== 1 ? "s" : ""
                }`}
              />
            )}
            {namedGuests.map((guest: any) => {
              const name = `${guest.first_name} ${guest.last_name || ""}`.trim();
              return (
                <WaRow
                  key={guest.id}
                  avatar={{ label: name || "Guest", seed: guest.id, size: 40 }}
                  title={name || "Guest"}
                  subtitle={guest.phone_number || guest.notes || undefined}
                />
              );
            })}
          </WaInsetGroup>
        </View>
      )}

      {/* Attended members */}
      <View style={styles.section}>
        <WaInsetGroup header="Members" separatorInset={WA_CELL_PADDING + 40 + 12}>
          {attendedMembers.length > 0 ? (
            attendedMembers.map((member: any) => {
              const name = `${member.user?.first_name || member.first_name || ""} ${
                member.user?.last_name || member.last_name || ""
              }`.trim();
              const userId = member.user?._id || member._id;
              return (
                <WaRow
                  key={userId}
                  avatar={{
                    imageUrl:
                      member.user?.profile_photo || member.profile_photo || null,
                    label: name || "Member",
                    seed: userId,
                    size: 40,
                  }}
                  title={name || "Member"}
                />
              );
            })
          ) : (
            <WaCell variant="footer" title="No members attended" />
          )}
        </WaInsetGroup>
      </View>
    </>
  );
}

/** One metric in the summary strip: value over label, evenly sharing the row. */
function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.textTertiary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: WA_GROUP_SPACING,
  },
  statsStrip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
  },
  stat: {
    flex: 1,
    alignItems: "center",
  },
  statValue: {
    fontSize: 24,
    fontWeight: "600",
  },
  statLabel: {
    fontSize: 13,
    marginTop: 2,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    marginVertical: 4,
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: WA_CELL_PADDING,
    paddingVertical: 16,
  },
  messageText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
  },
});
