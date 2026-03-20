/**
 * ChannelJoinRequestsBanner
 *
 * Displays a compact banner when there are pending channel join requests
 * in any channel of the group. Only shown to leaders.
 * Tapping navigates to the first channel with pending requests' members page.
 */
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { useQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";

interface ChannelJoinRequestsBannerProps {
  groupId: string;
}

export function ChannelJoinRequestsBanner({ groupId }: ChannelJoinRequestsBannerProps) {
  const router = useRouter();
  const { token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors, isDark } = useTheme();

  const result = useQuery(
    api.functions.messaging.channelInvites.getPendingRequestCountByGroup,
    token ? { token, groupId: groupId as Id<"groups"> } : "skip"
  );

  if (!result || result.count === 0) return null;

  return (
    <TouchableOpacity
      style={[styles.banner, {
        backgroundColor: isDark ? 'rgba(255,152,0,0.1)' : '#FFF8E1',
        borderColor: isDark ? 'rgba(255,152,0,0.2)' : '#FFE082',
      }]}
      onPress={() => {
        if (result.firstChannelSlug) {
          router.push(`/inbox/${groupId}/${result.firstChannelSlug}/members`);
        }
      }}
      activeOpacity={0.7}
    >
      <Ionicons name="people" size={18} color="#F57C00" />
      <Text style={[styles.bannerText, { color: isDark ? '#FFB74D' : '#E65100' }]}>
        {result.count} channel join request{result.count !== 1 ? "s" : ""}
      </Text>
      <View style={styles.bannerAction}>
        <Text style={[styles.bannerActionText, { color: primaryColor }]}>Review</Text>
        <Ionicons name="chevron-forward" size={16} color={primaryColor} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
    gap: 8,
  },
  bannerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },
  bannerAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  bannerActionText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
