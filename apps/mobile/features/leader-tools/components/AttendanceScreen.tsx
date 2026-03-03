import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { UserRoute } from "@components/guards/UserRoute";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AttendanceDetails } from "./AttendanceDetails";
import { EventsList } from "./EventsList";
import { useQuery, api, Id } from "@services/api/convex";
import { useAttendanceReport } from "../hooks/useAttendanceReport";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { DragHandle } from "@components/ui/DragHandle";

export function AttendanceScreen() {
  // NOTE: group_id is expected to be a Convex Id<"groups"> passed from navigation.
  // The leader-tools routes should only receive Convex IDs, not legacy UUIDs.
  const { group_id, eventDate: queryEventDate } = useLocalSearchParams<{
    group_id: string;
    eventDate?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Fetch group details (minimal - just for validation)
  const group = useQuery(
    api.functions.groups.index.getById,
    group_id ? { groupId: group_id as Id<"groups"> } : "skip"
  );
  const isLoadingGroup = group === undefined;
  const groupError = group === null;

  // Track selected event - only fetch attendance when an event is selected
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(
    null
  );
  const [selectedEventDate, setSelectedEventDate] = useState<string | null>(
    queryEventDate || null
  );

  // Only fetch attendance report when an event is selected
  const { data: attendanceReport } = useAttendanceReport(
    group_id || "",
    {
      meetingId: selectedMeetingId || undefined,
      eventDate: selectedMeetingId ? undefined : selectedEventDate || undefined,
    },
    !!group_id && (!!selectedMeetingId || !!selectedEventDate)
  );
  const report = attendanceReport;
  // Check if attendance has been submitted by checking if there are any attendance records
  const hasAttendanceSubmitted =
    !!report?.attendances && report.attendances.length > 0;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      // Fallback to group page if can't go back
      router.push(`/(user)/leader-tools/${group_id}`);
    }
  };

  const handleEdit = () => {
    if (!selectedEventDate) return;

    // Prevent editing attendance for future events
    const isFutureEvent = new Date(selectedEventDate) > new Date();
    if (isFutureEvent) {
      // Don't navigate to edit page for future events
      return;
    }
    // Leaders can always edit attendance, even after it's been submitted
    // Navigate to edit page with current date AND meetingId as query parameters
    // FIX for Issue #303: Include meetingId to ensure attendance is recorded
    // for the correct event when multiple events exist on the same day
    const encodedDate = encodeURIComponent(selectedEventDate);
    const meetingIdParam = selectedMeetingId
      ? `&meetingId=${encodeURIComponent(selectedMeetingId)}`
      : "";
    router.push(
      `/(user)/leader-tools/${group_id}/attendance/edit?eventDate=${encodedDate}${meetingIdParam}`
    );
  };

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
              style={styles.errorBackButton}
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.push(`/(user)/leader-tools/${group_id}`);
                }
              }}
            >
              <Text style={styles.errorText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </UserRoute>
    );
  }

  // Always show attendance details, even if no past event exists
  // Users can select any date to take attendance or modify RSVPs
  return (
    <UserRoute>
      <View style={styles.container}>
        <DragHandle />
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Attendance</Text>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          <EventsList
            groupId={group_id || ""}
            selectedDate={selectedEventDate}
            onEventSelect={(meetingId, date) => {
              setSelectedMeetingId(meetingId || null);
              setSelectedEventDate(date || null);
            }}
          />

          {selectedMeetingId || selectedEventDate ? (
            <AttendanceDetails
              groupId={group_id || ""}
              eventDate={selectedEventDate || new Date().toISOString()}
              meetingId={selectedMeetingId || undefined}
              onBack={handleBack}
              onEdit={handleEdit}
              onCancelEdit={() => {}} // Not in edit mode, so no cancel needed
              editMode={false}
              onUpdateAttendance={() => {}} // Not in edit mode
              onUpdateNote={() => {}} // Not in edit mode
              attendance={[]} // Not in edit mode
              note={""} // Not in edit mode
            />
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>
                Select an event to view attendance
              </Text>
            </View>
          )}
        </ScrollView>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
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
  errorBackButton: {
    padding: 12,
    backgroundColor: "#e0e0e0",
    borderRadius: 8,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginBottom: 24,
  },
  createEventButton: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  createEventButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
