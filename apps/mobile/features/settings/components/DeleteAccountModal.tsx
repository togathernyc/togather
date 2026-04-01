/**
 * Delete Account Modal
 *
 * Multi-step modal for account deletion:
 * 1. Confirmation step - user confirms they want to delete
 * 2. OTP verification step - user enters OTP sent to their phone
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { CustomModal } from "@/components/ui/Modal";
import { OTPInput } from "@/components/ui/OTPInput";
import { useAuth } from "@/providers/AuthProvider";
import { useAction, api } from "@services/api/convex";
import { useDeleteAccount } from "@/features/profile/hooks";
import { useTheme } from "@hooks/useTheme";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface DeleteAccountModalProps {
  visible: boolean;
  onClose: () => void;
}

type Step = "confirm" | "otp";

const RESEND_COOLDOWN_SECONDS = 60;

export function DeleteAccountModal({
  visible,
  onClose,
}: DeleteAccountModalProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const { user, token, logout } = useAuth();
  const [step, setStep] = useState<Step>("confirm");
  const [otpCode, setOtpCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Get last 4 digits of phone for display
  const phoneLast4 = user?.phone?.slice(-4) || "****";

  const sendPhoneOTP = useAction(api.functions.auth.phoneOtp.sendPhoneOTP);
  const { mutateAsync: deleteAccount } = useDeleteAccount();

  // Reset state when modal closes
  useEffect(() => {
    if (!visible) {
      setStep("confirm");
      setOtpCode("");
      setError(null);
      setResendCooldown(0);
    }
  }, [visible]);

  // Countdown timer for resend button
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => {
        setResendCooldown((prev) => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const handleSendOTP = useCallback(async () => {
    if (!user?.phone) {
      setError("No phone number associated with this account");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await sendPhoneOTP({ phone: user.phone });
      setStep("otp");
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err: any) {
      const message =
        err?.message ||
        "Failed to send verification code";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [user?.phone, sendPhoneOTP]);

  const handleResendOTP = useCallback(async () => {
    if (resendCooldown > 0 || !user?.phone) return;

    setIsLoading(true);
    setError(null);

    try {
      await sendPhoneOTP({ phone: user.phone });
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setOtpCode("");
    } catch (err: any) {
      const message =
        err?.message ||
        "Failed to resend verification code";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [user?.phone, resendCooldown, sendPhoneOTP]);

  const handleConfirmDelete = useCallback(async () => {
    if (otpCode.length !== 6) {
      setError("Please enter the 6-digit code");
      return;
    }

    if (!token || !user?.phone) {
      setError("Not authenticated. Please sign in again.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await deleteAccount({ code: otpCode });

      // Clear stored tokens
      await AsyncStorage.removeItem("access_token");
      await AsyncStorage.removeItem("refresh_token");

      // Close modal
      onClose();

      // Logout and navigate to sign in
      await logout();
      router.replace("/(auth)/signin");
    } catch (err: any) {
      const message =
        err?.message ||
        "Failed to delete account. Please try again.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [otpCode, token, user?.phone, deleteAccount, onClose, logout, router]);

  const renderConfirmStep = () => (
    <>
      <View style={styles.iconContainer}>
        <Ionicons name="warning" size={48} color={colors.destructive} />
      </View>

      <Text style={[styles.title, { color: colors.text }]}>Delete Account?</Text>

      <Text style={[styles.description, { color: colors.textSecondary }]}>
        This action is permanent and cannot be undone. By deleting your account:
      </Text>

      <View style={styles.bulletList}>
        <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>
          {"\u2022"} You will be removed from all communities
        </Text>
        <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>
          {"\u2022"} You will be removed from all groups
        </Text>
        <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>
          {"\u2022"} Your messages will remain but be anonymized
        </Text>
        <Text style={[styles.bulletItem, { color: colors.textSecondary }]}>
          {"\u2022"} Your personal data will be deleted
        </Text>
      </View>

      {error && <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>}

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.cancelButton, { backgroundColor: colors.surfaceSecondary }]}
          onPress={onClose}
          disabled={isLoading}
        >
          <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.continueButton, { backgroundColor: colors.destructive }, isLoading && styles.buttonDisabled]}
          onPress={handleSendOTP}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <Text style={[styles.continueButtonText, { color: colors.textInverse }]}>Continue</Text>
          )}
        </TouchableOpacity>
      </View>
    </>
  );

  const renderOTPStep = () => (
    <>
      <TouchableOpacity style={styles.backButton} onPress={() => setStep("confirm")}>
        <Ionicons name="arrow-back" size={24} color={colors.text} />
      </TouchableOpacity>

      <Text style={[styles.title, { color: colors.text }]}>Verify Your Phone</Text>

      <Text style={[styles.description, { color: colors.textSecondary }]}>
        Enter the 6-digit code sent to the phone number ending in {phoneLast4}
      </Text>

      <View style={styles.otpContainer}>
        <OTPInput
          value={otpCode}
          onChange={setOtpCode}
          error={error || undefined}
          autoFocus
        />
      </View>

      <TouchableOpacity
        style={styles.resendButton}
        onPress={handleResendOTP}
        disabled={resendCooldown > 0 || isLoading}
      >
        <Text
          style={[
            styles.resendButtonText,
            { color: colors.link },
            resendCooldown > 0 && { color: colors.textTertiary },
          ]}
        >
          {resendCooldown > 0
            ? `Resend code in ${resendCooldown}s`
            : "Resend code"}
        </Text>
      </TouchableOpacity>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.cancelButton, { backgroundColor: colors.surfaceSecondary }]}
          onPress={onClose}
          disabled={isLoading}
        >
          <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.deleteButton,
            { backgroundColor: colors.destructive },
            (isLoading || otpCode.length !== 6) && styles.buttonDisabled,
          ]}
          onPress={handleConfirmDelete}
          disabled={isLoading || otpCode.length !== 6}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <Text style={[styles.deleteButtonText, { color: colors.textInverse }]}>Delete Account</Text>
          )}
        </TouchableOpacity>
      </View>
    </>
  );

  return (
    <CustomModal
      visible={visible}
      onClose={onClose}
      withoutCloseBtn
      contentPadding="24"
    >
      <View style={styles.content}>
        {step === "confirm" ? renderConfirmStep() : renderOTPStep()}
      </View>
    </CustomModal>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: "center",
  },
  iconContainer: {
    marginBottom: 16,
  },
  backButton: {
    alignSelf: "flex-start",
    marginBottom: 16,
    padding: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 12,
    textAlign: "center",
  },
  description: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 16,
  },
  bulletList: {
    alignSelf: "stretch",
    marginBottom: 20,
  },
  bulletItem: {
    fontSize: 14,
    lineHeight: 24,
    paddingLeft: 8,
  },
  otpContainer: {
    alignSelf: "stretch",
    marginBottom: 16,
  },
  resendButton: {
    marginBottom: 24,
    padding: 8,
  },
  resendButtonText: {
    fontSize: 14,
    fontWeight: "500",
  },
  buttonRow: {
    flexDirection: "row",
    alignSelf: "stretch",
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  continueButton: {
    flex: 1,
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  continueButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  deleteButton: {
    flex: 1,
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  deleteButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 16,
  },
});
