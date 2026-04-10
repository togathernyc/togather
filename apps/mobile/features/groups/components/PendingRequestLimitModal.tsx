import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { CustomModal } from "@components/ui/Modal";
import { useTheme } from "@hooks/useTheme";
import { PENDING_JOIN_REQUEST_LIMIT } from "../hooks/useMyPendingJoinRequests";

interface PendingRequestLimitModalProps {
  visible: boolean;
  onDismiss: () => void;
  onViewRequests: () => void;
}

/**
 * Friction modal shown when a user tries to request to join a group while
 * already at the pending-request cap (currently 2). Two actions:
 *
 * - "View my requests" — navigates to the My Requests section on the
 *   profile page so the user can withdraw something to free up a slot.
 * - "Dismiss" — closes the modal with no side effects.
 *
 * This is the user-facing surface of a frontend-only stopgap. The backend
 * still allows unlimited memberships; we're just nudging users who are
 * accumulating pending requests to clean them up first.
 */
export function PendingRequestLimitModal({
  visible,
  onDismiss,
  onViewRequests,
}: PendingRequestLimitModalProps) {
  const { colors } = useTheme();

  return (
    <CustomModal
      visible={visible}
      onClose={onDismiss}
      title="You have pending requests"
      withoutCloseBtn
    >
      <View style={styles.container}>
        <Text style={[styles.message, { color: colors.text }]}>
          You already have {PENDING_JOIN_REQUEST_LIMIT} pending join requests.
          Withdraw one before requesting to join another group.
        </Text>

        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[
              styles.button,
              { backgroundColor: colors.surfaceSecondary },
            ]}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          >
            <Text style={[styles.dismissText, { color: colors.text }]}>
              Dismiss
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.link }]}
            onPress={onViewRequests}
            accessibilityRole="button"
            accessibilityLabel="View my requests"
          >
            <Text style={[styles.primaryText, { color: colors.textInverse }]}>
              View my requests
            </Text>
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
  dismissText: {
    fontSize: 16,
    fontWeight: "600",
  },
  primaryText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
