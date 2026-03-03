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
  if (step === "email") {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Reset Password</Text>
        <Text style={styles.subtitle}>
          Enter your email address and we'll send you a code to reset your
          password
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TextInput
          style={styles.input}
          placeholder="Email"
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
          style={[styles.button, isSendingEmail && styles.buttonDisabled]}
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
          <Text style={styles.linkText}>Back to Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={onBackToEmail}>
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Reset Password</Text>
      <Text style={styles.subtitle}>
        Enter the code sent to your email and your new password
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.label}>Reset Code</Text>
      <TextInput
        style={styles.input}
        placeholder="Enter code"
        value={code}
        onChangeText={(text) => {
          if (!/\s/.test(text)) {
            onCodeChange(text);
          }
        }}
        autoCapitalize="none"
      />

      <Text style={styles.label}>New Password</Text>
      <TextInput
        style={styles.input}
        placeholder="New password"
        value={newPassword}
        onChangeText={(text) => {
          if (!/\s/.test(text)) {
            onNewPasswordChange(text);
          }
        }}
        secureTextEntry
        autoCapitalize="none"
      />

      <Text style={styles.label}>Confirm Password</Text>
      <TextInput
        style={styles.input}
        placeholder="Confirm password"
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
        style={[styles.button, isResettingPassword && styles.buttonDisabled]}
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
        <Text style={styles.linkText}>Back to Sign In</Text>
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
    color: "#007AFF",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    marginBottom: 8,
    color: "#333",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 32,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: "#7f7f82",
    marginTop: 16,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 2,
    borderColor: "#ecedf0",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    fontSize: 16,
    backgroundColor: "#fff",
  },
  button: {
    backgroundColor: "#000",
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
    color: "#FF3B30",
    marginBottom: 16,
    fontSize: 14,
  },
  linkButton: {
    alignItems: "center",
    marginTop: 16,
  },
  linkText: {
    fontSize: 14,
    color: "#666",
  },
});

