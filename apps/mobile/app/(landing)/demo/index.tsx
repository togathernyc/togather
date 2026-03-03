import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { useRouter } from "expo-router";
import { AuthGuard } from "@components/guards/AuthGuard";
import { Ionicons } from "@expo/vector-icons";

function DemoScreen() {
  const router = useRouter();

  return (
    <AuthGuard>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <Ionicons name="arrow-back" size={24} color="#333" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Demo</Text>
            <View style={styles.headerRight} />
          </View>

          <View style={styles.content}>
            <Text style={styles.sectionTitle}>Try Togather</Text>
            <Text style={styles.description}>
              Experience what Togather has to offer. Sign up for a free trial to
              explore all features.
            </Text>

            <TouchableOpacity
              style={styles.button}
              onPress={() => router.push("/signup")}
            >
              <Text style={styles.buttonText}>Get Started Free</Text>
            </TouchableOpacity>

            <View style={styles.featuresContainer}>
              <View style={styles.feature}>
                <Ionicons name="people" size={24} color="#007AFF" />
                <Text style={styles.featureTitle}>Connect Your Community</Text>
                <Text style={styles.featureDescription}>
                  Bring your community together with groups and messaging
                </Text>
              </View>

              <View style={styles.feature}>
                <Ionicons name="calendar" size={24} color="#007AFF" />
                <Text style={styles.featureTitle}>Manage Events</Text>
                <Text style={styles.featureDescription}>
                  Organize events and track RSVPs easily
                </Text>
              </View>

              <View style={styles.feature}>
                <Ionicons name="stats-chart" size={24} color="#007AFF" />
                <Text style={styles.featureTitle}>Leader Tools</Text>
                <Text style={styles.featureDescription}>
                  Powerful reporting and management tools for leaders
                </Text>
              </View>
            </View>
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
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
  },
  headerRight: {
    width: 40,
  },
  content: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    color: "#666",
    lineHeight: 24,
    marginBottom: 24,
  },
  button: {
    backgroundColor: "#007AFF",
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 32,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  featuresContainer: {
    gap: 24,
  },
  feature: {
    padding: 16,
    backgroundColor: "#f9f9f9",
    borderRadius: 12,
  },
  featureTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginTop: 12,
    marginBottom: 8,
  },
  featureDescription: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
  },
});

export default DemoScreen;
