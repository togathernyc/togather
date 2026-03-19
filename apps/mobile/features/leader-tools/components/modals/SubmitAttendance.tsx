import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";

interface SubmitAttendanceProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: () => void;
  warningMessage?: string;
  attendanceCount?: number;
  guestCount?: number;
}

export function SubmitAttendance({
  visible,
  onClose,
  onSubmit,
  warningMessage,
  attendanceCount = 0,
  guestCount = 0,
}: SubmitAttendanceProps) {
  const { colors } = useTheme();
  const handleSubmit = () => {
    onSubmit();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <Ionicons name="warning" size={32} color={colors.warning} />
            </View>
            <Text style={styles.title}>Submit Attendance?</Text>
          </View>

          <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
            {warningMessage && (
              <Text style={styles.warningText}>{warningMessage}</Text>
            )}

            <View style={styles.statsContainer}>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Members Attended</Text>
                <Text style={styles.statValue}>{attendanceCount}</Text>
              </View>
              {guestCount > 0 && (
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>Guests</Text>
                  <Text style={styles.statValue}>{guestCount}</Text>
                </View>
              )}
            </View>

            <View style={styles.infoBox}>
              <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
              <Text style={styles.infoText}>
                Once submitted, attendance cannot be edited. Please verify all information is correct before submitting.
              </Text>
            </View>
          </ScrollView>

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.button, styles.submitButton]}
              onPress={handleSubmit}
            >
              <Text style={[styles.buttonText, styles.submitButtonText]}>
                Submit Attendance
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={onClose}
            >
              <Text style={[styles.buttonText, styles.cancelButtonText]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 16,
    width: "90%",
    maxWidth: 400,
    maxHeight: "80%",
  },
  header: {
    alignItems: "center",
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  iconContainer: {
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#333",
    textAlign: "center",
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 24,
  },
  warningText: {
    fontSize: 16,
    color: "#FF9500",
    marginBottom: 20,
    textAlign: "center",
    lineHeight: 22,
  },
  statsContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 20,
    paddingVertical: 16,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
  },
  statItem: {
    alignItems: "center",
  },
  statLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  statValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#f0f7ff",
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#007AFF",
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: "#666",
    marginLeft: 8,
    lineHeight: 20,
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
});

