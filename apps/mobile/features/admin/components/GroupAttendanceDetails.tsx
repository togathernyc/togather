/**
 * GroupAttendanceDetails - Drill-down view for group attendance
 *
 * Shows member-level attendance:
 * - Single date: List view with present/absent status
 * - Date range: Grid view with meetings as columns
 */
import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { DEFAULT_PRIMARY_COLOR } from "../../../utils/styles";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { ExportBottomSheet } from "./ExportBottomSheet";
import {
  generateSingleDayAttendanceCsv,
  generateDateRangeAttendanceCsv,
  generateFilename,
} from "../utils/csvExport";

interface GroupAttendanceDetailsProps {
  groupId: string;
  startDate: string;
  endDate: string;
  onBack: () => void;
}

export function GroupAttendanceDetails({
  groupId,
  startDate,
  endDate,
  onBack,
}: GroupAttendanceDetailsProps) {
  const { community, token, user } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const [showExportSheet, setShowExportSheet] = useState(false);

  // Convex query for group attendance details
  const detailsData = useQuery(
    api.functions.admin.stats.getGroupAttendanceDetails,
    community?.id && token
      ? {
          token,
          communityId: community.id as Id<"communities">,
          groupId: groupId as Id<"groups">,
          startDate,
          endDate,
        }
      : "skip"
  );

  const isLoading = detailsData === undefined;

  // CSV export data - hooks must be called before any early returns
  const csvContent = useMemo(() => {
    if (!detailsData) return "";
    if (detailsData.isSingleDay) {
      return generateSingleDayAttendanceCsv(detailsData as unknown as SingleDayData);
    } else {
      return generateDateRangeAttendanceCsv(detailsData as unknown as DateRangeData);
    }
  }, [detailsData]);

  const csvFilename = useMemo(() => {
    if (!detailsData) return "attendance.csv";
    return generateFilename("attendance", community?.name || "community", {
      groupTypeName: detailsData.groupName,
      date: detailsData.isSingleDay ? (detailsData as any).date : undefined,
      startDate: !detailsData.isSingleDay ? (detailsData as any).startDate : undefined,
      endDate: !detailsData.isSingleDay ? (detailsData as any).endDate : undefined,
    });
  }, [detailsData, community?.name]);

  const handleExport = useCallback(() => {
    if (detailsData) {
      setShowExportSheet(true);
    }
  }, [detailsData]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={primaryColor} />
        <Text style={styles.loadingText}>Loading attendance details...</Text>
      </View>
    );
  }

  if (!detailsData) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={48} color="#FF3B30" />
        <Text style={styles.errorText}>Failed to load attendance</Text>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const data = detailsData;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backIconButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{data.groupName}</Text>
          <Text style={styles.headerSubtitle}>
            {data.isSingleDay
              ? new Date((data as any).date).toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })
              : `${new Date((data as any).startDate).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })} - ${new Date((data as any).endDate).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}`}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.exportHeaderButton}
          onPress={handleExport}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="download-outline" size={22} color={primaryColor} />
        </TouchableOpacity>
      </View>

      {data.isSingleDay ? (
        <SingleDayView data={data as any} />
      ) : (
        <DateRangeView data={data as any} />
      )}

      {/* Export Bottom Sheet */}
      <ExportBottomSheet
        visible={showExportSheet}
        onClose={() => setShowExportSheet(false)}
        csvContent={csvContent}
        filename={csvFilename}
        userEmail={user?.email || undefined}
        title={`Export ${data.groupName} Attendance`}
      />
    </View>
  );
}

// Types for the two view modes
interface SingleDayData {
  groupId: string;
  groupName: string;
  isSingleDay: true;
  date: string;
  meetingId: string | null;
  meetingTitle: string | null;
  memberAttendance: Array<{
    userId: string;
    firstName: string;
    lastName: string;
    profilePhoto: string | null;
    status: number | null;
    statusLabel: string;
  }>;
  presentCount: number;
  absentCount: number;
  notRecordedCount: number;
}

interface DateRangeData {
  groupId: string;
  groupName: string;
  isSingleDay: false;
  startDate: string;
  endDate: string;
  meetingColumns: Array<{
    meetingId: string;
    title: string | null;
    date: string;
    dateLabel: string;
  }>;
  memberRows: Array<{
    userId: string;
    firstName: string;
    lastName: string;
    profilePhoto: string | null;
    attendanceByMeeting: Record<string, number | null>;
    presentCount: number;
    absentCount: number;
    attendanceRate: number;
  }>;
  totalMeetings: number;
}

