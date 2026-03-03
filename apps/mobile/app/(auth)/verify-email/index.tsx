import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/providers/AuthProvider";

// Check if there's a pending join intent
async function hasJoinIntent(): Promise<boolean> {
  try {
    const intent = await AsyncStorage.getItem("pending_join_intent");
    if (intent) {
      const parsed = JSON.parse(intent);
      // Check if not expired (30 min)
      if (Date.now() - parsed.timestamp < 30 * 60 * 1000) {
        return true;
      }
      // Clear expired intent
      await AsyncStorage.removeItem("pending_join_intent");
    }
  } catch (e) {
    console.error("Error checking join intent:", e);
  }
  return false;
}

export default function VerifyEmailPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const params = useLocalSearchParams<{
    phone: string;
    countryCode: string;
    otp: string;
    phoneVerificationToken?: string;
    firstName: string;
    lastName: string;
    email: string;
    birthday: string;
  }>();

  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  const sendEmailOTP = useCallback(async () => {
    setIsSending(true);
    setError("");

    try {
      const { convexVanilla, api } = await import("@/services/api/convex");
      // Use send_otp_for_registration for new users (indicated by presence of firstName)
      // Use send_otp for claim account flow (existing users)
      const action = params.firstName ? "send_otp_for_registration" : "send_otp";
      await convexVanilla.action(api.functions.auth.accountClaim.claimAccount, {
        action,
        email: params.email,
        phone: params.phone,
        countryCode: params.countryCode,
      });
      setCountdown(60); // 60 second cooldown
    } catch (err: any) {
      console.error("Failed to send email OTP:", err);
      const detail = err?.message;
      if (typeof detail === "string") {
        setError(detail);
      } else {
        setError("Failed to send verification code. Please try again.");
      }
    } finally {
      setIsSending(false);
    }
  }, [params.email, params.phone, params.countryCode, params.firstName]);

  // Send OTP on mount
  useEffect(() => {
    sendEmailOTP();
  }, [sendEmailOTP]);

  // Countdown timer for resend
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleCodeChange = (index: number, value: string) => {
    if (value.length > 1) {
      // Handle paste
      const digits = value.replace(/\D/g, "").slice(0, 6);
      const newCode = [...code];
      for (let i = 0; i < digits.length && index + i < 6; i++) {
        newCode[index + i] = digits[i];
      }
      setCode(newCode);
      const nextIndex = Math.min(index + digits.length, 5);
      inputRefs.current[nextIndex]?.focus();
    } else {
      const newCode = [...code];
      newCode[index] = value.replace(/\D/g, "");
      setCode(newCode);

      if (value && index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
    }
    setError("");
  };

  const handleKeyPress = (index: number, key: string) => {
    if (key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    const fullCode = code.join("");
    if (fullCode.length !== 6) {
      setError("Please enter the 6-digit code");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const { convexVanilla, api } = await import("@/services/api/convex");

      // Verify the email OTP (but don't link - just verify)
      await convexVanilla.action(api.functions.auth.accountClaim.claimAccount, {
        action: "verify_only",
        email: params.email,
        code: fullCode,
        phone: params.phone,
        countryCode: params.countryCode,
      });

      // Email verified - check for join intent first (from nearme flow)
      if (await hasJoinIntent()) {
        // New user with join intent: register the user first so join-flow has auth
        if (params.firstName) {
          // Convert birthday from MM/DD/YYYY to YYYY-MM-DD
          let formattedBirthday = params.birthday || "";
          if (formattedBirthday.includes("/")) {
            const [month, day, year] = formattedBirthday.split("/");
            formattedBirthday = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
          }

          const registrationResult = await convexVanilla.action(api.functions.auth.registration.registerNewUser, {
            phone: params.phone,
            countryCode: params.countryCode,
            firstName: params.firstName,
            lastName: params.lastName,
            email: params.email || undefined,
            otp: params.otp,
            phoneVerificationToken: params.phoneVerificationToken || undefined,
            dateOfBirth: formattedBirthday || undefined,
          });

          // Store tokens and set auth state
          await signIn(registrationResult.user.id, {
            accessToken: registrationResult.access_token,
            refreshToken: registrationResult.refresh_token,
          });
        }

        router.replace("/(auth)/join-flow");
      } else {
        // No join intent - proceed to community selection
        router.replace({
          pathname: "/(auth)/select-community",
          params: {
            phone: params.phone,
            countryCode: params.countryCode,
            otp: params.otp,
            phoneVerificationToken: params.phoneVerificationToken || "",
            isNewUser: "true",
            firstName: params.firstName,
            lastName: params.lastName,
            email: params.email,
            birthday: params.birthday,
            emailVerified: "true",
          },
        });
      }
    } catch (err: any) {
      console.error("Email verification failed:", err);
      const detail = err?.message;
      if (typeof detail === "string") {
        setError(detail);
      } else {
        setError("Invalid code. Please try again.");
      }
      setCode(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    router.back();
  };

  const maskedEmail = params.email
    ? params.email.replace(/(.{2})(.*)(@.*)/, "$1***$3")
    : "";

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>

          <Text style={styles.title}>Verify your email</Text>
          <Text style={styles.subtitle}>
            We sent a 6-digit code to {maskedEmail}
          </Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.codeContainer}>
            {code.map((digit, index) => (
              <TextInput
                key={index}
                ref={(ref) => {
                  inputRefs.current[index] = ref;
                }}
                style={[styles.codeInput, error && styles.codeInputError]}
                value={digit}
                onChangeText={(value) => handleCodeChange(index, value)}
                onKeyPress={({ nativeEvent }) =>
                  handleKeyPress(index, nativeEvent.key)
                }
                keyboardType="number-pad"
                maxLength={6}
                selectTextOnFocus
                editable={!isLoading}
              />
            ))}
          </View>

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleVerify}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Verify Email</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.resendButton}
            onPress={sendEmailOTP}
            disabled={countdown > 0 || isSending}
          >
            {isSending ? (
              <ActivityIndicator size="small" color="#007AFF" />
            ) : countdown > 0 ? (
              <Text style={styles.resendTextDisabled}>
                Resend code in {countdown}s
              </Text>
            ) : (
              <Text style={styles.resendText}>Resend Code</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.helpText}>
            Make sure to check your spam folder if you don't see the email.
          </Text>
        </View>
      </ScrollView>
    </>
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
  backButton: {
    marginBottom: 16,
    padding: 4,
    alignSelf: "flex-start",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 8,
    textAlign: "center",
    color: "#333",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 32,
    textAlign: "center",
  },
  errorText: {
    color: "#FF3B30",
    textAlign: "center",
    marginBottom: 16,
    fontSize: 14,
  },
  codeContainer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginBottom: 32,
  },
  codeInput: {
    width: 45,
    height: 55,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    fontSize: 24,
    textAlign: "center",
    backgroundColor: "#fff",
    color: "#333",
  },
  codeInputError: {
    borderColor: "#FF3B30",
  },
  button: {
    backgroundColor: "#007AFF",
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  resendButton: {
    padding: 16,
    alignItems: "center",
  },
  resendText: {
    color: "#007AFF",
    fontSize: 14,
    fontWeight: "500",
  },
  resendTextDisabled: {
    color: "#999",
    fontSize: 14,
  },
  helpText: {
    color: "#999",
    fontSize: 13,
    textAlign: "center",
    marginTop: 16,
  },
});
