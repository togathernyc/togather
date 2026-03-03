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
  const scheme = getGroupTypeColorScheme(groupTypeId);
  const badgeColors = { bg: scheme.bg, text: scheme.color };
  const isDesktopWeb = useIsDesktopWeb();

  return (
    <View style={styles.header}>
      {!isDesktopWeb && (
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color="#000" />
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
        <Text style={styles.groupName} numberOfLines={1}>
          {displayName}
        </Text>
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
        <Ionicons name="ellipsis-vertical" size={20} color="#333" />
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
  return (
    <View style={[styles.headerPlaceholder, { paddingTop: topInset }]}>
      <TouchableOpacity onPress={onBack} style={styles.backButton}>
        <Ionicons name="chevron-back" size={28} color="#000" />
      </TouchableOpacity>
      <Text style={styles.groupName}>{displayName}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    backgroundColor: "#fff",
  },
  headerPlaceholder: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    backgroundColor: "#fff",
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
    color: "#000",
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
