/**
 * ColorPicker - A color picker with preset swatches and hex input
 */
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";

interface ColorPickerProps {
  label: string;
  value: string | null | undefined;
  onChange: (color: string) => void;
  defaultColor?: string;
}

// Preset color swatches organized by hue
const PRESET_COLORS = [
  // Greens
  "#1E8449", "#27AE60", "#2ECC71", "#16A085", "#1ABC9C",
  // Blues
  "#2980B9", "#3498DB", "#1A5276", "#2471A3", "#5DADE2",
  // Purples
  "#8E44AD", "#9B59B6", "#6C3483", "#7D3C98", "#AF7AC5",
  // Reds/Pinks
  "#C0392B", "#E74C3C", "#922B21", "#CB4335", "#EC7063",
  // Oranges/Yellows
  "#D35400", "#E67E22", "#F39C12", "#F1C40F", "#D68910",
  // Neutrals
  "#2C3E50", "#34495E", "#5D6D7E", "#7F8C8D", "#95A5A6",
];

export function ColorPicker({ label, value, onChange, defaultColor = "#1E8449" }: ColorPickerProps) {
  const { colors, isDark } = useTheme();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [hexInput, setHexInput] = useState(value || defaultColor);
  const [isValidHex, setIsValidHex] = useState(true);

  const currentColor = value || defaultColor;

  useEffect(() => {
    setHexInput(value || defaultColor);
  }, [value, defaultColor]);

  const validateHex = (hex: string): boolean => {
    return /^#[0-9A-Fa-f]{6}$/.test(hex);
  };

  const handleHexChange = (text: string) => {
    // Auto-add # if missing
    let formatted = text.startsWith("#") ? text : `#${text}`;
    formatted = formatted.toUpperCase();

    // Limit to 7 characters (#RRGGBB)
    if (formatted.length > 7) {
      formatted = formatted.slice(0, 7);
    }

    setHexInput(formatted);

    if (validateHex(formatted)) {
      setIsValidHex(true);
      onChange(formatted);
    } else {
      setIsValidHex(formatted.length < 7);
    }
  };

  const handlePresetSelect = (color: string) => {
    setHexInput(color);
    setIsValidHex(true);
    onChange(color);
  };

  const handleResetToDefault = () => {
    setHexInput(defaultColor);
    setIsValidHex(true);
    onChange(defaultColor);
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>

      <TouchableOpacity
        style={[styles.colorButton, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
        onPress={() => setIsModalVisible(true)}
      >
        <View style={[styles.colorSwatch, { backgroundColor: currentColor, borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]} />
        <Text style={[styles.colorValue, { color: colors.text }]}>{currentColor}</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
      </TouchableOpacity>

      <Modal
        visible={isModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setIsModalVisible(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{label}</Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setIsModalVisible(false)}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            {/* Current color preview */}
            <View style={styles.previewSection}>
              <View style={[styles.largePreview, { backgroundColor: currentColor, borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]} />
              <Text style={[styles.previewHex, { color: colors.text }]}>{currentColor}</Text>
            </View>

            {/* Hex input */}
            <View style={styles.hexInputSection}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Hex Color</Text>
              <TextInput
                style={[
                  styles.hexInput,
                  { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, color: colors.text },
                  !isValidHex && { borderColor: colors.error },
                ]}
                value={hexInput}
                onChangeText={handleHexChange}
                placeholder="#000000"
                placeholderTextColor={colors.inputPlaceholder}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={7}
              />
              {!isValidHex && (
                <Text style={[styles.errorText, { color: colors.error }]}>Enter a valid hex color (e.g. #1E8449)</Text>
              )}
            </View>

            {/* Preset swatches */}
            <View style={styles.swatchSection}>
              <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Preset Colors</Text>
              <View style={styles.swatchGrid}>
                {PRESET_COLORS.map((color) => (
                  <TouchableOpacity
                    key={color}
                    style={[
                      styles.swatchItem,
                      { backgroundColor: color },
                      currentColor === color && [styles.swatchSelected, { borderColor: colors.text }],
                    ]}
                    onPress={() => handlePresetSelect(color)}
                  >
                    {currentColor === color && (
                      <Ionicons name="checkmark" size={20} color="#fff" />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Reset to default */}
            <TouchableOpacity
              style={styles.resetButton}
              onPress={handleResetToDefault}
            >
              <Ionicons name="refresh" size={18} color={colors.link} />
              <Text style={[styles.resetButtonText, { color: colors.link }]}>Reset to Default ({defaultColor})</Text>
            </TouchableOpacity>
          </ScrollView>

          {/* Done button */}
          <View style={[styles.modalFooter, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.doneButton, { backgroundColor: colors.buttonPrimary }]}
              onPress={() => setIsModalVisible(false)}
            >
              <Text style={[styles.doneButtonText, { color: colors.buttonPrimaryText }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 8,
  },
  colorButton: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
  },
  colorSwatch: {
    width: 32,
    height: 32,
    borderRadius: 6,
    marginRight: 12,
    borderWidth: 1,
  },
  colorValue: {
    flex: 1,
    fontSize: 16,
    fontFamily: "monospace",
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  closeButton: {
    padding: 4,
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  previewSection: {
    alignItems: "center",
    marginBottom: 24,
  },
  largePreview: {
    width: 120,
    height: 120,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  previewHex: {
    fontSize: 18,
    fontWeight: "600",
    fontFamily: "monospace",
  },
  hexInputSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 12,
  },
  hexInput: {
    borderRadius: 8,
    padding: 14,
    fontSize: 18,
    borderWidth: 1,
    fontFamily: "monospace",
    textAlign: "center",
  },
  errorText: {
    fontSize: 12,
    marginTop: 6,
    textAlign: "center",
  },
  swatchSection: {
    marginBottom: 24,
  },
  swatchGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  swatchItem: {
    width: 48,
    height: 48,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  swatchSelected: {},
  resetButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    gap: 8,
  },
  resetButtonText: {
    fontSize: 14,
    fontWeight: "500",
  },
  modalFooter: {
    padding: 16,
    borderTopWidth: 1,
  },
  doneButton: {
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
