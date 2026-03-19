/**
 * Delete Account Section
 *
 * Displays a warning message and button to initiate account deletion.
 * Opens the DeleteAccountModal when pressed.
 */
import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { DeleteAccountModal } from "./DeleteAccountModal";

export function DeleteAccountSection() {
  const { colors } = useTheme();
  const [isModalVisible, setIsModalVisible] = useState(false);

  return (
    <View style={[styles.section, { backgroundColor: colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Account</Text>

      <View style={[styles.warningContainer, { backgroundColor: colors.destructive + '10' }]}>
        <Ionicons
          name="warning-outline"
          size={20}
          color={colors.destructive}
          style={styles.warningIcon}
        />
        <Text style={[styles.warningText, { color: colors.destructive }]}>
          Deleting your account is permanent and cannot be undone. You will be
          removed from all communities and groups.
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.deleteButton, { backgroundColor: colors.destructive }]}
        onPress={() => setIsModalVisible(true)}
      >
        <Ionicons name="trash-outline" size={20} color={colors.textInverse} />
        <Text style={[styles.deleteButtonText, { color: colors.textInverse }]}>Delete Account</Text>
      </TouchableOpacity>

      <DeleteAccountModal
        visible={isModalVisible}
        onClose={() => setIsModalVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 12,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 16,
  },
  warningContainer: {
    flexDirection: "row",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  warningIcon: {
    marginRight: 8,
    marginTop: 2,
  },
  warningText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    padding: 14,
    gap: 8,
  },
  deleteButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
