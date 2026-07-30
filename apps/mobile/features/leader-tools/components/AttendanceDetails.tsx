import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { waAccentPalette } from "@utils/waPalette";
import { WaInsetGroup } from "@components/wa/WaInsetGroup";
import { WaCell } from "@components/wa/WaCell";
import { WA_GROUP_SPACING } from "@components/wa/metrics";
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
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const waAccent = waAccentPalette(primaryColor, isDark).accent;
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<string>("");

  // Modal states
  const [showAddGuestModal, setShowAddGuestModal] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);

  // Fetch attendance report (for view mode or to pre-populate edit mode)
  // Prefer meetingId over eventDate for direct lookup (more efficient and unambiguous)
  const {
    data: attendanceReport,
    isLoading: isLoadingReport,
    isPermissionDenied,
  } = useAttendanceReport(groupId, {
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

  // Attendance is host/leader/admin-only server-side. Say so instead of
  // rendering an empty roster (or letting the query throw and crash the
  // screen) when the viewer can't manage this event.
  if (isPermissionDenied) {
    return (
      <View style={styles.restrictedContainer}>
        <Text style={[styles.restrictedTitle, { color: colors.text }]}>
          You don&apos;t have access to this attendance
        </Text>
        <Text style={[styles.restrictedText, { color: colors.textSecondary }]}>
          Only the event&apos;s hosts, group leaders, or community admins can
          view attendance for this event.
        </Text>
      </View>
    );
  }

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
    <View
      style={[
        styles.container,
        // View mode sits on the screen's grouped canvas — the WaInsetGroups
        // bring their own card fill and margins, so no padding here.
        editMode && [styles.containerEditMode, { backgroundColor: colors.surface }],
      ]}
    >
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
        <>
          <AttendanceViewMode
            isFutureEvent={futureEvent}
            report={attendanceReport}
            submittedDate={submittedDate ?? undefined}
            submittedBy={submittedBy ?? undefined}
          />

          {/* §1.3 accent action row — replaces the stray "Edit" link that used
              to float in the top-right corner. Leaders can always correct a
              submitted count, so this shows whether or not one exists yet. */}
          {!futureEvent && (
            <View style={styles.actionSection}>
              <WaInsetGroup>
                <WaCell
                  variant="action"
                  title={
                    hasAttendanceData ? "Edit attendance" : "Take attendance"
                  }
                  accent={waAccent}
                  onPress={onEdit}
                />
              </WaInsetGroup>
            </View>
          )}
        </>
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
    paddingTop: 4,
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
  restrictedContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  restrictedTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
    textAlign: "center",
  },
  restrictedText: {
    fontSize: 15,
    textAlign: "center",
  },
  actionSection: {
    marginBottom: WA_GROUP_SPACING,
  },
});
