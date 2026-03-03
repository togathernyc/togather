import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAction, api } from "@/services/api/convex";
import { formatAuthError } from "@features/auth/utils/formatAuthError";

export default function ClaimEmailPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  const phone = params.phone as string || "";
  const countryCode = params.countryCode as string || "US";
  const otp = params.otp as string || "";
  const prefillEmail = params.prefillEmail as string || "";

  const [email, setEmail] = useState(prefillEmail);
  const [error, setError] = useState("");
  const [triedEmails, setTriedEmails] = useState<string[]>([]);
  const [isPending, setIsPending] = useState(false);

  // Action for looking up email
  const claimAccount = useAction(api.functions.auth.accountClaim.claimAccount);

  const handleSubmit = async () => {
    if (!email.trim()) {
      setError("Please enter your email");
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError("Please enter a valid email address");
      return;
    }

    setError("");
    setIsPending(true);

    try {
      // First lookup
      const lookupResult = await claimAccount({
        action: "lookup",
        email,
        phone,
        countryCode,
      });

      if (lookupResult.user_found) {
        // Send OTP to this email
        await claimAccount({
          action: "send_otp",
          email,
          phone,
          countryCode,
        });

        // Navigate to verify screen only after both calls succeed
        router.push({
          pathname: "/(auth)/claim-account/verify",
          params: {
            phone,
            countryCode,
            otp,
            email,
            maskedEmail: lookupResult.masked_email || email,
            triedEmails: JSON.stringify([...triedEmails, email]),
          },
        });
      } else {
        // Email not found - add to tried list
        setTriedEmails([...triedEmails, email]);
        setError(
          `We couldn't find an account with "${email}". You can try another email or request a manual review.`
        );
      }
    } catch (err: any) {
      setError(formatAuthError(err));
    } finally {
      setIsPending(false);
    }
  };

  const handleRequestReview = () => {
    router.push({
      pathname: "/(auth)/claim-account/request-review",
      params: {
        phone,
        countryCode,
        otp,
        triedEmails: JSON.stringify(triedEmails),
      },
    });
  };

  const handleBack = () => {
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
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
            <Text style={styles.title}>Enter your email</Text>
            <Text style={styles.subtitle}>
              We'll look up your existing account and send you a verification code.
            </Text>

            {error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="Email address"
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  setError("");
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                editable={!isPending}
              />
            </View>

            {triedEmails.length > 0 && (
              <View style={styles.triedEmailsContainer}>
                <Text style={styles.triedEmailsLabel}>Tried emails:</Text>
                {triedEmails.map((triedEmail, index) => (
                  <Text key={index} style={styles.triedEmail}>
                    • {triedEmail}
                  </Text>
                ))}
              </View>
            )}

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
                <Text style={styles.primaryButtonText}>Continue</Text>
              )}
            </TouchableOpacity>

            {triedEmails.length > 0 && (
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={handleRequestReview}
              >
                <Text style={styles.secondaryButtonText}>Request Manual Review</Text>
              </TouchableOpacity>
            )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  keyboardAvoid: {
    flex: 1,
  },
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
  inputContainer: {
    marginBottom: 24,
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
    backgroundColor: "#fff5e6",
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
  },
  triedEmailsLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#856404",
    marginBottom: 8,
  },
  triedEmail: {
    fontSize: 14,
    color: "#856404",
    marginLeft: 8,
  },
  button: {
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
    marginBottom: 12,
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
  buttonDisabled: {
    opacity: 0.6,
  },
  error: {
    color: "#FF3B30",
    marginBottom: 16,
    textAlign: "center",
    fontSize: 14,
  },
});
