import React from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { useQuery, api } from "@services/api/convex";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function SuperAdminDashboardContent() {
  const { user, token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();

  const isInternalUser = user?.is_staff === true || user?.is_superuser === true;

  const data = useQuery(
    api.functions.admin.stats.getDailySummary,
    token && isInternalUser ? { token } : "skip"
  );

  if (!isInternalUser) {
    return (
      <View style={styles.centered}>
        <Ionicons name="lock-closed-outline" size={28} color={colors.textTertiary} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Developers and owners only</Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          This dashboard is only available to Togather internal users.
        </Text>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={primaryColor} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading...</Text>
      </View>
    );
  }

  const hasActivity = data.messages.total > 0;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}
      contentContainerStyle={styles.content}
    >
      {/* Date header */}
      <Text style={[styles.dateHeader, { color: colors.textSecondary }]}>
        Today — {formatDate(data.date)}
      </Text>

      {!hasActivity ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.noActivity, { color: colors.textTertiary }]}>No activity today</Text>
        </View>
      ) : (
        <>
          {/* Metric cards */}
          <View style={styles.metricsRow}>
            <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Messages sent</Text>
              <Text style={[styles.metricValue, { color: colors.text }]}>{data.messages.total}</Text>
            </View>
            <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Active senders</Text>
              <Text style={[styles.metricValue, { color: colors.text }]}>{data.messages.uniqueSenders}</Text>
            </View>
          </View>

          {/* Top Channels */}
          {data.topChannels.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Top Channels</Text>
              {data.topChannels.map((channel, index) => (
                <View
                  key={channel.channelId}
                  style={[
                    styles.channelRow,
                    index < data.topChannels.length - 1 && {
                      borderBottomWidth: 1,
                      borderBottomColor: colors.borderLight,
                    },
                  ]}
                >
                  <View style={styles.channelInfo}>
                    <Text style={[styles.channelName, { color: colors.text }]} numberOfLines={1}>
                      {channel.channelName}
                    </Text>
                    <Text style={[styles.groupName, { color: colors.textTertiary }]} numberOfLines={1}>
                      {channel.groupName}
                    </Text>
                  </View>
                  <Text style={[styles.messageCount, { color: primaryColor }]}>
                    {channel.messageCount}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 18,
    fontWeight: "700",
  },
  emptySubtitle: {
    marginTop: 6,
    fontSize: 14,
    textAlign: "center",
  },
  dateHeader: {
    fontSize: 15,
    fontWeight: "600",
  },
  metricsRow: {
    flexDirection: "row",
    gap: 12,
  },
  metricCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
  metricLabel: {
    fontSize: 13,
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 32,
    fontWeight: "800",
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 8,
  },
  channelRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  channelInfo: {
    flex: 1,
    marginRight: 12,
  },
  channelName: {
    fontSize: 14,
    fontWeight: "500",
  },
  groupName: {
    fontSize: 12,
    marginTop: 2,
  },
  messageCount: {
    fontSize: 15,
    fontWeight: "700",
  },
  noActivity: {
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 20,
  },
});
