import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { ThemedHeading } from "@components/ui/ThemedHeading";
import { useAuth } from "@providers/AuthProvider";
import { api, Id, useAuthenticatedQuery } from "@services/api/convex";

/**
 * Hidden-by-default entry point for Tasks.
 * Leaders can also access the Tasks workspace directly from Profile.
 */
export function LeaderToolsSection() {
  const router = useRouter();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();
  const { community } = useAuth();

  const hasLeaderAccess = useAuthenticatedQuery(
    api.functions.tasks.index.hasLeaderAccess,
    community?.id
      ? { communityId: community.id as Id<"communities"> }
      : "skip",
  );

  if (!community?.id || hasLeaderAccess !== true) {
    return null;
  }

  return (
    <View style={[styles.section, { backgroundColor: colors.surface }]}>
      <ThemedHeading level={2} style={[styles.sectionTitle, { color: colors.text }]}>Leader Tools</ThemedHeading>

      <TouchableOpacity
        style={[styles.menuItem, { backgroundColor: colors.surfaceSecondary }]}
        onPress={() =>
          router.push({
            pathname: "/tasks",
            params: { returnTo: "/(user)/settings" },
          })
        }
        activeOpacity={0.7}
      >
        <View style={styles.menuItemContent}>
          <Ionicons
            name="checkmark-done-outline"
            size={22}
            color={colors.icon}
            style={styles.icon}
          />
          <View style={styles.menuItemText}>
            <Text style={[styles.menuItemLabel, { color: colors.text }]}>Tasks</Text>
            <Text style={[styles.menuItemDescription, { color: colors.textSecondary }]}>
              Manage leader tasks
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
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 16,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  },
  menuItemDescription: {
    fontSize: 13,
    marginTop: 2,
  },
});
