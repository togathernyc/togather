import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  TouchableOpacity,
  Share,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/providers/AuthProvider";
import { usePhoneAuth } from "../hooks/usePhoneAuth";
import { PhoneSignInForm } from "./PhoneSignInForm";
import { CompleteProfileScreen } from "./CompleteProfileScreen";
import { AuthGuard } from "@/components/guards/AuthGuard";
import { logCollector } from "@utils/logCollector";
import { useStoredAuthToken } from "@services/api/convex";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RegisterResult } from "../types";
import { useTheme } from "@hooks/useTheme";

// Check if there's a pending join intent and return the redirect path
async function getPostAuthRedirect(): Promise<string> {
  try {
    // Check for pending join intent
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
    console.error("Error checking post-auth redirect:", e);
  }
  return "/(tabs)/chat";
}

export function PhoneSignInScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refreshUser } = useAuth();
  const phoneAuth = usePhoneAuth();
  const authToken = useStoredAuthToken();
  const hasNavigatedRef = useRef(false);
  const { colors } = useTheme();

  // Handle successful phone OTP verification - wait for auth token to be ready
  useEffect(() => {
    // Skip if already navigated or conditions not met
    if (hasNavigatedRef.current) return;
    if (!phoneAuth.isVerifySuccess || !phoneAuth.verifyResult) return;
    if (phoneAuth.isNewUser) return; // New users go to profile completion

    // Wait for auth token to be available (signIn has propagated)
    if (!authToken) {
      console.log("[PhoneSignInScreen] Waiting for auth token to be ready...");
      return;
    }

    console.log("[PhoneSignInScreen] Auth token ready, proceeding with navigation");
    hasNavigatedRef.current = true;

    // Existing user - signIn was already called in usePhoneAuth hook and auth is ready
    // Add a small delay to ensure auth token is fully propagated to the Convex client
    (async () => {
      // Wait for auth to fully propagate to the client (React state update is faster than client injection)
      await new Promise(resolve => setTimeout(resolve, 500));
      try {
        // Check for pending join intent first
        const redirectPath = await getPostAuthRedirect();
        if (redirectPath === "/(auth)/join-flow") {
          router.replace(redirectPath);
          return;
        }

        // Use verifyResult data for routing
        const verifyResult = phoneAuth.verifyResult;

        // Auth is ready - set up the community context and navigate
        console.log("[PhoneSignInScreen] Auth ready, routing user:", {
          hasActiveCommunity: !!verifyResult.user?.activeCommunityId,
          communityCount: verifyResult.communities?.length,
        });

        // Always go to select-community first - it will handle the final navigation
        // This avoids navigating to a protected route before auth is fully propagated
        // The select-community screen will detect the active community and redirect
        console.log("[PhoneSignInScreen] Navigating to select-community for auth finalization");
        router.replace({
          pathname: "/(auth)/select-community",
          params: {
            communities: JSON.stringify(verifyResult.communities || []),
            activeCommunityId: verifyResult.user?.activeCommunityId || "",
            activeCommunityName: verifyResult.user?.activeCommunityName || "",
          },
        });
      } catch (err) {
        console.error("[PhoneSignInScreen] Login failed:", err);
        // Fall back to community selection
        router.replace("/(auth)/select-community");
      }
    })();
  }, [phoneAuth.isVerifySuccess, phoneAuth.verifyResult, phoneAuth.isNewUser, router, refreshUser, authToken]);

  // Handle phone not found after OTP verification - navigate to user-type screen
  useEffect(() => {
    if (phoneAuth.step === "user_type") {
      router.replace({
        pathname: "/(auth)/user-type",
        params: {
          phone: phoneAuth.phone,
          countryCode: phoneAuth.countryCode,
          otp: phoneAuth.verifiedOtp,
          phoneVerificationToken: phoneAuth.phoneVerificationToken,
          fromRejection: "false",
        },
      });
    }
  }, [phoneAuth.step, phoneAuth.phone, phoneAuth.countryCode, phoneAuth.verifiedOtp, router]);

  // Handle successful legacy login
  useEffect(() => {
    if (phoneAuth.isLegacySuccess && phoneAuth.legacyResult) {
      (async () => {
        await refreshUser();
        if (phoneAuth.legacyResult?.requiresPhoneVerification) {
          // User needs to verify phone - go to phone registration
          router.replace({
            pathname: "/(auth)/register-phone",
            params: {
              prefillPhone: phoneAuth.legacyResult?.user?.phone || "",
              associatedEmails: JSON.stringify([]),
            },
          });
        } else {
          // Phone already verified - check for join intent first
          const redirectPath = await getPostAuthRedirect();
          router.replace(redirectPath);
        }
      })();
    }
  }, [phoneAuth.isLegacySuccess, phoneAuth.legacyResult, refreshUser, router]);

  const handleSignUp = () => {
    router.push("/(auth)/signup");
  };

  const handleForgotPassword = () => {
    router.push("/(auth)/reset-password");
  };

  // Handle new user registration completion
  const handleCompleteProfile = async (result: RegisterResult) => {
    // Tokens are already stored by the API call
    await refreshUser();
    // Check for join intent first (from nearme flow)
    const redirectPath = await getPostAuthRedirect();
    router.replace(redirectPath);
  };

  // Handle going back from complete profile screen
  const handleBackFromProfile = () => {
    phoneAuth.goBackToPhone();
  };

  // Handle sending debug logs
  const handleSendDebugLogs = async () => {
    const appVersion = Constants.expoConfig?.version || "unknown";
    const runtimeVersion =
      typeof Constants.expoConfig?.runtimeVersion === "string"
        ? Constants.expoConfig.runtimeVersion
        : "unknown";
    const updateId = Updates.updateId || "none";
    const createdAt = Updates.createdAt ? Updates.createdAt.toISOString() : "none";
    const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL || "production default";

    const deviceInfo = `
=== DEVICE INFO ===
Platform: ${Platform.OS} ${Platform.Version}
App Version: ${appVersion}
Runtime Version: ${runtimeVersion}
Update ID: ${updateId}
Update Created: ${createdAt}
Is Dev: ${__DEV__}

=== API CONFIG ===
Convex URL: ${convexUrl}
==================
`;

    const logs = logCollector.getLogsAsString();
    const logCount = logCollector.getCount();
    const subject = `[Togather Debug Logs] ${new Date().toLocaleDateString()}`;
    const body = `${deviceInfo}\n=== CONSOLE LOGS (${logCount} entries) ===\n\n${logs || "No logs captured."}`;

    try {
      await Share.share({
        title: subject,
        message: `${subject}\n\n${body}`,
      });
    } catch (error) {
      console.error("Failed to share logs:", error);
    }
  };

  return (
    <AuthGuard>
      {phoneAuth.step === "new_user_profile" ? (
        <CompleteProfileScreen
          phone={phoneAuth.phone}
          countryCode={phoneAuth.countryCode}
          otp={phoneAuth.verifiedOtp}
          phoneVerificationToken={phoneAuth.phoneVerificationToken}
          onComplete={handleCompleteProfile}
          onBack={handleBackFromProfile}
        />
      ) : (
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={0}
        >
          <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.surface }]}>
            <PhoneSignInForm
              // Phone step
              phone={phoneAuth.phone}
              countryCode={phoneAuth.countryCode}
              onPhoneChange={phoneAuth.setPhone}
              onCountryCodeChange={phoneAuth.setCountryCode}
              onPhoneSubmit={phoneAuth.handlePhoneSubmit}
              // OTP step
              otp={phoneAuth.otp}
              onOtpChange={phoneAuth.setOtp}
              onOtpSubmit={phoneAuth.handleOTPSubmit}
              onResendOtp={phoneAuth.resendOTP}
              otpExpiresIn={phoneAuth.otpInfo?.expiresIn}
              rateLimitRemaining={phoneAuth.otpInfo?.rateLimitRemaining}
              // Legacy login step
              email={phoneAuth.email}
              password={phoneAuth.password}
              onEmailChange={phoneAuth.setEmail}
              onPasswordChange={phoneAuth.setPassword}
              onLegacySubmit={phoneAuth.handleLegacySubmit}
              // Navigation
              step={phoneAuth.step as "phone" | "otp" | "legacy"}
              onGoBack={phoneAuth.goBackToPhone}
              onSwitchToLegacy={phoneAuth.switchToLegacy}
              onSwitchToPhone={phoneAuth.switchToPhone}
              onSignUp={handleSignUp}
              onForgotPassword={handleForgotPassword}
              // State
              error={phoneAuth.error}
              isLoading={phoneAuth.isLoading}
            />

            <TouchableOpacity
              onPress={handleSendDebugLogs}
              style={[styles.debugLink, { paddingBottom: insets.bottom + 8 }]}
            >
              <Text style={[styles.debugLinkText, { color: colors.textTertiary }]}>Having issues? Send debug logs</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </AuthGuard>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  container: {
    flex: 1,
    maxWidth: 500,
    alignSelf: "center",
    width: "100%",
  },
  debugLink: {
    alignItems: "center",
    paddingVertical: 12,
  },
  debugLinkText: {
    fontSize: 13,
  },
});
