/**
 * Pin Channels Route
 *
 * Dedicated route for the channel pinning screen.
 * Leaders can reorder pinned channels via drag-and-drop.
 */
import React from "react";
import { View, StyleSheet, TouchableOpacity, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { UserRoute } from "@components/guards/UserRoute";
import { ChannelPinningScreen } from "@features/leader-tools/components/ChannelPinningScreen";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";

export default function PinChannelsRoute() {
  const { colors } = useTheme();
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push(`/groups/${group_id}`);
    }
  };

  if (!group_id) {
    return (
      <UserRoute>
        <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>Group not found</Text>
        </View>
      </UserRoute>
    );
  }

  return (
    <UserRoute>
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.surfaceSecondary }]}>
        {/* Header */}
        <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Pin Channels</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Channel Pinning Content */}
        <ChannelPinningScreen
          groupId={group_id as Id<"groups">}
          onSave={handleBack}
        />
      </View>
    </UserRoute>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
    marginRight: 32, // Balance the back button
  },
  headerSpacer: {
    width: 32,
  },
  errorText: {
    fontSize: 16,
    textAlign: "center",
    marginTop: 40,
  },
});
