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
import { UserRoute } from "@components/guards/UserRoute";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AttendanceDetails } from "./AttendanceDetails";
import { useAttendanceEdit } from "../hooks/useAttendanceEdit";
import { useAttendanceReport } from "../hooks/useAttendanceReport";
import { DragHandle } from "@components/ui/DragHandle";

export function AttendanceEditScreen() {
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
      <UserRoute>
        <View style={styles.container}>
          <DragHandle />
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        </View>
      </UserRoute>
    );
  }

  if (groupError || !group) {
    return (
      <UserRoute>
        <View style={styles.container}>
          <DragHandle />
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Group not found</Text>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => handleBack()}
            >
              <Text style={styles.errorText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </UserRoute>
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
      <UserRoute>
        <View style={styles.container}>
          <DragHandle />
          <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
            <TouchableOpacity style={styles.backButton} onPress={handleBack}>
              <Ionicons name="arrow-back" size={24} color="#333" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Edit Attendance</Text>
          </View>
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Cannot edit attendance for future events</Text>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => handleBack()}
            >
              <Text style={styles.errorText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </UserRoute>
    );
  }

  // Leaders can always edit attendance, even after it's been submitted
  // The hasAttendanceSubmitted check has been removed to allow editing

  return (
    <UserRoute>
      <View style={styles.container}>
        <DragHandle />
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Attendance</Text>
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
    </UserRoute>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
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
    color: "#666",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorText: {
    fontSize: 18,
    color: "#666",
    marginBottom: 20,
  },
});
