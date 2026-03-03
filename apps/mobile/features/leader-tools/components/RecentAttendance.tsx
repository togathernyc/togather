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
          <Text style={styles.sectionLabel}>MEMBERS</Text>
          <TouchableOpacity
            style={styles.membersRow}
            onPress={() => router.push(`/(user)/leader-tools/${groupId}/members`)}
          >
            {/* TODO: Show member avatars */}
            <View style={styles.memberAvatars}>
              {Array.from({
                length: Math.min(group?.members?.length || 0, 5),
              }).map((_, index) => (
                <View key={index} style={styles.memberAvatarPlaceholder} />
              ))}
            </View>
            <Text style={styles.memberCount}>
              {(() => {
                // Get member count from the group data
                const count = group?.members?.length || 0;
                return `${count} ${count === 1 ? "member" : "members"}`;
              })()}
            </Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.chatButton} onPress={onGroupChat}>
          <Ionicons name="chatbubble-outline" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.divider} />

      {/* Recent Attendance Graph */}
      <View style={styles.attendanceSection}>
        <Text style={styles.sectionTitle}>RECENT ATTENDANCE</Text>
        {isLoadingStats ? (
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>Loading attendance...</Text>
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
                      <Text style={styles.graphCountAbove}>
                        {stat.present_count}
                      </Text>
                    )}
                    <View
                      style={[
                        styles.graphBar,
                        { height: Math.max(height, 32) },
                      ]}
                    >
                      {showCountOnBar && (
                        <Text style={styles.graphCount}>
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
                <Text key={stat.id || index} style={styles.graphDate}>
                  {format(new Date(stat.date_of_meeting), "M/d")}
                </Text>
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No attendance records yet</Text>
          </View>
        )}
      </View>

      <View style={styles.divider} />

      {/* Next Event Section */}
      <View style={styles.eventSection}>
        <Text style={styles.sectionTitle}>Next Event</Text>
        <View style={styles.eventRow}>
          <Text style={styles.eventDate}>
            {hasNextEvent ? nextEventDate : "Nothing Scheduled"}
          </Text>
          <TouchableOpacity
            style={styles.eventButton}
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
            <Text style={styles.eventButtonText}>
              {hasNextEvent ? "EDIT" : "CREATE EVENT"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.divider} />

      {/* Navigation Tabs */}
      <TouchableOpacity
        style={styles.navTab}
        onPress={() => {
          if (onPageChange) {
            onPageChange("members");
          } else {
            router.push(`/(user)/leader-tools/${groupId}/members`);
          }
        }}
      >
        <Text style={styles.navTabText}>Members</Text>
        <Ionicons name="chevron-forward" size={20} color="#666" />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.navTab}
        onPress={() => {
          if (onPageChange) {
            onPageChange("events");
          } else {
            const groupName = group?.name || 'Group';
            router.push(`/(user)/group-events?groupId=${groupId}&groupName=${encodeURIComponent(groupName)}`);
          }
        }}
      >
        <Text style={styles.navTabText}>Events</Text>
        <Ionicons name="chevron-forward" size={20} color="#666" />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.navTab}
        onPress={() => {
          router.push(`/(user)/leader-tools/${groupId}/shared-channels`);
        }}
      >
        <Text style={styles.navTabText}>Shared Channels</Text>
        <Ionicons name="chevron-forward" size={20} color="#666" />
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
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
    color: "#666",
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
    backgroundColor: "#e0e0e0",
    marginLeft: -8,
    borderWidth: 1,
    borderColor: "#fff",
  },
  memberCount: {
    fontSize: 14,
    color: "#333",
  },
  chatButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#333",
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
    backgroundColor: "#e0e0e0",
    marginVertical: 24,
  },
  attendanceSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    marginBottom: 16,
    textTransform: "uppercase",
  },
  loadingContainer: {
    padding: 20,
    alignItems: "center",
  },
  loadingText: {
    fontSize: 14,
    color: "#666",
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
    backgroundColor: "#333",
    borderRadius: 4,
    minHeight: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  graphCount: {
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
  },
  graphCountAbove: {
    fontSize: 12,
    fontWeight: "600",
    color: "#333",
    marginBottom: 4,
  },
  graphDates: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  graphDate: {
    fontSize: 12,
    color: "#666",
    flex: 1,
    textAlign: "center",
  },
  emptyState: {
    padding: 20,
    alignItems: "center",
  },
  emptyStateText: {
    fontSize: 14,
    color: "#999",
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
    color: "#333",
  },
  eventButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 6,
  },
  eventButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#333",
  },
  navTab: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  navTabText: {
    fontSize: 16,
    color: "#333",
  },
});
