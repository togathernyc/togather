// PasswordResetScreen component - main password reset screen

import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthGuard } from "@components/guards/AuthGuard";
import { usePasswordReset } from "../hooks/usePasswordReset";
import { PasswordResetForm } from "./PasswordResetForm";
import { useTheme } from "@hooks/useTheme";

export function PasswordResetScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const passwordReset = usePasswordReset();
  const { colors } = useTheme();

  return (
    <AuthGuard>
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top, backgroundColor: colors.surface }]}>
        <PasswordResetForm
          step={passwordReset.step}
          email={passwordReset.email}
          code={passwordReset.code}
          newPassword={passwordReset.newPassword}
          confirmPassword={passwordReset.confirmPassword}
          error={passwordReset.error}
          isSendingEmail={passwordReset.isSendingEmail}
          isResettingPassword={passwordReset.isResettingPassword}
          onEmailChange={passwordReset.setEmail}
          onCodeChange={passwordReset.setCode}
          onNewPasswordChange={passwordReset.setNewPassword}
          onConfirmPasswordChange={passwordReset.setConfirmPassword}
          onSendEmail={passwordReset.handleSendEmail}
          onResetPassword={passwordReset.handleResetPassword}
          onBack={() => router.back()}
          onBackToEmail={() => passwordReset.setStep("email")}
          onSignIn={() => router.push("/(auth)/signin")}
        />
      </ScrollView>
    </AuthGuard>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
  },
});
