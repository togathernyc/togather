import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { useDevAccess } from "@features/contribute/hooks/useDevAccess";

/**
 * Hidden-by-default entry point for the contributor dev dashboard (ADR-029).
 * Only rendered for users the dev-assistant maintainer check admits
 * (superuser/staff or the dev_maintainer platform role).
 */
export function ContributeSection() {
  const router = useRouter();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();
  const { hasAccess } = useDevAccess();

  if (!hasAccess) {
    return null;
  }

  return (
    <View style={[styles.section, { backgroundColor: colors.surface }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Contribute</Text>

      <TouchableOpacity
        style={[styles.menuItem, { backgroundColor: colors.surfaceSecondary }]}
        onPress={() => router.push("/(user)/dev")}
        activeOpacity={0.7}
      >
        <View style={styles.menuItemContent}>
          <Ionicons
            name="construct-outline"
            size={22}
            color={colors.icon}
            style={styles.icon}
          />
          <View style={styles.menuItemText}>
            <Text style={[styles.menuItemLabel, { color: colors.text }]}>
              Help build Togather
            </Text>
            <Text style={[styles.menuItemDescription, { color: colors.textSecondary }]}>
              Report bugs, suggest ideas, and follow them to shipped
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
