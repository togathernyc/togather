/**
 * IntegrationsScreen - List of available third-party integrations.
 *
 * Shows all available integrations (Planning Center, etc.) with their
 * connection status. Allows admins to connect/manage integrations.
 */

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { Card } from "@components/ui";
import { useAvailableIntegrations } from "../hooks/useIntegrations";
import { useTheme } from "@hooks/useTheme";

export function IntegrationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const { data: integrations, isLoading } = useAvailableIntegrations();
  const { colors } = useTheme();

  // Only admins can manage integrations
  const isAdmin = user?.is_admin === true;

  if (!isAdmin) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Integrations</Text>
          <View style={styles.placeholder} />
        </View>

        <View style={styles.centerContainer}>
          <Ionicons name="lock-closed-outline" size={64} color={colors.iconSecondary} />
          <Text style={styles.emptyText}>
            Only community admins can manage integrations
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Integrations</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content}>
        <Text style={styles.sectionDescription}>
          Connect third-party services to sync groups, events, and members.
        </Text>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.text} />
          </View>
        ) : integrations && integrations.length > 0 ? (
          <View style={styles.integrationsContainer}>
            {integrations.map((integration) => (
              <Card
                key={integration.type}
                style={styles.integrationCard}
                onPress={() => {
                  if (integration.type === "planning_center") {
                    router.push("/leader-tools/integrations/planning-center");
                  }
                }}
              >
                <View style={styles.integrationContent}>
                  <View style={styles.integrationInfo}>
                    <Text style={styles.integrationName}>
                      {integration.display_name}
                    </Text>
                    <Text style={styles.integrationDescription}>
                      {integration.description}
                    </Text>
                  </View>

                  <View style={styles.integrationStatus}>
                    {integration.is_connected ? (
                      <View style={styles.connectedBadge}>
                        <Ionicons
                          name="checkmark-circle"
                          size={20}
                          color={colors.success}
                        />
                        <Text style={styles.connectedText}>Connected</Text>
                      </View>
                    ) : (
                      <Ionicons
                        name="chevron-forward"
                        size={24}
                        color={colors.iconSecondary}
                      />
                    )}
                  </View>
                </View>
              </Card>
            ))}
          </View>
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons name="link-outline" size={64} color={colors.iconSecondary} />
            <Text style={styles.emptyText}>No integrations available</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fafafa", // Will be overridden dynamically
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff", // Will be overridden dynamically
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5ea", // Will be overridden dynamically
  },
  backButton: {
    padding: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    color: "#222224",
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  sectionDescription: {
    fontSize: 16,
    color: "#666668",
    marginBottom: 24,
    lineHeight: 22,
  },
  loadingContainer: {
    padding: 40,
    alignItems: "center",
  },
  integrationsContainer: {
    gap: 16,
  },
  integrationCard: {
    padding: 16,
  },
  integrationContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  integrationInfo: {
    flex: 1,
    marginRight: 16,
  },
  integrationName: {
    fontSize: 18,
    fontWeight: "600",
    color: "#222224",
    marginBottom: 4,
  },
  integrationDescription: {
    fontSize: 14,
    color: "#666668",
    lineHeight: 20,
  },
  integrationStatus: {
    alignItems: "center",
  },
  connectedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#E8F5E9",
    borderRadius: 12,
  },
  connectedText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#34C759",
  },
  emptyContainer: {
    padding: 40,
    alignItems: "center",
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: "#666668",
    marginTop: 16,
    textAlign: "center",
  },
});
