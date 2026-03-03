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
  const { user, logout } = useAuth();
  const [step, setStep] = useState<Step>("confirm");
  const [otpCode, setOtpCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Get last 4 digits of phone for display
  const phoneLast4 = user?.phone?.slice(-4) || "****";

  // Convex actions for OTP
  const sendPhoneOTP = useAction(api.functions.auth.phoneOtp.sendPhoneOTP);

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

    setIsLoading(true);
    setError(null);

    try {
      // TODO: Implement deleteAccount action in Convex
      // For now, we'll throw an error since this functionality
      // needs to be implemented in the Convex backend
      // await deleteAccount({ code: otpCode });

      // Placeholder: This should call a Convex action/mutation for account deletion
      throw new Error("Account deletion is not yet implemented in Convex. Please contact support.");

      // Once implemented, the flow would be:
      // 1. Verify OTP
      // 2. Delete account data
      // 3. Clear stored tokens
      // await AsyncStorage.removeItem("access_token");
      // await AsyncStorage.removeItem("refresh_token");
      // 4. Close modal
      // onClose();
      // 5. Logout and navigate
      // await logout();
      // router.replace("/(auth)/signin");
    } catch (err: any) {
      const message =
        err?.message ||
        "Failed to delete account. Please try again.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [otpCode, onClose, logout, router]);

  const renderConfirmStep = () => (
    <>
      <View style={styles.iconContainer}>
        <Ionicons name="warning" size={48} color="#DC2626" />
      </View>

      <Text style={styles.title}>Delete Account?</Text>

      <Text style={styles.description}>
        This action is permanent and cannot be undone. By deleting your account:
      </Text>

      <View style={styles.bulletList}>
        <Text style={styles.bulletItem}>
          {"\u2022"} You will be removed from all communities
        </Text>
        <Text style={styles.bulletItem}>
          {"\u2022"} You will be removed from all groups
        </Text>
        <Text style={styles.bulletItem}>
          {"\u2022"} Your messages will remain but be anonymized
        </Text>
        <Text style={styles.bulletItem}>
          {"\u2022"} Your personal data will be deleted
        </Text>
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={onClose}
          disabled={isLoading}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.continueButton, isLoading && styles.buttonDisabled]}
          onPress={handleSendOTP}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.continueButtonText}>Continue</Text>
          )}
        </TouchableOpacity>
      </View>
    </>
  );

  const renderOTPStep = () => (
    <>
      <TouchableOpacity style={styles.backButton} onPress={() => setStep("confirm")}>
        <Ionicons name="arrow-back" size={24} color="#333" />
      </TouchableOpacity>

      <Text style={styles.title}>Verify Your Phone</Text>

      <Text style={styles.description}>
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
            resendCooldown > 0 && styles.resendButtonTextDisabled,
          ]}
        >
          {resendCooldown > 0
            ? `Resend code in ${resendCooldown}s`
            : "Resend code"}
        </Text>
      </TouchableOpacity>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={onClose}
          disabled={isLoading}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.deleteButton,
            (isLoading || otpCode.length !== 6) && styles.buttonDisabled,
          ]}
          onPress={handleConfirmDelete}
          disabled={isLoading || otpCode.length !== 6}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.deleteButtonText}>Delete Account</Text>
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
    color: "#333",
    marginBottom: 12,
    textAlign: "center",
  },
  description: {
    fontSize: 15,
    color: "#666",
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
    color: "#666",
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
    color: "#007AFF",
    fontWeight: "500",
  },
  resendButtonTextDisabled: {
    color: "#999",
  },
  buttonRow: {
    flexDirection: "row",
    alignSelf: "stretch",
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  continueButton: {
    flex: 1,
    backgroundColor: "#DC2626",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  continueButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  deleteButton: {
    flex: 1,
    backgroundColor: "#DC2626",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  deleteButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  errorText: {
    fontSize: 14,
    color: "#DC2626",
    textAlign: "center",
    marginBottom: 16,
  },
});
