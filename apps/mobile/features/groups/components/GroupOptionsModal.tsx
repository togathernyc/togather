import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableWithoutFeedback,
  Animated,
  Platform,
  Dimensions,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Share,
  ActionSheetIOS,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@providers/AuthProvider";
import { Group } from "../types";
import { DOMAIN_CONFIG } from "@togather/shared";
import * as Clipboard from "expo-clipboard";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

interface GroupOptionsModalProps {
  visible: boolean;
  group: Group | null;
  onClose: () => void;
  onLeaveGroup: () => void;
  onArchiveGroup?: () => void;
  isLeaving?: boolean;
  isArchiving?: boolean;
}

export function GroupOptionsModal({
  visible,
  group,
  onClose,
  onLeaveGroup,
  onArchiveGroup,
  isLeaving = false,
  isArchiving = false,
}: GroupOptionsModalProps) {
  const router = useRouter();
  const { user } = useAuth();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Reset animation values when opening
      slideAnim.setValue(SCREEN_HEIGHT);
      fadeAnim.setValue(0);

      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: SCREEN_HEIGHT,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, slideAnim, fadeAnim]);

  // TODO: Message group functionality removed
  const handleMessageGroup = async () => {
    console.log("Message group functionality has been removed");
    Alert.alert(
      "Feature Unavailable",
      "Message group functionality is currently unavailable.",
      [{ text: "OK" }]
    );
  };

  const handleLeaveGroup = () => {
    onLeaveGroup();
  };

  const handleEditGroup = () => {
    if (!group?._id) {
      console.error("Group ID is missing:", group);
      return;
    }

    onClose();
    router.push(`/groups/${group._id}/edit`);
  };

  const handleShareGroup = async () => {
    if (!group?.shortId) {
      Alert.alert("Cannot Share", "This group doesn't have a shareable link yet.");
      return;
    }

    const groupUrl = DOMAIN_CONFIG.groupShareUrl(group.shortId);
    const groupName = group.name || group.title || "Group";

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Copy Link", "Share"],
          cancelButtonIndex: 0,
        },
        async (buttonIndex) => {
          if (buttonIndex === 1) {
            await Clipboard.setStringAsync(groupUrl);
            Alert.alert("Link Copied", "Group link has been copied to clipboard.");
          } else if (buttonIndex === 2) {
            await Share.share({
              message: `${groupName}\n${groupUrl}`,
              url: groupUrl,
            });
          }
        }
      );
    } else {
      await Share.share({
        message: `${groupName}\n${groupUrl}`,
      });
    }
  };

  // Check if current user is a leader or community admin
  // Community admins (user.is_admin === true) can edit any group in their community
  const canEditGroup = useMemo(() => {
    if (!group || !user?.id) return false;

    // Check if user is a community admin
    const isCommunityAdmin = user.is_admin === true;

    // Check if user is a group leader
    // Compare as strings since user.id is now a Convex ID string
    const isGroupLeader = group.leaders?.some((leader) => String(leader.id) === String(user.id)) || false;

    return isCommunityAdmin || isGroupLeader;
  }, [group, user?.id, user?.is_admin]);

  // Only community admins can archive groups
  const canArchiveGroup = useMemo(() => {
    return user?.is_admin === true;
  }, [user?.is_admin]);

  const handleArchiveGroup = () => {
    if (onArchiveGroup) {
      onArchiveGroup();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]} />
        </TouchableWithoutFeedback>
        <Animated.View
          style={[
            styles.bottomSheet,
            {
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <View style={styles.handle} />
          <View style={styles.modalContent}>
            {/* Share Group button - available to all users */}
            {group?.shortId && (
              <TouchableOpacity
                style={[styles.optionButton, styles.shareButton]}
                onPress={handleShareGroup}
                disabled={isLeaving || isArchiving}
              >
                <Text style={styles.shareButtonText}>Share Group</Text>
              </TouchableOpacity>
            )}

            {canEditGroup && (
              <TouchableOpacity
                style={[styles.optionButton, styles.editButton]}
                onPress={handleEditGroup}
                disabled={isLeaving || isArchiving}
              >
                <Text style={styles.editButtonText}>Edit Group</Text>
              </TouchableOpacity>
            )}

            {canArchiveGroup && !group?.is_announcement_group && (
              <TouchableOpacity
                style={[styles.optionButton, styles.archiveButton]}
                onPress={handleArchiveGroup}
                disabled={isLeaving || isArchiving}
              >
                {isArchiving ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.archiveButtonText}>Archive Group</Text>
                )}
              </TouchableOpacity>
            )}

            {group?.is_announcement_group ? (
              <View style={styles.infoSection}>
                <Text style={styles.infoText}>
                  This is your community's announcement channel. To leave, go to Settings and leave the community.
                </Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.optionButton, styles.leaveButton]}
                onPress={handleLeaveGroup}
                disabled={isLeaving || isArchiving}
              >
                <Text style={styles.leaveButtonText}>Leave Group</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.optionButton, styles.cancelButton]}
              onPress={onClose}
              disabled={isLeaving}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  bottomSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 34 : 24,
    paddingHorizontal: 24,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: "#D1D1D6",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 20,
  },
  modalContent: {
    gap: 12,
  },
  optionButton: {
    paddingVertical: 18,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
  },
  messageButton: {
    backgroundColor: "#000000",
  },
  editButton: {
    backgroundColor: "#007AFF",
  },
  shareButton: {
    backgroundColor: "#34C759",
  },
  archiveButton: {
    backgroundColor: "#FF9500",
  },
  leaveButton: {
    backgroundColor: "#FF3B30",
  },
  cancelButton: {
    backgroundColor: "#E0E0E0",
  },
  messageButtonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "600",
  },
  editButtonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "600",
  },
  shareButtonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "600",
  },
  archiveButtonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "600",
  },
  leaveButtonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "600",
  },
  cancelButtonText: {
    color: "#000000",
    fontSize: 18,
    fontWeight: "600",
  },
  infoSection: {
    backgroundColor: "#F5F5F5",
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  infoText: {
    color: "#666666",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
});
