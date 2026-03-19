/**
 * AttendanceConfirmationModal
 *
 * This modal handles attendance self-reporting via:
 * - Token-based confirmation (for email links)
 * - Authenticated self-reporting
 *
 * Uses Convex functions:
 * - api.functions.meetings.attendance.validateAttendanceToken
 * - api.functions.meetings.attendance.selfReportAttendance
 * - api.functions.meetings.attendance.confirmAttendanceWithToken
 */

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CustomModal } from "@/components/ui/Modal";
import { useQuery, useMutation, useAuthenticatedMutation, api, Id } from "@services/api/convex";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { format, parseISO } from "date-fns";

interface AttendanceConfirmationModalProps {
  visible: boolean;
  onClose: () => void;
  meetingId: string;
  token?: string | null; // For unauthenticated access via email link
  eventTitle?: string;
  eventDate?: string;
  groupName?: string;
}

type Step = "confirm" | "success" | "already_confirmed" | "error";

export function AttendanceConfirmationModal({
  visible,
  onClose,
  meetingId,
  token,
  eventTitle,
  eventDate,
  groupName,
}: AttendanceConfirmationModalProps) {
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();
  const [step, setStep] = useState<Step>("confirm");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedStatus, setConfirmedStatus] = useState<number | null>(null);

  // Validate token if provided (for email links)
  const tokenData = useQuery(
    api.functions.meetings.attendance.validateAttendanceToken,
    token && visible ? { token } : "skip"
  );
  const isValidatingToken = tokenData === undefined && !!token && visible;

  // Convex mutations
  // selfReportAttendance uses auth token - use authenticated mutation
  const selfReportMutation = useAuthenticatedMutation(api.functions.meetings.attendance.selfReportAttendance);
  // confirmWithTokenMutation uses a special attendance token from email links, NOT auth token - keep as raw mutation
  const confirmWithTokenMutation = useMutation(api.functions.meetings.attendance.confirmAttendanceWithToken);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (visible) {
      setStep("confirm");
      setError(null);
      setConfirmedStatus(null);
    }
  }, [visible]);

  // Check if already confirmed when token is validated.
  // Skip if we're already in a terminal state (success/already_confirmed) to
  // prevent Convex reactive re-query from overwriting the success screen after
  // the token is marked as used by confirmAttendanceWithToken.
  useEffect(() => {
    if (step === "success" || step === "already_confirmed") {
      return;
    }
    if (tokenData?.valid && tokenData.alreadyConfirmed) {
      setStep("already_confirmed");
      setConfirmedStatus(tokenData.existingStatus ?? null);
    } else if (tokenData && !tokenData.valid) {
      setStep("error");
      setError(tokenData.error || "Invalid or expired link");
    }
  }, [tokenData, step]);

  const showConfirmDialog = (status: number, onConfirm: () => void) => {
    const statusText = status === 1 ? "attended" : "did not attend";
    const message = `You're about to confirm that you ${statusText} this event. This cannot be changed.`;

    if (Platform.OS === "web") {
      if (window.confirm(message)) {
        onConfirm();
      }
    } else {
      Alert.alert(
        "Confirm Attendance",
        message,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Confirm", onPress: onConfirm },
        ]
      );
    }
  };

  const handleConfirmAttendance = async (status: number) => {
    showConfirmDialog(status, async () => {
      setIsLoading(true);
      setError(null);

      try {
        if (token) {
          // Use token-based confirmation (special attendance token from email links)
          await confirmWithTokenMutation({ token, status });
        } else {
          // Use authenticated self-report (auth token added automatically)
          await selfReportMutation({ meetingId: meetingId as Id<"meetings">, status });
        }

        setConfirmedStatus(status);
        setStep("success");
      } catch (err: any) {
        const message = err?.message || "Failed to confirm attendance. Please try again.";
        setError(message);
        setStep("error");
      } finally {
        setIsLoading(false);
      }
    });
  };

  // Derive event info from token data if available
  const displayTitle = tokenData?.meeting?.title || eventTitle || "Event";
  const displayDate = tokenData?.meeting?.scheduledAt || eventDate;
  const displayGroupName = tokenData?.meeting?.groupName || groupName;

  const formattedDate = displayDate
    ? format(parseISO(displayDate), "EEEE, MMMM d 'at' h:mm a")
    : null;

  const renderConfirmStep = () => (
    <>
      <View style={styles.iconContainer}>
        <Ionicons name="hand-left" size={48} color={primaryColor} />
      </View>

      <Text style={[styles.title, { color: colors.text }]}>Did you attend?</Text>

      <View style={[styles.eventInfo, { backgroundColor: colors.surfaceSecondary }]}>
        <Text style={[styles.eventTitle, { color: colors.text }]}>{displayTitle}</Text>
        {displayGroupName && (
          <Text style={[styles.eventGroup, { color: colors.textSecondary }]}>{displayGroupName}</Text>
        )}
        {formattedDate && (
          <Text style={[styles.eventDate, { color: colors.textSecondary }]}>{formattedDate}</Text>
        )}
      </View>

      <Text style={[styles.description, { color: colors.textSecondary }]}>
        Please let us know if you made it to this event.
      </Text>

      {error && <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>}

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.attendedButton, { backgroundColor: primaryColor }]}
          onPress={() => handleConfirmAttendance(1)}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={24} color={colors.textInverse} />
              <Text style={[styles.attendedButtonText, { color: colors.textInverse }]}>I Attended</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.notAttendedButton, { backgroundColor: colors.surfaceSecondary }]}
          onPress={() => handleConfirmAttendance(0)}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <>
              <Ionicons name="close-circle" size={24} color={colors.textSecondary} />
              <Text style={[styles.notAttendedButtonText, { color: colors.textSecondary }]}>I Didn't Attend</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </>
  );

  const renderSuccessStep = () => (
    <>
      <View style={styles.iconContainer}>
        <Ionicons
          name="checkmark-circle"
          size={64}
          color={primaryColor}
        />
      </View>

      <Text style={[styles.title, { color: colors.text }]}>Thanks for confirming!</Text>

      <Text style={[styles.description, { color: colors.textSecondary }]}>
        {confirmedStatus === 1
          ? "Great to hear you made it to the event!"
          : "Thanks for letting us know. We hope to see you next time!"}
      </Text>

      <TouchableOpacity
        style={[styles.doneButton, { backgroundColor: primaryColor }]}
        onPress={onClose}
      >
        <Text style={[styles.doneButtonText, { color: colors.textInverse }]}>Done</Text>
      </TouchableOpacity>
    </>
  );

  const renderAlreadyConfirmedStep = () => (
    <>
      <View style={styles.iconContainer}>
        <Ionicons name="information-circle" size={64} color={colors.textSecondary} />
      </View>

      <Text style={[styles.title, { color: colors.text }]}>Already Confirmed</Text>

      <Text style={[styles.description, { color: colors.textSecondary }]}>
        You've already confirmed your attendance for this event.
        {confirmedStatus === 1
          ? " You marked that you attended."
          : " You marked that you didn't attend."}
      </Text>

      <TouchableOpacity
        style={[styles.doneButton, { backgroundColor: primaryColor }]}
        onPress={onClose}
      >
        <Text style={[styles.doneButtonText, { color: colors.textInverse }]}>Got it</Text>
      </TouchableOpacity>
    </>
  );

  const renderErrorStep = () => (
    <>
      <View style={styles.iconContainer}>
        <Ionicons name="alert-circle" size={64} color={colors.error} />
      </View>

      <Text style={[styles.title, { color: colors.text }]}>Something went wrong</Text>

      <Text style={[styles.description, { color: colors.textSecondary }]}>
        {error || "Unable to process your request. Please try again."}
      </Text>

      <TouchableOpacity
        style={[styles.doneButton, { backgroundColor: colors.textSecondary }]}
        onPress={onClose}
      >
        <Text style={[styles.doneButtonText, { color: colors.textInverse }]}>Close</Text>
      </TouchableOpacity>
    </>
  );

  const renderContent = () => {
    // Show loading state while validating token
    if (token && isValidatingToken) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Validating...</Text>
        </View>
      );
    }

    switch (step) {
      case "confirm":
        return renderConfirmStep();
      case "success":
        return renderSuccessStep();
      case "already_confirmed":
        return renderAlreadyConfirmedStep();
      case "error":
        return renderErrorStep();
      default:
        return null;
    }
  };

  return (
    <CustomModal
      visible={visible}
      onClose={onClose}
      withoutCloseBtn={step === "success" || step === "already_confirmed"}
      contentPadding="24"
    >
      <View style={styles.content}>{renderContent()}</View>
    </CustomModal>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: "center",
  },
  loadingContainer: {
    alignItems: "center",
    padding: 40,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  iconContainer: {
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 12,
    textAlign: "center",
  },
  eventInfo: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    alignSelf: "stretch",
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 4,
  },
  eventGroup: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 4,
  },
  eventDate: {
    fontSize: 14,
    textAlign: "center",
  },
  description: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  buttonRow: {
    alignSelf: "stretch",
    marginBottom: 12,
  },
  attendedButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    padding: 16,
  },
  attendedButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  notAttendedButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    padding: 16,
  },
  notAttendedButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  doneButton: {
    alignSelf: "stretch",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 16,
  },
});
