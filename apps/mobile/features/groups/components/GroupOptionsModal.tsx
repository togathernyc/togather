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
import { useTheme } from "@hooks/useTheme";
import { AdminViewNote } from "@components/ui/AdminViewNote";
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
  /** When false, hides Leave Group (e.g. for non-members viewing the group) */
  isMember?: boolean;
}

export function GroupOptionsModal({
  visible,
  group,
  onClose,
  onLeaveGroup,
  onArchiveGroup,
  isLeaving = false,
  isArchiving = false,
  isMember = true,
}: GroupOptionsModalProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();
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
  const isCommunityAdmin = user?.is_admin === true;
  const isGroupLeader = useMemo(() => {
    if (!group || !user?.id) return false;
    // Compare as strings since user.id is a Convex ID string.
    return (
      group.leaders?.some(
        (leader) => String(leader.id) === String(user.id),
      ) || false
    );
  }, [group, user?.id]);
  const canEditGroup = isCommunityAdmin || isGroupLeader;
  // True when the viewer can edit only because they're a community admin
  // (not because they lead the group). Used to surface the asymmetric
  // affordance to the user.
  const isEditingAsAdminOnly = canEditGroup && isCommunityAdmin && !isGroupLeader;

  // Only community admins can archive groups (matches backend gate in
  // `groups/mutations.update` — leaders are blocked by the API).
  const canArchiveGroup = isCommunityAdmin;

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
          <Animated.View style={[styles.backdrop, { opacity: fadeAnim, backgroundColor: colors.overlay }]} />
        </TouchableWithoutFeedback>
        <Animated.View
          style={[
            styles.bottomSheet,
            { backgroundColor: colors.modalBackground },
            {
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.iconSecondary }]} />
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
              <>
                <TouchableOpacity
                  style={[styles.optionButton, styles.editButton]}
                  onPress={handleEditGroup}
                  disabled={isLeaving || isArchiving}
                >
                  <Text style={styles.editButtonText}>Edit Group</Text>
                </TouchableOpacity>
                {isEditingAsAdminOnly && (
                  <View style={styles.disclaimerWrap}>
                    <AdminViewNote text="Editing this group as a community admin." />
                  </View>
                )}
              </>
            )}

            {canArchiveGroup && !group?.is_announcement_group && (
              <>
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
                <View style={styles.disclaimerWrap}>
                  <AdminViewNote text="Archiving cascades to all channels and members. Community admins only." />
                </View>
              </>
            )}

            {group?.is_announcement_group ? (
              <View style={[styles.infoSection, { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                  This is your community's announcement channel. To leave, go to Settings and leave the community.
                </Text>
              </View>
            ) : isMember ? (
              <TouchableOpacity
                style={[styles.optionButton, styles.leaveButton]}
                onPress={handleLeaveGroup}
                disabled={isLeaving || isArchiving}
              >
                <Text style={styles.leaveButtonText}>Leave Group</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={[styles.optionButton, styles.cancelButton, { backgroundColor: colors.border }]}
              onPress={onClose}
              disabled={isLeaving}
            >
              <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
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
  },
  bottomSheet: {
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
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 20,
  },
  modalContent: {
    gap: 12,
  },
  disclaimerWrap: {
    // Pulls the disclaimer up against the button it explains so the
    // pairing reads as one row, not two stacked items.
    marginTop: -4,
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
    // backgroundColor set dynamically via theme
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
    fontSize: 18,
    fontWeight: "600",
  },
  infoSection: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  infoText: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
});
