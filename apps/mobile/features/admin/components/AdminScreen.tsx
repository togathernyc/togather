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
import { useTheme } from "@hooks/useTheme";
import { PendingRequestsContent } from "./PendingRequestsContent";
import { StatsContent } from "./StatsContent";
import { PeopleContent } from "./PeopleContent";
import { SettingsContent } from "./SettingsContent";
import { SuperAdminDashboardContent } from "./SuperAdminDashboardContent";

type TabKey = "dashboard" | "requests" | "people" | "stats" | "settings";

interface Tab {
  key: TabKey;
  label: string;
}

export function AdminScreen() {
  const insets = useSafeAreaInsets();
  const { community, user } = useAuth();
  const { colors } = useTheme();
  const isInternalDashboardUser =
    user?.is_staff === true || user?.is_superuser === true;
  const isAdmin = user?.is_admin === true;
  const hasCommunity = !!community?.id;
  const tabs: Tab[] = useMemo(
    () => {
      if (isInternalDashboardUser && !isAdmin) {
        return [{ key: "dashboard", label: "Dashboard" }];
      }

      if (isInternalDashboardUser && !hasCommunity) {
        return [{ key: "dashboard", label: "Dashboard" }];
      }

      if (isInternalDashboardUser) {
        return [
          { key: "requests", label: "Requests" },
          { key: "people", label: "People" },
          { key: "stats", label: "Stats" },
          { key: "settings", label: "Settings" },
          { key: "dashboard", label: "Dashboard" },
        ];
      }

      return [
        { key: "requests", label: "Requests" },
        { key: "people", label: "People" },
        { key: "stats", label: "Stats" },
        { key: "settings", label: "Settings" },
      ];
    },
    [hasCommunity, isInternalDashboardUser, isAdmin]
  );
  const [activeTab, setActiveTab] = useState<TabKey>(
    "requests"
  );

  useEffect(() => {
    if (!tabs.some((tab) => tab.key === activeTab)) {
      setActiveTab(tabs[0].key);
    }
  }, [tabs, activeTab]);

  // Show message when user has no community context (except for internal dashboard users)
  if (!hasCommunity && !isInternalDashboardUser) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={[styles.header, { paddingTop: insets.top + 16, backgroundColor: colors.surface }]}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Admin</Text>
        </View>
        <View style={styles.noCommunityContainer}>
          <Ionicons name="shield-outline" size={48} color={colors.borderLight} style={{ marginBottom: 16 }} />
          <Text style={[styles.noCommunityTitle, { color: colors.text }]}>No Community Selected</Text>
          <Text style={[styles.noCommunitySubtext, { color: colors.textSecondary }]}>
            Join a community to access admin features
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16, backgroundColor: colors.surface }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Admin</Text>

        {/* Segmented Control */}
        <View style={[styles.segmentedControl, { backgroundColor: colors.surfaceSecondary }]}>
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.segment,
                activeTab === tab.key && [styles.segmentActive, { backgroundColor: colors.surface }],
              ]}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.segmentText,
                  { color: colors.textSecondary },
                  activeTab === tab.key && [styles.segmentTextActive, { color: colors.text }],
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
        ) : (
          <SettingsContent />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 16,
  },
  segmentedControl: {
    flexDirection: "row",
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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: {
    fontSize: 15,
    fontWeight: "500",
  },
  segmentTextActive: {
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
    marginBottom: 8,
    textAlign: "center",
  },
  noCommunitySubtext: {
    fontSize: 16,
    textAlign: "center",
  },
});
