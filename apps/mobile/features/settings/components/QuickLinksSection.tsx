/**
 * Quick Links Section
 *
 * Admin-only shortcuts for operational screens.
 */
import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useAuth } from "@providers/AuthProvider";

export function QuickLinksSection() {
  const router = useRouter();
  const { primaryColor } = useCommunityTheme();
  const { user } = useAuth();

  // Only show for community admins
  if (!user?.is_admin) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Quick Links</Text>

      <TouchableOpacity
        style={styles.menuItem}
        onPress={() => router.push("/(user)/settings/archived-groups")}
      >
        <View style={styles.menuItemContent}>
          <Ionicons name="archive-outline" size={22} color="#666" style={styles.icon} />
          <View style={styles.menuItemText}>
            <Text style={styles.menuItemLabel}>Archived Groups</Text>
            <Text style={styles.menuItemDescription}>
              View and restore archived groups
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={primaryColor} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 12,
    backgroundColor: "#fff",
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 16,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#f8f9fa",
    borderRadius: 12,
    padding: 16,
  },
  menuItemContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  icon: {
    marginRight: 12,
  },
  menuItemText: {
    flex: 1,
  },
  menuItemLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  menuItemDescription: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
});

