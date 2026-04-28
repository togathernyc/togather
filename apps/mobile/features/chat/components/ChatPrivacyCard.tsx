/**
 * Chat Privacy Card
 *
 * Subtle one-time notice rendered above the message list in ad-hoc DM
 * channels. Sets expectations that messages aren't end-to-end encrypted
 * and community admins can request access. Non-dismissible — appears
 * once at the top of the conversation, not on every render.
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";

export function ChatPrivacyCard() {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surfaceSecondary,
          borderColor: colors.border,
        },
      ]}
      accessibilityRole="text"
    >
      <Ionicons
        name="lock-closed-outline"
        size={14}
        color={colors.textSecondary}
        style={styles.icon}
      />
      <Text style={[styles.text, { color: colors.textSecondary }]}>
        Messages stay between people in this chat. They&apos;re not
        end-to-end encrypted, and community admins can request access. Treat
        this like a public conversation.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  icon: {
    marginTop: 1,
  },
  text: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
});
