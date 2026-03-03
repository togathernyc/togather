import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { useAuth } from "@providers/AuthProvider";
import { UserRoute } from "@components/guards/UserRoute";
import { Card } from "@components/ui";
import { Ionicons } from "@expo/vector-icons";
import { ProfileHeader } from "./ProfileHeader";
import { ProfileMenu } from "./ProfileMenu";
import { Environment } from "@/services/environment";
import { isDevToolsEscapeHatchEnabled } from "@hooks/useDevToolsEscapeHatch";


export function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [escapeHatchEnabled, setEscapeHatchEnabled] = useState(false);

  // Check for escape hatch when screen focuses (re-checks after Settings changes)
  useFocusEffect(
    useCallback(() => {
      const checkEscapeHatch = async () => {
        const enabled = await isDevToolsEscapeHatchEnabled();
        setEscapeHatchEnabled(enabled);
      };
      checkEscapeHatch();
    }, [])
  );

  // Show dev tools in dev mode, staging builds, or when escape hatch is enabled
  const showDevTools = __DEV__ || Environment.isStaging() || escapeHatchEnabled;

  const handleLogout = async () => {
    await logout();
    router.replace("/");
  };

  return (
    <UserRoute>
      <ScrollView style={styles.scrollView}>
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <Text style={styles.headerTitle}>Profile</Text>
        </View>

        <ProfileHeader user={user} />
        <ProfileMenu />

        <Card style={styles.section}>
          <TouchableOpacity
            style={styles.logoutButton}
            onPress={handleLogout}
            activeOpacity={0.8}
          >
            <Ionicons name="log-out-outline" size={20} color="#fff" />
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </Card>

        {/* Dev Tools Section - only visible in dev/staging */}
        {showDevTools && (
          <Card style={styles.section}>
            <Text style={styles.devSectionTitle}>Developer Tools</Text>
            <TouchableOpacity
              style={styles.devMenuItem}
              onPress={() => router.push("/(user)/dev/feature-flags")}
              activeOpacity={0.7}
            >
              <View style={styles.devMenuIconContainer}>
                <Ionicons name="flag-outline" size={20} color="#007AFF" />
              </View>
              <View style={styles.devMenuTextContainer}>
                <Text style={styles.devMenuText}>Feature Flags</Text>
                <Text style={styles.devMenuSubtext}>
                  View and override PostHog feature flags
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#999" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devMenuItem}
              onPress={() => router.push("/(user)/dev/notifications")}
              activeOpacity={0.7}
            >
              <View style={styles.devMenuIconContainer}>
                <Ionicons name="notifications-outline" size={20} color="#007AFF" />
              </View>
              <View style={styles.devMenuTextContainer}>
                <Text style={styles.devMenuText}>Notification Tester</Text>
                <Text style={styles.devMenuSubtext}>
                  Test push notifications and deep links
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#999" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.devMenuItem}
              onPress={() => router.push("/(user)/dev/task-reminder-tester")}
              activeOpacity={0.7}
            >
              <View style={styles.devMenuIconContainer}>
                <Ionicons name="clipboard-outline" size={20} color="#007AFF" />
              </View>
              <View style={styles.devMenuTextContainer}>
                <Text style={styles.devMenuText}>Task Reminder Tester</Text>
                <Text style={styles.devMenuSubtext}>
                  Test task reminder bot with mentions
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#999" />
            </TouchableOpacity>
          </Card>
        )}
      </ScrollView>
    </UserRoute>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: "#fff",
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
  },
  section: {
    marginTop: 12,
    marginHorizontal: 12,
    padding: 20,
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FF3B30",
    borderRadius: 12,
    padding: 16,
    gap: 8,
    ...Platform.select({
      web: {
        boxShadow: "0px 2px 8px rgba(255, 59, 48, 0.3)",
        cursor: "pointer",
      },
      default: {
        shadowColor: "#FF3B30",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 3,
      },
    }),
  },
  logoutText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  devSectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#007AFF",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  devMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
  },
  devMenuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#e8f4ff",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  devMenuTextContainer: {
    flex: 1,
  },
  devMenuText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
  },
  devMenuSubtext: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
});
