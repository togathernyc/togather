import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { CustomModal } from "./Modal";
import { useTheme } from "@hooks/useTheme";

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  isLoading?: boolean;
  destructive?: boolean;
}

export function ConfirmModal({
  visible,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = "Confirm",
  cancelText = "Cancel",
  isLoading = false,
  destructive = false,
}: ConfirmModalProps) {
  const { colors } = useTheme();

  return (
    <CustomModal
      visible={visible}
      onClose={onCancel}
      title={title}
      withoutCloseBtn
    >
      <View style={styles.container}>
        <Text style={[styles.message, { color: colors.text }]}>{message}</Text>

        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.surfaceSecondary }]}
            onPress={onCancel}
            disabled={isLoading}
          >
            <Text style={[styles.cancelButtonText, { color: colors.text }]}>{cancelText}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.button,
              { backgroundColor: destructive ? colors.destructive : colors.link },
              isLoading && styles.buttonDisabled,
            ]}
            onPress={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={[styles.confirmButtonText, { color: colors.textInverse }]}>{confirmText}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </CustomModal>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 8,
  },
  message: {
    fontSize: 16,
    marginBottom: 24,
    lineHeight: 22,
  },
  buttonContainer: {
    flexDirection: "row",
    gap: 12,
  },
  button: {
    flex: 1,
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
