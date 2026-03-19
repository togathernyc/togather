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
import { useTheme } from "@hooks/useTheme";

export function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { colors } = useTheme();
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
      <ScrollView style={[styles.scrollView, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={[styles.header, { paddingTop: insets.top + 16, backgroundColor: colors.backgroundSecondary }]}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Profile</Text>
        </View>

        <ProfileHeader user={user} />
        <ProfileMenu />

        {/* Dev Tools Section - only visible in dev/staging */}
        {showDevTools && (
          <Card style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.textTertiary }]}>Developer Tools</Text>
            <TouchableOpacity
              style={[styles.menuItem, { borderBottomColor: colors.border }]}
              onPress={() => router.push("/(user)/dev/feature-flags")}
              activeOpacity={0.7}
            >
              <View style={[styles.menuIconContainer, { backgroundColor: colors.surfaceSecondary }]}>
                <Ionicons name="flag-outline" size={20} color={colors.text} />
              </View>
              <View style={styles.menuTextContainer}>
                <Text style={[styles.menuText, { color: colors.text }]}>Feature Flags</Text>
                <Text style={[styles.menuSubtext, { color: colors.textTertiary }]}>
                  View and override PostHog feature flags
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.iconSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.menuItem, { borderBottomColor: colors.border }]}
              onPress={() => router.push("/(user)/dev/notifications")}
              activeOpacity={0.7}
            >
              <View style={[styles.menuIconContainer, { backgroundColor: colors.surfaceSecondary }]}>
                <Ionicons name="notifications-outline" size={20} color={colors.text} />
              </View>
              <View style={styles.menuTextContainer}>
                <Text style={[styles.menuText, { color: colors.text }]}>Notification Tester</Text>
                <Text style={[styles.menuSubtext, { color: colors.textTertiary }]}>
                  Test push notifications and deep links
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.iconSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.menuItem, { borderBottomColor: colors.border }]}
              onPress={() => router.push("/(user)/dev/theme-gallery")}
              activeOpacity={0.7}
            >
              <View style={[styles.menuIconContainer, { backgroundColor: colors.surfaceSecondary }]}>
                <Ionicons name="color-palette-outline" size={20} color={colors.text} />
              </View>
              <View style={styles.menuTextContainer}>
                <Text style={[styles.menuText, { color: colors.text }]}>Theme Gallery</Text>
                <Text style={[styles.menuSubtext, { color: colors.textTertiary }]}>
                  Preview all components in light/dark mode
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.iconSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.menuItem, styles.menuItemLast, { borderBottomColor: colors.border }]}
              onPress={() => router.push("/(user)/dev/task-reminder-tester")}
              activeOpacity={0.7}
            >
              <View style={[styles.menuIconContainer, { backgroundColor: colors.surfaceSecondary }]}>
                <Ionicons name="clipboard-outline" size={20} color={colors.text} />
              </View>
              <View style={styles.menuTextContainer}>
                <Text style={[styles.menuText, { color: colors.text }]}>Task Reminder Tester</Text>
                <Text style={[styles.menuSubtext, { color: colors.textTertiary }]}>
                  Test task reminder bot with mentions
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.iconSecondary} />
            </TouchableOpacity>
          </Card>
        )}

        {/* Logout - subtle row item like ChatGPT */}
        <Card style={styles.section}>
          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemLast, { borderBottomColor: colors.border }]}
            onPress={handleLogout}
            activeOpacity={0.7}
          >
            <View style={[styles.menuIconContainer, { backgroundColor: colors.surfaceSecondary }]}>
              <Ionicons name="log-out-outline" size={20} color={colors.text} />
            </View>
            <Text style={[styles.menuText, { color: colors.text }]}>Log out</Text>
          </TouchableOpacity>
        </Card>
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
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
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
    marginTop: 8,
    marginBottom: 4,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuItemLast: {
    borderBottomWidth: 0,
  },
  menuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  menuText: {
    flex: 1,
    fontSize: 16,
    fontWeight: "400",
  },
  menuTextContainer: {
    flex: 1,
  },
  menuSubtext: {
    fontSize: 13,
    marginTop: 2,
  },
});
