/**
 * GroupActionsCard
 *
 * Bottom-of-screen "GROUP ACTIONS" card for the group detail page. Absorbs the
 * actions that previously lived in the 3-dot `GroupOptionsModal` — Pin
 * Channels, Toolbar Settings, Share Group, Edit Group, Archive Group, Leave
 * Group — and presents them as a clean grouped list matching the DM
 * chat-info aesthetic (one row per action, internal dividers, chevrons for
 * navigations, no chevron on destructive Leave).
 *
 * Role-gating mirrors `GroupOptionsModal`:
 *   - Share Group: anyone (renders only if the group has a shortId)
 *   - Pin Channels / Toolbar Settings: leaders + admins
 *   - Edit Group: group leaders + community admins (canEditGroup)
 *   - Archive Group: community admins, hidden on announcement groups
 *   - Leave Group: members (hidden on announcement groups; their leave path
 *     is "leave the community", surfaced separately)
 *
 * The legacy `GroupOptionsModal` stays mounted for now so the bottom-sheet
 * code path isn't broken — phase 2 retires it cleanly.
 */
import React, { useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  Share,
  Platform,
  ActionSheetIOS,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { DOMAIN_CONFIG } from "@togather/shared";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import type { Group } from "../types";

interface GroupActionsCardProps {
  group: Group;
  /** Whether the current user is a member (controls Leave Group visibility). */
  isMember: boolean;
  /** Whether the current user is a leader/admin (controls Pin/Toolbar). */
  isLeader: boolean;
  /** Existing handler from `GroupDetailScreen`. */
  onLeavePress: () => void;
  /** Existing handler from `GroupDetailScreen`. */
  onArchivePress: () => void;
}

type ActionRow = {
  key: string;
  label: string;
  icon: keyof typeof import("@expo/vector-icons/build/Ionicons").default.glyphMap;
  onPress: () => void;
  destructive?: boolean;
};

export function GroupActionsCard({
  group,
  isMember,
  isLeader,
  onLeavePress,
  onArchivePress,
}: GroupActionsCardProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();

  const isCommunityAdmin = user?.is_admin === true;

  // Mirrors `GroupOptionsModal.canEditGroup`: leaders of the group OR
  // community admins can edit. Leader detection compares stringified IDs to
  // tolerate Convex-id vs legacy-numeric drift.
  const canEditGroup = useMemo(() => {
    if (!group || !user?.id) return false;
    if (isCommunityAdmin) return true;
    return (
      group.leaders?.some(
        (leader) => String(leader.id) === String(user.id),
      ) || false
    );
  }, [group, user?.id, isCommunityAdmin]);

  const canArchive = isCommunityAdmin && !group.is_announcement_group;

  const handlePinChannels = useCallback(() => {
    if (!group._id) return;
    router.push(`/(user)/leader-tools/${group._id}/pin-channels`);
  }, [router, group._id]);

  const handleToolbarSettings = useCallback(() => {
    if (!group._id) return;
    router.push(`/(user)/leader-tools/${group._id}/toolbar-settings`);
  }, [router, group._id]);

  const handleEditGroup = useCallback(() => {
    if (!group._id) return;
    router.push(`/groups/${group._id}/edit`);
  }, [router, group._id]);

  // Share handler — copy of `GroupOptionsModal.handleShareGroup` so removing
  // the modal in phase 2 doesn't strand this entry point.
  const handleShareGroup = useCallback(async () => {
    if (!group.shortId) {
      Alert.alert(
        "Cannot Share",
        "This group doesn't have a shareable link yet.",
      );
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
            Alert.alert(
              "Link Copied",
              "Group link has been copied to clipboard.",
            );
          } else if (buttonIndex === 2) {
            await Share.share({
              message: `${groupName}\n${groupUrl}`,
              url: groupUrl,
            });
          }
        },
      );
    } else {
      await Share.share({
        message: `${groupName}\n${groupUrl}`,
      });
    }
  }, [group]);

  const rows: ActionRow[] = [];
  if (isLeader) {
    rows.push({
      key: "pin-channels",
      label: "Pin Channels",
      icon: "pin-outline",
      onPress: handlePinChannels,
    });
    rows.push({
      key: "toolbar-settings",
      label: "Toolbar Settings",
      icon: "options-outline",
      onPress: handleToolbarSettings,
    });
  }
  if (group.shortId) {
    rows.push({
      key: "share",
      label: "Share Group",
      icon: "share-outline",
      onPress: handleShareGroup,
    });
  }
  if (canEditGroup) {
    rows.push({
      key: "edit",
      label: "Edit Group",
      icon: "create-outline",
      onPress: handleEditGroup,
    });
  }
  if (canArchive) {
    rows.push({
      key: "archive",
      label: "Archive Group",
      icon: "archive-outline",
      onPress: onArchivePress,
    });
  }
  if (isMember && !group.is_announcement_group) {
    rows.push({
      key: "leave",
      label: "Leave Group",
      icon: "exit-outline",
      onPress: onLeavePress,
      destructive: true,
    });
  }

  if (rows.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
        GROUP ACTIONS
      </Text>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        {rows.map((row, idx) => (
          <Pressable
            key={row.key}
            onPress={row.onPress}
            style={({ pressed }) => [
              styles.row,
              idx > 0 && {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: colors.border,
              },
              pressed && { backgroundColor: colors.selectedBackground },
            ]}
          >
            <Ionicons
              name={row.icon}
              size={20}
              color={row.destructive ? colors.destructive : colors.icon}
            />
            <Text
              style={[
                styles.rowLabel,
                {
                  color: row.destructive ? colors.destructive : colors.text,
                },
              ]}
            >
              {row.label}
            </Text>
            {!row.destructive ? (
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textTertiary}
              />
            ) : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingTop: 8,
    paddingBottom: 24,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  card: {
    marginHorizontal: 12,
    borderRadius: 12,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
  },
});
