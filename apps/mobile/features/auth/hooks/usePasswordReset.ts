// usePasswordReset hook - handles password reset logic
// TODO: Implement password reset in Convex (sendResetPasswordEmail and resetPassword actions)

import { useState, useCallback } from "react";
import { useRouter } from "expo-router";
import { formatAuthError } from "../utils";

/**
 * Password Reset Hook
 *
 * Note: Password reset functionality is not yet implemented in the Convex backend.
 * This hook provides a placeholder that will show an error message until
 * the backend support is added.
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

  const handleSendEmail = useCallback(() => {
    setError("");
    if (!email) {
      setError("Please enter your email address");
      return;
    }

    // TODO: Implement when backend support is added
    // For now, show a message that this feature is coming soon
    setError("Password reset is temporarily unavailable. Please contact support at help@gettogather.co for assistance.");
  }, [email]);

  const handleResetPassword = useCallback(() => {
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

    // TODO: Implement when backend support is added
    setError("Password reset is temporarily unavailable. Please contact support at help@gettogather.co for assistance.");
  }, [code, newPassword, confirmPassword]);

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
