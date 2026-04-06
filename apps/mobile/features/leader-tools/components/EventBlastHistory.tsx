import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { useAuth } from "@providers/AuthProvider";

interface EventBlastHistoryProps {
  meetingId: string;
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function EventBlastHistory({ meetingId }: EventBlastHistoryProps) {
  const { colors } = useTheme();
  const { token } = useAuth();

  const blasts = useQuery(
    api.functions.eventBlasts.list,
    token ? { token, meetingId: meetingId as Id<"meetings"> } : "skip",
  );

  if (!blasts || blasts.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
        MESSAGE HISTORY
      </Text>
      {blasts.map((blast) => (
        <View
          key={blast._id}
          style={[styles.blastCard, { backgroundColor: colors.surface }]}
        >
          <View style={styles.blastHeader}>
            <Text style={[styles.sentBy, { color: colors.textSecondary }]}>
              {blast.sentByName} &middot; {formatTimeAgo(blast.createdAt)}
            </Text>
            <View style={styles.channelBadges}>
              {blast.channels.map((ch) => (
                <View
                  key={ch}
                  style={[styles.badge, { backgroundColor: colors.surfaceSecondary }]}
                >
                  <Ionicons
                    name={ch === "push" ? "notifications-outline" : "chatbubble-outline"}
                    size={12}
                    color={colors.textSecondary}
                  />
                  <Text style={[styles.badgeText, { color: colors.textSecondary }]}>
                    {ch.toUpperCase()}
                  </Text>
                </View>
              ))}
            </View>
          </View>
          <Text style={[styles.message, { color: colors.text }]} numberOfLines={3}>
            {blast.message}
          </Text>
          <Text style={[styles.recipientCount, { color: colors.textSecondary }]}>
            Sent to {blast.recipientCount} {blast.recipientCount === 1 ? "person" : "people"}
            {blast.status === "partial" && " (some failed)"}
            {blast.status === "failed" && " (failed)"}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 12,
  },
  blastCard: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  blastHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  sentBy: {
    fontSize: 12,
    flex: 1,
  },
  channelBadges: {
    flexDirection: "row",
    gap: 4,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "600",
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 6,
  },
  recipientCount: {
    fontSize: 12,
  },
});
