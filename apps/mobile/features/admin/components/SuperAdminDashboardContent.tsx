import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
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

type DashboardRange = "7d" | "30d" | "90d" | "all";
type ChartMetric = "messages" | "dailyActiveUsers" | "newMembers";

const RANGE_OPTIONS: Array<{ key: DashboardRange; label: string }> = [
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "all", label: "All time" },
];

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function MetricCard({
  icon,
  title,
  value,
  subtitle,
  iconColor,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  value: number;
  subtitle: string;
  iconColor: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.metricIcon, { backgroundColor: `${iconColor}1A` }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <Text style={[styles.metricTitle, { color: colors.textSecondary }]}>{title}</Text>
      <Text style={[styles.metricValue, { color: colors.text }]}>{formatCompactNumber(value)}</Text>
      <Text style={[styles.metricSubtitle, { color: colors.textTertiary }]}>{subtitle}</Text>
    </View>
  );
}

export function SuperAdminDashboardContent() {
  const { user, token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors, isDark } = useTheme();
  const [range, setRange] = useState<DashboardRange>("30d");
  const [chartMetric, setChartMetric] = useState<ChartMetric>("messages");

  const isInternalUser = user?.is_staff === true || user?.is_superuser === true;

  const dashboardData = useQuery(
    api.functions.admin.stats.getInternalDashboard,
    token && isInternalUser
      ? {
          token,
          range,
        }
      : "skip"
  );

  const chartMax = useMemo(() => {
    if (!dashboardData?.trend || dashboardData.trend.length === 0) return 1;
    return Math.max(
      ...dashboardData.trend.map((point) => {
        if (chartMetric === "dailyActiveUsers") return point.dailyActiveUsers;
        if (chartMetric === "newMembers") return point.newMembers;
        return point.messagesSent;
      }),
      1
    );
  }, [dashboardData?.trend, chartMetric]);

  if (!isInternalUser) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="lock-closed-outline" size={28} color={colors.textTertiary} />
        <Text style={[styles.emptyTitle, { color: colors.text }]}>Developers and owners only</Text>
        <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
          This dashboard is only available to Togather internal users.
        </Text>
      </View>
    );
  }

  if (!dashboardData) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={primaryColor} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading dashboard...</Text>
      </View>
    );
  }

  const rangeLabel = RANGE_OPTIONS.find((option) => option.key === range)?.label ?? "30D";

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.backgroundSecondary }]} contentContainerStyle={styles.content}>
      <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View>
          <Text style={[styles.heroTitle, { color: colors.text }]}>Togather Dashboard</Text>
          <Text style={[styles.heroSubtitle, { color: colors.textSecondary }]}>
            App-wide health, activity, and growth at a glance.
          </Text>
        </View>
        <View style={[styles.roleBadge, { borderColor: primaryColor, backgroundColor: colors.surface }]}>
          <Text style={[styles.roleBadgeText, { color: primaryColor }]}>Internal</Text>
        </View>
      </View>

      <View style={styles.rangeRow}>
        {RANGE_OPTIONS.map((option) => {
          const selected = option.key === range;
          return (
            <TouchableOpacity
              key={option.key}
              style={[
                styles.rangeButton,
                { borderColor: colors.border, backgroundColor: colors.surface },
                selected && { backgroundColor: primaryColor, borderColor: primaryColor },
              ]}
              onPress={() => setRange(option.key)}
            >
              <Text style={[styles.rangeButtonText, { color: colors.textSecondary }, selected && styles.rangeButtonTextSelected]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.metricsGrid}>
        <MetricCard
          icon="chatbubble-ellipses-outline"
          title="Messages sent"
          value={dashboardData.overview.messagesSent}
          subtitle={`In ${rangeLabel}`}
          iconColor={primaryColor}
        />
        <MetricCard
          icon="pulse-outline"
          title="Unique active senders"
          value={dashboardData.overview.uniqueActiveSenders}
          subtitle={`In ${rangeLabel}`}
          iconColor="#10B981"
        />
        <MetricCard
          icon="person-add-outline"
          title="New members"
          value={dashboardData.overview.newMembers}
          subtitle={`In ${rangeLabel}`}
          iconColor="#3B82F6"
        />
        <MetricCard
          icon="calendar-outline"
          title="Meetings held"
          value={dashboardData.overview.meetingsHeld}
          subtitle={`In ${rangeLabel}`}
          iconColor="#F59E0B"
        />
        <MetricCard
          icon="checkmark-done-outline"
          title="Attendance check-ins"
          value={dashboardData.overview.attendanceCheckIns}
          subtitle={`In ${rangeLabel}`}
          iconColor="#8B5CF6"
        />
        <MetricCard
          icon="analytics-outline"
          title="Avg msgs / active day"
          value={dashboardData.overview.avgMessagesPerActiveDay}
          subtitle="Posting cadence"
          iconColor="#EF4444"
        />
      </View>

      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.panelHeader}>
          <Text style={[styles.panelTitle, { color: colors.text }]}>Trend over time</Text>
          <View style={[styles.metricToggle, { backgroundColor: colors.surfaceSecondary }]}>
            <TouchableOpacity
              style={[
                styles.metricToggleButton,
                chartMetric === "messages" && [styles.metricToggleButtonActive, { backgroundColor: colors.surface }],
              ]}
              onPress={() => setChartMetric("messages")}
            >
              <Text
                style={[
                  styles.metricToggleText,
                  { color: colors.textSecondary },
                  chartMetric === "messages" && [styles.metricToggleTextActive, { color: colors.text }],
                ]}
              >
                Messages
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.metricToggleButton,
                chartMetric === "dailyActiveUsers" && [styles.metricToggleButtonActive, { backgroundColor: colors.surface }],
              ]}
              onPress={() => setChartMetric("dailyActiveUsers")}
            >
              <Text
                style={[
                  styles.metricToggleText,
                  { color: colors.textSecondary },
                  chartMetric === "dailyActiveUsers" && [styles.metricToggleTextActive, { color: colors.text }],
                ]}
              >
                DAU
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.metricToggleButton,
                chartMetric === "newMembers" && [styles.metricToggleButtonActive, { backgroundColor: colors.surface }],
              ]}
              onPress={() => setChartMetric("newMembers")}
            >
              <Text
                style={[
                  styles.metricToggleText,
                  { color: colors.textSecondary },
                  chartMetric === "newMembers" && [styles.metricToggleTextActive, { color: colors.text }],
                ]}
              >
                New
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chartRow}>
            {dashboardData.trend.map((point) => {
              const value =
                chartMetric === "dailyActiveUsers"
                  ? point.dailyActiveUsers
                  : chartMetric === "newMembers"
                    ? point.newMembers
                    : point.messagesSent;
              const height = Math.max((value / chartMax) * 120, value > 0 ? 8 : 2);
              const barColor =
                chartMetric === "dailyActiveUsers"
                  ? "#10B981"
                  : chartMetric === "newMembers"
                    ? "#3B82F6"
                    : primaryColor;

              return (
                <View key={point.bucketStart} style={styles.chartItem}>
                  <Text style={[styles.chartValue, { color: colors.textSecondary }]}>{value}</Text>
                  <View style={[styles.chartBarTrack, { backgroundColor: colors.surfaceSecondary }]}>
                    <View style={[styles.chartBar, { height, backgroundColor: barColor }]} />
                  </View>
                  <Text style={[styles.chartLabel, { color: colors.textTertiary }]}>{point.label}</Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>

      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.panelTitle, { color: colors.text }]}>All-time footprint</Text>
        <View style={styles.footprintRow}>
          <View style={[styles.footprintItem, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[styles.footprintValue, { color: colors.text }]}>{formatCompactNumber(dashboardData.totals.totalMembers)}</Text>
            <Text style={[styles.footprintLabel, { color: colors.textSecondary }]}>Members</Text>
          </View>
          <View style={[styles.footprintItem, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[styles.footprintValue, { color: colors.text }]}>{formatCompactNumber(dashboardData.totals.activeMembers30d)}</Text>
            <Text style={[styles.footprintLabel, { color: colors.textSecondary }]}>Active in 30d</Text>
          </View>
          <View style={[styles.footprintItem, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[styles.footprintValue, { color: colors.text }]}>{formatCompactNumber(dashboardData.totals.activeGroups)}</Text>
            <Text style={[styles.footprintLabel, { color: colors.textSecondary }]}>Groups</Text>
          </View>
          <View style={[styles.footprintItem, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[styles.footprintValue, { color: colors.text }]}>{formatCompactNumber(dashboardData.totals.activeChannels)}</Text>
            <Text style={[styles.footprintLabel, { color: colors.textSecondary }]}>Channels</Text>
          </View>
          <View style={[styles.footprintItem, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[styles.footprintValue, { color: colors.text }]}>{formatCompactNumber(dashboardData.totals.totalCommunities)}</Text>
            <Text style={[styles.footprintLabel, { color: colors.textSecondary }]}>Communities</Text>
          </View>
        </View>
      </View>

      <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.panelTitle, { color: colors.text }]}>Top channels ({rangeLabel})</Text>
        {dashboardData.topChannels.length > 0 ? (
          dashboardData.topChannels.map((channel, index) => (
            <View key={channel.channelId} style={[styles.channelRow, { borderBottomColor: colors.borderLight }]}>
              <View style={[styles.channelRank, { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={[styles.channelRankText, { color: colors.textSecondary }]}>{index + 1}</Text>
              </View>
              <Text style={[styles.channelName, { color: colors.text }]} numberOfLines={1}>
                {channel.channelName}
              </Text>
              <Text style={[styles.channelCount, { color: primaryColor }]}>{channel.messagesSent}</Text>
            </View>
          ))
        ) : (
          <Text style={[styles.noDataText, { color: colors.textTertiary }]}>No messages in this range.</Text>
        )}
      </View>
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
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
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
  hero: {
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  heroSubtitle: {
    marginTop: 4,
    fontSize: 13,
  },
  roleBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  rangeRow: {
    flexDirection: "row",
    gap: 8,
  },
  rangeButton: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rangeButtonText: {
    fontSize: 12,
    fontWeight: "700",
  },
  rangeButtonTextSelected: {
    color: "#fff",
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metricCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    minWidth: "48%",
    flex: 1,
  },
  metricIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  metricTitle: {
    fontSize: 12,
  },
  metricValue: {
    marginTop: 2,
    fontSize: 24,
    fontWeight: "800",
  },
  metricSubtitle: {
    marginTop: 2,
    fontSize: 11,
  },
  panel: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  panelHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    gap: 12,
  },
  panelTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  metricToggle: {
    flexDirection: "row",
    gap: 4,
    borderRadius: 999,
    padding: 3,
  },
  metricToggleButton: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  metricToggleButtonActive: {},
  metricToggleText: {
    fontSize: 11,
    fontWeight: "700",
  },
  metricToggleTextActive: {},
  chartRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    minHeight: 160,
    paddingBottom: 6,
  },
  chartItem: {
    width: 42,
    alignItems: "center",
  },
  chartValue: {
    fontSize: 11,
    marginBottom: 6,
  },
  chartBarTrack: {
    width: 22,
    height: 120,
    borderRadius: 99,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  chartBar: {
    width: "100%",
    borderRadius: 99,
  },
  chartLabel: {
    marginTop: 6,
    fontSize: 10,
    textAlign: "center",
  },
  footprintRow: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  footprintItem: {
    flex: 1,
    minWidth: "45%",
    padding: 10,
    borderRadius: 10,
  },
  footprintValue: {
    fontSize: 20,
    fontWeight: "800",
  },
  footprintLabel: {
    fontSize: 12,
  },
  channelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  channelRank: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  channelRankText: {
    fontSize: 11,
    fontWeight: "700",
  },
  channelName: {
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
  },
  channelCount: {
    fontSize: 13,
    fontWeight: "700",
  },
  noDataText: {
    fontSize: 13,
    paddingVertical: 8,
  },
});

