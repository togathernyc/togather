import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useAction, api } from "@/services/api/convex";
import { formatAuthError } from "@features/auth/utils/formatAuthError";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useAuth } from "@/providers/AuthProvider";

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

export default function ClaimVerifyPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const { signIn } = useAuth();

  const phone = params.phone as string || "";
  const countryCode = params.countryCode as string || "US";
  const otp = params.otp as string || "";
  const email = params.email as string || "";
  const maskedEmail = params.maskedEmail as string || email;
  const triedEmailsJson = params.triedEmails as string || "[]";

  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isPending, setIsPending] = useState(false);

  // Action for verifying OTP and linking account
  const claimAccount = useAction(api.functions.auth.accountClaim.claimAccount);

  const handleSubmit = () => {
    if (code.length !== 6) {
      setError("Please enter the 6-digit code");
      return;
    }

    setError("");
    setShowConfirmModal(true);
  };

  const handleConfirmLink = async () => {
    setIsPending(true);
    try {
      const data = await claimAccount({
        action: "verify_and_link",
        email,
        code,
        phone,
        countryCode,
      });

      // Sign in using AuthProvider (stores tokens and sets up auth state)
      if (data.access_token && data.user?.id) {
        await signIn(data.user.id, {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
        });
      }

      // Check for join intent (from nearme flow)
      const joinFlowPath = await getPostAuthRedirect();
      if (joinFlowPath) {
        router.replace(joinFlowPath);
        return;
      }

      // No join intent - navigate to community selection
      const communities = data.communities || [];
      if (communities.length > 0) {
        router.replace({
          pathname: "/(auth)/select-community",
          params: { communities: JSON.stringify(communities) },
        });
      } else {
        router.replace("/(auth)/select-community");
      }
    } catch (err: any) {
      setError(formatAuthError(err));
      setShowConfirmModal(false);
    } finally {
      setIsPending(false);
    }
  };

  const handleBack = () => {
    router.back();
  };

  // Auto-submit when code is 6 digits (but still show confirmation)
  useEffect(() => {
    if (code.length === 6 && !error) {
      // Small delay for better UX
      setTimeout(() => {
        setShowConfirmModal(true);
      }, 300);
    }
  }, [code, error]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color="#007AFF" />
          </TouchableOpacity>

          <View style={styles.content}>
            <Text style={styles.title}>Check your email</Text>
            <Text style={styles.subtitle}>
              We sent a verification code to{"\n"}
              <Text style={styles.email}>{maskedEmail}</Text>
            </Text>
            <Text style={styles.spamHint}>Be sure to check your spam folder</Text>

            {error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="Enter 6-digit code"
                value={code}
                onChangeText={(text) => {
                  // Only allow numbers
                  const cleaned = text.replace(/[^0-9]/g, "");
                  setCode(cleaned.slice(0, 6));
                  setError("");
                }}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
                editable={!isPending}
              />
            </View>

            <TouchableOpacity
              style={[
                styles.button,
                styles.primaryButton,
                (code.length !== 6 || isPending) && styles.buttonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={code.length !== 6 || isPending}
            >
              {isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Verify Code</Text>
              )}
            </TouchableOpacity>

            <View style={styles.helpText}>
              <Text style={styles.helpTextLabel}>Didn't receive the code?</Text>
              <TouchableOpacity onPress={handleBack}>
                <Text style={styles.link}>Try a different email</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>

      <ConfirmModal
        visible={showConfirmModal}
        title="Link Phone Number"
        message="This will link your phone number to this account. You'll be able to sign in with either your phone number or email in the future."
        confirmText="Link Account"
        cancelText="Cancel"
        onConfirm={handleConfirmLink}
        onCancel={() => setShowConfirmModal(false)}
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
  },
  backButton: {
    alignSelf: "flex-start",
    padding: 8,
    marginBottom: 16,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    maxWidth: 500,
    alignSelf: "center",
    width: "100%",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    marginBottom: 12,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 8,
    textAlign: "center",
    lineHeight: 22,
  },
  email: {
    fontWeight: "600",
    color: "#333",
  },
  spamHint: {
    fontSize: 14,
    color: "#888",
    textAlign: "center",
    marginBottom: 24,
    fontStyle: "italic",
  },
  inputContainer: {
    marginBottom: 24,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 16,
    fontSize: 24,
    backgroundColor: "#fff",
    color: "#333",
    textAlign: "center",
    letterSpacing: 8,
    fontWeight: "600",
  },
  button: {
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: "#007AFF",
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  error: {
    color: "#FF3B30",
    marginBottom: 16,
    textAlign: "center",
    fontSize: 14,
  },
  helpText: {
    alignItems: "center",
  },
  helpTextLabel: {
    fontSize: 14,
    color: "#666",
    marginBottom: 8,
  },
  link: {
    fontSize: 14,
    color: "#007AFF",
    fontWeight: "600",
  },
});
