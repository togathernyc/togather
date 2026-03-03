import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CustomModal } from "@/components/ui/Modal";

interface LeaveCommunityModalProps {
  visible: boolean;
  communityName: string;
  onCancel: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
}

export function LeaveCommunityModal({
  visible,
  communityName,
  onCancel,
  onConfirm,
  isLoading = false,
}: LeaveCommunityModalProps) {
  return (
    <CustomModal
      visible={visible}
      onClose={onCancel}
      withoutCloseBtn
      contentPadding="24"
    >
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="warning" size={48} color="#DC2626" />
        </View>

        <Text style={styles.title}>Leave {communityName}</Text>

        <Text style={styles.description}>
          This action cannot be undone. You will lose all your group memberships
          and RSVPs in this community.
        </Text>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={onCancel}
            disabled={isLoading}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.leaveButton, isLoading && styles.buttonDisabled]}
            onPress={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.leaveButtonText}>Leave Community</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </CustomModal>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: "center",
  },
  iconContainer: {
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#333",
    marginBottom: 12,
    textAlign: "center",
  },
  description: {
    fontSize: 15,
    color: "#666",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  buttonRow: {
    flexDirection: "row",
    alignSelf: "stretch",
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  leaveButton: {
    flex: 1,
    backgroundColor: "#DC2626",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  leaveButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
