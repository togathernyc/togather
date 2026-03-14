import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Keyboard,
  TouchableWithoutFeedback,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { OTPInput } from "@/components/ui/OTPInput";
import { ProgrammaticTextInput } from "@/components/ui/ProgrammaticTextInput";

interface PhoneSignInFormProps {
  // Phone step
  phone: string;
  countryCode: string;
  onPhoneChange: (phone: string) => void;
  onCountryCodeChange: (code: string) => void;
  onPhoneSubmit: () => void;

  // OTP step
  otp: string;
  onOtpChange: (otp: string) => void;
  onOtpSubmit: () => void;
  onResendOtp: () => void;
  otpExpiresIn?: number;
  rateLimitRemaining?: number;

  // Legacy login step
  email: string;
  password: string;
  onEmailChange: (email: string) => void;
  onPasswordChange: (password: string) => void;
  onLegacySubmit: () => void;

  // Navigation
  step: "phone" | "otp" | "legacy" | "new_user_profile";
  onGoBack: () => void;
  onSwitchToLegacy: () => void;
  onSwitchToPhone: () => void;
  onSignUp: () => void;
  onForgotPassword: () => void;

  // State
  error: string;
  isLoading: boolean;
}

export function PhoneSignInForm({
  phone,
  countryCode,
  onPhoneChange,
  onCountryCodeChange,
  onPhoneSubmit,
  otp,
  onOtpChange,
  onOtpSubmit,
  onResendOtp,
  otpExpiresIn,
  rateLimitRemaining,
  email,
  password,
  onEmailChange,
  onPasswordChange,
  onLegacySubmit,
  step,
  onGoBack,
  onSwitchToLegacy,
  onSwitchToPhone,
  onSignUp,
  onForgotPassword,
  error,
  isLoading,
}: PhoneSignInFormProps) {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const router = useRouter();

  const handleTermsPress = () => {
    router.push("/(landing)/legal/terms");
  };

  const handlePrivacyPress = () => {
    router.push("/(landing)/legal/privacy");
  };

  if (step === "phone") {
    const isSubmitDisabled = isLoading || !termsAccepted;
    return (
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.container}>
          {/* Content area */}
          <View style={styles.content}>
            {/* Back button */}
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
            </TouchableOpacity>

            <Text style={styles.title}>Enter your phone number</Text>
            <Text style={styles.subtitle}>
              We'll send you a code to verify your number.
            </Text>

            <PhoneInput
              value={phone}
              onChangeText={onPhoneChange}
              countryCode={countryCode}
              onCountryCodeChange={onCountryCodeChange}
              error={error}
              autoFocus
            />

            {/* Terms checkbox */}
            <TouchableOpacity
              onPress={() => setTermsAccepted(!termsAccepted)}
              activeOpacity={0.7}
              style={styles.termsRow}
              testID="terms-checkbox"
            >
              <Ionicons
                name={termsAccepted ? "checkbox" : "square-outline"}
                size={22}
                color={termsAccepted ? "#1a1a1a" : "#ccc"}
              />
              <Text style={styles.termsText}>
                I agree to the{" "}
                <Text style={styles.termsLink} onPress={handleTermsPress}>
                  Terms
                </Text>
                {" and "}
                <Text style={styles.termsLink} onPress={handlePrivacyPress}>
                  Privacy Policy
                </Text>
              </Text>
            </TouchableOpacity>
          </View>

          {/* Bottom button */}
          <View style={styles.bottomSection}>
            <TouchableOpacity
              style={[styles.button, isSubmitDisabled && styles.buttonDisabled]}
              onPress={onPhoneSubmit}
              disabled={isSubmitDisabled}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Continue</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </TouchableWithoutFeedback>
    );
  }

  if (step === "otp") {
    return (
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.container}>
          <View style={styles.content}>
            {/* Back button */}
            <TouchableOpacity style={styles.backButton} onPress={onGoBack}>
              <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
            </TouchableOpacity>

            <Text style={styles.title}>Enter verification code</Text>
            <Text style={styles.subtitle}>
              We sent a 6-digit code to{"\n"}
              <Text style={styles.phoneHighlight}>{countryCode} {phone}</Text>
            </Text>

            <View style={styles.otpContainer}>
              <OTPInput value={otp} onChange={onOtpChange} error={error} autoFocus />
            </View>

            <View style={styles.resendContainer}>
              {rateLimitRemaining === 0 ? (
                <Text style={styles.rateLimitText}>
                  Too many attempts. Please wait a moment.
                </Text>
              ) : (
                <TouchableOpacity onPress={onResendOtp} disabled={isLoading}>
                  <Text style={styles.resendText}>Didn't get the code? Resend</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={styles.bottomSection}>
            <TouchableOpacity
              style={[
                styles.button,
                (isLoading || otp.length !== 6) && styles.buttonDisabled,
              ]}
              onPress={onOtpSubmit}
              disabled={isLoading || otp.length !== 6}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Verify</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </TouchableWithoutFeedback>
    );
  }

  // Legacy login step
  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={styles.container}>
        <View style={styles.content}>
          <TouchableOpacity style={styles.backButton} onPress={onSwitchToPhone}>
            <Ionicons name="arrow-back" size={24} color="#1a1a1a" />
          </TouchableOpacity>

          <Text style={styles.title}>Sign in with email</Text>
          <Text style={styles.subtitle}>
            Use your email and password to continue
          </Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.inputContainer}>
            <ProgrammaticTextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#999"
              value={email}
              onChangeText={onEmailChange}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              testID="signin-email"
            />
          </View>

          <View style={styles.inputContainer}>
            <ProgrammaticTextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#999"
              value={password}
              onChangeText={onPasswordChange}
              secureTextEntry
              autoCapitalize="none"
              testID="signin-password"
            />
          </View>

          <TouchableOpacity onPress={onForgotPassword} style={styles.forgotButton}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>

          {/* Terms checkbox */}
          <TouchableOpacity
            onPress={() => setTermsAccepted(!termsAccepted)}
            activeOpacity={0.7}
            style={styles.termsRow}
          >
            <Ionicons
              name={termsAccepted ? "checkbox" : "square-outline"}
              size={22}
              color={termsAccepted ? "#1a1a1a" : "#ccc"}
            />
            <Text style={styles.termsText}>
              I agree to the{" "}
              <Text style={styles.termsLink} onPress={handleTermsPress}>
                Terms
              </Text>
              {" and "}
              <Text style={styles.termsLink} onPress={handlePrivacyPress}>
                Privacy Policy
              </Text>
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bottomSection}>
          <TouchableOpacity
            style={[
              styles.button,
              (isLoading || !termsAccepted) && styles.buttonDisabled,
            ]}
            onPress={onLegacySubmit}
            disabled={isLoading || !termsAccepted}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <TouchableOpacity onPress={onSignUp}>
              <Text style={styles.signUpLink}>Sign up</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  bottomSection: {
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 28,
    lineHeight: 24,
  },
  phoneHighlight: {
    color: "#1a1a1a",
    fontWeight: "600",
  },
  otpContainer: {
    marginTop: 8,
  },
  inputContainer: {
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: "#e5e5e5",
    borderRadius: 12,
    backgroundColor: "#fff",
  },
  input: {
    padding: 16,
    fontSize: 16,
    color: "#1a1a1a",
  },
  termsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 24,
    gap: 12,
  },
  termsText: {
    fontSize: 14,
    color: "#666",
    flex: 1,
    lineHeight: 20,
  },
  termsLink: {
    color: "#1a1a1a",
    fontWeight: "600",
  },
  button: {
    backgroundColor: "#1a1a1a",
    paddingVertical: 18,
    borderRadius: 30,
    alignItems: "center",
  },
  buttonDisabled: {
    backgroundColor: "#ccc",
  },
  buttonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
  resendContainer: {
    alignItems: "center",
    marginTop: 32,
  },
  resendText: {
    fontSize: 15,
    color: "#1a1a1a",
    fontWeight: "500",
  },
  rateLimitText: {
    fontSize: 14,
    color: "#666",
  },
  forgotButton: {
    alignSelf: "flex-start",
    marginBottom: 8,
  },
  forgotText: {
    fontSize: 14,
    color: "#1a1a1a",
    fontWeight: "500",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 16,
  },
  footerText: {
    fontSize: 14,
    color: "#666",
  },
  signUpLink: {
    fontSize: 14,
    color: "#1a1a1a",
    fontWeight: "600",
  },
  errorText: {
    color: "#DC3545",
    fontSize: 14,
    marginBottom: 16,
    backgroundColor: "rgba(220, 53, 69, 0.08)",
    padding: 12,
    borderRadius: 8,
    overflow: "hidden",
  },
});
