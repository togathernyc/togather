import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, api, convexVanilla } from "@/services/api/convex";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { formatAuthError } from "@/features/auth/utils/formatAuthError";
import { useAuth } from "@/providers/AuthProvider";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";

export default function RsvpProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refreshUser, signIn } = useAuth();
  const { shortId, phone, countryCode, otp, optionId, phoneVerificationToken } = useLocalSearchParams<{
    shortId: string;
    phone: string;
    countryCode: string;
    otp: string;
    optionId: string;
    phoneVerificationToken: string;
  }>();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [registerPending, setRegisterPending] = useState(false);

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

  const handleSubmit = async () => {
    if (!firstName.trim()) {
      setError("Please enter your first name");
      return;
    }
    if (!lastName.trim()) {
      setError("Please enter your last name");
      return;
    }

    setError("");
    setIsSubmitting(true);
    setRegisterPending(true);

    try {
      // Register new user using Convex
      const result = await convexVanilla.action(api.functions.auth.registration.registerNewUser, {
        phone: phone || "",
        countryCode: countryCode || "US",
        otp: otp || "",
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phoneVerificationToken: phoneVerificationToken || undefined,
      });

      // Persist tokens + sync AuthProvider state so downstream calls (like RSVP submit) can authenticate
      if (!result?.access_token || !result?.user?.id) {
        throw new Error("Not authenticated: no auth token available");
      }
      await signIn(result.user.id, {
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
      });

      setRegisterPending(false);

      // Refresh user to update auth state
      await refreshUser();

      // Submit RSVP
      await submitRsvp();

      // Navigate to success
      router.replace({
        pathname: `/e/${shortId}/rsvp/success`,
        params: { optionLabel: getOptionLabel() },
      });
    } catch (err: any) {
      setRegisterPending(false);
      setError(formatAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLoading = registerPending || isSubmitting;

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
          <Text style={styles.title}>What's your name?</Text>
          <Text style={styles.subtitle}>
            This helps others know who's coming to the event
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>First name</Text>
            <TextInput
              style={styles.input}
              value={firstName}
              onChangeText={setFirstName}
              placeholder="First name"
              placeholderTextColor="#bdbdc1"
              autoCapitalize="words"
              autoFocus
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Last name</Text>
            <TextInput
              style={styles.input}
              value={lastName}
              onChangeText={setLastName}
              placeholder="Last name"
              placeholderTextColor="#bdbdc1"
              autoCapitalize="words"
            />
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Continue</Text>
            )}
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
    borderWidth: 2,
    borderColor: "#ecedf0",
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: "#333",
    backgroundColor: "#fff",
  },
  error: {
    color: "#FF3B30",
    marginBottom: 16,
    textAlign: "center",
  },
  button: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 16,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
