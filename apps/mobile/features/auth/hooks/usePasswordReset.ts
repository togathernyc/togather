// usePasswordReset hook - handles password reset logic

import { useState, useCallback } from "react";
import { useRouter } from "expo-router";
import { useAction, api } from "@services/api/convex";

/**
 * Password Reset Hook
 *
 * Two-step flow:
 * 1. Enter email -> sends OTP code via Resend
 * 2. Enter code + new password -> verifies OTP and resets password
 */
export function usePasswordReset() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  const sendResetEmail = useAction(
    api.functions.auth.registration.sendResetPasswordEmail
  );
  const resetPasswordAction = useAction(
    api.functions.auth.registration.resetPassword
  );

  const handleSendEmail = useCallback(async () => {
    setError("");
    if (!email) {
      setError("Please enter your email address");
      return;
    }

    setIsSendingEmail(true);
    try {
      await sendResetEmail({ email });
      setStep("reset");
    } catch (err: any) {
      setError(err?.message || "Failed to send reset email. Please try again.");
    } finally {
      setIsSendingEmail(false);
    }
  }, [email, sendResetEmail]);

  const handleResetPassword = useCallback(async () => {
    setError("");

    if (!code) {
      setError("Please enter the reset code");
      return;
    }
    if (!newPassword) {
      setError("Please enter a new password");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setIsResettingPassword(true);
    try {
      await resetPasswordAction({
        email,
        code,
        newPassword,
      });
      // Navigate back to sign-in on success
      router.push("/(auth)/signin");
    } catch (err: any) {
      setError(
        err?.message || "Failed to reset password. Please try again."
      );
    } finally {
      setIsResettingPassword(false);
    }
  }, [code, newPassword, confirmPassword, email, resetPasswordAction, router]);

  return {
    step,
    setStep,
    email,
    setEmail,
    code,
    setCode,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    error,
    setError,
    handleSendEmail,
    handleResetPassword,
    isSendingEmail,
    isResettingPassword,
  };
}
