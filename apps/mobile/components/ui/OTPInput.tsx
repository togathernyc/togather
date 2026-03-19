import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  Platform,
  Pressable,
} from "react-native";
import { useTheme } from "@hooks/useTheme";

interface OTPInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoFocus?: boolean;
}

export function OTPInput({
  length = 6,
  value,
  onChange,
  error,
  autoFocus = true,
}: OTPInputProps) {
  const { colors } = useTheme();
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(
    autoFocus ? 0 : null
  );

  // Convert value string to array of individual characters
  const digits = value.split("").slice(0, length);
  while (digits.length < length) {
    digits.push("");
  }

  useEffect(() => {
    if (autoFocus && inputRefs.current[0]) {
      inputRefs.current[0]?.focus();
    }
  }, [autoFocus]);

  const handleKeyPress = useCallback(
    (index: number, key: string) => {
      if (key === "Backspace") {
        if (digits[index]) {
          // Clear current digit
          const newValue = digits.map((d, i) => (i === index ? "" : d)).join("");
          onChange(newValue);
        } else if (index > 0) {
          // Move to previous input and clear it
          const newValue = digits
            .map((d, i) => (i === index - 1 ? "" : d))
            .join("");
          onChange(newValue);
          inputRefs.current[index - 1]?.focus();
        }
      }
    },
    [digits, onChange]
  );

  const handleChange = useCallback(
    (index: number, text: string) => {
      // Only allow digits
      const cleanedText = text.replace(/[^0-9]/g, "");

      // Handle paste (multiple digits at once)
      if (cleanedText.length > 1) {
        const pastedDigits = cleanedText.slice(0, length);
        onChange(pastedDigits);
        // Focus the appropriate input after paste
        const nextIndex = Math.min(pastedDigits.length, length - 1);
        inputRefs.current[nextIndex]?.focus();
        return;
      }

      const digit = cleanedText.slice(-1);

      if (digit) {
        const newDigits = [...digits];
        newDigits[index] = digit;
        const newValue = newDigits.join("");
        onChange(newValue);

        // Auto-advance to next input
        if (index < length - 1) {
          inputRefs.current[index + 1]?.focus();
        }
      }
    },
    [digits, length, onChange]
  );

  const handleFocus = useCallback((index: number) => {
    setFocusedIndex(index);
  }, []);

  const handleBlur = useCallback(() => {
    setFocusedIndex(null);
  }, []);

  const handleContainerPress = useCallback(() => {
    // Focus the first empty input or the last input
    const firstEmptyIndex = digits.findIndex((d) => !d);
    const indexToFocus = firstEmptyIndex === -1 ? length - 1 : firstEmptyIndex;
    inputRefs.current[indexToFocus]?.focus();
  }, [digits, length]);

  // Handle paste for web
  const handlePaste = useCallback(
    (e: any) => {
      if (Platform.OS === "web" && e.clipboardData) {
        const pastedData = e.clipboardData.getData("text");
        const digits = pastedData.replace(/[^0-9]/g, "").slice(0, length);
        if (digits) {
          onChange(digits);
          // Focus the appropriate input
          const nextIndex = Math.min(digits.length, length - 1);
          inputRefs.current[nextIndex]?.focus();
        }
        e.preventDefault();
      }
    },
    [length, onChange]
  );

  return (
    <View style={styles.container}>
      <Pressable style={styles.inputsContainer} onPress={handleContainerPress}>
        {digits.map((digit, index) => (
          <View
            key={index}
            style={[
              styles.inputBox,
              { borderColor: colors.border, backgroundColor: colors.inputBackground },
              focusedIndex === index && { borderColor: colors.text },
              error && { borderColor: colors.error },
              digit && { borderColor: colors.buttonPrimary, backgroundColor: colors.surfaceSecondary },
            ]}
          >
            <TextInput
              ref={(ref) => { inputRefs.current[index] = ref; }}
              style={[styles.input, { color: colors.text }]}
              value={digit}
              onChangeText={(text) => handleChange(index, text)}
              onKeyPress={({ nativeEvent }) =>
                handleKeyPress(index, nativeEvent.key)
              }
              onFocus={() => handleFocus(index)}
              onBlur={handleBlur}
              keyboardType="number-pad"
              selectTextOnFocus
              testID={`otp-input-${index}`}
              {...(Platform.OS === "web" && { onPaste: handlePaste })}
            />
          </View>
        ))}
      </Pressable>
      {error && <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
    alignItems: "center",
  },
  inputsContainer: {
    flexDirection: "row",
    gap: 8,
  },
  inputBox: {
    width: 48,
    height: 56,
    borderWidth: 2,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    ...Platform.select({
      web: {
        transition: "all 0.2s",
      },
    }),
  },
  input: {
    fontSize: 24,
    fontWeight: "600",
    textAlign: "center",
    width: "100%",
    height: "100%",
  },
  errorText: {
    fontSize: 12,
    marginTop: 8,
    textAlign: "center",
  },
});
