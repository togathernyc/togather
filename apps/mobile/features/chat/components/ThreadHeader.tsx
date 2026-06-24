/**
 * ThreadHeader Component
 *
 * Header for thread page showing "Thread" title with channel name, back
 * navigation, and a bell toggle for per-thread notification control.
 */
import React, { memo } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";

/**
 * Per-thread notification preference:
 *   - "default": notify only when @mentioned (the app-wide default)
 *   - "all":     notify on every reply
 *   - "none":    never notify, even when @mentioned
 */
export type ThreadNotificationState = "default" | "all" | "none";

interface ThreadHeaderProps {
  channelName?: string;
  onBack: () => void;
  /**
   * Current notification preference for this thread. When provided (together
   * with `onToggleNotifications`), the bell control is rendered.
   */
  notificationState?: ThreadNotificationState;
  /** Advance the notification preference to its next state. */
  onToggleNotifications?: () => void;
}

const BELL_ICON: Record<
  ThreadNotificationState,
  keyof typeof Ionicons.glyphMap
> = {
  default: "notifications-outline",
  all: "notifications",
  none: "notifications-off-outline",
};

const BELL_LABEL: Record<ThreadNotificationState, string> = {
  default: "Notifications: only when mentioned",
  all: "Notifications: all replies",
  none: "Notifications: muted",
};

export const ThreadHeader = memo(function ThreadHeader({
  channelName,
  onBack,
  notificationState,
  onToggleNotifications,
}: ThreadHeaderProps) {
  const { colors } = useTheme();

  const showBell = !!notificationState && !!onToggleNotifications;

  return (
    <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <TouchableOpacity onPress={onBack} style={styles.backButton}>
        <Ionicons name="chevron-back" size={28} color={colors.text} />
      </TouchableOpacity>

      <View style={styles.headerInfo}>
        <Text style={[styles.title, { color: colors.text }]}>Thread</Text>
        {channelName && (
          <Text style={[styles.channelName, { color: colors.textSecondary }]}>#{channelName}</Text>
        )}
      </View>

      {showBell && (
        <TouchableOpacity
          onPress={onToggleNotifications}
          style={styles.bellButton}
          accessibilityRole="button"
          accessibilityLabel={BELL_LABEL[notificationState!]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name={BELL_ICON[notificationState!]}
            size={22}
            color={notificationState === "all" ? colors.link : colors.text}
          />
        </TouchableOpacity>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    padding: 4,
    marginRight: 8,
  },
  headerInfo: {
    flex: 1,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
  },
  channelName: {
    fontSize: 13,
    marginTop: 1,
  },
  bellButton: {
    padding: 8,
    marginLeft: 8,
  },
});
