/**
 * IntegrationsContent - Content component for integrations list.
 *
 * Displays available integrations without header/safe area handling.
 * Used within AdminScreen's segmented control.
 */

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { Card } from "@components/ui";
import { useAvailableIntegrations } from "../hooks/useIntegrations";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useCommunityTheme } from "@hooks/useCommunityTheme";

export function IntegrationsContent() {
  const router = useRouter();
  const { user } = useAuth();
  const { primaryColor } = useCommunityTheme();

  const { data: integrations, isLoading, refetch, isRefetching } = useAvailableIntegrations();

  // Only admins can manage integrations
  const isAdmin = user?.is_admin === true;

  if (!isAdmin) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="lock-closed-outline" size={64} color="#ccccd1" />
        <Text style={styles.emptyText}>
          Only community admins can manage integrations
        </Text>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={primaryColor} />
        <Text style={styles.loadingText}>Loading integrations...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
      >
        <Text style={styles.sectionDescription}>
          Connect third-party services to sync groups, events, and members.
        </Text>

        {integrations && integrations.length > 0 ? (
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
                          color="#34C759"
                        />
                        <Text style={styles.connectedText}>Connected</Text>
                      </View>
                    ) : (
                      <Ionicons
                        name="chevron-forward"
                        size={24}
                        color="#ccccd1"
                      />
                    )}
                  </View>
                </View>
              </Card>
            ))}
          </View>
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons name="link-outline" size={64} color="#ccccd1" />
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
    backgroundColor: "#f5f5f5",
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#666",
  },
  content: {
    flex: 1,
    padding: 16,
  },
  sectionDescription: {
    fontSize: 14,
    color: "#666",
    marginBottom: 20,
    lineHeight: 20,
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
  emptyText: {
    fontSize: 16,
    color: "#666668",
    marginTop: 16,
    textAlign: "center",
  },
});
