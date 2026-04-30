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

interface NotificationSoftAskSheetProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * Pre-permission explainer shown before the iOS one-shot OS prompt. The OS
 * prompt is a single-use resource on iOS — once denied, recovery requires a
 * trip to Settings. This sheet lets reflexive deniers back out via "Not now"
 * without burning the prompt, and primes confirmers with the value prop +
 * mute-anytime escape hatch.
 */
export function NotificationSoftAskSheet({
  visible,
  onClose,
  onConfirm,
}: NotificationSoftAskSheetProps) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isWide = width >= 600;

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
            <Ionicons name="notifications" size={32} color={primaryColor} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>
            Stay in the loop with your community
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Turn on notifications to hear from your groups and never miss a
            message. You can mute individual groups or channels in Settings
            anytime.
          </Text>

          <Pressable
            accessibilityRole="button"
            onPress={onConfirm}
            style={[styles.primaryButton, { backgroundColor: primaryColor }]}
          >
            <Text style={styles.primaryButtonText}>Turn on notifications</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={styles.secondaryButton}
            hitSlop={8}
          >
            <Text style={[styles.secondaryButtonText, { color: colors.textSecondary }]}>
              Not now
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
