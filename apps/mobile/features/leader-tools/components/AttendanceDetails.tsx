import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useAuth } from "@providers/AuthProvider";
import { ToastManager } from "@components/ui/Toast";
import { AddGuest, SubmitAttendance } from "./modals";
import {
  useAttendanceReport,
  useGroupMembers,
  useAttendanceGuests,
  useFilteredMembers,
  useAttendanceSubmission,
} from "../hooks";
import { AttendanceEditMode } from "./AttendanceEditMode";
import { AttendanceViewMode } from "./AttendanceViewMode";
import { isFutureEvent, isAnonymousGuest } from "../utils/attendanceUtils";
import { useTheme } from "@hooks/useTheme";

interface AttendanceDetailsProps {
  groupId: string;
  eventDate: string;
  meetingId?: string;  // Preferred for attendance lookup (more efficient and unambiguous)
  onBack: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  editMode: boolean;
  onUpdateAttendance: (attendance: string[]) => void;
  onUpdateNote: (note: string) => void;
  attendance: string[]; // Convex user IDs
  note: string;
  onAddGuest?: () => void;
  onSelectDate?: (date: Date) => void;
}

/**
 * AttendanceDetails - Component for viewing and editing attendance for a group event
 *
 * This component orchestrates the attendance management UI, delegating to:
 * - AttendanceEditMode: Edit mode UI
 * - AttendanceViewMode: View mode UI
 * - Custom hooks: Business logic for guests, filtering, and submission
 */
