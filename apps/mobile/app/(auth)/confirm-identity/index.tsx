import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useAction, api } from "@/services/api/convex";
import { formatAuthError } from "@features/auth/utils/formatAuthError";

// Check if there's a pending join intent and return the redirect path
async function getPostAuthRedirect(): Promise<string | null> {
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
  return null;
}

export default function ConfirmIdentityPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  const [showRejectModal, setShowRejectModal] = useState(false);
  const [error, setError] = useState("");

  // Parse user data from params
  const userName = params.userName as string || "";
  const communitiesJson = params.communities as string || "[]";
  const communities = JSON.parse(communitiesJson) as Array<{ id: number; name: string }>;
  const phone = params.phone as string || "";
  const countryCode = params.countryCode as string || "US";
  const otp = params.otp as string || "";
  const [isPending, setIsPending] = useState(false);

  // Action for rejecting identity (verifyPhoneOTP with confirmIdentity: false)
  const verifyPhoneOTP = useAction(api.functions.auth.phoneOtp.verifyPhoneOTP);

  const handleYes = async () => {
    // Check for join intent first (from nearme flow)
    const joinFlowPath = await getPostAuthRedirect();
    if (joinFlowPath) {
      router.replace(joinFlowPath);
      return;
    }
    // No join intent - navigate to community selection
    router.replace({
      pathname: "/(auth)/select-community",
      params: { communities: communitiesJson },
    });
  };

  const handleNo = () => {
    setShowRejectModal(true);
  };

  const handleConfirmReject = async () => {
    setIsPending(true);
    try {
      await verifyPhoneOTP({
        phone,
        code: otp,
        countryCode,
        confirmIdentity: false,
      });
      // Navigate to user-type screen
      router.replace({
        pathname: "/(auth)/user-type",
        params: {
          phone,
          countryCode,
          otp,
          fromRejection: "true",
        },
      });
    } catch (err: any) {
      setError(formatAuthError(err));
      setShowRejectModal(false);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}
      >
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
                style={[styles.button, styles.primaryButton]}
                onPress={handleYes}
              >
                <Text style={styles.primaryButtonText}>Yes, that's me</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={handleNo}
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
        message="This will unlink your phone number from this account. You'll then be able to either create a new account or link your phone to a different existing account."
        confirmText="Continue"
        cancelText="Cancel"
        onConfirm={handleConfirmReject}
        onCancel={() => setShowRejectModal(false)}
        isLoading={isPending}
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
  },
  container: {
    flex: 1,
    padding: 20,
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
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
  },
  primaryButton: {
    backgroundColor: "#007AFF",
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
