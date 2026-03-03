/**
 * Delete Account Section
 *
 * Displays a warning message and button to initiate account deletion.
 * Opens the DeleteAccountModal when pressed.
 */
import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { DeleteAccountModal } from "./DeleteAccountModal";

export function DeleteAccountSection() {
  const [isModalVisible, setIsModalVisible] = useState(false);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Account</Text>

      <View style={styles.warningContainer}>
        <Ionicons
          name="warning-outline"
          size={20}
          color="#DC2626"
          style={styles.warningIcon}
        />
        <Text style={styles.warningText}>
          Deleting your account is permanent and cannot be undone. You will be
          removed from all communities and groups.
        </Text>
      </View>

      <TouchableOpacity
        style={styles.deleteButton}
        onPress={() => setIsModalVisible(true)}
      >
        <Ionicons name="trash-outline" size={20} color="#fff" />
        <Text style={styles.deleteButtonText}>Delete Account</Text>
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
    backgroundColor: "#fff",
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 16,
  },
  warningContainer: {
    flexDirection: "row",
    backgroundColor: "#FEF2F2",
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
    color: "#991B1B",
    lineHeight: 20,
  },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DC2626",
    borderRadius: 8,
    padding: 14,
    gap: 8,
  },
  deleteButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
