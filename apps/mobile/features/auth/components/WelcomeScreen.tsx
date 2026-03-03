// WelcomeScreen component - welcome screen after sign up

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthGuard } from "@components/guards/AuthGuard";
import { Ionicons } from "@expo/vector-icons";

export function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <AuthGuard>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}>
          <View style={styles.content}>
            <View style={styles.iconContainer}>
              <Ionicons name="checkmark-circle" size={80} color="#34C759" />
            </View>
            <Text style={styles.title}>Welcome to Togather!</Text>
            <Text style={styles.description}>
              Your account has been created successfully. You're all set to
              start connecting with your community.
            </Text>

            <View style={styles.featuresContainer}>
              <View style={styles.feature}>
                <Ionicons name="people" size={24} color="#007AFF" />
                <Text style={styles.featureText}>Join Groups</Text>
              </View>
              <View style={styles.feature}>
                <Ionicons name="chatbubbles" size={24} color="#007AFF" />
                <Text style={styles.featureText}>Send Messages</Text>
              </View>
              <View style={styles.feature}>
                <Ionicons name="calendar" size={24} color="#007AFF" />
                <Text style={styles.featureText}>RSVP to Events</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.button}
              onPress={() => router.push("/inbox")}
            >
              <Text style={styles.buttonText}>Get Started</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </AuthGuard>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 20,
  },
  content: {
    alignItems: "center",
    maxWidth: 400,
    alignSelf: "center",
    width: "100%",
  },
  iconContainer: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 12,
    textAlign: "center",
  },
  description: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 32,
  },
  featuresContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    width: "100%",
    marginBottom: 32,
  },
  feature: {
    alignItems: "center",
    gap: 8,
  },
  featureText: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  button: {
    backgroundColor: "#007AFF",
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 8,
    width: "100%",
    maxWidth: 300,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
});

