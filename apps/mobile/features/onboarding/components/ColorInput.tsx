/**
 * Hex color field with a native color picker on web, monospace hex input, and
 * a live swatch. Shared by the community setup and demo questionnaire forms.
 */
import { useState, useEffect } from "react";
import { View, Text, TextInput, StyleSheet, Platform } from "react-native";
import { useTheme } from "@hooks/useTheme";

/** Validate a hex color string (#RRGGBB). */
export function isValidHex(hex: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(hex);
}

export function ColorInput({
  label,
  value,
  onChange,
  colors,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const [textValue, setTextValue] = useState(value);
  const valid = isValidHex(textValue);

  useEffect(() => {
    setTextValue(value);
  }, [value]);

  function handleTextChange(newValue: string) {
    let normalized = newValue;
    if (normalized && !normalized.startsWith("#")) {
      normalized = "#" + normalized;
    }
    setTextValue(normalized);
    if (isValidHex(normalized)) {
      onChange(normalized);
    }
  }

  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <View style={styles.colorRow}>
        {/* Native color picker on web */}
        {Platform.OS === "web" && (
          <View style={styles.colorPickerWrapper}>
            <input
              type="color"
              value={valid ? textValue : "#000000"}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onChange={(e: any) => {
                const hex = (e.target as HTMLInputElement).value.toUpperCase();
                setTextValue(hex);
                onChange(hex);
              }}
              style={{
                width: 40,
                height: 40,
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                padding: 2,
                backgroundColor: "transparent",
              }}
            />
          </View>
        )}
        <TextInput
          style={[
            styles.input,
            styles.colorTextInput,
            {
              backgroundColor: colors.inputBackground,
              borderColor:
                textValue && !valid ? colors.error : colors.inputBorder,
              color: colors.text,
              fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
            },
          ]}
          value={textValue}
          onChangeText={handleTextChange}
          placeholder="#3B82F6"
          placeholderTextColor={colors.inputPlaceholder}
          maxLength={7}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {valid && (
          <View
            style={[styles.colorSwatch, { backgroundColor: textValue }]}
          />
        )}
      </View>
      {textValue && !valid && (
        <Text style={[styles.fieldHint, { color: colors.error }]}>
          Enter a valid hex color (e.g. #3B82F6)
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fieldGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  fieldHint: {
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  colorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  colorPickerWrapper: {
    width: 40,
    height: 40,
    borderRadius: 8,
    overflow: "hidden",
  },
  colorTextInput: {
    flex: 1,
  },
  colorSwatch: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
});
