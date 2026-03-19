import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import type { ThemePreference } from "@providers/ThemeProvider";

const OPTIONS: { value: ThemePreference; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "auto", label: "Auto", icon: "phone-portrait-outline" },
  { value: "light", label: "Light", icon: "sunny-outline" },
  { value: "dark", label: "Dark", icon: "moon-outline" },
];

export function AppearanceSection() {
  const { colors, preference, setPreference } = useTheme();

  return (
    <View style={[styles.section, { backgroundColor: colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Appearance
      </Text>
      <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
        Choose how Togather looks. Auto follows your device setting.
      </Text>

      <View style={styles.optionsRow}>
        {OPTIONS.map((option) => {
          const isSelected = preference === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.option,
                { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                isSelected && { borderColor: colors.buttonPrimary, backgroundColor: colors.selectedBackground },
              ]}
              onPress={() => setPreference(option.value)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={option.icon}
                size={24}
                color={isSelected ? colors.buttonPrimary : colors.textSecondary}
              />
              <Text
                style={[
                  styles.optionLabel,
                  { color: isSelected ? colors.buttonPrimary : colors.text },
                  isSelected && styles.optionLabelSelected,
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 12,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
  },
  sectionDescription: {
    fontSize: 14,
    marginBottom: 16,
  },
  optionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  option: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 2,
    gap: 8,
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  optionLabelSelected: {
    fontWeight: "700",
  },
});
