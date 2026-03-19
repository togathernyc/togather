// CommunitySelector component - displays selected community with change button

import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Community } from "../types";
import { useTheme } from "@hooks/useTheme";

interface CommunitySelectorProps {
  community: Community;
  onChange: () => void;
}

export function CommunitySelector({ community, onChange }: CommunitySelectorProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.communityInfo, { backgroundColor: colors.surfaceSecondary }]}>
      <Text style={[styles.communityText, { color: colors.text }]}>
        {community.name || community.subdomain}
      </Text>
      <TouchableOpacity onPress={onChange}>
        <Text style={[styles.changeCommunityText, { color: colors.link }]}>Change Community</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  communityInfo: {
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
  },
  changeCommunityText: {
    fontSize: 12,
  },
});

