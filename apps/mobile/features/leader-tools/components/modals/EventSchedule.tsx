import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { format } from "date-fns";
import { useQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { CalendarGrid } from "@components/ui/CalendarGrid";
import { EventScheduleType } from "../../types";
import { getTimezoneAbbreviation } from "@togather/shared";

interface MeetingSummary {
  id?: number;
  meeting_id?: string;
  date: string;
  name?: string;
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

interface EventScheduleProps {
  visible: boolean;
  onClose: () => void;
  onSchedule: (
    eventType: EventScheduleType,
    date: string,
    originalDate?: string,
    meetingId?: string
  ) => void;
  groupId: string;
  currentDate: Date;
}

export function EventSchedule({
  visible,
  onClose,
  onSchedule,
  groupId,
  currentDate,
}: EventScheduleProps) {
  // Fetch group data to get community timezone using Convex
  const groupData = useQuery(
    api.functions.groups.queries.getByIdWithRole,
    visible && groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  );
  const communityTimezone = groupData?.community?.timezone || 'America/New_York';
  const timezoneAbbreviation = getTimezoneAbbreviation(communityTimezone);

  // Initialize selectedDate and selectedTime from currentDate
  const [selectedDate, setSelectedDate] = useState(currentDate);
  const [selectedTime, setSelectedTime] = useState(() => {
    // Extract time from currentDate if it's a valid date
    if (currentDate && !isNaN(currentDate.getTime())) {
      return currentDate;
    }
    return new Date();
  });
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [error, setError] = useState("");
  const [existingMeetings, setExistingMeetings] = useState<MeetingSummary[]>(
    []
  );
  const [isCheckingMeetings, setIsCheckingMeetings] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<{
    eventType: EventScheduleType;
    date: string;
    originalDate?: string;
    meetingId?: string;
  } | null>(null);

  // Reset selectedDate and selectedTime when modal opens or currentDate changes
  useEffect(() => {
    if (visible && currentDate) {
      setSelectedDate(currentDate);
      setSelectedTime(currentDate);
    }
  }, [visible, currentDate]);

  // Fetch meetings using Convex
  const meetingsData = useQuery(
    api.functions.meetings.index.listByGroup,
    visible && groupId ? {
      groupId: groupId as Id<"groups">,
      includeCompleted: true,
      includeCancelled: false,
    } : "skip"
  );
  const isLoadingMeetings = visible && groupId && meetingsData === undefined;

  const checkExistingMeetings = useCallback(() => {
    setIsCheckingMeetings(true);
    try {
      // Convert Convex meetings to MeetingSummary format
      // Convex stores scheduledAt as a timestamp number
      const meetings: MeetingSummary[] = (meetingsData || []).map((meeting) => ({
        id: undefined, // Legacy field
        meeting_id: meeting._id,
        date: new Date(meeting.scheduledAt).toISOString(),
        name: meeting.title || undefined,
        dinner: undefined, // Not included in Convex response
        stats: undefined, // Not included in Convex response
        logDetails: (meeting.attendanceCount || 0) > 0 ? [
          {
            id: 0,
            updatedBy: {
              // createdBy user details not included in Convex listByGroup response
              first_name: "",
              last_name: "",
            },
            attendance: meeting.attendanceCount || 0,
            createdAt: new Date(meeting._creationTime).toISOString(),
          }
        ] : undefined,
      }));

      setExistingMeetings(meetings);
    } catch (error) {
      console.error("Error checking existing meetings:", error);
      setExistingMeetings([]);
    } finally {
      setIsCheckingMeetings(false);
    }
  }, [meetingsData]);

  // Check for existing meetings when data is loaded
  useEffect(() => {
    if (visible && groupId && meetingsData) {
      checkExistingMeetings();
    }
  }, [visible, groupId, meetingsData, checkExistingMeetings]);

  const checkIfMeetingExists = (): MeetingSummary | undefined => {
    const eventDateTime = new Date(selectedDate);
    eventDateTime.setHours(selectedTime.getHours());
    eventDateTime.setMinutes(selectedTime.getMinutes());
    eventDateTime.setSeconds(0);
    eventDateTime.setMilliseconds(0);

    return existingMeetings.find((meeting) => {
      const meetingDate = new Date(meeting.date);
      return (
        meetingDate.toDateString() === eventDateTime.toDateString() &&
        meetingDate.getHours() === eventDateTime.getHours() &&
        meetingDate.getMinutes() === eventDateTime.getMinutes()
      );
    });
  };

  const checkIfMeetingOnCurrentDate = (): MeetingSummary | undefined => {
    if (!currentDate || isNaN(currentDate.getTime())) {
      return undefined;
    }
    return existingMeetings.find((meeting) => {
      const meetingDate = new Date(meeting.date);
      // Compare date and time more accurately
      const currentDateStr = currentDate.toISOString().split("T")[0]; // YYYY-MM-DD
      const meetingDateStr = meetingDate.toISOString().split("T")[0]; // YYYY-MM-DD
      return currentDateStr === meetingDateStr;
    });
  };

  const hasAttendanceSubmitted = (
    meeting: MeetingSummary | undefined
  ): boolean => {
    if (!meeting) return false;
    // Check if there are log details (attendance has been submitted)
    return !!(meeting.logDetails && meeting.logDetails.length > 0);
  };

  const handleSchedule = () => {
    setError("");

    if (!selectedDate || !selectedTime) {
      setError("Please select both date and time.");
      return;
    }

    // Create date in UTC timezone (matching iOS behavior)
    // iOS uses UTC timezone for dates: yyyy-MM-dd'T'HH:mm:ss'Z'
    const eventDateTime = new Date(
      Date.UTC(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate(),
        selectedTime.getHours(),
        selectedTime.getMinutes(),
        0,
        0
      )
    );

    const existingMeeting = checkIfMeetingExists();
    const currentDateMeeting = checkIfMeetingOnCurrentDate();

    // If there's a meeting on the selected date and time, and it's different from current date
    if (
      existingMeeting &&
      new Date(existingMeeting.date).toISOString() !== currentDate.toISOString()
    ) {
      setError(
        `An event is already scheduled on ${format(
          selectedDate,
          "MMM d"
        )} at ${format(selectedTime, "h:mm a")}.`
      );
      return;
    }

    // Determine event type
    let eventType: EventScheduleType;
    let originalDate: string | undefined;

    if (
      currentDateMeeting &&
      selectedDate.toDateString() === currentDate.toDateString() &&
      existingMeeting &&
      new Date(existingMeeting.date).toISOString() ===
        new Date(currentDateMeeting.date).toISOString()
    ) {
      // Same date, same time - remove event
      eventType = EventScheduleType.REMOVE_EVENT;

      // Check if attendance has been submitted (matching iOS behavior)
      if (hasAttendanceSubmitted(currentDateMeeting)) {
        // Show confirmation dialog before removing
        setPendingRemove({
          eventType,
          date: eventDateTime.toISOString().split(".")[0] + "Z",
          originalDate,
          meetingId: currentDateMeeting?.meeting_id,
        });
        setShowRemoveConfirm(true);
        return;
      }
    } else if (currentDateMeeting && existingMeeting) {
      // Rescheduling existing event
      eventType = EventScheduleType.RESCHEDULE_EVENT;
      const originalDateTime = new Date(currentDateMeeting.date);
      originalDateTime.setUTCSeconds(0);
      originalDateTime.setUTCMilliseconds(0);
      originalDate = originalDateTime.toISOString().split(".")[0] + "Z";
    } else if (currentDateMeeting) {
      // Changing date of existing event
      eventType = EventScheduleType.RESCHEDULE_EVENT;
      const originalDateTime = new Date(currentDateMeeting.date);
      originalDateTime.setUTCSeconds(0);
      originalDateTime.setUTCMilliseconds(0);
      originalDate = originalDateTime.toISOString().split(".")[0] + "Z";
    } else {
      // Creating new event
      eventType = EventScheduleType.ADD_EVENT;
    }

    // iOS format: yyyy-MM-dd'T'HH:mm:ss'Z' (literal Z, not timezone)
    // toISOString() already includes 'Z', so we just need to remove milliseconds
    const eventDateString = eventDateTime.toISOString().split(".")[0] + "Z";
    const meetingId = currentDateMeeting?.meeting_id;
    console.log("📅 EventSchedule - Calling onSchedule with:", {
      eventType,
      eventDateString,
      originalDate,
      meetingId,
      eventDateTime: eventDateTime.toISOString(),
    });
    onSchedule(eventType, eventDateString, originalDate, meetingId);
    onClose();
  };

  const handleConfirmRemove = () => {
    if (pendingRemove) {
      onSchedule(
        pendingRemove.eventType,
        pendingRemove.date,
        pendingRemove.originalDate,
        pendingRemove.meetingId
      );
      setPendingRemove(null);
      setShowRemoveConfirm(false);
      onClose();
    }
  };

  const handleCancelRemove = () => {
    setPendingRemove(null);
    setShowRemoveConfirm(false);
  };

  const handleClose = () => {
    setSelectedDate(currentDate);
    setSelectedTime(new Date());
    setError("");
    onClose();
  };

  const getActionButtonText = () => {
    if (isDeleteAction()) {
      return "Delete Event";
    }

    const currentDateMeeting = checkIfMeetingOnCurrentDate();
    const existingMeeting = checkIfMeetingExists();

    if (currentDateMeeting && existingMeeting) {
      return `Change Time on ${format(selectedDate, "MMM d")}`;
    } else if (currentDateMeeting) {
      return `Change Date to ${format(selectedDate, "MMM d")}`;
    } else {
      // Match iOS: "Create Event on {MMM dd}"
      return `Create Event on ${format(selectedDate, "MMM dd")}`;
    }
  };

  const isDeleteAction = () => {
    const currentDateMeeting = checkIfMeetingOnCurrentDate();

    // If there's a meeting on the current date, we're editing an existing event
    // Show delete button when editing (not creating new)
    if (currentDateMeeting) {
      // Check if selected date matches current date (we're still on the same date)
      const selectedDateStr = selectedDate.toISOString().split("T")[0];
      const currentDateStr = currentDate.toISOString().split("T")[0];

      // If we're on the same date as the event, show delete button
      // This means we're editing an existing event, not creating a new one
      return selectedDateStr === currentDateStr;
    }

    return false;
  };

  const getCurrentDateMeeting = (): MeetingSummary | undefined => {
    return checkIfMeetingOnCurrentDate();
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={handleClose}
        />
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Set Date</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color="#333" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentContainer}
          >
            <Text style={styles.description}>
              Select the date and time for your event.
            </Text>
            <View style={styles.timezoneNote}>
              <Ionicons name="time-outline" size={16} color="#666" />
              <Text style={styles.timezoneNoteText}>
                Times are in {timezoneAbbreviation}
              </Text>
            </View>

            {/* Calendar Grid - Always visible like iOS */}
            <View style={styles.pickerSection}>
              <CalendarGrid
                selectedDate={selectedDate}
                onDateSelect={(date) => {
                  setSelectedDate(date);
                  setError("");
                }}
                minimumDate={new Date()}
              />
            </View>

            {/* Time Picker - iOS style selector */}
            <View style={styles.pickerSection}>
              <Text style={styles.sectionLabel}>Time</Text>
              <TouchableOpacity
                style={styles.timeSelectorButton}
                onPress={() => setShowTimePicker(true)}
              >
                <Text style={styles.timeSelectorText}>
                  {format(selectedTime, "h:mm a")}
                </Text>
                <Ionicons name="chevron-down" size={16} color="#333" />
              </TouchableOpacity>
            </View>

            {error ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {isCheckingMeetings && (
              <View style={styles.loadingContainer}>
                <Text style={styles.loadingText}>
                  Checking for existing events...
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Action Buttons */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[
                styles.button,
                isDeleteAction() ? styles.deleteButton : styles.submitButton,
              ]}
              onPress={handleSchedule}
            >
              <Text
                style={[
                  styles.buttonText,
                  isDeleteAction()
                    ? styles.deleteButtonText
                    : styles.submitButtonText,
                ]}
              >
                {getActionButtonText()}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={handleClose}
            >
              <Text style={[styles.buttonText, styles.cancelButtonText]}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>

          {/* Time Picker Modal - iOS style wheel picker */}
          <Modal
            visible={showTimePicker}
            transparent={true}
            animationType="slide"
            onRequestClose={() => setShowTimePicker(false)}
          >
            <View style={styles.timePickerOverlay}>
              <TouchableOpacity
                style={styles.timePickerBackdrop}
                activeOpacity={1}
                onPress={() => setShowTimePicker(false)}
              />
              <View style={styles.timePickerModal}>
                <View style={styles.timePickerHeader}>
                  <Text style={styles.timePickerTitle}>Select Time</Text>
                </View>
                <View style={styles.timePickerContent}>
                  {Platform.OS === "web" ? (
                    <input
                      type="time"
                      value={format(selectedTime, "HH:mm")}
                      onChange={(e) => {
                        if (e.target.value) {
                          const [hours, minutes] = e.target.value
                            .split(":")
                            .map(Number);
                          const newTime = new Date(selectedTime);
                          newTime.setHours(hours, minutes, 0, 0);
                          setSelectedTime(newTime);
                          setError("");
                        }
                      }}
                      style={{
                        width: "100%",
                        padding: "20px",
                        fontSize: "24px",
                        textAlign: "center",
                        border: "none",
                        outline: "none",
                      }}
                    />
                  ) : (
                    <View style={styles.timePickerWheel}>
                      <Text style={styles.timePickerWheelText}>
                        {format(selectedTime, "h:mm a")}
                      </Text>
                      <Text style={styles.timePickerWheelHint}>
                        Use native time picker when available
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.timePickerButtons}>
                  <TouchableOpacity
                    style={[styles.button, styles.submitButton]}
                    onPress={() => setShowTimePicker(false)}
                  >
                    <Text style={[styles.buttonText, styles.submitButtonText]}>
                      Change Time
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.button, styles.cancelButton]}
                    onPress={() => {
                      setSelectedTime(new Date());
                      setShowTimePicker(false);
                    }}
                  >
                    <Text style={[styles.buttonText, styles.cancelButtonText]}>
                      Cancel
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        </View>
      </View>

      {/* Remove Confirmation Modal */}
      <Modal
        visible={showRemoveConfirm}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCancelRemove}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmModal}>
            <Text style={styles.confirmTitle}>
              Attendance Already Submitted
            </Text>
            <Text style={styles.confirmText}>
              An attendance report was already submitted for this date.
            </Text>

            {getCurrentDateMeeting()?.logDetails &&
              getCurrentDateMeeting()!.logDetails!.length > 0 && (
                <View style={styles.attendanceInfo}>
                  <Text style={styles.attendanceInfoText}>
                    Submitted by:{" "}
                    {
                      getCurrentDateMeeting()!.logDetails![0].updatedBy
                        .first_name
                    }{" "}
                    {
                      getCurrentDateMeeting()!.logDetails![0].updatedBy
                        .last_name
                    }
                  </Text>
                  <Text style={styles.attendanceInfoText}>
                    Date:{" "}
                    {format(
                      new Date(
                        getCurrentDateMeeting()!.logDetails![0].createdAt
                      ),
                      "MMM dd, yyyy"
                    )}
                  </Text>
                </View>
              )}

            <Text style={styles.confirmWarning}>
              Removing this event from this date will also delete the attendance
              report. Are you sure you want to do that?
            </Text>

            <TouchableOpacity
              style={[styles.button, styles.removeButton]}
              onPress={handleConfirmRemove}
            >
              <Text style={[styles.buttonText, styles.removeButtonText]}>
                Yes, Remove Event
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={handleCancelRemove}
            >
              <Text style={[styles.buttonText, styles.cancelButtonText]}>
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  backdrop: {
    flex: 1,
  },
  modalContent: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "90%",
    paddingBottom: Platform.OS === "ios" ? 34 : 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
  },
  closeButton: {
    padding: 4,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  description: {
    fontSize: 16,
    color: "#7f7f82",
    textAlign: "center",
    marginBottom: 12,
    lineHeight: 24,
  },
  timezoneNote: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f0f0f0",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 24,
    gap: 6,
  },
  timezoneNoteText: {
    fontSize: 14,
    color: "#666",
    fontWeight: "500",
  },
  pickerSection: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  pickerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 8,
    padding: 12,
    backgroundColor: "#fff",
  },
  pickerButtonText: {
    fontSize: 16,
    color: "#333",
  },
  datePickerContainer: {
    marginTop: 12,
  },
  timeSelectorButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 2,
    borderColor: "#ecedf0",
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: "#fff",
    height: 48,
    width: 180,
  },
  timeSelectorText: {
    fontSize: 16,
    color: "#333",
    fontWeight: "500",
  },
  timePickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  timePickerBackdrop: {
    flex: 1,
  },
  timePickerModal: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "50%",
    paddingBottom: Platform.OS === "ios" ? 34 : 16,
  },
  timePickerHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    alignItems: "center",
  },
  timePickerTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
  },
  timePickerContent: {
    padding: 40,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 200,
  },
  timePickerWheel: {
    alignItems: "center",
  },
  timePickerWheelText: {
    fontSize: 32,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  timePickerWheelHint: {
    fontSize: 14,
    color: "#666",
  },
  timePickerButtons: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
  },
  errorContainer: {
    backgroundColor: "#fff3cd",
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  errorText: {
    fontSize: 14,
    color: "#856404",
    textAlign: "center",
  },
  loadingContainer: {
    padding: 12,
    alignItems: "center",
  },
  loadingText: {
    fontSize: 14,
    color: "#666",
  },
  buttonContainer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
  },
  button: {
    borderRadius: 100,
    padding: 15,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  submitButton: {
    backgroundColor: "#222224",
  },
  cancelButton: {
    backgroundColor: "#ecedf0",
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "600",
  },
  submitButtonText: {
    color: "#fff",
  },
  cancelButtonText: {
    color: "#4b4b4d",
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  confirmModal: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 24,
    width: "100%",
    maxWidth: 400,
  },
  confirmTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 8,
    textAlign: "center",
  },
  confirmText: {
    fontSize: 16,
    color: "#666",
    marginBottom: 16,
    textAlign: "center",
  },
  confirmWarning: {
    fontSize: 16,
    color: "#666",
    marginBottom: 24,
    textAlign: "center",
  },
  attendanceInfo: {
    backgroundColor: "#f5f5f5",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  attendanceInfoText: {
    fontSize: 14,
    color: "#333",
    marginBottom: 4,
  },
  removeButton: {
    backgroundColor: "#dc3545",
    marginBottom: 12,
  },
  removeButtonText: {
    color: "#fff",
  },
  deleteButton: {
    backgroundColor: "#dc3545",
  },
  deleteButtonText: {
    color: "#fff",
  },
});
