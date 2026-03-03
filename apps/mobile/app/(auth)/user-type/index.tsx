import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

export default function UserTypePage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  const phone = params.phone as string || "";
  const countryCode = params.countryCode as string || "US";
  const otp = params.otp as string || "";
  const phoneVerificationToken = params.phoneVerificationToken as string || "";
  const fromRejection = params.fromRejection === "true";

  const handleNewUser = () => {
    // Navigate to profile collection screen first
    router.replace({
      pathname: "/(auth)/new-user-profile",
      params: {
        phone,
        countryCode,
        otp,
        phoneVerificationToken,
      },
    });
  };

  const handleExistingUser = () => {
    // Navigate to claim account flow (use push so user can go back)
    router.push({
      pathname: "/(auth)/claim-account/email",
      params: {
        phone,
        countryCode,
        otp,
      },
    });
  };

  const handleBack = () => {
    // Only show back button if they came from rejection
    if (fromRejection) {
      router.back();
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
          {fromRejection && (
            <TouchableOpacity style={styles.backButton} onPress={handleBack}>
              <Ionicons name="arrow-back" size={24} color="#007AFF" />
            </TouchableOpacity>
          )}

          <View style={styles.content}>
            <Text style={styles.title}>Are you new to Togather?</Text>
            <Text style={styles.subtitle}>
              Let us know if you're creating a new account or if you already have one.
            </Text>

            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[styles.button, styles.primaryButton]}
                onPress={handleNewUser}
              >
                <View style={styles.buttonContent}>
                  <Ionicons name="person-add-outline" size={24} color="#fff" />
                  <View style={styles.buttonTextContainer}>
                    <Text style={styles.primaryButtonText}>I'm new</Text>
                    <Text style={styles.buttonSubtext}>Create a new account</Text>
                  </View>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={handleExistingUser}
              >
                <View style={styles.buttonContent}>
                  <Ionicons name="person-outline" size={24} color="#007AFF" />
                  <View style={styles.buttonTextContainer}>
                    <Text style={styles.secondaryButtonText}>I have an account</Text>
                    <Text style={[styles.buttonSubtext, { color: "#666" }]}>
                      Link my phone to existing account
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>
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
    marginBottom: 40,
    textAlign: "center",
    lineHeight: 22,
  },
  buttonContainer: {
    gap: 16,
  },
  button: {
    borderRadius: 12,
    padding: 20,
    borderWidth: 2,
  },
  primaryButton: {
    backgroundColor: "#007AFF",
    borderColor: "#007AFF",
  },
  secondaryButton: {
    backgroundColor: "#fff",
    borderColor: "#e0e0e0",
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  buttonTextContainer: {
    flex: 1,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 4,
  },
  secondaryButtonText: {
    color: "#007AFF",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 4,
  },
  buttonSubtext: {
    fontSize: 14,
    color: "#fff",
    opacity: 0.9,
  },
});
