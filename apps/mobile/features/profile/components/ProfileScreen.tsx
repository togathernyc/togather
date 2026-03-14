import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
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

// Design constants
const ICON_COLOR = "#1a1a1a";
const ICON_BG = "#f5f5f5";


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

        {/* Dev Tools Section - only visible in dev/staging */}
        {showDevTools && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Developer Tools</Text>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push("/(user)/dev/feature-flags")}
              activeOpacity={0.7}
            >
              <View style={styles.menuIconContainer}>
                <Ionicons name="flag-outline" size={20} color={ICON_COLOR} />
              </View>
              <View style={styles.menuTextContainer}>
                <Text style={styles.menuText}>Feature Flags</Text>
                <Text style={styles.menuSubtext}>
                  View and override PostHog feature flags
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push("/(user)/dev/notifications")}
              activeOpacity={0.7}
            >
              <View style={styles.menuIconContainer}>
                <Ionicons name="notifications-outline" size={20} color={ICON_COLOR} />
              </View>
              <View style={styles.menuTextContainer}>
                <Text style={styles.menuText}>Notification Tester</Text>
                <Text style={styles.menuSubtext}>
                  Test push notifications and deep links
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.menuItem, styles.menuItemLast]}
              onPress={() => router.push("/(user)/dev/task-reminder-tester")}
              activeOpacity={0.7}
            >
              <View style={styles.menuIconContainer}>
                <Ionicons name="clipboard-outline" size={20} color={ICON_COLOR} />
              </View>
              <View style={styles.menuTextContainer}>
                <Text style={styles.menuText}>Task Reminder Tester</Text>
                <Text style={styles.menuSubtext}>
                  Test task reminder bot with mentions
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
            </TouchableOpacity>
          </Card>
        )}

        {/* Logout - subtle row item like ChatGPT */}
        <Card style={styles.section}>
          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemLast]}
            onPress={handleLogout}
            activeOpacity={0.7}
          >
            <View style={styles.menuIconContainer}>
              <Ionicons name="log-out-outline" size={20} color={ICON_COLOR} />
            </View>
            <Text style={styles.menuText}>Log out</Text>
          </TouchableOpacity>
        </Card>
      </ScrollView>
    </UserRoute>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: "#f2f2f7",
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: "#f2f2f7",
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: "700",
    color: "#1a1a1a",
    letterSpacing: -0.5,
  },
  section: {
    marginTop: 12,
    marginHorizontal: 16,
    paddingVertical: 4,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: "#8e8e93",
    marginTop: 8,
    marginBottom: 4,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  menuItemLast: {
    borderBottomWidth: 0,
  },
  menuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: ICON_BG,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  menuText: {
    flex: 1,
    fontSize: 16,
    fontWeight: "400",
    color: "#1a1a1a",
  },
  menuTextContainer: {
    flex: 1,
  },
  menuSubtext: {
    fontSize: 13,
    color: "#8e8e93",
    marginTop: 2,
  },
});
