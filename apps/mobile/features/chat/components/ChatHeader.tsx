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
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { getGroupTypeColorScheme } from "../../../constants/groupTypes";
import { useIsDesktopWeb } from "../../../hooks/useIsDesktopWeb";

type ChatHeaderProps = {
  displayName: string;
  displayType: string;
  displayImage: string;
  groupTypeId: number;
  /** When provided, renders a tappable "N members" link under the group name. */
  memberCount?: number;
  onBack: () => void;
  onInfoPress: () => void;
  onGroupPagePress: () => void;
  onMembersPress?: () => void;
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
  onMembersPress,
}: ChatHeaderProps) {
  const { colors: themeColors } = useTheme();
  const { primaryColor } = useCommunityTheme();
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

      {/* Group Image - clickable to go to group page */}
      <TouchableOpacity onPress={onGroupPagePress}>
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
      </TouchableOpacity>

      {/* Group Info */}
      <View style={styles.headerInfo}>
        <Text style={[styles.groupName, { color: themeColors.text }]} numberOfLines={1}>
          {displayName}
        </Text>
        <View style={styles.headerMetaRow}>
          {displayType && (
            <View style={[styles.headerBadge, { backgroundColor: badgeColors.bg }]}>
              <Text style={[styles.headerBadgeText, { color: badgeColors.text }]}>
                {displayType}
              </Text>
            </View>
          )}
          {typeof memberCount === "number" && memberCount > 0 && (
            <TouchableOpacity
              onPress={onMembersPress}
              disabled={!onMembersPress}
              hitSlop={6}
              style={styles.memberCountButton}
            >
              <Text
                style={[styles.memberCountText, { color: primaryColor }]}
              >
                {memberCount} {memberCount === 1 ? "member" : "members"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Info Button — routes to channel info (or group page for General) */}
      <TouchableOpacity
        onPress={onInfoPress}
        style={styles.menuButton}
        accessibilityRole="button"
        accessibilityLabel="Channel info"
      >
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
  memberCountButton: {
    // Hit-target is tight to the text. Tappability signalled by brand color.
  },
  memberCountText: {
    fontSize: 12,
    fontWeight: "600",
  },
  menuButton: {
    padding: 8,
  },
});
