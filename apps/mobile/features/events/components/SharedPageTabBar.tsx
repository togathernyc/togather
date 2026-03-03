import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface SharedPageTabBarProps {
  hasActiveCommunity: boolean;
  isAdmin: boolean;
}

/**
 * SharedPageTabBar - Bottom navigation for authenticated users on shared pages
 *
 * Shows a minimal tab bar with navigation to main app sections:
 * - Explore (always)
 * - Inbox (if user has an active community)
 * - Admin (if user is an admin)
 * - Profile (always)
 */
export function SharedPageTabBar({
  hasActiveCommunity,
  isAdmin,
}: SharedPageTabBarProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const tabs = [
    {
      key: "explore",
      label: "Explore",
      icon: "globe-outline" as const,
      iconFocused: "globe" as const,
      route: "/(tabs)/search",
      show: true,
    },
    {
      key: "inbox",
      label: "Inbox",
      icon: "chatbubbles-outline" as const,
      iconFocused: "chatbubbles" as const,
      route: "/(tabs)/chat",
      show: hasActiveCommunity,
    },
    {
      key: "admin",
      label: "Admin",
      icon: "shield-checkmark-outline" as const,
      iconFocused: "shield-checkmark" as const,
      route: "/(tabs)/admin",
      show: isAdmin,
    },
    {
      key: "profile",
      label: "Profile",
      icon: "person-outline" as const,
      iconFocused: "person" as const,
      route: "/(tabs)/profile",
      show: true,
    },
  ];

  const visibleTabs = tabs.filter((tab) => tab.show);

  const handleTabPress = (route: string) => {
    router.push(route as any);
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 8 }]}>
      {visibleTabs.map((tab) => (
        <TouchableOpacity
          key={tab.key}
          style={styles.tab}
          onPress={() => handleTabPress(tab.route)}
          activeOpacity={0.7}
        >
          <Ionicons name={tab.icon} size={24} color="#666" />
          <Text style={styles.tabLabel}>{tab.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#666",
    marginTop: 4,
  },
});
