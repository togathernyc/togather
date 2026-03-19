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
import { useTheme } from "@hooks/useTheme";

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
  const { colors, isDark } = useTheme();
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

  // Warning colors - semantic, using isDark for appropriate tones
  const warningBg = isDark ? '#3a3520' : '#fff3cd';
  const warningTextColor = isDark ? '#FF9F0A' : '#856404';

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={handleClose}
        />
        <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Set Date</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentContainer}
          >
            <Text style={[styles.description, { color: colors.textSecondary }]}>
              Select the date and time for your event.
            </Text>
            <View style={[styles.timezoneNote, { backgroundColor: colors.surfaceSecondary }]}>
              <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.timezoneNoteText, { color: colors.textSecondary }]}>
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
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Time</Text>
              <TouchableOpacity
                style={[styles.timeSelectorButton, { borderColor: colors.borderLight, backgroundColor: colors.surface }]}
                onPress={() => setShowTimePicker(true)}
              >
                <Text style={[styles.timeSelectorText, { color: colors.text }]}>
                  {format(selectedTime, "h:mm a")}
                </Text>
                <Ionicons name="chevron-down" size={16} color={colors.text} />
              </TouchableOpacity>
            </View>

            {error ? (
              <View style={[styles.errorContainer, { backgroundColor: warningBg }]}>
                <Text style={[styles.errorText, { color: warningTextColor }]}>{error}</Text>
              </View>
            ) : null}

            {isCheckingMeetings && (
              <View style={styles.loadingContainer}>
                <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                  Checking for existing events...
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Action Buttons */}
          <View style={[styles.buttonContainer, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[
                styles.button,
                isDeleteAction()
                  ? { backgroundColor: colors.destructive }
                  : { backgroundColor: colors.buttonPrimary },
              ]}
              onPress={handleSchedule}
            >
              <Text
                style={[
                  styles.buttonText,
                  { color: isDeleteAction() ? '#fff' : colors.buttonPrimaryText },
                ]}
              >
                {getActionButtonText()}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.borderLight }]}
              onPress={handleClose}
            >
              <Text style={[styles.buttonText, { color: colors.textSecondary }]}>
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
            <View style={[styles.timePickerOverlay, { backgroundColor: colors.overlay }]}>
              <TouchableOpacity
                style={styles.timePickerBackdrop}
                activeOpacity={1}
                onPress={() => setShowTimePicker(false)}
              />
              <View style={[styles.timePickerModal, { backgroundColor: colors.surface }]}>
                <View style={[styles.timePickerHeader, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.timePickerTitle, { color: colors.text }]}>Select Time</Text>
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
                      <Text style={[styles.timePickerWheelText, { color: colors.text }]}>
                        {format(selectedTime, "h:mm a")}
                      </Text>
                      <Text style={[styles.timePickerWheelHint, { color: colors.textSecondary }]}>
                        Use native time picker when available
                      </Text>
                    </View>
                  )}
                </View>
                <View style={[styles.timePickerButtons, { borderTopColor: colors.border }]}>
                  <TouchableOpacity
                    style={[styles.button, { backgroundColor: colors.buttonPrimary }]}
                    onPress={() => setShowTimePicker(false)}
                  >
                    <Text style={[styles.buttonText, { color: colors.buttonPrimaryText }]}>
                      Change Time
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.button, { backgroundColor: colors.borderLight }]}
                    onPress={() => {
                      setSelectedTime(new Date());
                      setShowTimePicker(false);
                    }}
                  >
                    <Text style={[styles.buttonText, { color: colors.textSecondary }]}>
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
        <View style={[styles.confirmOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.confirmModal, { backgroundColor: colors.surface }]}>
            <Text style={[styles.confirmTitle, { color: colors.text }]}>
              Attendance Already Submitted
            </Text>
            <Text style={[styles.confirmText, { color: colors.textSecondary }]}>
              An attendance report was already submitted for this date.
            </Text>

            {getCurrentDateMeeting()?.logDetails &&
              getCurrentDateMeeting()!.logDetails!.length > 0 && (
                <View style={[styles.attendanceInfo, { backgroundColor: colors.surfaceSecondary }]}>
                  <Text style={[styles.attendanceInfoText, { color: colors.text }]}>
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
                  <Text style={[styles.attendanceInfoText, { color: colors.text }]}>
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

            <Text style={[styles.confirmWarning, { color: colors.textSecondary }]}>
              Removing this event from this date will also delete the attendance
              report. Are you sure you want to do that?
            </Text>

            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.destructive }]}
              onPress={handleConfirmRemove}
            >
              <Text style={[styles.buttonText, { color: '#fff' }]}>
                Yes, Remove Event
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.borderLight }]}
              onPress={handleCancelRemove}
            >
              <Text style={[styles.buttonText, { color: colors.textSecondary }]}>
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
    justifyContent: "flex-end",
  },
  backdrop: {
    flex: 1,
  },
  modalContent: {
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
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
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
    textAlign: "center",
    marginBottom: 12,
    lineHeight: 24,
  },
  timezoneNote: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 24,
    gap: 6,
  },
  timezoneNoteText: {
    fontSize: 14,
    fontWeight: "500",
  },
  pickerSection: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  pickerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  pickerButtonText: {
    fontSize: 16,
  },
  datePickerContainer: {
    marginTop: 12,
  },
  timeSelectorButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 2,
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 12,
    height: 48,
    width: 180,
  },
  timeSelectorText: {
    fontSize: 16,
    fontWeight: "500",
  },
  timePickerOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  timePickerBackdrop: {
    flex: 1,
  },
  timePickerModal: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "50%",
    paddingBottom: Platform.OS === "ios" ? 34 : 16,
  },
  timePickerHeader: {
    padding: 16,
    borderBottomWidth: 1,
    alignItems: "center",
  },
  timePickerTitle: {
    fontSize: 24,
    fontWeight: "bold",
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
    marginBottom: 8,
  },
  timePickerWheelHint: {
    fontSize: 14,
  },
  timePickerButtons: {
    padding: 16,
    borderTopWidth: 1,
  },
  errorContainer: {
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
  },
  loadingContainer: {
    padding: 12,
    alignItems: "center",
  },
  loadingText: {
    fontSize: 14,
  },
  buttonContainer: {
    padding: 16,
    borderTopWidth: 1,
  },
  button: {
    borderRadius: 100,
    padding: 15,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "600",
  },
  confirmOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  confirmModal: {
    borderRadius: 12,
    padding: 24,
    width: "100%",
    maxWidth: 400,
  },
  confirmTitle: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 8,
    textAlign: "center",
  },
  confirmText: {
    fontSize: 16,
    marginBottom: 16,
    textAlign: "center",
  },
  confirmWarning: {
    fontSize: 16,
    marginBottom: 24,
    textAlign: "center",
  },
  attendanceInfo: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  attendanceInfoText: {
    fontSize: 14,
    marginBottom: 4,
  },
});
