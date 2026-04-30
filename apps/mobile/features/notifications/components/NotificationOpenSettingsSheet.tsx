import React from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";

interface NotificationOpenSettingsSheetProps {
  visible: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

/**
 * Coaching sheet for the OS-denied-permanent state. iOS only allows
 * `requestPermissionsAsync()` once per install — after a denial, the OS
 * silently no-ops every subsequent ask. The only way back is for the user to
 * flip the app's permission in iOS Settings. Dropping users into Settings
 * cold has a measurable abandon rate, so this sheet primes them with what to
 * look for before the hand-off.
 *
 * Reused by:
 *  - The inbox `EnableNotificationsBanner` CTA when status is denied-permanent
 *  - The Settings master toggle when the user flips it on with OS perms off
 */
export function NotificationOpenSettingsSheet({
  visible,
  onClose,
  onOpenSettings,
}: NotificationOpenSettingsSheetProps) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isWide = width >= 600;

  // Platform-specific coaching:
  //  - iOS: `Linking.openSettings()` lands on the app's settings page; user
  //    taps Notifications row, then Allow Notifications.
  //  - Android: `expo-intent-launcher` deep-links directly to the per-app
  //    notification settings page; user just flips the switch.
  const instructionLine =
    Platform.OS === "ios"
      ? "We'll open Settings — tap Notifications, then turn on Allow Notifications."
      : "We'll take you to notification settings — turn on Allow Notifications.";

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              paddingBottom: Math.max(insets.bottom + 16, 24),
              maxWidth: isWide ? 480 : undefined,
              alignSelf: isWide ? "center" : "stretch",
              marginHorizontal: isWide ? 24 : 0,
              marginBottom: isWide ? 24 : 0,
              borderBottomLeftRadius: isWide ? 20 : 0,
              borderBottomRightRadius: isWide ? 20 : 0,
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.grabber} />

          <View
            style={[
              styles.iconCircle,
              { backgroundColor: primaryColor + "1A" },
            ]}
          >
            <Ionicons name="settings-outline" size={30} color={primaryColor} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>
            Notifications are off
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {instructionLine} You can mute individual groups or channels in
            Togather Settings anytime.
          </Text>

          <Pressable
            accessibilityRole="button"
            onPress={onOpenSettings}
            style={[styles.primaryButton, { backgroundColor: primaryColor }]}
          >
            <Text style={styles.primaryButtonText}>Open Settings</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={styles.secondaryButton}
            hitSlop={8}
          >
            <Text style={[styles.secondaryButtonText, { color: colors.textSecondary }]}>
              Cancel
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    alignItems: "center",
    ...Platform.select({
      web: {
        boxShadow: "0px -4px 20px rgba(0,0,0,0.15)",
      },
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
        elevation: 12,
      },
    }),
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(0,0,0,0.15)",
    marginBottom: 16,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
    marginBottom: 24,
  },
  primaryButton: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 8,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "500",
  },
});
