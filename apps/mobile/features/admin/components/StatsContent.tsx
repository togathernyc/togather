/**
 * StatsContent - Community statistics dashboard for admins
 *
 * Displays:
 * - Active members (logged in within past month)
 * - New members this month
 * - Attendance breakdown by group type with date selection
 */
import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { DatePicker } from "@components/ui";
import { useQuery, useAction, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useAuth } from "@providers/AuthProvider";
import { useGroupTypes } from "../hooks";
import { GroupAttendanceDetails } from "./GroupAttendanceDetails";
import { MemberListModal } from "./MemberListModal";
import { ExportBottomSheet } from "./ExportBottomSheet";
import { generateGroupTypeAttendanceCsv, generateFilename } from "../utils/csvExport";

type DateMode = "single" | "range";

type MemberModalType = "active" | "new" | null;

export function StatsContent() {
  const { primaryColor } = useCommunityTheme();
  const { user, community, token } = useAuth();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dateMode, setDateMode] = useState<DateMode>("range");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d;
  });
  const [endDate, setEndDate] = useState(new Date());
  const [selectedGroupTypeId, setSelectedGroupTypeId] = useState<string | null>(null);
  const [showGroupTypePicker, setShowGroupTypePicker] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [memberModalType, setMemberModalType] = useState<MemberModalType>(null);
  const [showExportSheet, setShowExportSheet] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportedCsvContent, setExportedCsvContent] = useState("");

  // Convex queries
  const activeMembers = useQuery(
    api.functions.admin.stats.getActiveMembers,
    community?.id && token
      ? {
          token,
          communityId: community.id as Id<"communities">,
        }
      : "skip"
  );

  const newMembers = useQuery(
    api.functions.admin.stats.getNewMembersThisMonth,
    community?.id && token
      ? {
          token,
          communityId: community.id as Id<"communities">,
        }
      : "skip"
  );

  const { groupTypes, isLoading: groupTypesLoading, refetch: refetchGroupTypes } = useGroupTypes();

  // Action for exporting large date ranges
  const exportAttendance = useAction(api.functions.admin.stats.exportAttendanceByGroupType);

  // Convex query for attendance by group type
  const attendanceData = useQuery(
    api.functions.admin.stats.getAttendanceByGroupType,
    community?.id && selectedGroupTypeId && token
      ? {
          token,
          communityId: community.id as Id<"communities">,
          groupTypeId: selectedGroupTypeId as Id<"groupTypes">,
          startDate: dateMode === "single" ? startDate.toISOString() : startDate.toISOString(),
          endDate: dateMode === "single" ? startDate.toISOString() : endDate.toISOString(),
        }
      : "skip"
  );

  const attendanceLoading = attendanceData === undefined;
  const activeMembersLoading = activeMembers === undefined;
  const newMembersLoading = newMembers === undefined;

  // Auto-select first group type if none selected
  React.useEffect(() => {
    if (groupTypes && groupTypes.length > 0 && selectedGroupTypeId === null) {
      setSelectedGroupTypeId(groupTypes[0].id);
    }
  }, [groupTypes, selectedGroupTypeId]);

  const selectedGroupType = useMemo(() => {
    if (!groupTypes || selectedGroupTypeId === null) return null;
    return groupTypes.find((gt) => gt.id === selectedGroupTypeId) || null;
  }, [groupTypes, selectedGroupTypeId]);

  // CSV filename for export
  const csvFilename = useMemo(() => {
    const effectiveStartDate = dateMode === "single" ? startDate.toISOString() : startDate.toISOString();
    const effectiveEndDate = dateMode === "single" ? startDate.toISOString() : endDate.toISOString();

    return generateFilename("attendance", community?.name || "community", {
      groupTypeName: selectedGroupType?.name,
      startDate: effectiveStartDate,
      endDate: effectiveEndDate,
    });
  }, [dateMode, startDate, endDate, community?.name, selectedGroupType?.name]);

  // Handle export using action (supports large date ranges)
  const handleExportAttendance = useCallback(async () => {
    if (!community?.id || !selectedGroupTypeId || !token) return;

    setIsExporting(true);
    try {
      const effectiveStartDate = dateMode === "single" ? startDate.toISOString() : startDate.toISOString();
      const effectiveEndDate = dateMode === "single" ? startDate.toISOString() : endDate.toISOString();

      // Call the action to fetch data (handles large date ranges)
      const exportData = await exportAttendance({
        token,
        communityId: community.id as Id<"communities">,
        groupTypeId: selectedGroupTypeId as Id<"groupTypes">,
        startDate: effectiveStartDate,
        endDate: effectiveEndDate,
      });

      if (exportData && exportData.groupBreakdown.length > 0) {
        // Generate CSV from action result
        const csv = generateGroupTypeAttendanceCsv(exportData, selectedGroupType?.name || "Attendance");
        setExportedCsvContent(csv);
        setShowExportSheet(true);
      }
    } catch (error) {
      console.error("Export failed:", error);
    } finally {
      setIsExporting(false);
    }
  }, [community?.id, selectedGroupTypeId, token, dateMode, startDate, endDate, exportAttendance, selectedGroupType?.name]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    // Convex queries auto-update, just trigger groupTypes refetch for API compatibility
    await refetchGroupTypes();
    setIsRefreshing(false);
  };

  // If a group is selected for drill-down, show the details
  if (selectedGroupId) {
    return (
      <GroupAttendanceDetails
        groupId={selectedGroupId}
        startDate={dateMode === "single" ? startDate.toISOString() : startDate.toISOString()}
        endDate={dateMode === "single" ? startDate.toISOString() : endDate.toISOString()}
        onBack={() => setSelectedGroupId(null)}
      />
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
        }
      >
        {/* Overview Stats */}
        <View style={styles.statsRow}>
          <TouchableOpacity
            style={styles.statCard}
            onPress={() => setMemberModalType("active")}
            activeOpacity={0.7}
          >
            <View style={styles.statIconContainer}>
              <Ionicons name="people" size={24} color={primaryColor} />
            </View>
            {activeMembersLoading ? (
              <ActivityIndicator size="small" color={primaryColor} />
            ) : (
              <>
                <Text style={styles.statValue}>
                  {activeMembers?.activeCount ?? 0}
                </Text>
                <Text style={styles.statLabel}>Active Members</Text>
                <Text style={styles.statSubtext}>
                  of {activeMembers?.totalMembers ?? 0} total
                </Text>
              </>
            )}
            <View style={styles.tapHint}>
              <Text style={styles.tapHintText}>Tap to view</Text>
              <Ionicons name="chevron-forward" size={14} color="#999" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.statCard}
            onPress={() => setMemberModalType("new")}
            activeOpacity={0.7}
          >
            <View style={[styles.statIconContainer, { backgroundColor: "#E3F2FD" }]}>
              <Ionicons name="person-add" size={24} color="#2196F3" />
            </View>
            {newMembersLoading ? (
              <ActivityIndicator size="small" color="#2196F3" />
            ) : (
              <>
                <Text style={styles.statValue}>
                  {newMembers?.newMembersCount ?? 0}
                </Text>
                <Text style={styles.statLabel}>New Members</Text>
                <Text style={styles.statSubtext}>
                  {newMembers?.monthName ?? "this month"}
                </Text>
              </>
            )}
            <View style={styles.tapHint}>
              <Text style={styles.tapHintText}>Tap to view</Text>
              <Ionicons name="chevron-forward" size={14} color="#999" />
            </View>
          </TouchableOpacity>
        </View>

        {/* Attendance Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Attendance</Text>

          {/* Group Type Selector */}
          <View style={styles.field}>
            <Text style={styles.label}>Group Type</Text>
            <TouchableOpacity
              style={styles.picker}
              onPress={() => setShowGroupTypePicker(true)}
            >
              <Text style={styles.pickerText}>
                {selectedGroupType?.name ?? "Select group type"}
              </Text>
              <Ionicons name="chevron-down" size={20} color="#666" />
            </TouchableOpacity>
          </View>

          {/* Date Mode Toggle */}
          <View style={styles.field}>
            <Text style={styles.label}>Date Selection</Text>
            <View style={styles.toggleRow}>
              <TouchableOpacity
                style={[styles.toggleButton, dateMode === "single" && styles.toggleButtonActive]}
                onPress={() => setDateMode("single")}
              >
                <Text
                  style={[
                    styles.toggleButtonText,
                    dateMode === "single" && styles.toggleButtonTextActive,
                  ]}
                >
                  Single Date
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toggleButton, dateMode === "range" && styles.toggleButtonActive]}
                onPress={() => setDateMode("range")}
              >
                <Text
                  style={[
                    styles.toggleButtonText,
                    dateMode === "range" && styles.toggleButtonTextActive,
                  ]}
                >
                  Date Range
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Date Pickers */}
          <View style={styles.dateRow}>
            <DatePicker
              label={dateMode === "single" ? "Date" : "Start Date"}
              value={startDate}
              onChange={(date) => {
                if (date) {
                  setStartDate(date);
                  // Ensure end date is not before start date
                  if (date > endDate) {
                    setEndDate(date);
                  }
                }
              }}
              maximumDate={new Date()}
              style={styles.datePicker}
            />
            {dateMode === "range" && (
              <DatePicker
                label="End Date"
                value={endDate}
                onChange={(date) => {
                  if (date) {
                    setEndDate(date);
                  }
                }}
                minimumDate={startDate}
                maximumDate={new Date()}
                style={styles.datePicker}
              />
            )}
          </View>

          {/* Attendance Results */}
          {selectedGroupTypeId && (
            <View style={styles.resultsSection}>
              {attendanceLoading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={primaryColor} />
                  <Text style={styles.loadingText}>Loading attendance...</Text>
                </View>
              ) : attendanceData ? (
                <>
                  {/* Total Summary */}
                  <View style={styles.summaryCard}>
                    <View style={styles.summaryRow}>
                      <View style={styles.summaryItem}>
                        <Text style={styles.summaryValue}>
                          {attendanceData.totalAttended}
                        </Text>
                        <Text style={styles.summaryLabel}>Total Present</Text>
                      </View>
                      <View style={styles.summaryItem}>
                        <Text style={styles.summaryValue}>
                          {attendanceData.totalMeetings}
                        </Text>
                        <Text style={styles.summaryLabel}>Meetings</Text>
                      </View>
                      <View style={styles.summaryItem}>
                        <Text style={styles.summaryValue}>
                          {attendanceData.overallRate}%
                        </Text>
                        <Text style={styles.summaryLabel}>Rate</Text>
                      </View>
                    </View>
                  </View>

                  {/* Group Breakdown */}
                  <View style={styles.breakdownHeader}>
                    <Text style={styles.breakdownTitle}>By Group</Text>
                    {attendanceData.groupBreakdown.length > 0 && (
                      <TouchableOpacity
                        style={[styles.exportButton, isExporting && styles.exportButtonDisabled]}
                        onPress={handleExportAttendance}
                        disabled={isExporting}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        {isExporting ? (
                          <ActivityIndicator size="small" color={primaryColor} />
                        ) : (
                          <Ionicons name="download-outline" size={20} color={primaryColor} />
                        )}
                        <Text style={[styles.exportButtonText, { color: primaryColor }]}>
                          {isExporting ? "Exporting..." : "Export"}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {attendanceData.groupBreakdown.length > 0 ? (
                    <View style={styles.groupList}>
                      {attendanceData.groupBreakdown.map((group) => (
                        <TouchableOpacity
                          key={group.groupId}
                          style={styles.groupItem}
                          onPress={() => setSelectedGroupId(group.groupId)}
                        >
                          <View style={styles.groupInfo}>
                            <Text style={styles.groupName}>{group.groupName}</Text>
                            <Text style={styles.groupStats}>
                              {group.attended} present • {group.meetingCount} meetings
                            </Text>
                          </View>
                          <View style={styles.groupRateContainer}>
                            <Text style={styles.groupRate}>{group.rate}%</Text>
                            <Ionicons name="chevron-forward" size={16} color="#999" />
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.emptyText}>
                      No attendance data for this period
                    </Text>
                  )}
                </>
              ) : null}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Group Type Picker Modal */}
      <Modal
        visible={showGroupTypePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowGroupTypePicker(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowGroupTypePicker(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Group Type</Text>
            {groupTypesLoading ? (
              <ActivityIndicator size="large" color={primaryColor} />
            ) : (
              <ScrollView style={styles.modalList}>
                {groupTypes?.map((gt) => (
                  <TouchableOpacity
                    key={gt.id}
                    style={[
                      styles.modalItem,
                      selectedGroupTypeId === gt.id && styles.modalItemSelected,
                    ]}
                    onPress={() => {
                      setSelectedGroupTypeId(gt.id);
                      setShowGroupTypePicker(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.modalItemText,
                        selectedGroupTypeId === gt.id && styles.modalItemTextSelected,
                      ]}
                    >
                      {gt.name}
                    </Text>
                    {selectedGroupTypeId === gt.id && (
                      <Ionicons name="checkmark" size={20} color={primaryColor} />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </Pressable>
      </Modal>

      {/* Member List Modal */}
      <MemberListModal
        visible={memberModalType !== null}
        onClose={() => setMemberModalType(null)}
        type={memberModalType ?? "active"}
      />

      {/* Export Bottom Sheet */}
      <ExportBottomSheet
        visible={showExportSheet}
        onClose={() => {
          setShowExportSheet(false);
          setExportedCsvContent("");
        }}
        csvContent={exportedCsvContent}
        filename={csvFilename}
        userEmail={user?.email || undefined}
        title={`Export ${selectedGroupType?.name || "Attendance"}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  statsRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  statIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#F3E8FF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  statValue: {
    fontSize: 28,
    fontWeight: "700",
    color: "#333",
  },
  statLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: "#666",
    marginTop: 4,
  },
  tapHint: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    gap: 2,
  },
  tapHintText: {
    fontSize: 12,
    color: "#999",
  },
  statSubtext: {
    fontSize: 12,
    color: "#999",
    marginTop: 2,
  },
  section: {
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 16,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    color: "#666",
    marginBottom: 8,
  },
  picker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#f8f8f8",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  pickerText: {
    fontSize: 16,
    color: "#333",
  },
  toggleRow: {
    flexDirection: "row",
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    padding: 4,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 6,
  },
  toggleButtonActive: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  toggleButtonText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#666",
  },
  toggleButtonTextActive: {
    color: "#333",
    fontWeight: "600",
  },
  dateRow: {
    flexDirection: "row",
    gap: 12,
  },
  datePicker: {
    flex: 1,
    marginBottom: 0,
  },
  resultsSection: {
    marginTop: 8,
  },
  loadingContainer: {
    padding: 32,
    alignItems: "center",
  },
  loadingText: {
    fontSize: 14,
    color: "#666",
    marginTop: 12,
  },
  summaryCard: {
    backgroundColor: "#f8f8f8",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: "row",
  },
  summaryItem: {
    flex: 1,
    alignItems: "center",
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
  breakdownHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  breakdownTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  exportButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "#f8f8f8",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    minWidth: 100,
    justifyContent: "center",
  },
  exportButtonDisabled: {
    opacity: 0.7,
  },
  exportButtonText: {
    fontSize: 14,
    fontWeight: "500",
  },
  groupList: {
    gap: 8,
  },
  groupItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8f8f8",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  groupInfo: {
    flex: 1,
  },
  groupName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  groupStats: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
  groupRateContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  groupRate: {
    fontSize: 16,
    fontWeight: "600",
    color: DEFAULT_PRIMARY_COLOR,
  },
  emptyText: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
    paddingVertical: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    width: "100%",
    maxWidth: 400,
    maxHeight: "60%",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 16,
    textAlign: "center",
  },
  modalList: {
    maxHeight: 300,
  },
  modalItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  modalItemSelected: {
    backgroundColor: "#F3E8FF",
    borderRadius: 8,
    borderBottomWidth: 0,
    marginBottom: 4,
  },
  modalItemText: {
    fontSize: 16,
    color: "#333",
  },
  modalItemTextSelected: {
    fontWeight: "600",
    color: DEFAULT_PRIMARY_COLOR,
  },
});
