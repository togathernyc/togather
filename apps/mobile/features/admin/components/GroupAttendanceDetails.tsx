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
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
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
  const { colors, isDark } = useTheme();
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
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading attendance details...</Text>
      </View>
    );
  }

  if (!detailsData) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
        <Text style={[styles.errorText, { color: colors.text }]}>Failed to load attendance</Text>
        <TouchableOpacity style={[styles.backButton, { backgroundColor: primaryColor }]} onPress={onBack}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const data = detailsData;

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backIconButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{data.groupName}</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
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
  const { colors, isDark } = useTheme();
  return (
    <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
      {/* Summary */}
      <View style={[styles.summaryCard, { backgroundColor: colors.surface }]}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
            <Text style={[styles.summaryValue, { color: colors.text }]}>{data.presentCount}</Text>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Present</Text>
          </View>
          <View style={styles.summaryItem}>
            <View style={[styles.statusDot, { backgroundColor: colors.error }]} />
            <Text style={[styles.summaryValue, { color: colors.text }]}>{data.absentCount}</Text>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Absent</Text>
          </View>
          <View style={styles.summaryItem}>
            <View style={[styles.statusDot, { backgroundColor: colors.iconSecondary }]} />
            <Text style={[styles.summaryValue, { color: colors.text }]}>{data.notRecordedCount}</Text>
            <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>Not Recorded</Text>
          </View>
        </View>
      </View>

      {/* Member List */}
      {data.memberAttendance.length > 0 ? (
        <View style={[styles.memberList, { backgroundColor: colors.surface }]}>
          {data.memberAttendance.map((member) => (
            <View key={member.userId} style={[styles.memberItem, { borderBottomColor: colors.border }]}>
              {member.profilePhoto ? (
                <Image source={{ uri: member.profilePhoto }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
                  <Ionicons name="person" size={20} color={colors.textTertiary} />
                </View>
              )}
              <View style={styles.memberInfo}>
                <Text style={[styles.memberName, { color: colors.text }]}>
                  {member.firstName} {member.lastName}
                </Text>
              </View>
              <View
                style={[
                  styles.statusBadge,
                  member.status === 1
                    ? { backgroundColor: isDark ? 'rgba(52,199,89,0.15)' : '#E8F5E9' }
                    : member.status === 0
                    ? { backgroundColor: isDark ? 'rgba(255,59,48,0.15)' : '#FFEBEE' }
                    : { backgroundColor: colors.surfaceSecondary },
                ]}
              >
                <Text
                  style={[
                    styles.statusBadgeText,
                    member.status === 1
                      ? { color: colors.success }
                      : member.status === 0
                      ? { color: colors.error }
                      : { color: colors.textTertiary },
                  ]}
                >
                  {member.statusLabel}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No members to display</Text>
      )}
    </ScrollView>
  );
}

function DateRangeView({ data }: { data: DateRangeData }) {
  const { colors, isDark } = useTheme();
  if (data.meetingColumns.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="calendar-outline" size={48} color={colors.textTertiary} />
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No meetings in this date range</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scrollView}>
      {/* Stats Header */}
      <View style={[styles.gridHeader, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <Text style={[styles.gridHeaderText, { color: colors.textSecondary }]}>
          {data.totalMeetings} meeting{data.totalMeetings !== 1 ? "s" : ""} • {data.memberRows.length} members
        </Text>
      </View>

      {/* Grid */}
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          {/* Header Row */}
          <View style={[styles.gridRow, { borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={[styles.gridNameCell, { borderRightColor: colors.border }]}>
              <Text style={[styles.gridHeaderCellText, { color: colors.textSecondary }]}>Member</Text>
            </View>
            {data.meetingColumns.map((meeting) => (
              <View key={meeting.meetingId} style={styles.gridCell}>
                <Text style={[styles.gridHeaderCellText, { color: colors.textSecondary }]}>{meeting.dateLabel}</Text>
              </View>
            ))}
            <View style={styles.gridCell}>
              <Text style={[styles.gridHeaderCellText, { color: colors.textSecondary }]}>Rate</Text>
            </View>
          </View>

          {/* Data Rows */}
          {data.memberRows.map((member) => (
            <View key={member.userId} style={[styles.gridRow, { borderBottomColor: colors.border, backgroundColor: colors.surface }]}>
              <View style={[styles.gridNameCell, { borderRightColor: colors.border }]}>
                <View style={styles.memberRow}>
                  {member.profilePhoto ? (
                    <Image source={{ uri: member.profilePhoto }} style={styles.gridAvatar} />
                  ) : (
                    <View style={[styles.gridAvatarPlaceholder, { backgroundColor: colors.border }]}>
                      <Ionicons name="person" size={12} color={colors.textTertiary} />
                    </View>
                  )}
                  <Text style={[styles.gridMemberName, { color: colors.text }]} numberOfLines={1}>
                    {member.firstName} {member.lastName}
                  </Text>
                </View>
              </View>
              {data.meetingColumns.map((meeting) => {
                const status = member.attendanceByMeeting[meeting.meetingId];
                return (
                  <View key={meeting.meetingId} style={styles.gridCell}>
                    {status === 1 ? (
                      <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                    ) : status === 0 ? (
                      <Ionicons name="close-circle" size={20} color={colors.error} />
                    ) : (
                      <Ionicons name="remove-circle-outline" size={20} color={colors.iconSecondary} />
                    )}
                  </View>
                );
              })}
              <View style={styles.gridCell}>
                <Text
                  style={[
                    styles.gridRateText,
                    member.attendanceRate >= 80
                      ? { color: colors.success }
                      : member.attendanceRate >= 50
                      ? { color: colors.warning }
                      : { color: colors.error },
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
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    fontSize: 16,
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
  },
  backButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
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
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
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
  },
  headerSubtitle: {
    fontSize: 14,
    marginTop: 2,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  summaryCard: {
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
  },
  summaryLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  memberList: {
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
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontSize: 13,
    fontWeight: "500",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    textAlign: "center",
    marginTop: 12,
  },
  gridHeader: {
    padding: 16,
    borderBottomWidth: 1,
  },
  gridHeaderText: {
    fontSize: 14,
  },
  gridRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
  },
  gridNameCell: {
    width: 150,
    padding: 12,
    justifyContent: "center",
    borderRightWidth: 1,
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
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  gridMemberName: {
    fontSize: 14,
    flex: 1,
  },
  gridRateText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
