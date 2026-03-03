import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { OTPInput } from "@/components/ui/OTPInput";
import { useQuery, api, convexVanilla } from "@/services/api/convex";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { formatAuthError } from "@/features/auth/utils/formatAuthError";
import { useAuth } from "@/providers/AuthProvider";
import { useSelectCommunity } from "@/features/auth/hooks/useAuth";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";

export default function RsvpVerifyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refreshUser, setCommunity, signIn } = useAuth();
  const selectCommunityMutation = useSelectCommunity();
  const {
    shortId,
    phone,
    countryCode,
    optionId,
    exists,
    hasVerifiedPhone,
    userName,
    communities,
  } = useLocalSearchParams<{
    shortId: string;
    phone: string;
    countryCode: string;
    optionId: string;
    exists: string;
    hasVerifiedPhone: string;
    userName: string;
    communities: string;
  }>();

  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [verifyPending, setVerifyPending] = useState(false);
  const [resendPending, setResendPending] = useState(false);

  // Get event details to find the option label using Convex
  const event = useQuery(
    api.functions.meetings.index.getByShortId,
    shortId ? { shortId } : "skip"
  );

  const isLoading = verifyPending || isSubmitting;

  const getOptionLabel = useCallback(() => {
    if (!event?.rsvpOptions || !optionId) return "Going";
    const option = (event.rsvpOptions as any[]).find(
      (o) => o.id === parseInt(optionId, 10)
    );
    return option?.label || "Going";
  }, [event, optionId]);

  const submitRsvp = useCallback(async () => {
    if (!event?.id || !optionId) return;

    try {
      // Get auth token from AsyncStorage for the mutation
      const token = await AsyncStorage.getItem('auth_token');
      if (!token) {
        throw new Error('Not authenticated: no auth token available');
      }
      await convexVanilla.mutation(api.functions.meetingRsvps.submit, {
        token,
        meetingId: event.id,
        optionId: parseInt(optionId, 10),
      });
      return true;
    } catch (err) {
      console.error("Failed to submit RSVP:", err);
      throw err;
    }
  }, [event?.id, optionId]);

  const handleSubmit = async () => {
    if (otp.length !== 6) {
      setError("Please enter the 6-digit code");
      return;
    }

    setError("");
    setIsSubmitting(true);
    setVerifyPending(true);

    try {
      const userExists = exists === "true";
      const userHasVerifiedPhone = hasVerifiedPhone === "true";

      if (userExists && userHasVerifiedPhone) {
        // Case 1: Existing verified user - verify OTP, get tokens, submit RSVP
        const result = await convexVanilla.action(api.functions.auth.phoneOtp.verifyPhoneOTP, {
          phone: phone || "",
          code: otp,
          countryCode: countryCode || "US",
        });
        setVerifyPending(false);

        // Persist tokens + sync AuthProvider state so downstream calls (like RSVP submit) can authenticate
        if (!result?.access_token || !result?.user?.id) {
          throw new Error("Not authenticated: no auth token available");
        }
        await signIn(result.user.id, {
          accessToken: result.access_token,
          refreshToken: result.refresh_token,
        });

        // Refresh user to get their profile data
        await refreshUser();

        // Restore community context if user has an active community
        // This ensures tabs and other features work correctly after RSVP auth
        try {
          const userProfile = await convexVanilla.query(api.functions.users.me, {});
          if (userProfile?.activeCommunityId) {
            // Set community context using the authenticated mutation
            await selectCommunityMutation.mutateAsync({
              communityId: String(userProfile.activeCommunityId),
            });
            // Update auth context with community
            await setCommunity({
              id: userProfile.activeCommunityId,
              name: userProfile.activeCommunityName || undefined,
            });
            // Refresh user again to sync state
            await refreshUser();
          }
        } catch (communityError) {
          // Non-blocking: user can still proceed without community context
          console.warn("Failed to restore community context:", communityError);
        }

        // Submit RSVP
        await submitRsvp();

        // Navigate to success
        router.replace({
          pathname: `/e/${shortId}/rsvp/success`,
          params: { optionLabel: getOptionLabel() },
        });
      } else if (userExists && !userHasVerifiedPhone) {
        // Case 2: User exists but phone not verified - go to confirm identity
        router.push({
          pathname: `/e/${shortId}/rsvp/confirm`,
          params: {
            phone,
            countryCode,
            otp,
            optionId,
            userName: userName || "",
            communities: communities || "[]",
          },
        });
      } else {
        // Case 3: New user - verify OTP to get phoneVerificationToken, then collect name
        const verifyResult = await convexVanilla.action(api.functions.auth.phoneOtp.verifyPhoneOTP, {
          phone: phone || "",
          code: otp,
          countryCode: countryCode || "US",
        });
        setVerifyPending(false);

        router.push({
          pathname: `/e/${shortId}/rsvp/profile`,
          params: {
            phone,
            countryCode,
            otp,
            optionId,
            phoneVerificationToken: verifyResult.phoneVerificationToken || "",
          },
        });
      }
    } catch (err: any) {
      setVerifyPending(false);
      setError(formatAuthError(err));
      setOtp("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    setError("");
    setResendPending(true);
    try {
      await convexVanilla.action(api.functions.auth.phoneOtp.sendPhoneOTP, {
        phone: phone || "",
        countryCode: countryCode || "US",
      });
    } catch (err: any) {
      setError(formatAuthError(err));
    } finally {
      setResendPending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Back button */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>

        <View style={styles.content}>
          <Text style={styles.title}>Enter verification code</Text>
          <Text style={styles.subtitle}>
            We sent a 6-digit code to {phone}
          </Text>

          <OTPInput
            value={otp}
            onChange={setOtp}
            error={error}
            autoFocus
          />

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Verify</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.resendButton}
            onPress={handleResend}
            disabled={resendPending}
          >
            <Text style={styles.resendText}>
              {resendPending ? "Sending..." : "Resend code"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 20,
  },
  backButton: {
    marginBottom: 20,
    padding: 8,
    alignSelf: "flex-start",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    maxWidth: 400,
    width: "100%",
    alignSelf: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 12,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 32,
    textAlign: "center",
    lineHeight: 22,
  },
  button: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 24,
    width: "100%",
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
    marginTop: 24,
    padding: 8,
  },
  resendText: {
    color: DEFAULT_PRIMARY_COLOR,
    fontSize: 14,
    fontWeight: "500",
  },
});
