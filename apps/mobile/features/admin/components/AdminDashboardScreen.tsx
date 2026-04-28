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
import { useTheme } from "@hooks/useTheme";

export function AdminDashboardScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
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
    <ScrollView style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View style={styles.headerTop}>
          <View>
            <Text style={[styles.welcomeText, { color: colors.text }]}>
              Welcome, {user?.first_name || "Admin"}!
            </Text>
            <Text style={[styles.dateText, { color: colors.textSecondary }]}>
              {format(new Date(), "MMM d, yyyy")}
            </Text>
          </View>
          <TouchableOpacity onPress={handleLogout} style={[styles.logoutButton, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
            <Text style={[styles.logoutText, { color: colors.text }]}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.statsContainer}>
        <View style={[styles.statCard, { backgroundColor: colors.surface }]}>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Total Attendance</Text>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {totalAttendance?.totalAttendance || 0}
          </Text>
          {dateRange && (
            <Text style={[styles.statSubtext, { color: colors.textTertiary }]}>
              {format(new Date(dateRange.startDate), "MMM d")} -{" "}
              {format(new Date(dateRange.endDate), "MMM d")}
            </Text>
          )}
        </View>

        <View style={[styles.statCard, { backgroundColor: colors.surface }]}>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>New Signups</Text>
          <Text style={[styles.statValue, { color: colors.text }]}>{newSignups?.newSignups || 0}</Text>
          {dateRange && <Text style={[styles.statSubtext, { color: colors.textTertiary }]}>Last 7 days</Text>}
        </View>

        <View style={[styles.statCard, { backgroundColor: colors.surface }]}>
          <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Active Groups</Text>
          <Text style={[styles.statValue, { color: colors.text }]}>{groupsList.length}</Text>
          <Text style={[styles.statSubtext, { color: colors.textTertiary }]}>Total groups</Text>
        </View>
      </View>

      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Quick Access</Text>
        <View style={styles.quickActions}>
          <TouchableOpacity
            style={[styles.actionCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
            onPress={() => router.push("/(user)/admin/community-wide-events")}
          >
            <Text style={[styles.actionTitle, { color: colors.text }]}>Community-Wide Events</Text>
            <Text style={[styles.actionSubtext, { color: colors.textSecondary }]}>Manage multi-group events</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
            onPress={() => router.push("/(user)/admin/duplicate-accounts")}
          >
            <Text style={[styles.actionTitle, { color: colors.text }]}>Duplicate Accounts</Text>
            <Text style={[styles.actionSubtext, { color: colors.textSecondary }]}>Merge duplicate users</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
            onPress={() => router.push("/(user)/admin/features" as any)}
          >
            <Text style={[styles.actionTitle, { color: colors.text }]}>Feature Flags</Text>
            <Text style={[styles.actionSubtext, { color: colors.textSecondary }]}>Toggle staged rollouts</Text>
          </TouchableOpacity>
          <View style={[styles.actionCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
            <Text style={[styles.actionTitle, { color: colors.text }]}>Groups</Text>
            <Text style={[styles.actionSubtext, { color: colors.textSecondary }]}>Manage small groups</Text>
          </View>
          <View style={[styles.actionCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
            <Text style={[styles.actionTitle, { color: colors.text }]}>Members</Text>
            <Text style={[styles.actionSubtext, { color: colors.textSecondary }]}>View member list</Text>
          </View>
          <View style={[styles.actionCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
            <Text style={[styles.actionTitle, { color: colors.text }]}>Reports</Text>
            <Text style={[styles.actionSubtext, { color: colors.textSecondary }]}>View analytics</Text>
          </View>
          <View style={[styles.actionCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
            <Text style={[styles.actionTitle, { color: colors.text }]}>Settings</Text>
            <Text style={[styles.actionSubtext, { color: colors.textSecondary }]}>Community settings</Text>
          </View>
        </View>
      </View>

      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Activity</Text>
        <Text style={[styles.placeholderText, { color: colors.textTertiary }]}>
          Recent activity will appear here
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    padding: 20,
    borderBottomWidth: 1,
  },
  welcomeText: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 4,
  },
  dateText: {
    fontSize: 14,
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
    marginBottom: 8,
  },
  statValue: {
    fontSize: 28,
    fontWeight: "bold",
  },
  statSubtext: {
    fontSize: 11,
    marginTop: 4,
  },
  section: {
    padding: 20,
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
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
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  actionSubtext: {
    fontSize: 12,
  },
  placeholderText: {
    fontSize: 14,
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
    borderWidth: 1,
  },
  logoutText: {
    fontSize: 14,
    fontWeight: "600",
  },
});

