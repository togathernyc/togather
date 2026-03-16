/**
 * AdminScreen - Main admin hub with segmented control.
 *
 * Displays a segmented control to switch between:
 * - Requests: Pending group join requests
 * - Apps: Third-party integrations management
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { PendingRequestsContent } from "./PendingRequestsContent";
import { StatsContent } from "./StatsContent";
import { PeopleContent } from "./PeopleContent";
import { SettingsContent } from "./SettingsContent";
import { LandingPageContent } from "./LandingPageContent";
import { SuperAdminDashboardContent } from "./SuperAdminDashboardContent";

type TabKey = "dashboard" | "requests" | "people" | "stats" | "settings" | "landing";

interface Tab {
  key: TabKey;
  label: string;
}

export function AdminScreen() {
  const insets = useSafeAreaInsets();
  const { community, user } = useAuth();
  const isPrimaryAdmin = user?.is_primary_admin === true;
  const tabs: Tab[] = useMemo(
    () =>
      isPrimaryAdmin
        ? [
            { key: "dashboard", label: "Dashboard" },
            { key: "requests", label: "Requests" },
            { key: "people", label: "People" },
            { key: "stats", label: "Stats" },
            { key: "settings", label: "Settings" },
            { key: "landing", label: "Landing" },
          ]
        : [
            { key: "requests", label: "Requests" },
            { key: "people", label: "People" },
            { key: "stats", label: "Stats" },
            { key: "settings", label: "Settings" },
            { key: "landing", label: "Landing" },
          ],
    [isPrimaryAdmin]
  );
  const [activeTab, setActiveTab] = useState<TabKey>(isPrimaryAdmin ? "dashboard" : "requests");
  const hasCommunity = !!community?.id;

  useEffect(() => {
    if (!tabs.some((tab) => tab.key === activeTab)) {
      setActiveTab(tabs[0].key);
    }
  }, [tabs, activeTab]);

  // Show message when user has no community context
  if (!hasCommunity) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <Text style={styles.headerTitle}>Admin</Text>
        </View>
        <View style={styles.noCommunityContainer}>
          <Ionicons name="shield-outline" size={48} color="#ccc" style={{ marginBottom: 16 }} />
          <Text style={styles.noCommunityTitle}>No Community Selected</Text>
          <Text style={styles.noCommunitySubtext}>
            Join a community to access admin features
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.headerTitle}>Admin</Text>

        {/* Segmented Control */}
        <View style={styles.segmentedControl}>
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.segment,
                activeTab === tab.key && styles.segmentActive,
              ]}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.segmentText,
                  activeTab === tab.key && styles.segmentTextActive,
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Content */}
      <View style={styles.content}>
        {activeTab === "dashboard" ? (
          <SuperAdminDashboardContent />
        ) : activeTab === "requests" ? (
          <PendingRequestsContent />
        ) : activeTab === "people" ? (
          <PeopleContent />
        ) : activeTab === "stats" ? (
          <StatsContent />
        ) : activeTab === "settings" ? (
          <SettingsContent />
        ) : (
          <LandingPageContent />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    backgroundColor: "#fff",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 16,
  },
  segmentedControl: {
    flexDirection: "row",
    backgroundColor: "#f0f0f0",
    borderRadius: 10,
    padding: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 8,
  },
  segmentActive: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#666",
  },
  segmentTextActive: {
    color: "#333",
    fontWeight: "600",
  },
  content: {
    flex: 1,
  },
  noCommunityContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  noCommunityTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
    textAlign: "center",
  },
  noCommunitySubtext: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
  },
});
