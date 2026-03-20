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
import { useTheme } from "@hooks/useTheme";

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
  onShareGroupPress?: () => void;
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
  onShareGroupPress,
  onLeaveGroupPress,
}: ChatMenuModalProps) {
  const { colors: themeColors } = useTheme();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={[styles.modalOverlay, { backgroundColor: themeColors.overlay }]} onPress={onClose}>
        <View style={[styles.menuContainer, { backgroundColor: themeColors.modalBackground }]}>
          {/* Members - available to all */}
          {hasGroup && (
            <TouchableOpacity style={[styles.menuItem, { borderBottomColor: themeColors.borderLight }]} onPress={onMembersPress}>
              <Ionicons name="people-outline" size={20} color={themeColors.text} />
              <Text style={[styles.menuItemText, { color: themeColors.text }]}>Members</Text>
            </TouchableOpacity>
          )}

          {/* Events - only for non-leaders (leaders have it in toolbar) */}
          {hasGroup && !showLeaderTools && (
            <TouchableOpacity style={[styles.menuItem, { borderBottomColor: themeColors.borderLight }]} onPress={onEventsPress}>
              <Ionicons name="calendar-outline" size={20} color={themeColors.text} />
              <Text style={[styles.menuItemText, { color: themeColors.text }]}>Events</Text>
            </TouchableOpacity>
          )}

          {/* Group Page - leaders only */}
          {showLeaderTools && (
            <TouchableOpacity style={[styles.menuItem, { borderBottomColor: themeColors.borderLight }]} onPress={onGroupPagePress}>
              <Ionicons name="globe-outline" size={20} color={themeColors.text} />
              <Text style={[styles.menuItemText, { color: themeColors.text }]}>Group Page</Text>
            </TouchableOpacity>
          )}

          {/* Share Group - available to all when group has shareable link */}
          {hasGroup && onShareGroupPress && (
            <TouchableOpacity style={[styles.menuItem, { borderBottomColor: themeColors.borderLight }]} onPress={onShareGroupPress}>
              <Ionicons name="share-outline" size={20} color={themeColors.text} />
              <Text style={[styles.menuItemText, { color: themeColors.text }]}>Share Group</Text>
            </TouchableOpacity>
          )}

          {/* Leave Group - available to all */}
          {hasGroup && (
            <TouchableOpacity style={[styles.menuItem, { borderBottomColor: themeColors.borderLight }]} onPress={onLeaveGroupPress}>
              <Ionicons name="exit-outline" size={20} color={themeColors.error} />
              <Text style={[styles.menuItemText, { color: themeColors.error }]}>
                Leave Group
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemLast]}
            onPress={onClose}
          >
            <Ionicons name="close-outline" size={20} color={themeColors.textSecondary} />
            <Text style={[styles.menuItemText, { color: themeColors.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingTop: 80,
    paddingRight: 16,
  },
  menuContainer: {
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
  },
  menuItemLast: {
    borderBottomWidth: 0,
  },
  menuItemText: {
    fontSize: 16,
    marginLeft: 12,
  },
});
