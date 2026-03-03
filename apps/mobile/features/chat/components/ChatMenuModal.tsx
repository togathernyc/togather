/**
 * Chat Menu Modal Component
 * Dropdown menu with group actions (Members, Events, Attendance, etc.)
 */
import React, { memo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

type ChatMenuModalProps = {
  visible: boolean;
  hasGroup: boolean;
  showLeaderTools: boolean;
  onClose: () => void;
  onMembersPress: () => void;
  onEventsPress: () => void;
  onAttendancePress: () => void;
  onFollowupPress: () => void;
  onBotsPress: () => void;
  onGroupPagePress: () => void;
  onLeaveGroupPress: () => void;
};

export const ChatMenuModal = memo(function ChatMenuModal({
  visible,
  hasGroup,
  showLeaderTools,
  onClose,
  onMembersPress,
  onEventsPress,
  onAttendancePress,
  onFollowupPress,
  onBotsPress,
  onGroupPagePress,
  onLeaveGroupPress,
}: ChatMenuModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={styles.menuContainer}>
          {/* Members - available to all */}
          {hasGroup && (
            <TouchableOpacity style={styles.menuItem} onPress={onMembersPress}>
              <Ionicons name="people-outline" size={20} color="#333" />
              <Text style={styles.menuItemText}>Members</Text>
            </TouchableOpacity>
          )}

          {/* Events - only for non-leaders (leaders have it in toolbar) */}
          {hasGroup && !showLeaderTools && (
            <TouchableOpacity style={styles.menuItem} onPress={onEventsPress}>
              <Ionicons name="calendar-outline" size={20} color="#333" />
              <Text style={styles.menuItemText}>Events</Text>
            </TouchableOpacity>
          )}

          {/* Group Page - leaders only */}
          {showLeaderTools && (
            <TouchableOpacity style={styles.menuItem} onPress={onGroupPagePress}>
              <Ionicons name="globe-outline" size={20} color="#333" />
              <Text style={styles.menuItemText}>Group Page</Text>
            </TouchableOpacity>
          )}

          {/* Leave Group - available to all */}
          {hasGroup && (
            <TouchableOpacity style={styles.menuItem} onPress={onLeaveGroupPress}>
              <Ionicons name="exit-outline" size={20} color="#e74c3c" />
              <Text style={[styles.menuItemText, { color: "#e74c3c" }]}>
                Leave Group
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemLast]}
            onPress={onClose}
          >
            <Ionicons name="close-outline" size={20} color="#666" />
            <Text style={[styles.menuItemText, { color: "#666" }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingTop: 80,
    paddingRight: 16,
  },
  menuContainer: {
    backgroundColor: "#fff",
    borderRadius: 12,
    minWidth: 180,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  menuItemLast: {
    borderBottomWidth: 0,
  },
  menuItemText: {
    fontSize: 16,
    color: "#333",
    marginLeft: 12,
  },
});
