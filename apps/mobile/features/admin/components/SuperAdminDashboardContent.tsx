import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { useQuery, api } from "@services/api/convex";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";

/** Convert snake_case notification type to Title Case (e.g. "new_message" -> "New Message") */
function formatNotificationType(type: string): string {
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function SuperAdminDashboardContent() {
  const { user, token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();
  const [daysAgo, setDaysAgo] = useState(0);

  const isInternalUser = user?.is_staff === true || user?.is_superuser === true;

  const data = useQuery(
    api.functions.admin.stats.getDailySummary,
    token && isInternalUser ? { token, daysAgo } : "skip"
  );

  const notifStats = useQuery(
    api.functions.admin.stats.getNotificationStats,
    token && isInternalUser ? { token, daysAgo } : "skip"
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

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}
      contentContainerStyle={styles.content}
    >
      {/* Day navigation */}
      <View style={styles.dayNav}>
        <TouchableOpacity
          onPress={() => setDaysAgo((d) => d + 1)}
          style={[styles.navButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={18} color={colors.text} />
        </TouchableOpacity>

        <Text style={[styles.dateHeader, { color: colors.text }]}>
          {daysAgo === 0 ? "Today" : daysAgo === 1 ? "Yesterday" : `${daysAgo} days ago`}
          {data ? ` — ${formatDate(data.date)}` : ""}
        </Text>

        <TouchableOpacity
          onPress={() => setDaysAgo((d) => Math.max(0, d - 1))}
          disabled={daysAgo === 0}
          style={[
            styles.navButton,
            { backgroundColor: colors.surface, borderColor: colors.border },
            daysAgo === 0 && { opacity: 0.3 },
          ]}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-forward" size={18} color={colors.text} />
        </TouchableOpacity>
      </View>

      {!data ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={primaryColor} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading...</Text>
        </View>
      ) : data.messages.total === 0 && data.appOpens === 0 && data.totalReactions === 0 ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.noActivity, { color: colors.textTertiary }]}>No activity this day</Text>
        </View>
      ) : (
        <>
          {/* Metric cards - row 1 */}
          <View style={styles.metricsRow}>
            <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Messages</Text>
              <Text style={[styles.metricValue, { color: colors.text }]}>{data.messages.total.toLocaleString()}</Text>
            </View>
            <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Reactions</Text>
              <Text style={[styles.metricValue, { color: colors.text }]}>{data.totalReactions}</Text>
            </View>
          </View>
          {/* Metric cards - row 2 */}
          <View style={styles.metricsRow}>
            <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Senders</Text>
              <Text style={[styles.metricValue, { color: colors.text }]}>{data.messages.uniqueSenders}</Text>
            </View>
            <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>App opens</Text>
              <Text style={[styles.metricValue, { color: colors.text }]}>{data.appOpens}</Text>
            </View>
          </View>

          {/* Top Channels */}
          {data.topChannels.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Top Channels</Text>
              {data.topChannels.map((channel: any, index: number) => (
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
                  {channel.groupPhoto ? (
                    <Image
                      source={{ uri: channel.groupPhoto }}
                      style={styles.groupAvatar}
                    />
                  ) : (
                    <View style={[styles.groupAvatarPlaceholder, { backgroundColor: colors.surfaceSecondary }]}>
                      <Ionicons name="people" size={14} color={colors.textTertiary} />
                    </View>
                  )}
                  <View style={styles.channelInfo}>
                    <Text style={[styles.channelName, { color: colors.text }]} numberOfLines={1}>
                      {channel.channelName}
                    </Text>
                    <Text style={[styles.groupName, { color: colors.textTertiary }]} numberOfLines={1}>
                      {channel.groupName}
                    </Text>
                  </View>
                  <View style={styles.channelStats}>
                    <Text style={[styles.messageCount, { color: primaryColor }]}>
                      {channel.messages} msg
                    </Text>
                    {channel.reactions > 0 && (
                      <Text style={[styles.reactionCount, { color: colors.textSecondary }]}>
                        {channel.reactions} rxn
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Top Senders */}
          {data.topSenders && data.topSenders.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Top Senders</Text>
              {data.topSenders.map((sender: any, index: number) => (
                <View
                  key={sender.userId}
                  style={[
                    styles.channelRow,
                    index < data.topSenders.length - 1 && {
                      borderBottomWidth: 1,
                      borderBottomColor: colors.borderLight,
                    },
                  ]}
                >
                  {sender.profilePhoto ? (
                    <Image
                      source={{ uri: sender.profilePhoto }}
                      style={styles.groupAvatar}
                    />
                  ) : (
                    <View style={[styles.groupAvatarPlaceholder, { backgroundColor: colors.surfaceSecondary }]}>
                      <Ionicons name="person" size={14} color={colors.textTertiary} />
                    </View>
                  )}
                  <View style={styles.channelInfo}>
                    <Text style={[styles.channelName, { color: colors.text }]} numberOfLines={1}>
                      {sender.name}
                    </Text>
                  </View>
                  <View style={styles.channelStats}>
                    <Text style={[styles.messageCount, { color: primaryColor }]}>
                      {sender.messages} msg
                    </Text>
                    {sender.reactions > 0 && (
                      <Text style={[styles.reactionCount, { color: colors.textSecondary }]}>
                        {sender.reactions} rxn
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {/* Notification Stats */}
      {notifStats && notifStats.totalSent > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 8 }]}>
            Notifications
          </Text>
          <View style={styles.metricsRow}>
            <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Sent</Text>
              <Text style={[styles.metricValue, { color: colors.text }]}>{notifStats.totalSent}</Text>
            </View>
            <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Impressed</Text>
              <Text style={[styles.metricValue, { color: colors.text }]}>{notifStats.totalImpressed}</Text>
            </View>
            <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Clicked</Text>
              <Text style={[styles.metricValue, { color: colors.text }]}>{notifStats.totalClicked}</Text>
            </View>
          </View>

          {notifStats.byType.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>By Type</Text>
              {notifStats.byType.map((entry: { type: string; sent: number; impressed: number; clicked: number }, index: number) => (
                <View
                  key={entry.type}
                  style={[
                    styles.notifTypeRow,
                    index < notifStats.byType.length - 1 && {
                      borderBottomWidth: 1,
                      borderBottomColor: colors.borderLight,
                    },
                  ]}
                >
                  <Text style={[styles.notifTypeName, { color: colors.text }]} numberOfLines={1}>
                    {formatNotificationType(entry.type)}
                  </Text>
                  <Text style={[styles.notifTypeStats, { color: colors.textSecondary }]}>
                    {entry.sent} sent · {entry.impressed} imp · {entry.clicked} click
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
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 40,
  },
  loadingText: {
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
  dayNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dateHeader: {
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
  metricsRow: {
    flexDirection: "row",
    gap: 10,
  },
  metricCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  metricLabel: {
    fontSize: 11,
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 26,
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
  groupAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 10,
  },
  groupAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
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
  channelStats: {
    alignItems: "flex-end",
  },
  messageCount: {
    fontSize: 14,
    fontWeight: "700",
  },
  reactionCount: {
    fontSize: 12,
    marginTop: 2,
  },
  noActivity: {
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 20,
  },
  notifTypeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
  },
  notifTypeName: {
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
    marginRight: 8,
  },
  notifTypeStats: {
    fontSize: 12,
  },
});
