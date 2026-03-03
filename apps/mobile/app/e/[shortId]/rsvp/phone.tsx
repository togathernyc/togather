import React, { useState } from "react";
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
import { PhoneInput } from "@/components/ui/PhoneInput";
import { useAction, useQuery, api } from "@/services/api/convex";
import { formatAuthError } from "@/features/auth/utils/formatAuthError";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";

export default function RsvpPhoneScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { shortId, optionId } = useLocalSearchParams<{
    shortId: string;
    optionId: string;
  }>();

  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState("US");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Fetch event data to check visibility and RSVP settings
  const event = useQuery(
    api.functions.meetings.index.getByShortId,
    shortId ? { shortId } : "skip"
  );

  // Convex actions
  const phoneLookup = useAction(api.functions.auth.login.phoneLookup);
  const sendPhoneOTP = useAction(api.functions.auth.phoneOtp.sendPhoneOTP);

  const handleSubmit = async () => {
    if (!phone.trim()) {
      setError("Please enter your phone number");
      return;
    }

    setError("");
    setIsLoading(true);

    try {
      // First look up the phone to check if user exists
      const lookupResult = await phoneLookup({ phone, countryCode });

      // Send OTP regardless of whether user exists
      await sendPhoneOTP({ phone, countryCode });

      // Navigate to verify screen with all necessary params
      router.push({
        pathname: `/e/${shortId}/rsvp/verify`,
        params: {
          phone,
          countryCode,
          optionId,
          exists: lookupResult.exists ? "true" : "false",
          hasVerifiedPhone: lookupResult.hasVerifiedPhone ? "true" : "false",
          userName: lookupResult.userName || "",
          communities: JSON.stringify(lookupResult.communities || []),
        },
      });
    } catch (err: any) {
      setError(formatAuthError(err));
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state while fetching event data
  if (event === undefined) {
    return (
      <View style={[styles.container, styles.centeredContent]}>
        <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
      </View>
    );
  }

  // Check if RSVP is accessible for this event
  const canRSVP =
    event &&
    event.rsvpEnabled &&
    (event.visibility === "public" || event.hasAccess);

  if (!canRSVP) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 20 }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <View style={styles.blockedContent}>
          <Ionicons name="lock-closed-outline" size={48} color="#999" />
          <Text style={styles.blockedTitle}>RSVP Not Available</Text>
          <Text style={styles.blockedMessage}>
            {!event
              ? "This event could not be found."
              : !event.rsvpEnabled
                ? "RSVP is not enabled for this event."
                : "You must be a member of this group to RSVP to this event."}
          </Text>
          <TouchableOpacity
            style={styles.blockedButton}
            onPress={() => router.back()}
          >
            <Text style={styles.blockedButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

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
          <Text style={styles.title}>Enter your phone number</Text>
          <Text style={styles.subtitle}>
            We'll send you a verification code to confirm your RSVP
          </Text>

          <PhoneInput
            value={phone}
            onChangeText={setPhone}
            countryCode={countryCode}
            onCountryCodeChange={setCountryCode}
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
  centeredContent: {
    justifyContent: "center",
    alignItems: "center",
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
  blockedContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  blockedTitle: {
    fontSize: 22,
    fontWeight: "600",
    color: "#333",
    marginTop: 16,
    marginBottom: 8,
  },
  blockedMessage: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  blockedButton: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  blockedButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
