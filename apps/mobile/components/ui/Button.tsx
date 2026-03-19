import React from "react";
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useTheme } from "@hooks/useTheme";

interface ButtonProps {
  onPress: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  loading?: boolean;
  style?: any;
  textStyle?: any;
}

export function Button({
  onPress,
  children,
  disabled = false,
  variant = "primary",
  loading = false,
  style,
  textStyle,
}: ButtonProps) {
  const { colors } = useTheme();
  const isDisabled = disabled || loading;

  const variantStyles = {
    primary: { backgroundColor: colors.buttonPrimary },
    secondary: { backgroundColor: colors.buttonSecondary },
    danger: { backgroundColor: colors.destructive },
  };

  const variantTextStyles = {
    primary: { color: colors.textInverse },
    secondary: { color: colors.text },
    danger: { color: colors.textInverse },
  };

  return (
    <TouchableOpacity
      style={[
        styles.button,
        variant === "secondary" && styles.secondary,
        variantStyles[variant],
        isDisabled && [styles.disabled, { backgroundColor: colors.buttonDisabled }],
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === "primary" ? colors.textInverse : colors.text}
          size="small"
        />
      ) : (
        <Text style={[styles.text, variantTextStyles[variant], textStyle]}>
          {children}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 18,
    paddingHorizontal: 24,
    borderRadius: 100,
    minHeight: 56,
    justifyContent: "center",
    alignItems: "center",
    ...Platform.select({
      web: {
        boxShadow: "0px 6px 12px rgba(0, 0, 0, 0.12)",
        cursor: "pointer",
      },
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 6,
        elevation: 3,
      },
    }),
  },
  secondary: {
    ...Platform.select({
      web: {
        boxShadow: "0px 9px 14px -7px rgba(0, 0, 0, 0.35)",
      },
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 3,
      },
    }),
  },
  disabled: {
    ...(Platform.OS === "web" ? { cursor: "not-allowed" as any } : {}),
  },
  text: {
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 22,
  },
});
