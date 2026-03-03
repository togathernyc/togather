import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { format } from "date-fns";
import { MemberItem } from "./MemberItem";
import { Ionicons } from "@expo/vector-icons";

interface AttendanceViewModeProps {
  isFutureEvent: boolean;
  projectedAttendance?: number;
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

export function AttendanceViewMode({
  isFutureEvent,
  projectedAttendance = 0,
  report,
  submittedDate,
  submittedBy,
}: AttendanceViewModeProps) {
  if (isFutureEvent) {
    return (
      <View style={styles.statsSection}>
        <View style={styles.messageContainer}>
          <Ionicons
            name="time-outline"
            size={24}
            color="#666"
            style={styles.messageIcon}
          />
          <Text style={styles.messageText}>
            Wait until the day of the event or after to take attendance
          </Text>
        </View>
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

  return (
    <>
      {/* Attendance Stats for Past Events */}
      <View style={styles.statsSection}>
        <Text style={styles.sectionLabel}>Attendance</Text>
        {submittedDate && (
          <>
            <Text style={styles.submittedText}>
              Submitted on {format(new Date(submittedDate), "MMM dd, yyyy")}
            </Text>
            {submittedBy && (
              <Text style={styles.submittedText}>
                By {submittedBy.first_name} {submittedBy.last_name}
              </Text>
            )}
          </>
        )}
        <View style={styles.noteContainer}>
          <Text style={styles.noteText}>{report?.note || "No note"}</Text>
        </View>

        {/* Stats Cards */}
        <View style={styles.statsCards}>
          <View style={styles.statCard}>
            <Text style={styles.statCardTitle}>Attended</Text>
            <Text style={styles.statCardValue}>{totalAttended}</Text>
            <Text style={styles.statCardSubtitle}>
              {memberCount} members, {guestCount} guests
            </Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statCardTitle}>Change</Text>
            <Text
              style={[
                styles.statCardValue,
                {
                  color:
                    (report?.stats?.prev_diff || 0) > 0
                      ? "#66D440"
                      : (report?.stats?.prev_diff || 0) < 0
                        ? "#F56848"
                        : "#333",
                },
              ]}
            >
              {report?.stats?.prev_diff || 0}
            </Text>
          </View>
        </View>
      </View>

      {/* Guests Section */}
      {guestList.length > 0 && (
        <View style={styles.attendedSection}>
          <Text style={styles.sectionLabel}>Guests</Text>
          <View style={styles.membersList}>
            {/* Anonymous Guests Summary Card */}
            {anonymousGuests.length > 0 && (
              <View style={styles.guestCard}>
                <View style={styles.guestIconContainer}>
                  <Ionicons name="people" size={20} color="#666" />
                </View>
                <View style={styles.guestInfo}>
                  <Text style={styles.guestName}>Anonymous Guests</Text>
                  <Text style={styles.guestDetail}>
                    {anonymousGuests.length} guest
                    {anonymousGuests.length !== 1 ? "s" : ""}
                  </Text>
                </View>
              </View>
            )}

            {/* Named Guests Individual Cards */}
            {namedGuests.map((guest: any) => (
              <View key={guest.id} style={styles.guestCard}>
                <View style={styles.guestIconContainer}>
                  <Ionicons name="person" size={20} color="#666" />
                </View>
                <View style={styles.guestInfo}>
                  <Text style={styles.guestName}>
                    {guest.first_name} {guest.last_name || ""}
                  </Text>
                  {guest.phone_number && (
                    <Text style={styles.guestDetail}>{guest.phone_number}</Text>
                  )}
                  {guest.notes && (
                    <Text style={styles.guestDetail}>{guest.notes}</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Attended Members List */}
      <View style={styles.attendedSection}>
        <Text style={styles.sectionLabel}>Members</Text>
        <View style={styles.membersList}>
          {attendedMembers.length > 0 ? (
            attendedMembers.map((member: any) => (
              <MemberItem
                key={member.user?._id || member._id}
                member={{
                  ...member,
                  id: member.user?._id || member._id,
                  // Flatten user data for MemberItem compatibility
                  first_name: member.user?.first_name || member.first_name || '',
                  last_name: member.user?.last_name || member.last_name || '',
                  profile_photo: member.user?.profile_photo || member.profile_photo || null,
                }}
                isAttended={true}
                showCheckbox={false}
              />
            ))
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No members attended</Text>
            </View>
          )}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  statsSection: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  projectedStatsContainer: {
    flexDirection: "row",
    gap: 16,
    marginTop: 16,
  },
  projectedStatItem: {
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    padding: 16,
    minWidth: 100,
  },
  projectedStatValue: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 4,
  },
  projectedStatLabel: {
    fontSize: 14,
    color: "#666",
    fontWeight: "500",
  },
  projectedNote: {
    fontSize: 12,
    color: "#999",
    marginTop: 8,
    fontStyle: "italic",
  },
  submittedText: {
    fontSize: 14,
    color: "#666",
    marginTop: 8,
  },
  noteContainer: {
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  noteText: {
    fontSize: 14,
    color: "#666",
  },
  statsCards: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    padding: 16,
  },
  statCardTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    marginBottom: 8,
  },
  statCardValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
  },
  statCardSubtitle: {
    fontSize: 11,
    color: "#999",
    marginTop: 4,
  },
  guestCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    marginBottom: 8,
  },
  guestIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#e0e0e0",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  guestInfo: {
    flex: 1,
  },
  guestName: {
    fontSize: 15,
    fontWeight: "500",
    color: "#333",
  },
  guestDetail: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
  attendedSection: {
    marginBottom: 24,
  },
  membersList: {
    marginTop: 8,
  },
  emptyState: {
    padding: 20,
    alignItems: "center",
  },
  emptyStateText: {
    fontSize: 14,
    color: "#999",
  },
  messageContainer: {
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  messageIcon: {
    marginBottom: 12,
  },
  messageText: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 20,
  },
});
