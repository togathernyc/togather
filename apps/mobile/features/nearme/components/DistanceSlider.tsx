import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";

interface DistanceSliderProps {
  /** Current value in miles */
  value: number;
  /** Callback when value changes */
  onChange: (value: number) => void;
}

const DISTANCE_OPTIONS = [5, 10, 15, 25, 50];

/**
 * Distance selector component
 *
 * Shows preset distance options as selectable pills.
 * Displays "Within X miles" as header.
 */
export function DistanceSlider({ value, onChange }: DistanceSliderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>Distance</Text>
        <Text style={styles.value}>
          Within <Text style={styles.valueNumber}>{value}</Text> miles
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.optionsRow}>
          {DISTANCE_OPTIONS.map((miles) => (
            <TouchableOpacity
              key={miles}
              style={[styles.option, value === miles && styles.optionActive]}
              onPress={() => onChange(miles)}
            >
              <Text style={[styles.optionText, value === miles && styles.optionTextActive]}>
                {miles} mi
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  value: {
    fontSize: 14,
    color: "#666",
  },
  valueNumber: {
    fontWeight: "600",
    color: DEFAULT_PRIMARY_COLOR,
  },
  optionsRow: {
    flexDirection: "row",
    gap: 8,
  },
  option: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "#f0f0f0",
    borderWidth: 2,
    borderColor: "transparent",
  },
  optionActive: {
    backgroundColor: "#f8f4ff",
    borderColor: DEFAULT_PRIMARY_COLOR,
  },
  optionText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#666",
  },
  optionTextActive: {
    color: DEFAULT_PRIMARY_COLOR,
  },
});
