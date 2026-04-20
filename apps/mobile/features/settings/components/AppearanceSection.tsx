import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import type { ThemePreference } from "@providers/ThemeProvider";
import {
  hearthColors,
  consoleColors,
  conservatoryColors,
} from "@/theme/colors";

type SystemOption = {
  value: Extract<ThemePreference, "auto" | "light" | "dark">;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

type DesignOption = {
  value: Extract<ThemePreference, "hearth" | "console" | "conservatory">;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  swatch: string;
};

const SYSTEM_OPTIONS: SystemOption[] = [
  { value: "auto", label: "Auto", icon: "phone-portrait-outline" },
  { value: "light", label: "Light", icon: "sunny-outline" },
  { value: "dark", label: "Dark", icon: "moon-outline" },
];

const DESIGN_OPTIONS: DesignOption[] = [
  { value: "hearth", label: "Hearth", icon: "flame-outline", swatch: hearthColors.link },
  { value: "console", label: "Console", icon: "terminal-outline", swatch: consoleColors.link },
  { value: "conservatory", label: "Conservatory", icon: "leaf-outline", swatch: conservatoryColors.link },
];

export function AppearanceSection() {
  const { colors, preference, setPreference } = useTheme();

  return (
    <View style={[styles.section, { backgroundColor: colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Appearance</Text>
      <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
        Choose how Togather looks. Auto follows your device setting; designs apply custom colors and fonts across the app.
      </Text>

      <Text style={[styles.groupLabel, { color: colors.textTertiary }]}>System</Text>
      <View style={styles.optionsRow}>
        {SYSTEM_OPTIONS.map((option) => {
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
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={option.label}
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

      <Text style={[styles.groupLabel, { color: colors.textTertiary, marginTop: 20 }]}>Designs</Text>
      <View style={styles.optionsRow}>
        {DESIGN_OPTIONS.map((option) => {
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
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={option.label}
            >
              <View style={styles.designIconRow}>
                <Ionicons
                  name={option.icon}
                  size={22}
                  color={isSelected ? colors.buttonPrimary : colors.textSecondary}
                />
                <View style={[styles.swatch, { backgroundColor: option.swatch }]} />
              </View>
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
  groupLabel: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 8,
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
  designIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
