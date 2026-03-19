import React from "react";
import { View, StyleSheet } from "react-native";
import { useTheme } from "@hooks/useTheme";

export function DragHandle() {
  const { colors } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <View style={[styles.indicator, { backgroundColor: colors.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 12,
  },
  indicator: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
});
