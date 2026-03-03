import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useCommunityTheme } from "@hooks/useCommunityTheme";

export type VisibilityLevel = "group" | "community" | "public";

interface VisibilitySelectorProps {
  value: VisibilityLevel;
  onChange: (value: VisibilityLevel) => void;
}

interface VisibilityOption {
  value: VisibilityLevel;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  description: string;
}

const VISIBILITY_OPTIONS: VisibilityOption[] = [
  {
    value: "group",
    label: "Group Only",
    icon: "people",
    description: "Only group members can see and RSVP",
  },
  {
    value: "community",
    label: "Community",
    icon: "business",
    description: "All community members can see and RSVP",
  },
  {
    value: "public",
    label: "Public",
    icon: "globe",
    description: "Anyone with the link can view (RSVP requires login)",
  },
];

export function VisibilitySelector({ value, onChange }: VisibilitySelectorProps) {
  const { primaryColor } = useCommunityTheme();

  return (
    <View style={styles.container}>
      {VISIBILITY_OPTIONS.map((option) => {
        const isSelected = value === option.value;
        return (
          <TouchableOpacity
            key={option.value}
            style={[styles.option, isSelected && { borderColor: primaryColor, backgroundColor: "#faf5ff" }]}
            onPress={() => onChange(option.value)}
            activeOpacity={0.7}
          >
            <View style={styles.optionHeader}>
              <View style={[styles.radio, isSelected && { borderColor: primaryColor }]}>
                {isSelected && <View style={[styles.radioInner, { backgroundColor: primaryColor }]} />}
              </View>
              <Ionicons
                name={option.icon}
                size={20}
                color={isSelected ? primaryColor : "#666"}
                style={styles.icon}
              />
              <Text style={[styles.label, isSelected && { color: primaryColor }]}>
                {option.label}
              </Text>
            </View>
            <Text style={styles.description}>{option.description}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  option: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 12,
    borderWidth: 2,
    borderColor: "#ecedf0",
  },
  optionSelected: {
    borderColor: DEFAULT_PRIMARY_COLOR,
    backgroundColor: "#faf5ff",
  },
  optionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#ccc",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  radioSelected: {
    borderColor: DEFAULT_PRIMARY_COLOR,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: DEFAULT_PRIMARY_COLOR,
  },
  icon: {
    marginRight: 8,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
  },
  labelSelected: {
    color: DEFAULT_PRIMARY_COLOR,
  },
  description: {
    fontSize: 13,
    color: "#666",
    marginLeft: 48,
  },
});
