import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AttendanceDetails } from "./AttendanceDetails";
import { useAttendanceEdit } from "../hooks/useAttendanceEdit";
import { useAttendanceReport } from "../hooks/useAttendanceReport";
import { DragHandle } from "@components/ui/DragHandle";
import { useTheme } from "@hooks/useTheme";

export function AttendanceEditScreen() {
  const { colors } = useTheme();
  // FIX for Issue #303: Read meetingId from URL params to ensure we record
  // attendance for the correct event when multiple events exist on the same day
  const { group_id, eventDate: eventDateParam, meetingId: meetingIdParam } = useLocalSearchParams<{
    group_id: string;
    eventDate?: string;
    meetingId?: string;
  }>();
  const insets = useSafeAreaInsets();
  const {
    group,
    isLoadingGroup,
    groupError,
    attendanceList,
    note,
    eventDate,
    meetingId,
    setAttendanceList,
    setNote,
    handleBack,
    handleCancelEdit,
    handleDateSelect,
  } = useAttendanceEdit(group_id || "", eventDateParam || null, meetingIdParam || null);

  // Calculate currentEventDate before hook call (using a safe fallback)
  const currentEventDate = eventDate || new Date().toISOString();

  // All hooks must be called before any conditional returns
  // Note: AttendanceEditScreen doesn't have meetingId yet, so falls back to date lookup
  const { data: attendanceReport, isLoading: isLoadingReport } = useAttendanceReport(
    group_id || "",
    { eventDate: currentEventDate },
    !!group_id && !!currentEventDate && !isLoadingGroup && !!group
  );

  if (isLoadingGroup) {
    return (
      <>
        <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
          <DragHandle />
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading...</Text>
          </View>
        </View>
      </>
    );
  }

  if (groupError || !group) {
    return (
      <>
        <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
          <DragHandle />
          <View style={styles.errorContainer}>
            <Text style={[styles.errorText, { color: colors.textSecondary }]}>Group not found</Text>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => handleBack()}
            >
              <Text style={[styles.errorText, { color: colors.textSecondary }]}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </>
    );
  }

  // Check if event is in the future (cannot edit attendance for future events)
  const isFutureEvent = currentEventDate ? new Date(currentEventDate) > new Date() : false;

  // Note: We don't block on isLoadingReport anymore since:
  // 1. The members list comes from a different API (useGroupMembers)
  // 2. Blocking causes infinite loading if the attendance report API fails
  // 3. The edit form can work without the attendance report data

  if (isFutureEvent) {
    return (
      <>
        <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
          <DragHandle />
          <View style={[styles.header, { paddingTop: insets.top + 16, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <TouchableOpacity style={styles.backButton} onPress={handleBack}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Edit Attendance</Text>
          </View>
          <View style={styles.errorContainer}>
            <Text style={[styles.errorText, { color: colors.textSecondary }]}>Cannot edit attendance for future events</Text>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => handleBack()}
            >
              <Text style={[styles.errorText, { color: colors.textSecondary }]}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </>
    );
  }

  // Leaders can always edit attendance, even after it's been submitted
  // The hasAttendanceSubmitted check has been removed to allow editing

  return (
    <>
      <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
        <DragHandle />
        <View style={[styles.header, { paddingTop: insets.top + 16, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Edit Attendance</Text>
        </View>

        {/* No ScrollView here - AttendanceEditMode handles its own scrolling */}
        {/* This allows the fixed submit button to work correctly */}
        <View style={styles.contentContainer}>
          <AttendanceDetails
            groupId={group_id || ""}
            eventDate={currentEventDate}
            meetingId={meetingId || undefined}
            onBack={handleBack}
            onEdit={() => {}} // Already in edit mode
            onCancelEdit={handleCancelEdit}
            editMode={true}
            onUpdateAttendance={setAttendanceList}
            onUpdateNote={setNote}
            attendance={attendanceList}
            note={note}
            onSelectDate={handleDateSelect}
          />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  contentContainer: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorText: {
    fontSize: 18,
    marginBottom: 20,
  },
});
