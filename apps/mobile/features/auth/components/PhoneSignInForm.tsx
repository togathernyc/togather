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
import { useTheme } from "@hooks/useTheme";

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
  const { colors } = useTheme();

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
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>

            <Text style={[styles.title, { color: colors.text }]}>Enter your phone number</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
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
                color={termsAccepted ? colors.text : colors.border}
              />
              <Text style={[styles.termsText, { color: colors.textSecondary }]}>
                I agree to the{" "}
                <Text style={[styles.termsLink, { color: colors.text }]} onPress={handleTermsPress}>
                  Terms
                </Text>
                {" and "}
                <Text style={[styles.termsLink, { color: colors.text }]} onPress={handlePrivacyPress}>
                  Privacy Policy
                </Text>
              </Text>
            </TouchableOpacity>
          </View>

          {/* Bottom button */}
          <View style={styles.bottomSection}>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.buttonPrimary }, isSubmitDisabled && [styles.buttonDisabled, { backgroundColor: colors.border }]]}
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
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>

            <Text style={[styles.title, { color: colors.text }]}>Enter verification code</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              We sent a 6-digit code to{"\n"}
              <Text style={[styles.phoneHighlight, { color: colors.text }]}>{phone}</Text>
            </Text>

            <View style={styles.otpContainer}>
              <OTPInput value={otp} onChange={onOtpChange} error={error} autoFocus />
            </View>

            <View style={styles.resendContainer}>
              {rateLimitRemaining === 0 ? (
                <Text style={[styles.rateLimitText, { color: colors.textSecondary }]}>
                  Too many attempts. Please wait a moment.
                </Text>
              ) : (
                <TouchableOpacity onPress={onResendOtp} disabled={isLoading}>
                  <Text style={[styles.resendText, { color: colors.text }]}>Didn't get the code? Resend</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={styles.bottomSection}>
            <TouchableOpacity
              style={[
                styles.button,
                { backgroundColor: colors.buttonPrimary },
                (isLoading || otp.length !== 6) && [styles.buttonDisabled, { backgroundColor: colors.border }],
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
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>

          <Text style={[styles.title, { color: colors.text }]}>Sign in with email</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Use your email and password to continue
          </Text>

          {error ? <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text> : null}

          <View style={[styles.inputContainer, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <ProgrammaticTextInput
              style={[styles.input, { color: colors.text }]}
              placeholder="Email"
              placeholderTextColor={colors.inputPlaceholder}
              value={email}
              onChangeText={onEmailChange}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              testID="signin-email"
            />
          </View>

          <View style={[styles.inputContainer, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <ProgrammaticTextInput
              style={[styles.input, { color: colors.text }]}
              placeholder="Password"
              placeholderTextColor={colors.inputPlaceholder}
              value={password}
              onChangeText={onPasswordChange}
              secureTextEntry
              autoCapitalize="none"
              testID="signin-password"
            />
          </View>

          <TouchableOpacity onPress={onForgotPassword} style={styles.forgotButton}>
            <Text style={[styles.forgotText, { color: colors.text }]}>Forgot password?</Text>
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
              color={termsAccepted ? colors.text : colors.border}
            />
            <Text style={[styles.termsText, { color: colors.textSecondary }]}>
              I agree to the{" "}
              <Text style={[styles.termsLink, { color: colors.text }]} onPress={handleTermsPress}>
                Terms
              </Text>
              {" and "}
              <Text style={[styles.termsLink, { color: colors.text }]} onPress={handlePrivacyPress}>
                Privacy Policy
              </Text>
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.bottomSection}>
          <TouchableOpacity
            style={[
              styles.button,
              { backgroundColor: colors.buttonPrimary },
              (isLoading || !termsAccepted) && [styles.buttonDisabled, { backgroundColor: colors.border }],
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
            <Text style={[styles.footerText, { color: colors.textSecondary }]}>Don't have an account? </Text>
            <TouchableOpacity onPress={onSignUp}>
              <Text style={[styles.signUpLink, { color: colors.text }]}>Sign up</Text>
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
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 28,
    lineHeight: 24,
  },
  phoneHighlight: {
    fontWeight: "600",
  },
  otpContainer: {
    marginTop: 8,
  },
  inputContainer: {
    marginBottom: 16,
    borderWidth: 1.5,
    borderRadius: 12,
  },
  input: {
    padding: 16,
    fontSize: 16,
  },
  termsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 24,
    gap: 12,
  },
  termsText: {
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  termsLink: {
    fontWeight: "600",
  },
  button: {
    paddingVertical: 18,
    borderRadius: 30,
    alignItems: "center",
  },
  buttonDisabled: {},
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
    fontWeight: "500",
  },
  rateLimitText: {
    fontSize: 14,
  },
  forgotButton: {
    alignSelf: "flex-start",
    marginBottom: 8,
  },
  forgotText: {
    fontSize: 14,
    fontWeight: "500",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 16,
  },
  footerText: {
    fontSize: 14,
  },
  signUpLink: {
    fontSize: 14,
    fontWeight: "600",
  },
  errorText: {
    fontSize: 14,
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
    overflow: "hidden",
  },
});
