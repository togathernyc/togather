import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";

interface GuestCounterProps {
  count: number;
  onIncrement: () => void;
  onDecrement: () => void;
  label?: string;
}

export function GuestCounter({
  count,
  onIncrement,
  onDecrement,
  label = "Guests",
}: GuestCounterProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <View style={styles.counterContainer}>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }, count === 0 && styles.buttonDisabled]}
          onPress={onDecrement}
          disabled={count === 0}
        >
          <Ionicons
            name="remove"
            size={20}
            color={count === 0 ? colors.iconSecondary : colors.text}
          />
        </TouchableOpacity>
        <Text style={[styles.count, { color: colors.text }]}>{count}</Text>
        <TouchableOpacity style={[styles.button, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]} onPress={onIncrement}>
          <Ionicons name="add" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: "500",
  },
  counterContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  count: {
    fontSize: 18,
    fontWeight: "600",
    minWidth: 30,
    textAlign: "center",
  },
});

