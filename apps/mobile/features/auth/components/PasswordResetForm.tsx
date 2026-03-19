// PasswordResetForm component - password reset form with email and reset steps

import React from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useTheme } from "@hooks/useTheme";

interface PasswordResetFormProps {
  step: "email" | "reset";
  email: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
  error: string;
  isSendingEmail: boolean;
  isResettingPassword: boolean;
  onEmailChange: (email: string) => void;
  onCodeChange: (code: string) => void;
  onNewPasswordChange: (password: string) => void;
  onConfirmPasswordChange: (password: string) => void;
  onSendEmail: () => void;
  onResetPassword: () => void;
  onBack: () => void;
  onBackToEmail: () => void;
  onSignIn: () => void;
}

export function PasswordResetForm({
  step,
  email,
  code,
  newPassword,
  confirmPassword,
  error,
  isSendingEmail,
  isResettingPassword,
  onEmailChange,
  onCodeChange,
  onNewPasswordChange,
  onConfirmPasswordChange,
  onSendEmail,
  onResetPassword,
  onBack,
  onBackToEmail,
  onSignIn,
}: PasswordResetFormProps) {
  const { colors } = useTheme();
  if (step === "email") {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={[styles.backButtonText, { color: colors.link }]}>← Back</Text>
        </TouchableOpacity>

        <Text style={[styles.title, { color: colors.text }]}>Reset Password</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Enter your email address and we'll send you a code to reset your
          password
        </Text>

        {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

        <TextInput
          style={[styles.input, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.text }]}
          placeholder="Email"
          placeholderTextColor={colors.inputPlaceholder}
          value={email}
          onChangeText={(text) => {
            if (!/\s/.test(text)) {
              onEmailChange(text);
            }
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />

        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.buttonPrimary }, isSendingEmail && styles.buttonDisabled]}
          onPress={onSendEmail}
          disabled={isSendingEmail}
        >
          {isSendingEmail ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Send Reset Code</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.linkButton} onPress={onSignIn}>
          <Text style={[styles.linkText, { color: colors.textSecondary }]}>Back to Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={onBackToEmail}>
        <Text style={[styles.backButtonText, { color: colors.link }]}>← Back</Text>
      </TouchableOpacity>

      <Text style={[styles.title, { color: colors.text }]}>Reset Password</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Enter the code sent to your email and your new password
      </Text>

      {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

      <Text style={[styles.label, { color: colors.textSecondary }]}>Reset Code</Text>
      <TextInput
        style={[styles.input, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.text }]}
        placeholder="Enter code"
        placeholderTextColor={colors.inputPlaceholder}
        value={code}
        onChangeText={(text) => {
          if (!/\s/.test(text)) {
            onCodeChange(text);
          }
        }}
        autoCapitalize="none"
      />

      <Text style={[styles.label, { color: colors.textSecondary }]}>New Password</Text>
      <TextInput
        style={[styles.input, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.text }]}
        placeholder="New password"
        placeholderTextColor={colors.inputPlaceholder}
        value={newPassword}
        onChangeText={(text) => {
          if (!/\s/.test(text)) {
            onNewPasswordChange(text);
          }
        }}
        secureTextEntry
        autoCapitalize="none"
      />

      <Text style={[styles.label, { color: colors.textSecondary }]}>Confirm Password</Text>
      <TextInput
        style={[styles.input, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.text }]}
        placeholder="Confirm password"
        placeholderTextColor={colors.inputPlaceholder}
        value={confirmPassword}
        onChangeText={(text) => {
          if (!/\s/.test(text)) {
            onConfirmPasswordChange(text);
          }
        }}
        secureTextEntry
        autoCapitalize="none"
      />

      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.buttonPrimary }, isResettingPassword && styles.buttonDisabled]}
        onPress={onResetPassword}
        disabled={isResettingPassword}
      >
        {isResettingPassword ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Reset Password</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.linkButton} onPress={onSignIn}>
        <Text style={[styles.linkText, { color: colors.textSecondary }]}>Back to Sign In</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    maxWidth: 500,
    alignSelf: "center",
    width: "100%",
  },
  backButton: {
    marginBottom: 20,
  },
  backButtonText: {
    fontSize: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 32,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 16,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 2,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    fontSize: 16,
  },
  button: {
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    marginTop: 8,
    marginBottom: 16,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  error: {
    marginBottom: 16,
    fontSize: 14,
  },
  linkButton: {
    alignItems: "center",
    marginTop: 16,
  },
  linkText: {
    fontSize: 14,
  },
});

