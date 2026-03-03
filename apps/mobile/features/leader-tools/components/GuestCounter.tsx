import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

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
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.counterContainer}>
        <TouchableOpacity
          style={[styles.button, count === 0 && styles.buttonDisabled]}
          onPress={onDecrement}
          disabled={count === 0}
        >
          <Ionicons
            name="remove"
            size={20}
            color={count === 0 ? "#ccc" : "#333"}
          />
        </TouchableOpacity>
        <Text style={styles.count}>{count}</Text>
        <TouchableOpacity style={styles.button} onPress={onIncrement}>
          <Ionicons name="add" size={20} color="#333" />
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
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  label: {
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
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
    backgroundColor: "#f5f5f5",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  count: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    minWidth: 30,
    textAlign: "center",
  },
});

