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

export default function PinChannelsRoute() {
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
        <View style={styles.container}>
          <Text style={styles.errorText}>Group not found</Text>
        </View>
      </UserRoute>
    );
  }

  return (
    <UserRoute>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Pin Channels</Text>
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
    backgroundColor: "#F5F5F5",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    textAlign: "center",
    marginRight: 32, // Balance the back button
  },
  headerSpacer: {
    width: 32,
  },
  errorText: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginTop: 40,
  },
});
