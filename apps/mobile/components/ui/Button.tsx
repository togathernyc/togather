import React from "react";
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";

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
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      style={[
        styles.button,
        styles[variant],
        isDisabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === "primary" ? "#fff" : "#222224"}
          size="small"
        />
      ) : (
        <Text style={[styles.text, styles[`${variant}Text`], textStyle]}>
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
  primary: {
    backgroundColor: "#222224",
  },
  secondary: {
    backgroundColor: "#fafafa",
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
  danger: {
    backgroundColor: "#FF3B30",
  },
  disabled: {
    backgroundColor: "#ccccd1",
    ...(Platform.OS === "web" ? { cursor: "not-allowed" as any } : {}),
  },
  text: {
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 22,
  },
  primaryText: {
    color: "#ffffff",
  },
  secondaryText: {
    color: "#222224",
  },
  dangerText: {
    color: "#ffffff",
  },
});