function SingleDayView({ data }: { data: SingleDayData }) {
  return (
    <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
      {/* Summary */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <View style={[styles.statusDot, { backgroundColor: "#34C759" }]} />
            <Text style={styles.summaryValue}>{data.presentCount}</Text>
            <Text style={styles.summaryLabel}>Present</Text>
          </View>
          <View style={styles.summaryItem}>
            <View style={[styles.statusDot, { backgroundColor: "#FF3B30" }]} />
            <Text style={styles.summaryValue}>{data.absentCount}</Text>
            <Text style={styles.summaryLabel}>Absent</Text>
          </View>
          <View style={styles.summaryItem}>
            <View style={[styles.statusDot, { backgroundColor: "#C7C7CC" }]} />
            <Text style={styles.summaryValue}>{data.notRecordedCount}</Text>
            <Text style={styles.summaryLabel}>Not Recorded</Text>
          </View>
        </View>
      </View>

      {/* Member List */}
      {data.memberAttendance.length > 0 ? (
        <View style={styles.memberList}>
          {data.memberAttendance.map((member) => (
            <View key={member.userId} style={styles.memberItem}>
              {member.profilePhoto ? (
                <Image source={{ uri: member.profilePhoto }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Ionicons name="person" size={20} color="#999" />
                </View>
              )}
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>
                  {member.firstName} {member.lastName}
                </Text>
              </View>
              <View
                style={[
                  styles.statusBadge,
                  member.status === 1
                    ? styles.statusPresent
                    : member.status === 0
                    ? styles.statusAbsent
                    : styles.statusNotRecorded,
                ]}
              >
                <Text
                  style={[
                    styles.statusBadgeText,
                    member.status === 1
                      ? styles.statusPresentText
                      : member.status === 0
                      ? styles.statusAbsentText
                      : styles.statusNotRecordedText,
                  ]}
                >
                  {member.statusLabel}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.emptyText}>No members to display</Text>
      )}
    </ScrollView>
  );
}

function DateRangeView({ data }: { data: DateRangeData }) {
  if (data.meetingColumns.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="calendar-outline" size={48} color="#ccc" />
        <Text style={styles.emptyText}>No meetings in this date range</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scrollView}>
      {/* Stats Header */}
      <View style={styles.gridHeader}>
        <Text style={styles.gridHeaderText}>
          {data.totalMeetings} meeting{data.totalMeetings !== 1 ? "s" : ""} • {data.memberRows.length} members
        </Text>
      </View>

      {/* Grid */}
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          {/* Header Row */}
          <View style={styles.gridRow}>
            <View style={styles.gridNameCell}>
              <Text style={styles.gridHeaderCellText}>Member</Text>
            </View>
            {data.meetingColumns.map((meeting) => (
              <View key={meeting.meetingId} style={styles.gridCell}>
                <Text style={styles.gridHeaderCellText}>{meeting.dateLabel}</Text>
              </View>
            ))}
            <View style={styles.gridCell}>
              <Text style={styles.gridHeaderCellText}>Rate</Text>
            </View>
          </View>

          {/* Data Rows */}
          {data.memberRows.map((member) => (
            <View key={member.userId} style={styles.gridRow}>
              <View style={styles.gridNameCell}>
                <View style={styles.memberRow}>
                  {member.profilePhoto ? (
                    <Image source={{ uri: member.profilePhoto }} style={styles.gridAvatar} />
                  ) : (
                    <View style={styles.gridAvatarPlaceholder}>
                      <Ionicons name="person" size={12} color="#999" />
                    </View>
                  )}
                  <Text style={styles.gridMemberName} numberOfLines={1}>
                    {member.firstName} {member.lastName}
                  </Text>
                </View>
              </View>
              {data.meetingColumns.map((meeting) => {
                const status = member.attendanceByMeeting[meeting.meetingId];
                return (
                  <View key={meeting.meetingId} style={styles.gridCell}>
                    {status === 1 ? (
                      <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                    ) : status === 0 ? (
                      <Ionicons name="close-circle" size={20} color="#FF3B30" />
                    ) : (
                      <Ionicons name="remove-circle-outline" size={20} color="#C7C7CC" />
                    )}
                  </View>
                );
              })}
              <View style={styles.gridCell}>
                <Text
                  style={[
                    styles.gridRateText,
                    member.attendanceRate >= 80
                      ? styles.rateGood
                      : member.attendanceRate >= 50
                      ? styles.rateMedium
                      : styles.rateLow,
                  ]}
                >
                  {member.attendanceRate}%
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    fontSize: 16,
    color: "#666",
    marginTop: 12,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    gap: 12,
  },
  errorText: {
    fontSize: 16,
    color: "#333",
  },
  backButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    borderRadius: 8,
    marginTop: 8,
  },
  backButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  backIconButton: {
    padding: 4,
    marginRight: 12,
  },
  headerText: {
    flex: 1,
  },
  exportHeaderButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  headerSubtitle: {
    fontSize: 14,
    color: "#666",
    marginTop: 2,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  summaryCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  summaryRow: {
    flexDirection: "row",
  },
  summaryItem: {
    flex: 1,
    alignItems: "center",
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginBottom: 8,
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: "700",
    color: "#333",
  },
  summaryLabel: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
  },
  memberList: {
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  memberItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#f0f0f0",
    alignItems: "center",
    justifyContent: "center",
  },
  memberInfo: {
    flex: 1,
    marginLeft: 12,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusPresent: {
    backgroundColor: "#E8F5E9",
  },
  statusAbsent: {
    backgroundColor: "#FFEBEE",
  },
  statusNotRecorded: {
    backgroundColor: "#f0f0f0",
  },
  statusBadgeText: {
    fontSize: 13,
    fontWeight: "500",
  },
  statusPresentText: {
    color: "#34C759",
  },
  statusAbsentText: {
    color: "#FF3B30",
  },
  statusNotRecordedText: {
    color: "#999",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginTop: 12,
  },
  gridHeader: {
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  gridHeaderText: {
    fontSize: 14,
    color: "#666",
  },
  gridRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    backgroundColor: "#fff",
  },
  gridNameCell: {
    width: 150,
    padding: 12,
    justifyContent: "center",
    borderRightWidth: 1,
    borderRightColor: "#f0f0f0",
  },
  gridCell: {
    width: 60,
    padding: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  gridHeaderCellText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  gridAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 8,
  },
  gridAvatarPlaceholder: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#f0f0f0",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  gridMemberName: {
    fontSize: 14,
    color: "#333",
    flex: 1,
  },
  gridRateText: {
    fontSize: 14,
    fontWeight: "600",
  },
  rateGood: {
    color: "#34C759",
  },
  rateMedium: {
    color: "#FF9500",
  },
  rateLow: {
    color: "#FF3B30",
  },
});
