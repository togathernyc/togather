import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppImage } from "@components/ui";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";

interface JoinCommunityCardProps {
  communityName: string;
  communityLogo: string | null;
  onJoinPress: () => void;
  isLoading?: boolean;
}

/**
 * JoinCommunityCard - Prompts users to join the event's host community
 *
 * Displayed on shared event pages (accessed via direct link without ?source=app)
 * for users who are not members of the host community.
 */
export function JoinCommunityCard({
  communityName,
  communityLogo,
  onJoinPress,
  isLoading = false,
}: JoinCommunityCardProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <AppImage
          source={communityLogo}
          style={styles.communityLogo}
          placeholder={{
            type: "initials",
            name: communityName,
          }}
        />
        <View style={styles.headerText}>
          <Text style={styles.title}>Join {communityName}</Text>
        </View>
      </View>

      <Text style={styles.description}>
        Join groups and be in the know on all the events and resources{" "}
        {communityName} has for you.
      </Text>

      <TouchableOpacity
        style={[styles.joinButton, isLoading && styles.joinButtonDisabled]}
        onPress={onJoinPress}
        disabled={isLoading}
        activeOpacity={0.8}
      >
        {isLoading ? (
          <Text style={styles.joinButtonText}>Joining...</Text>
        ) : (
          <>
            <Text style={styles.joinButtonText}>Join Community</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  communityLogo: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#f0f0f0",
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  description: {
    fontSize: 15,
    color: "#666",
    lineHeight: 22,
    marginBottom: 16,
  },
  joinButton: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  joinButtonDisabled: {
    opacity: 0.7,
  },
  joinButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
