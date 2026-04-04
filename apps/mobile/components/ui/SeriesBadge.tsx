import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";

interface SeriesBadgeProps {
  seriesName: string;
  seriesNumber?: number;
  seriesTotalCount?: number;
  size?: "small" | "medium";
}

export function SeriesBadge({
  seriesName,
  seriesNumber,
  seriesTotalCount,
  size = "small",
}: SeriesBadgeProps) {
  const { colors } = useTheme();

  const isSmall = size === "small";
  const iconSize = isSmall ? 12 : 14;
  const fontSize = isSmall ? 11 : 13;

  const numberText =
    seriesNumber && seriesTotalCount
      ? ` \u00b7 ${seriesNumber} of ${seriesTotalCount}`
      : "";

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
        isSmall ? styles.badgeSmall : styles.badgeMedium,
      ]}
    >
      <Ionicons
        name="layers-outline"
        size={iconSize}
        color={colors.textSecondary}
      />
      <Text
        style={[styles.text, { color: colors.textSecondary, fontSize }]}
        numberOfLines={1}
      >
        {seriesName}
        {numberText}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  badgeSmall: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeMedium: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  text: {
    fontWeight: "500",
  },
});
