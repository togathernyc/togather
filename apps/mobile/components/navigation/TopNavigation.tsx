import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter, useSegments } from "expo-router";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";

interface NavButton {
  label: string;
  route: string;
  icon?: string;
}

export function TopNavigation() {
  const router = useRouter();
  const segments = useSegments();
  const { user } = useAuth();
  const { primaryColor } = useCommunityTheme();

  const navButtons: NavButton[] = [
    { label: "Home", route: "/home" },
    { label: "Groups", route: "/groups" },
    { label: "Inbox", route: "/(tabs)/chat" },
  ];

  // Add Leader Tools if user is a leader
  if (user?.is_leader) {
    navButtons.push({
      label: "Leader Tools",
      route: "/leader-tools",
      icon: "🛠️",
    });
  }

  const isActive = (route: string) => {
    const currentPath = segments.join("/") || "home";
    if (route === "/home") {
      return currentPath === "home" || currentPath === "";
    }
    return currentPath === route.replace("/", "");
  };

  return (
    <View style={styles.container}>
      <View style={styles.navButtons}>
        {navButtons.map((button) => (
          <TouchableOpacity
            key={button.label}
            style={[
              styles.navButton,
              isActive(button.route) && styles.navButtonActive,
            ]}
            onPress={() => router.push(button.route as any)}
          >
            {button.icon && <Text style={styles.icon}>{button.icon}</Text>}
            <Text
              style={[
                styles.navText,
                isActive(button.route) && styles.navTextActive,
              ]}
            >
              {button.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity
        style={styles.profileButton}
        onPress={() => router.push("/(tabs)/profile" as any)}
      >
        <View style={[styles.profileIcon, { backgroundColor: primaryColor, borderColor: primaryColor }]}>
          <Text style={styles.profileIconText}>
            {user?.first_name?.[0] || user?.email?.[0] || "U"}
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
  },
  navButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  navButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  navButtonActive: {
    backgroundColor: "#f0f0f0",
  },
  icon: {
    fontSize: 18,
  },
  navText: {
    fontSize: 14,
    color: "#666",
    fontWeight: "500",
  },
  navTextActive: {
    color: "#333",
    fontWeight: "600",
  },
  profileButton: {
    padding: 4,
  },
  profileIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
  },
  profileIconText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
