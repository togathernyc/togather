import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { format, addDays } from "date-fns";
import { Ionicons } from "@expo/vector-icons";
import { useRecentAttendanceStats, useMeetingDates } from "../hooks";
// Removed LeaderToolsPage import - navigation now uses router.push

import { useTheme } from "@hooks/useTheme";

interface RecentAttendanceProps {
  groupId: string;
  group: any;
  onPageChange?: (page: string) => void; // Optional for backward compatibility
  onGroupChat: () => void;
  onNotifications: () => void;
}

interface MeetingSummary {
  id?: number;
  dateOfMeeting: string;
  dinner?: number;
  stats?: {
    id: number;
    totalUserCount: number;
    completionCount: number;
    presentCount?: number;
  };
  logDetails?: Array<{
    id: number;
    updatedBy: {
      first_name: string;
      last_name: string;
    };
    attendance: number;
    createdAt: string;
  }>;
}

export function RecentAttendance({
  groupId,
  group,
  onPageChange,
  onGroupChat,
  onNotifications,
}: RecentAttendanceProps) {
  const { colors } = useTheme();
  const router = useRouter();

  // Fetch recent attendance stats
  const { data: attendanceStatsData, isLoading: isLoadingStats } =
    useRecentAttendanceStats(groupId, 6);

  // Fetch meeting dates for the next 7 days (matching iOS behavior)
  const startDate = new Date();
  const endDate = addDays(startDate, 7);
  const { data: meetingDatesData } = useMeetingDates(groupId, {
    startDate,
    endDate,
  });

  const attendanceStats = Array.isArray(attendanceStatsData) ? attendanceStatsData : [];
  const highestAttendance =
    attendanceStats.reduce(
      (max: number, stat: any) => Math.max(max, stat.present_count || 0),
      0
    ) || 1;

  // Get meeting dates
  const meetingDates: MeetingSummary[] = Array.isArray(meetingDatesData) ? meetingDatesData : [];

  // Log the data we receive for debugging
  if (__DEV__) {
    console.log("📅 RecentAttendance - Raw data:", {
      meetingDatesData,
      hasData: !!meetingDatesData,
      isArray: Array.isArray(meetingDatesData),
      dataType: typeof meetingDatesData,
    });
    console.log("📅 RecentAttendance - Processed meetingDates:", {
      count: meetingDates.length,
      dates: meetingDates.map((m) => m.dateOfMeeting),
    });
  }

  // Find next scheduled event (matching iOS behavior)
  const nextEvent = meetingDates
    .sort(
      (a, b) =>
        new Date(a.dateOfMeeting).getTime() -
        new Date(b.dateOfMeeting).getTime()
    )
    .find((meeting) => new Date(meeting.dateOfMeeting) >= new Date());

  if (__DEV__) {
    console.log("📅 RecentAttendance - Next event:", {
      hasNextEvent: !!nextEvent,
      nextEventDate: nextEvent?.dateOfMeeting,
    });
  }

  const nextEventDate = nextEvent
    ? format(new Date(nextEvent.dateOfMeeting), "MMM dd, yyyy")
    : null;

  const hasNextEvent = !!nextEvent;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
    >
      {/* Group Info Header */}
      <View style={styles.header}>
        <View style={styles.membersSection}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>MEMBERS</Text>
          <TouchableOpacity
            style={styles.membersRow}
            onPress={() => router.push(`/(user)/leader-tools/${groupId}/members`)}
          >
            {/* TODO: Show member avatars */}
            <View style={styles.memberAvatars}>
              {Array.from({
                length: Math.min(group?.members?.length || 0, 5),
              }).map((_, index) => (
                <View key={index} style={[styles.memberAvatarPlaceholder, { backgroundColor: colors.border, borderColor: colors.surface }]} />
              ))}
            </View>
            <Text style={[styles.memberCount, { color: colors.text }]}>
              {(() => {
                // Get member count from the group data
                const count = group?.members?.length || 0;
                return `${count} ${count === 1 ? "member" : "members"}`;
              })()}
            </Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={[styles.chatButton, { backgroundColor: colors.text }]} onPress={onGroupChat}>
          <Ionicons name="chatbubble-outline" size={20} color={colors.textInverse} />
        </TouchableOpacity>
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {/* Recent Attendance Graph */}
      <View style={styles.attendanceSection}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>RECENT ATTENDANCE</Text>
        {isLoadingStats ? (
          <View style={styles.loadingContainer}>
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading attendance...</Text>
          </View>
        ) : attendanceStats.length > 0 ? (
          <View style={styles.graphContainer}>
            <View style={styles.graph}>
              {attendanceStats.map((stat: any, index: number) => {
                const height =
                  (stat.present_count / highestAttendance) * 113 + 32;
                const showCountOnBar = height >= 48;
                return (
                  <View key={stat.id || index} style={styles.graphBarContainer}>
                    {!showCountOnBar && (
                      <Text style={[styles.graphCountAbove, { color: colors.text }]}>
                        {stat.present_count}
                      </Text>
                    )}
                    <View
                      style={[
                        styles.graphBar,
                        { height: Math.max(height, 32), backgroundColor: colors.text },
                      ]}
                    >
                      {showCountOnBar && (
                        <Text style={[styles.graphCount, { color: colors.textInverse }]}>
                          {stat.present_count}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
            <View style={styles.graphDates}>
              {attendanceStats.map((stat: any, index: number) => (
                <Text key={stat.id || index} style={[styles.graphDate, { color: colors.textSecondary }]}>
                  {format(new Date(stat.date_of_meeting), "M/d")}
                </Text>
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyStateText, { color: colors.textTertiary }]}>No attendance records yet</Text>
          </View>
        )}
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {/* Next Event Section */}
      <View style={styles.eventSection}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Next Event</Text>
        <View style={styles.eventRow}>
          <Text style={[styles.eventDate, { color: colors.text }]}>
            {hasNextEvent ? nextEventDate : "Nothing Scheduled"}
          </Text>
          <TouchableOpacity
            style={[styles.eventButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => {
              // Navigate to events modal (matching iOS behavior)
              if (onPageChange) {
                onPageChange("events");
              } else {
                const groupName = group?.name || 'Group';
                router.push(`/(user)/group-events?groupId=${groupId}&groupName=${encodeURIComponent(groupName)}`);
              }
            }}
          >
            <Text style={[styles.eventButtonText, { color: colors.text }]}>
              {hasNextEvent ? "EDIT" : "CREATE EVENT"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {/* Navigation Tabs */}
      <TouchableOpacity
        style={[styles.navTab, { borderBottomColor: colors.border }]}
        onPress={() => {
          if (onPageChange) {
            onPageChange("members");
          } else {
            router.push(`/(user)/leader-tools/${groupId}/members`);
          }
        }}
      >
        <Text style={[styles.navTabText, { color: colors.text }]}>Members</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.navTab, { borderBottomColor: colors.border }]}
        onPress={() => {
          if (onPageChange) {
            onPageChange("events");
          } else {
            const groupName = group?.name || 'Group';
            router.push(`/(user)/group-events?groupId=${groupId}&groupName=${encodeURIComponent(groupName)}`);
          }
        }}
      >
        <Text style={[styles.navTabText, { color: colors.text }]}>Events</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.navTab, { borderBottomColor: colors.border }]}
        onPress={() => {
          router.push(`/(user)/leader-tools/${groupId}/shared-channels`);
        }}
      >
        <Text style={[styles.navTabText, { color: colors.text }]}>Shared Channels</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 32,
  },
  membersSection: {
    flex: 1,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 12,
    textTransform: "uppercase",
  },
  membersRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  memberAvatars: {
    flexDirection: "row",
    marginRight: 8,
  },
  memberAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginLeft: -8,
    borderWidth: 1,
  },
  memberCount: {
    fontSize: 14,
  },
  chatButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  divider: {
    height: 1,
    marginVertical: 24,
  },
  attendanceSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 16,
    textTransform: "uppercase",
  },
  loadingContainer: {
    padding: 20,
    alignItems: "center",
  },
  loadingText: {
    fontSize: 14,
  },
  graphContainer: {
    marginTop: 8,
  },
  graph: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: 113,
    marginBottom: 8,
  },
  graphBarContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  graphBar: {
    width: "80%",
    borderRadius: 4,
    minHeight: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  graphCount: {
    fontSize: 12,
    fontWeight: "600",
  },
  graphCountAbove: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4,
  },
  graphDates: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  graphDate: {
    fontSize: 12,
    flex: 1,
    textAlign: "center",
  },
  emptyState: {
    padding: 20,
    alignItems: "center",
  },
  emptyStateText: {
    fontSize: 14,
  },
  eventSection: {
    marginBottom: 24,
  },
  eventRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  eventDate: {
    fontSize: 16,
    fontWeight: "500",
  },
  eventButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 6,
  },
  eventButtonText: {
    fontSize: 12,
    fontWeight: "600",
  },
  navTab: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  navTabText: {
    fontSize: 16,
  },
});
