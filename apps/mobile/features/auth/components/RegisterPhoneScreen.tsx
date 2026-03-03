import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/providers/AuthProvider";
import { useAction, api } from "@services/api/convex";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { OTPInput } from "@/components/ui/OTPInput";
import { formatAuthError } from "../utils/formatAuthError";

// Check if there's a pending join intent and return the redirect path
async function getPostAuthRedirect(): Promise<string> {
  try {
    const intent = await AsyncStorage.getItem("pending_join_intent");
    if (intent) {
      const parsed = JSON.parse(intent);
      // Check if not expired (30 min)
      if (Date.now() - parsed.timestamp < 30 * 60 * 1000) {
        return "/(auth)/join-flow";
      }
      // Clear expired intent
      await AsyncStorage.removeItem("pending_join_intent");
    }
  } catch (e) {
    console.error("Error checking join intent:", e);
  }
  return "/(auth)/select-community";
}

interface SendOTPResult {
  success: boolean;
  expiresIn: number;
  rateLimitRemaining?: number;
}

interface RegisterPhoneResult {
  success: boolean;
  message: string;
  phone_verified: boolean;
}

export function RegisterPhoneScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refreshUser, user, token } = useAuth();
  const params = useLocalSearchParams<{
    prefillPhone?: string;
    associatedEmails?: string;
  }>();

  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState("US");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [otpInfo, setOtpInfo] = useState<SendOTPResult | null>(null);
  const [associatedEmails, setAssociatedEmails] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Convex actions
  const sendPhoneOTP = useAction(api.functions.auth.phoneOtp.sendPhoneOTP);
  const registerPhone = useAction(api.functions.auth.phoneOtp.registerPhone);

  // Parse prefill data from params
  useEffect(() => {
    if (params.prefillPhone) {
      setPhone(params.prefillPhone);
    }
    if (params.associatedEmails) {
      try {
        const parsed = JSON.parse(params.associatedEmails);
        setAssociatedEmails(parsed);
      } catch (e) {
        console.error("Failed to parse associated emails:", e);
      }
    }
  }, [params.prefillPhone, params.associatedEmails]);

  const handlePhoneSubmit = useCallback(async () => {
    if (!phone.trim()) {
      setError("Please enter your phone number");
      return;
    }
    setError("");
    setIsLoading(true);

    try {
      const data = await sendPhoneOTP({ phone, countryCode });
      setOtpInfo({
        success: data.success,
        expiresIn: data.expiresIn,
      });
      setStep("otp");
      setError("");
    } catch (err: any) {
      const errorMessage = formatAuthError(err);
      if (err?.message?.includes("rate") || err?.message?.includes("limit")) {
        setError(`Rate limit exceeded. ${errorMessage}`);
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  }, [phone, countryCode, sendPhoneOTP]);

  const handleOTPSubmit = useCallback(async () => {
    if (otp.length !== 6) {
      setError("Please enter the 6-digit code");
      return;
    }
    setError("");
    setIsLoading(true);

    try {
      if (!token) {
        setError("Not authenticated. Please log in again.");
        return;
      }
      // registerPhone requires auth token
      await registerPhone({
        token,
        phone,
        code: otp,
        countryCode,
      });
      // Refresh user data to get updated phone_verified status
      await refreshUser();
      // Check for join intent first (from nearme flow), then community selection
      const redirectPath = await getPostAuthRedirect();
      router.replace(redirectPath);
    } catch (err: any) {
      setError(formatAuthError(err));
      setOtp("");
    } finally {
      setIsLoading(false);
    }
  }, [otp, phone, countryCode, token, registerPhone, refreshUser, router]);

  const handleResendOTP = useCallback(async () => {
    setOtp("");
    setError("");
    setIsLoading(true);

    try {
      const data = await sendPhoneOTP({ phone, countryCode });
      setOtpInfo({
        success: data.success,
        expiresIn: data.expiresIn,
      });
    } catch (err: any) {
      setError(formatAuthError(err));
    } finally {
      setIsLoading(false);
    }
  }, [phone, countryCode, sendPhoneOTP]);

  const handleGoBack = () => {
    setStep("phone");
    setOtp("");
    setError("");
    setOtpInfo(null);
  };

  if (step === "otp") {
    return (
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container}>
          <TouchableOpacity style={styles.backButton} onPress={handleGoBack}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Verify Phone</Text>
          <Text style={styles.subtitle}>
            We sent a 6-digit code to {phone}
          </Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <OTPInput value={otp} onChange={setOtp} error={error} autoFocus />

          <TouchableOpacity
            style={[
              styles.button,
              (isLoading || otp.length !== 6) && styles.buttonDisabled,
            ]}
            onPress={handleOTPSubmit}
            disabled={isLoading || otp.length !== 6}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Verify & Continue</Text>
            )}
          </TouchableOpacity>

          <View style={styles.resendContainer}>
            {otpInfo?.rateLimitRemaining === 0 ? (
              <Text style={styles.footerText}>
                Rate limit reached. Please wait before requesting a new code.
              </Text>
            ) : (
              <TouchableOpacity onPress={handleResendOTP} disabled={isLoading}>
                <Text style={styles.linkText}>Resend Code</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.container}>
        <View style={styles.logoContainer}>
          <Text style={styles.logoText}>Togather</Text>
        </View>

        <Text style={styles.title}>Add Your Phone</Text>
        <Text style={styles.subtitle}>
          Phone verification is required to continue using Togather
        </Text>

        {/* Previously linked emails notice */}
        {associatedEmails.length > 0 && (
          <View style={styles.linkedEmailsContainer}>
            <Text style={styles.linkedEmailsTitle}>Previously Linked Emails</Text>
            {associatedEmails.map((email, index) => (
              <Text key={index} style={styles.linkedEmail}>
                {email}
              </Text>
            ))}
          </View>
        )}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <PhoneInput
          value={phone}
          onChangeText={setPhone}
          countryCode={countryCode}
          onCountryCodeChange={setCountryCode}
          error={error}
          autoFocus={!params.prefillPhone}
        />

        <TouchableOpacity
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handlePhoneSubmit}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Send Verification Code</Text>
          )}
        </TouchableOpacity>

        <View style={styles.helpSection}>
          <Text style={styles.helpText}>Need help?</Text>
          <Text style={styles.helpLink}>Contact support at help@gettogather.co</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: "#fff",
  },
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    padding: 20,
    maxWidth: 400,
    alignSelf: "center",
    width: "100%",
  },
  logoContainer: {
    alignItems: "center",
    marginTop: 40,
    marginBottom: 20,
  },
  logoText: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#007AFF",
  },
  backButton: {
    marginBottom: 16,
  },
  backButtonText: {
    fontSize: 16,
    color: "#007AFF",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 8,
    color: "#333",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginBottom: 24,
  },
  linkedEmailsContainer: {
    backgroundColor: "#f8f8f8",
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  linkedEmailsTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
    marginBottom: 8,
  },
  linkedEmail: {
    fontSize: 14,
    color: "#333",
    marginBottom: 4,
  },
  errorText: {
    color: "#FF3B30",
    textAlign: "center",
    marginBottom: 16,
    fontSize: 14,
  },
  button: {
    backgroundColor: "#007AFF",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 16,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  resendContainer: {
    alignItems: "center",
    marginTop: 24,
  },
  footerText: {
    fontSize: 14,
    color: "#666",
  },
  linkText: {
    fontSize: 14,
    color: "#007AFF",
    fontWeight: "500",
  },
  helpSection: {
    alignItems: "center",
    marginTop: 32,
  },
  helpText: {
    fontSize: 14,
    color: "#666",
    marginBottom: 4,
  },
  helpLink: {
    fontSize: 14,
    color: "#007AFF",
    fontWeight: "500",
  },
});
