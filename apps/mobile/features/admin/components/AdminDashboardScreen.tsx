import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { format } from "date-fns";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@providers/AuthProvider";
import { useAdminDashboard } from "../hooks/useAdminDashboard";

export function AdminDashboardScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { totalAttendance, newSignups, groupsList, dateRange, isLoading } =
    useAdminDashboard();

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const handleLogout = async () => {
    await logout();
    router.replace("/(auth)/signin");
  };

  return (
    <ScrollView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.welcomeText}>
              Welcome, {user?.first_name || "Admin"}!
            </Text>
            <Text style={styles.dateText}>
              {format(new Date(), "MMM d, yyyy")}
            </Text>
          </View>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Total Attendance</Text>
          <Text style={styles.statValue}>
            {totalAttendance?.totalAttendance || 0}
          </Text>
          {dateRange && (
            <Text style={styles.statSubtext}>
              {format(new Date(dateRange.startDate), "MMM d")} -{" "}
              {format(new Date(dateRange.endDate), "MMM d")}
            </Text>
          )}
        </View>

        <View style={styles.statCard}>
          <Text style={styles.statLabel}>New Signups</Text>
          <Text style={styles.statValue}>{newSignups?.newSignups || 0}</Text>
          {dateRange && <Text style={styles.statSubtext}>Last 7 days</Text>}
        </View>

        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Active Groups</Text>
          <Text style={styles.statValue}>{groupsList.length}</Text>
          <Text style={styles.statSubtext}>Total groups</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Access</Text>
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push("/(user)/admin/community-wide-events")}
          >
            <Text style={styles.actionTitle}>Community-Wide Events</Text>
            <Text style={styles.actionSubtext}>Manage multi-group events</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => router.push("/(user)/admin/duplicate-accounts")}
          >
            <Text style={styles.actionTitle}>Duplicate Accounts</Text>
            <Text style={styles.actionSubtext}>Merge duplicate users</Text>
          </TouchableOpacity>
          <View style={styles.actionCard}>
            <Text style={styles.actionTitle}>Groups</Text>
            <Text style={styles.actionSubtext}>Manage small groups</Text>
          </View>
          <View style={styles.actionCard}>
            <Text style={styles.actionTitle}>Members</Text>
            <Text style={styles.actionSubtext}>View member list</Text>
          </View>
          <View style={styles.actionCard}>
            <Text style={styles.actionTitle}>Reports</Text>
            <Text style={styles.actionSubtext}>View analytics</Text>
          </View>
          <View style={styles.actionCard}>
            <Text style={styles.actionTitle}>Settings</Text>
            <Text style={styles.actionSubtext}>Community settings</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        <Text style={styles.placeholderText}>
          Recent activity will appear here
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    padding: 20,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  welcomeText: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 4,
  },
  dateText: {
    fontSize: 14,
    color: "#666",
  },
  statsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 12,
    gap: 12,
  },
  statCard: {
    flex: 1,
    minWidth: "30%",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 8,
  },
  statValue: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#333",
  },
  statSubtext: {
    fontSize: 11,
    color: "#999",
    marginTop: 4,
  },
  section: {
    padding: 20,
    backgroundColor: "#fff",
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 16,
  },
  quickActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  actionCard: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: "#f8f8f8",
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 4,
  },
  actionSubtext: {
    fontSize: 12,
    color: "#666",
  },
  placeholderText: {
    fontSize: 14,
    color: "#999",
    fontStyle: "italic",
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  logoutButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#f0f0f0",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  logoutText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
});

