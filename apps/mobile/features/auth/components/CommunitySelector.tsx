// CommunitySelector component - displays selected community with change button

import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Community } from "../types";

interface CommunitySelectorProps {
  community: Community;
  onChange: () => void;
}

export function CommunitySelector({ community, onChange }: CommunitySelectorProps) {
  return (
    <View style={styles.communityInfo}>
      <Text style={styles.communityText}>
        {community.name || community.subdomain}
      </Text>
      <TouchableOpacity onPress={onChange}>
        <Text style={styles.changeCommunityText}>Change Community</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  communityInfo: {
    backgroundColor: "#f5f5f5",
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  communityText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  changeCommunityText: {
    fontSize: 12,
    color: "#007AFF",
  },
});