export function AttendanceDetails({
  groupId,
  eventDate,
  meetingId,
  onBack,
  onEdit,
  onCancelEdit,
  editMode,
  onUpdateAttendance,
  onUpdateNote,
  attendance,
  note,
  onAddGuest,
  onSelectDate,
}: AttendanceDetailsProps) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<string>("");

  // Modal states
  const [showAddGuestModal, setShowAddGuestModal] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);

  // Fetch attendance report (for view mode or to pre-populate edit mode)
  // Prefer meetingId over eventDate for direct lookup (more efficient and unambiguous)
  const { data: attendanceReport, isLoading: isLoadingReport } =
    useAttendanceReport(groupId, {
      meetingId: meetingId,
      eventDate: meetingId ? undefined : eventDate,
    });

  // Fetch group members (for edit mode when there's no attendance report)
  // loadAllMembers: true ensures all members are loaded for attendance tracking (Issue #272)
  const { members: groupMembers, isLoading: isLoadingMembers } =
    useGroupMembers(groupId, {
      sortBy: "-membership__role,last_name,first_name,id",
      enabled: editMode,
      loadAllMembers: true, // Load all members, not just the first page
    });

  // Guest management hook
  const {
    localGuests,
    anonymousGuestCount,
    namedGuests,
    anonymousGuestIds,
    addGuest,
    incrementAnonymousGuests,
    decrementAnonymousGuests,
    setAnonymousGuestCount,
    setLocalGuests,
    // FIX for Issue #303: Track existing guests for proper edit handling
    existingAnonymousGuests,
    existingNamedGuests,
    anonymousGuestDelta,
    markExistingGuestForRemoval,
    guestsToRemove,
  } = useAttendanceGuests({
    groupId,
    eventDate,
    editMode,
    attendanceReport,
    attendance,
    onUpdateAttendance,
  });

  // Filtered members hook
  const filteredMembers = useFilteredMembers({
    editMode,
    groupMembers,
    localGuests,
    attendanceReport,
    searchQuery,
    sortBy,
  });

  // Submission hook
  const { submitAttendance } = useAttendanceSubmission({
    groupId,
    eventDate,
    meetingId,
    attendance,
    note,
    filteredMembers,
    localGuests,
    anonymousGuestCount,
    onCancelEdit,
    setAnonymousGuestCount,
    setLocalGuests,
    // FIX for Issue #303: Pass existing guests and delta for proper edit handling
    existingAnonymousGuests,
    anonymousGuestDelta,
    guestsToRemove,
  });

  // Check if event is in the future
  const futureEvent = isFutureEvent(eventDate);

  // Note: RSVP stats query removed - we no longer display RSVP-based projected attendance
  // Future events now show a message to wait until the event day to take attendance

  // Initialize attendance list from report when in edit mode
  useEffect(() => {
    if (editMode && attendanceReport) {
      const attendanceList = attendanceReport?.attendances || [];
      if (attendanceList.length > 0) {
        const attended = attendanceList
          .filter((member: any) => member.status === 1)
          .map((member: any) => member.user?._id) // Use Convex user ID
          .filter((id: string | undefined): id is string => !!id);
        if (attended.length > 0) {
          onUpdateAttendance(attended);
        }

        const note = attendanceReport?.note;
        if (note) {
          onUpdateNote(note);
        }
      }
    }
  }, [editMode, attendanceReport, onUpdateAttendance, onUpdateNote]);

  // Toggle member attendance using Convex user ID
  const toggleAttendance = (userId: string) => {
    const attendanceIds = attendance || [];
    if (attendanceIds.includes(userId)) {
      onUpdateAttendance(attendanceIds.filter((id) => id !== userId));
    } else {
      onUpdateAttendance([...attendanceIds, userId]);
    }
  };

  // Handle submitting attendance
  const handleSubmitAttendance = async () => {
    try {
      await submitAttendance();
      setShowSubmitModal(false);
    } catch (error) {
      console.error("Failed to submit attendance:", error);
      ToastManager.error("Failed to save attendance. Please try again.");
    }
  };

  if (isLoadingReport || (editMode && isLoadingMembers)) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading attendance...</Text>
      </View>
    );
  }

  // Check if there's attendance data
  const hasAttendanceData =
    ((attendanceReport?.attendances?.length ?? 0) > 0) ||
    ((attendanceReport?.guests?.length ?? 0) > 0) ||
    ((attendanceReport?.stats?.member_count ?? 0) > 0) ||
    ((attendanceReport?.stats?.guest_count ?? 0) > 0);
  const submittedDate = attendanceReport?.attendance_details?.created_at || (hasAttendanceData ? eventDate : null);
  const submittedBy = attendanceReport?.attendance_details?.updated_by;

  // Calculate modal counts
  const attendanceIdsForModal = attendance || [];
  const modalAttendanceCount = attendanceIdsForModal.filter(
    (id) => !anonymousGuestIds.includes(id)
  ).length;
  const modalGuestCount = anonymousGuestCount + namedGuests.length;

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }, editMode && styles.containerEditMode]}>
      {/* Edit Button (only in view mode, not for future events) */}
      {/* Leaders can always edit attendance, even after it's been submitted */}
      {!editMode && !futureEvent && (
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.editButton} onPress={onEdit}>
            <Text style={[styles.editButtonText, { color: colors.text }]}>Edit</Text>
          </TouchableOpacity>
        </View>
      )}

      {editMode ? (
        <AttendanceEditMode
          note={note}
          onUpdateNote={onUpdateNote}
          anonymousGuestCount={anonymousGuestCount}
          onIncrementAnonymousGuests={incrementAnonymousGuests}
          onDecrementAnonymousGuests={decrementAnonymousGuests}
          onAddNamedGuest={() => setShowAddGuestModal(true)}
          existingNamedGuests={existingNamedGuests}
          onRemoveNamedGuest={markExistingGuestForRemoval}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onFilterPress={() => {
            // TODO: Open filter modal
            console.log("Open filter modal");
          }}
          filteredMembers={filteredMembers}
          attendance={attendance}
          currentUserId={user?.id}
          onToggleAttendance={toggleAttendance}
          isLoading={isLoadingReport || isLoadingMembers}
          onSubmitPress={() => setShowSubmitModal(true)}
        />
      ) : (
        <AttendanceViewMode
          isFutureEvent={futureEvent}
          report={attendanceReport}
          submittedDate={submittedDate ?? undefined}
          submittedBy={submittedBy ?? undefined}
        />
      )}

      {/* Modals */}
      <AddGuest
        visible={showAddGuestModal}
        onClose={() => setShowAddGuestModal(false)}
        onAddGuest={addGuest}
      />

      <SubmitAttendance
        visible={showSubmitModal}
        onClose={() => setShowSubmitModal(false)}
        onSubmit={handleSubmitAttendance}
        attendanceCount={modalAttendanceCount}
        guestCount={modalGuestCount}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
  },
  containerEditMode: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  headerActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    marginBottom: 16,
  },
  editButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  editButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
