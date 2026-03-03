import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@utils/query-keys";
import { api } from "@services/api";
import { AuthGuard } from "@components/guards/AuthGuard";
import { Ionicons } from "@expo/vector-icons";

function GetStartedScreen() {
  const router = useRouter();

  const { data: subscriptions, isLoading } = useQuery({
    queryKey: queryKeys.subscriptions.list(),
    queryFn: async () => {
      try {
        const response = await api.getSubscriptionsList();
        return Array.isArray(response?.data) ? response.data : [];
      } catch (error) {
        return [];
      }
    },
  });

  const sortedSubscriptions =
    subscriptions?.sort((a: any, b: any) => (a.price || 0) - (b.price || 0)) ||
    [];

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
            <Text style={styles.headerTitle}>Get Started</Text>
            <View style={styles.headerRight} />
          </View>

          <View style={styles.content}>
            <Text style={styles.sectionTitle}>Start Your Journey</Text>
            <Text style={styles.description}>
              Choose a plan and get started with Togather today.
            </Text>

            {isLoading ? (
              <Text style={styles.loadingText}>Loading plans...</Text>
            ) : sortedSubscriptions.length > 0 ? (
              <View style={styles.plansContainer}>
                {sortedSubscriptions.map((plan: any, index: number) => (
                  <View key={index} style={styles.planCard}>
                    <Text style={styles.planName}>
                      {plan.name || `Plan ${index + 1}`}
                    </Text>
                    <Text style={styles.planPrice}>
                      ${plan.price || 0}
                      {plan.interval && (
                        <Text style={styles.planInterval}>
                          /{plan.interval}
                        </Text>
                      )}
                    </Text>
                    {plan.description && (
                      <Text style={styles.planDescription}>
                        {plan.description}
                      </Text>
                    )}
                    <TouchableOpacity
                      style={styles.planButton}
                      onPress={() => router.push("/signup")}
                    >
                      <Text style={styles.planButtonText}>Sign Up</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : (
              <TouchableOpacity
                style={styles.button}
                onPress={() => router.push("/signup")}
              >
                <Text style={styles.buttonText}>Create Account</Text>
              </TouchableOpacity>
            )}
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
  loadingText: {
    fontSize: 16,
    color: "#999",
    textAlign: "center",
    marginTop: 40,
  },
  plansContainer: {
    gap: 16,
  },
  planCard: {
    backgroundColor: "#f9f9f9",
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  planName: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  planPrice: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#007AFF",
    marginBottom: 12,
  },
  planInterval: {
    fontSize: 16,
    color: "#666",
    fontWeight: "normal",
  },
  planDescription: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
    marginBottom: 20,
  },
  planButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  planButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  button: {
    backgroundColor: "#007AFF",
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 16,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
});

export default GetStartedScreen;
