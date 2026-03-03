import React, { useState } from "react";
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
import { Ionicons } from "@expo/vector-icons";
import { useAction, api } from "@/services/api/convex";
import { formatAuthError } from "@features/auth/utils/formatAuthError";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

export default function ClaimRequestReviewPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  const phone = params.phone as string || "";
  const countryCode = params.countryCode as string || "US";
  const triedEmailsJson = params.triedEmails as string || "[]";
  const triedEmails = JSON.parse(triedEmailsJson) as string[];

  const [name, setName] = useState("");
  const [communityName, setCommunityName] = useState("");
  const [error, setError] = useState("");
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  // Action for submitting review request
  const submitAccountClaimRequest = useAction(api.functions.auth.accountClaim.submitAccountClaimRequest);

  const handleSubmit = () => {
    if (!name.trim()) {
      setError("Please enter your name");
      return;
    }

    if (!communityName.trim()) {
      setError("Please enter your community name");
      return;
    }

    if (triedEmails.length === 0) {
      setError("Please try at least one email first");
      return;
    }

    setError("");
    setShowConfirmModal(true);
  };

  const handleConfirmSubmit = async () => {
    setIsPending(true);
    try {
      const data = await submitAccountClaimRequest({
        name,
        communityName,
        phone,
        countryCode,
        possibleEmails: triedEmails,
      });
      setRequestId(data.request_id);
      setShowSuccessMessage(true);
      setShowConfirmModal(false);
    } catch (err: any) {
      setError(formatAuthError(err));
      setShowConfirmModal(false);
    } finally {
      setIsPending(false);
    }
  };

  const handleBack = () => {
    if (showSuccessMessage) {
      // Go back to login/start
      router.replace("/(auth)/signin");
    } else {
      router.back();
    }
  };

  if (showSuccessMessage) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={[styles.scrollView, { paddingTop: insets.top }]}>
          <View style={styles.successWrapper}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark-circle" size={80} color="#34C759" />
            </View>

            <Text style={styles.successTitle}>Request Submitted</Text>
            <Text style={styles.successMessage}>
              We've received your account claim request. Our team will review it and
              get back to you within 1-2 business days.
            </Text>

            {requestId && (
              <View style={styles.requestIdContainer}>
                <Text style={styles.requestIdLabel}>Request ID:</Text>
                <Text style={styles.requestIdValue}>{requestId}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.button, styles.primaryButton]}
              onPress={handleBack}
            >
              <Text style={styles.primaryButtonText}>Back to Sign In</Text>
            </TouchableOpacity>
          </View>
        </View>
      </>
    );
  }

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
            <Text style={styles.title}>Request Manual Review</Text>
            <Text style={styles.subtitle}>
              We'll manually review your request and help you access your account.
            </Text>

            {error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.formContainer}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Your Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="First and Last Name"
                  value={name}
                  onChangeText={(text) => {
                    setName(text);
                    setError("");
                  }}
                  autoCapitalize="words"
                  autoCorrect={false}
                  editable={!isPending}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Community Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Name of your community"
                  value={communityName}
                  onChangeText={(text) => {
                    setCommunityName(text);
                    setError("");
                  }}
                  autoCapitalize="words"
                  autoCorrect={false}
                  editable={!isPending}
                />
              </View>

              {triedEmails.length > 0 && (
                <View style={styles.triedEmailsContainer}>
                  <Text style={styles.label}>Emails you tried:</Text>
                  {triedEmails.map((email, index) => (
                    <Text key={index} style={styles.triedEmail}>
                      • {email}
                    </Text>
                  ))}
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[
                styles.button,
                styles.primaryButton,
                isPending && styles.buttonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={isPending}
            >
              {isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Submit Request</Text>
              )}
            </TouchableOpacity>

            <View style={styles.infoBox}>
              <Ionicons name="information-circle-outline" size={20} color="#007AFF" />
              <Text style={styles.infoText}>
                Our team will verify your identity and link your phone number to your
                account. You'll receive an email or text once complete.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <ConfirmModal
        visible={showConfirmModal}
        title="Submit Review Request"
        message="This will send your information to our team for manual review. We'll get back to you within 1-2 business days."
        confirmText="Submit"
        cancelText="Cancel"
        onConfirm={handleConfirmSubmit}
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
  successWrapper: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
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
    paddingTop: 40,
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
    marginBottom: 32,
    textAlign: "center",
    lineHeight: 22,
  },
  formContainer: {
    marginBottom: 24,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
    backgroundColor: "#fff",
    color: "#333",
    letterSpacing: 0,
  },
  triedEmailsContainer: {
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    padding: 16,
    marginTop: 8,
  },
  triedEmail: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
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
  infoBox: {
    flexDirection: "row",
    backgroundColor: "#f0f7ff",
    borderRadius: 8,
    padding: 16,
    gap: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: "#007AFF",
    lineHeight: 20,
  },
  successIcon: {
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 16,
    textAlign: "center",
  },
  successMessage: {
    fontSize: 16,
    color: "#666",
    marginBottom: 32,
    textAlign: "center",
    lineHeight: 22,
  },
  requestIdContainer: {
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    paddingVertical: 16,
    paddingHorizontal: 32,
    marginBottom: 32,
    alignItems: "center",
  },
  requestIdLabel: {
    fontSize: 14,
    color: "#666",
    marginBottom: 4,
  },
  requestIdValue: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
  },
});
