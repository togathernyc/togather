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
  /**
   * Whether this is a DM/group_dm thread. DM replies notify by default
   * (mentions are meaningless in a 1:1), so the bell only distinguishes
   * "all replies" from "muted" rather than the group three-state cycle.
   */
  isDm?: boolean;
}

/** Icon, label, and active styling for the bell given the state and channel kind. */
function bellDisplay(
  state: ThreadNotificationState,
  isDm: boolean,
): { icon: keyof typeof Ionicons.glyphMap; label: string; active: boolean } {
  if (state === "none") {
    return {
      icon: "notifications-off-outline",
      label: "Notifications: muted",
      active: false,
    };
  }
  // In DMs both "default" and "all" mean every reply notifies.
  if (isDm || state === "all") {
    return {
      icon: "notifications",
      label: "Notifications: all replies",
      active: true,
    };
  }
  return {
    icon: "notifications-outline",
    label: "Notifications: only when mentioned",
    active: false,
  };
}

export const ThreadHeader = memo(function ThreadHeader({
  channelName,
  onBack,
  notificationState,
  onToggleNotifications,
  isDm = false,
}: ThreadHeaderProps) {
  const { colors } = useTheme();

  const showBell = !!notificationState && !!onToggleNotifications;
  const display = notificationState
    ? bellDisplay(notificationState, isDm)
    : null;

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

      {showBell && display && (
        <TouchableOpacity
          onPress={onToggleNotifications}
          style={styles.bellButton}
          accessibilityRole="button"
          accessibilityLabel={display.label}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name={display.icon}
            size={22}
            color={display.active ? colors.link : colors.text}
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
