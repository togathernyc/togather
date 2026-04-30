/**
 * GroupHeader (sleek, DM-style hero)
 *
 * Centered presentation on white:
 *   - back chevron top-left
 *   - share icon top-right (no info icon — you're already on the info)
 *   - circular group avatar (~120px), tappable to view full-size
 *   - centered group name with optional pencil-edit icon for leaders/admins
 *   - centered cadence subtitle
 *   - optional centered description (rendered when non-empty)
 *
 * Match-list with `apps/mobile/features/chat/components/ChatInfoScreen.tsx`
 * to keep DM/info parity. The full-bleed grey hero with a left-aligned
 * title was retired in favour of this layout.
 */
import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Group } from "../types";
import { formatCadence } from "../utils";
import { Avatar } from "@components/ui";
import { useTheme } from "@hooks/useTheme";
import { ImageViewerManager } from "@/providers/ImageViewerProvider";

interface GroupHeaderProps {
  group: Group;
  /** Tap handler for the share icon. Hidden when not provided. */
  onSharePress?: () => void;
  /** When true, the user can edit this group; renders a pencil next to the title. */
  canEdit?: boolean;
}

export function GroupHeader({
  group,
  onSharePress,
  canEdit = false,
}: GroupHeaderProps) {
  const router = useRouter();
  const { colors } = useTheme();
  // The screen this header sits on hides the native nav header
  // (root `_layout.tsx` sets `headerShown: false`), so the back chevron is
  // ours and has to clear the device safe area itself. Reading insets
  // here keeps any consumer of `GroupHeader` (member view + non-member
  // view) safe-area-correct without each one remembering to wrap the
  // surrounding scroll view.
  const insets = useSafeAreaInsets();
  const previewUrl = group.preview || group.image_url || null;
  const groupName = group?.title || group?.name || "Group";
  const cadence = formatCadence(group);
  const description = group.description?.trim() || "";
  const hasDescription = description.length > 0;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/groups");
    }
  };

  const handleEdit = () => {
    if (!group?._id) return;
    router.push(`/groups/${group._id}/edit`);
  };

  const handleAvatarPress = () => {
    if (!previewUrl) return;
    ImageViewerManager.show([previewUrl], 0);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={handleBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.spacer} />
        {!!onSharePress && (
          <TouchableOpacity
            style={styles.iconButton}
            onPress={onSharePress}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Share group"
          >
            <Ionicons
              name="share-outline"
              size={24}
              color={colors.text}
            />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.heroContent}>
        <Pressable
          onPress={handleAvatarPress}
          disabled={!previewUrl}
          style={({ pressed }) => [pressed && previewUrl && { opacity: 0.85 }]}
          accessibilityRole={previewUrl ? "button" : undefined}
          accessibilityLabel={previewUrl ? "View group photo" : undefined}
        >
          <Avatar name={groupName} imageUrl={previewUrl} size={120} />
        </Pressable>
        <Pressable
          onPress={canEdit ? handleEdit : undefined}
          disabled={!canEdit}
          style={({ pressed }) => [
            styles.titleRow,
            pressed && canEdit && { opacity: 0.7 },
          ]}
        >
          <Text style={[styles.groupName, { color: colors.text }]} numberOfLines={2}>
            {groupName}
          </Text>
          {canEdit && (
            <Ionicons
              name="pencil"
              size={16}
              color={colors.textSecondary}
              style={styles.pencilIcon}
            />
          )}
        </Pressable>
        {cadence ? (
          <Text style={[styles.cadence, { color: colors.textSecondary }]} numberOfLines={1}>
            {cadence}
          </Text>
        ) : null}
        {hasDescription ? (
          <Text
            style={[styles.description, { color: colors.textSecondary }]}
            numberOfLines={3}
          >
            {description}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    paddingBottom: 24,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  iconButton: {
    // ≥44pt tap target so back/share clear the iOS HIG minimum.
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  spacer: {
    flex: 1,
  },
  heroContent: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  titleRow: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  groupName: {
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
  },
  pencilIcon: {
    marginTop: 4,
  },
  cadence: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
  },
  description: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
});
