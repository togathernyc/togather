import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
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
      <View style={styles.container}>
        <Text style={styles.title}>Sign In</Text>
        <Text style={styles.subtitle}>
          Enter your phone number to get started
        </Text>

        <PhoneInput
          value={phone}
          onChangeText={onPhoneChange}
          countryCode={countryCode}
          onCountryCodeChange={onCountryCodeChange}
          error={error}
          autoFocus
        />

        <View style={styles.termsContainer}>
          <TouchableOpacity
            onPress={() => setTermsAccepted(!termsAccepted)}
            activeOpacity={0.7}
            style={styles.checkbox}
            testID="terms-checkbox"
          >
            <Ionicons
              name={termsAccepted ? "checkbox" : "square-outline"}
              size={24}
              color={termsAccepted ? "#007AFF" : "#999"}
            />
          </TouchableOpacity>
          <View style={styles.termsTextContainer}>
            <Text style={styles.termsText}>I agree to the </Text>
            <TouchableOpacity onPress={handleTermsPress}>
              <Text style={styles.termsLink}>Terms of Service</Text>
            </TouchableOpacity>
            <Text style={styles.termsText}> and </Text>
            <TouchableOpacity onPress={handlePrivacyPress}>
              <Text style={styles.termsLink}>Privacy Policy</Text>
            </TouchableOpacity>
          </View>
        </View>

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
    );
  }

  if (step === "otp") {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.backButton} onPress={onGoBack}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Enter Code</Text>
        <Text style={styles.subtitle}>
          We sent a 6-digit code to {phone}
        </Text>

        <OTPInput value={otp} onChange={onOtpChange} error={error} autoFocus />

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

        <View style={styles.resendContainer}>
          {rateLimitRemaining === 0 ? (
            <Text style={styles.footerText}>
              Rate limit reached. Please wait before requesting a new code.
            </Text>
          ) : (
            <TouchableOpacity onPress={onResendOtp} disabled={isLoading}>
              <Text style={styles.linkText}>Resend Code</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  // Legacy login step
  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={onSwitchToPhone}>
        <Text style={styles.backButtonText}>← Back to Phone</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Sign In with Email</Text>
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

      <View style={styles.termsContainer}>
        <TouchableOpacity
          onPress={() => setTermsAccepted(!termsAccepted)}
          activeOpacity={0.7}
          style={styles.checkbox}
        >
          <Ionicons
            name={termsAccepted ? "checkbox" : "square-outline"}
            size={24}
            color={termsAccepted ? "#007AFF" : "#999"}
          />
        </TouchableOpacity>
        <View style={styles.termsTextContainer}>
          <Text style={styles.termsText}>I agree to the </Text>
          <TouchableOpacity onPress={handleTermsPress}>
            <Text style={styles.termsLink}>Terms of Service</Text>
          </TouchableOpacity>
          <Text style={styles.termsText}> and </Text>
          <TouchableOpacity onPress={handlePrivacyPress}>
            <Text style={styles.termsLink}>Privacy Policy</Text>
          </TouchableOpacity>
        </View>
      </View>

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

      <TouchableOpacity onPress={onForgotPassword} style={styles.forgotButton}>
        <Text style={styles.linkText}>Forgot Password?</Text>
      </TouchableOpacity>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Don't have an account? </Text>
        <TouchableOpacity onPress={onSignUp}>
          <Text style={styles.linkText}>Sign up</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    maxWidth: 400,
    alignSelf: "center",
    width: "100%",
  },
  backButton: {
    marginBottom: 16,
  },
  backButtonText: {
    fontSize: 16,
    color: "#007AFF",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 8,
    color: "#333",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginBottom: 32,
  },
  inputContainer: {
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
  },
  input: {
    padding: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#007AFF",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
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
  resendContainer: {
    alignItems: "center",
    marginTop: 24,
  },
  forgotButton: {
    alignItems: "center",
    marginTop: 16,
  },
  errorText: {
    color: "#FF3B30",
    textAlign: "center",
    marginBottom: 16,
    fontSize: 14,
  },
  termsContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  checkbox: {
    marginRight: 12,
    marginTop: 2,
  },
  termsTextContainer: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
  termsText: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
  },
  termsLink: {
    color: "#007AFF",
    fontWeight: "500",
    fontSize: 14,
    lineHeight: 20,
  },
});
