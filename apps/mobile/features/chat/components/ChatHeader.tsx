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
import { ThemedHeading } from "@components/ui/ThemedHeading";
import { useTheme } from "@hooks/useTheme";
import { getGroupTypeColorScheme } from "../../../constants/groupTypes";
import { useIsDesktopWeb } from "../../../hooks/useIsDesktopWeb";

type ChatHeaderProps = {
  displayName: string;
  displayType: string;
  displayImage: string;
  groupTypeId: number;
  onBack: () => void;
  onMenuPress: () => void;
  onGroupPagePress: () => void;
};

export const ChatHeader = memo(function ChatHeader({
  displayName,
  displayType,
  displayImage,
  groupTypeId,
  onBack,
  onMenuPress,
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
        <ThemedHeading level={3} style={[styles.groupName, { color: themeColors.text }]} numberOfLines={1}>
          {displayName}
        </ThemedHeading>
        {displayType && (
          <View style={[styles.headerBadge, { backgroundColor: badgeColors.bg }]}>
            <Text style={[styles.headerBadgeText, { color: badgeColors.text }]}>
              {displayType}
            </Text>
          </View>
        )}
      </View>

      {/* Menu Button */}
      <TouchableOpacity onPress={onMenuPress} style={styles.menuButton}>
        <Ionicons name="ellipsis-vertical" size={20} color={themeColors.text} />
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
  headerBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 3,
  },
  headerBadgeText: {
    fontSize: 10,
    fontWeight: "600",
  },
  menuButton: {
    padding: 8,
  },
});
