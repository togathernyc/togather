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
import { useTheme } from "@hooks/useTheme";

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
  const { colors } = useTheme();
  return (
    <CustomModal
      visible={visible}
      onClose={onCancel}
      withoutCloseBtn
      contentPadding="24"
    >
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="warning" size={48} color={colors.error} />
        </View>

        <Text style={[styles.title, { color: colors.text }]}>Leave {communityName}</Text>

        <Text style={[styles.description, { color: colors.textSecondary }]}>
          This action cannot be undone. You will lose all your group memberships
          and RSVPs in this community.
        </Text>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.cancelButton, { backgroundColor: colors.surfaceSecondary }]}
            onPress={onCancel}
            disabled={isLoading}
          >
            <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.leaveButton, { backgroundColor: colors.error }, isLoading && styles.buttonDisabled]}
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
    marginBottom: 12,
    textAlign: "center",
  },
  description: {
    fontSize: 15,
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
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  leaveButton: {
    flex: 1,
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
