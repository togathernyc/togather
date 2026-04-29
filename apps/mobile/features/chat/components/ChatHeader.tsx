/**
 * Chat Room Header Component
 * Displays group image, name, type badge, and menu button.
 */
import React, { memo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppImage } from "@components/ui";
import { useTheme } from "@hooks/useTheme";
import { getGroupTypeColorScheme } from "../../../constants/groupTypes";
import { useIsDesktopWeb } from "../../../hooks/useIsDesktopWeb";

type ChatHeaderProps = {
  displayName: string;
  displayType: string;
  displayImage: string;
  groupTypeId: number;
  /** Member count rendered next to the group-type badge. */
  memberCount?: number;
  onBack: () => void;
  /**
   * Tap handler for the (i) info icon in the top-right. For General chats
   * this should route to the group page; for non-General channels it
   * should route to the per-channel info screen.
   */
  onInfoPress: () => void;
  /** Tap handler for the entire identity block (avatar + name + meta). */
  onGroupPagePress: () => void;
};

export const ChatHeader = memo(function ChatHeader({
  displayName,
  displayType,
  displayImage,
  groupTypeId,
  memberCount,
  onBack,
  onInfoPress,
  onGroupPagePress,
}: ChatHeaderProps) {
  const { colors: themeColors } = useTheme();
  const scheme = getGroupTypeColorScheme(groupTypeId);
  const badgeColors = { bg: scheme.bg, text: scheme.color };
  const isDesktopWeb = useIsDesktopWeb();

  return (
    <View style={[styles.header, { backgroundColor: themeColors.surface }]}>
      {!isDesktopWeb && (
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color={themeColors.text} />
        </TouchableOpacity>
      )}

      {/* Whole identity block — avatar + name + badge + member count — is
          one tap target that routes to the group page. Mirrors the DM
          chat-header pattern where tapping anywhere in the title row goes
          to the chat info. The dedicated `onMembersPress` link is gone;
          members are reachable from the group page. */}
      <TouchableOpacity
        onPress={onGroupPagePress}
        style={styles.identityBlock}
        accessibilityRole="button"
        accessibilityLabel={`${displayName} — open group page`}
      >
        <AppImage
          source={displayImage}
          style={styles.groupImage}
          optimizedWidth={100}
          placeholder={{
            type: 'initials',
            name: displayName,
            backgroundColor: '#E5E5E5',
          }}
        />
        <View style={styles.headerInfo}>
          <Text style={[styles.groupName, { color: themeColors.text }]} numberOfLines={1}>
            {displayName}
          </Text>
          <View style={styles.headerMetaRow}>
            {!!displayType && (
              <View style={[styles.headerBadge, { backgroundColor: badgeColors.bg }]}>
                <Text style={[styles.headerBadgeText, { color: badgeColors.text }]}>
                  {displayType}
                </Text>
              </View>
            )}
            {typeof memberCount === "number" && memberCount > 0 && (
              <Text
                style={[styles.memberCountText, { color: themeColors.textSecondary }]}
              >
                {memberCount} {memberCount === 1 ? "member" : "members"}
              </Text>
            )}
          </View>
        </View>
      </TouchableOpacity>

      {/* Info Button — replaces the legacy 3-dot menu. Routes via the
          parent's onInfoPress to either the group page (General) or the
          per-channel info screen. */}
      <TouchableOpacity onPress={onInfoPress} style={styles.menuButton} accessibilityLabel="Channel info">
        <Ionicons name="information-circle-outline" size={26} color={themeColors.text} />
      </TouchableOpacity>
    </View>
  );
});

// Simplified header for loading/error states
type ChatHeaderPlaceholderProps = {
  displayName: string;
  onBack: () => void;
  topInset: number;
};

export const ChatHeaderPlaceholder = memo(function ChatHeaderPlaceholder({
  displayName,
  onBack,
  topInset,
}: ChatHeaderPlaceholderProps) {
  const { colors: themeColors } = useTheme();
  return (
    <View style={[styles.headerPlaceholder, { paddingTop: topInset, backgroundColor: themeColors.surface }]}>
      <TouchableOpacity onPress={onBack} style={styles.backButton}>
        <Ionicons name="chevron-back" size={28} color={themeColors.text} />
      </TouchableOpacity>
      <Text style={[styles.groupName, { color: themeColors.text }]}>{displayName}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  headerPlaceholder: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  backButton: {
    padding: 4,
    marginRight: 4,
  },
  identityBlock: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  groupImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
  },
  headerInfo: {
    flex: 1,
  },
  groupName: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 2,
  },
  headerMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  headerBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 3,
  },
  headerBadgeText: {
    fontSize: 10,
    fontWeight: "600",
  },
  memberCountText: {
    fontSize: 12,
    fontWeight: "500",
  },
  menuButton: {
    padding: 8,
  },
});
