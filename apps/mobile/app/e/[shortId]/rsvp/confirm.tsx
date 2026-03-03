import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useQuery, api, convexVanilla } from "@/services/api/convex";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { formatAuthError } from "@/features/auth/utils/formatAuthError";
import { useAuth } from "@/providers/AuthProvider";
import { useSelectCommunity } from "@/features/auth/hooks/useAuth";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";

export default function RsvpConfirmScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refreshUser, setCommunity, signIn } = useAuth();
  const selectCommunityMutation = useSelectCommunity();
  const {
    shortId,
    phone,
    countryCode,
    otp,
    optionId,
    userName,
    communities: communitiesJson,
  } = useLocalSearchParams<{
    shortId: string;
    phone: string;
    countryCode: string;
    otp: string;
    optionId: string;
    userName: string;
    communities: string;
  }>();

  const [showRejectModal, setShowRejectModal] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [verifyPending, setVerifyPending] = useState(false);

  // Parse communities
  const communities = JSON.parse(communitiesJson || "[]") as Array<{
    id: number;
    name: string;
  }>;

  // Get event details to find the option label using Convex
  const event = useQuery(
    api.functions.meetings.index.getByShortId,
    shortId ? { shortId } : "skip"
  );

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

  const handleYes = async () => {
    setError("");
    setIsSubmitting(true);
    setVerifyPending(true);

    try {
      // Verify OTP and confirm identity using Convex
      const result = await convexVanilla.action(api.functions.auth.phoneOtp.verifyPhoneOTP, {
        phone: phone || "",
        code: otp || "",
        countryCode: countryCode || "US",
        confirmIdentity: true,
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
    } catch (err: any) {
      setVerifyPending(false);
      setError(formatAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNo = () => {
    setShowRejectModal(true);
  };

  const handleConfirmReject = async () => {
    setShowRejectModal(false);
    setError("");
    setIsSubmitting(true);
    setVerifyPending(true);

    try {
      // Verify OTP with confirmIdentity: false to unlink the phone using Convex
      const result = await convexVanilla.action(api.functions.auth.phoneOtp.verifyPhoneOTP, {
        phone: phone || "",
        code: otp || "",
        countryCode: countryCode || "US",
        confirmIdentity: false,
      });
      setVerifyPending(false);

      // Navigate to profile to create a new account
      router.replace({
        pathname: `/e/${shortId}/rsvp/profile`,
        params: {
          phone,
          countryCode,
          otp,
          optionId,
          phoneVerificationToken: result.phoneVerificationToken || "",
        },
      });
    } catch (err: any) {
      setVerifyPending(false);
      setError(formatAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLoading = verifyPending || isSubmitting;

  return (
    <>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 },
        ]}
      >
        {/* Back button */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>

        <View style={styles.container}>
          <View style={styles.content}>
            <Text style={styles.title}>Is this you?</Text>

            {userName && (
              <View style={styles.userInfo}>
                <Text style={styles.label}>Name</Text>
                <Text style={styles.userName}>{userName}</Text>
              </View>
            )}

            {communities.length > 0 && (
              <View style={styles.communitiesSection}>
                <Text style={styles.label}>
                  {communities.length === 1 ? "Community" : "Communities"}
                </Text>
                {communities.map((community) => (
                  <View key={community.id} style={styles.communityItem}>
                    <Text style={styles.communityName}>{community.name}</Text>
                  </View>
                ))}
              </View>
            )}

            {error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[styles.button, styles.primaryButton, isLoading && styles.buttonDisabled]}
                onPress={handleYes}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Yes, that's me</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={handleNo}
                disabled={isLoading}
              >
                <Text style={styles.secondaryButtonText}>No, that's not me</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>

      <ConfirmModal
        visible={showRejectModal}
        title="Not You?"
        message="This will unlink your phone number from this account. You'll then be able to create a new account with this phone number."
        confirmText="Continue"
        cancelText="Cancel"
        onConfirm={handleConfirmReject}
        onCancel={() => setShowRejectModal(false)}
        isLoading={isLoading}
      />
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
    padding: 20,
  },
  backButton: {
    marginBottom: 20,
    padding: 8,
    alignSelf: "flex-start",
  },
  container: {
    flex: 1,
    justifyContent: "center",
  },
  content: {
    maxWidth: 500,
    alignSelf: "center",
    width: "100%",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    marginBottom: 32,
    textAlign: "center",
    color: "#333",
  },
  userInfo: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    color: "#666",
    marginBottom: 8,
    fontWeight: "600",
  },
  userName: {
    fontSize: 20,
    color: "#333",
    fontWeight: "500",
  },
  communitiesSection: {
    marginBottom: 32,
  },
  communityItem: {
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    padding: 16,
    marginBottom: 8,
  },
  communityName: {
    fontSize: 16,
    color: "#333",
    fontWeight: "500",
  },
  buttonContainer: {
    gap: 12,
  },
  button: {
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButton: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    backgroundColor: "#f0f0f0",
  },
  secondaryButtonText: {
    color: "#333",
    fontSize: 16,
    fontWeight: "600",
  },
  error: {
    color: "#FF3B30",
    marginBottom: 16,
    textAlign: "center",
  },
});
