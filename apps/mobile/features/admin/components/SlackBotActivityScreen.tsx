/**
 * SlackBotActivityScreen - Debug panel showing bot activity log
 *
 * Displays a list of recent bot interactions with expandable details
 * showing tool calls, agent responses, errors, and timing info.
 */
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { useSlackBotConfig } from "../hooks/useSlackBotConfig";

interface ToolCallEntry {
  tool: string;
  args: unknown;
  result: unknown;
  durationMs: number;
}

interface ActivityLogEntry {
  trigger: string;
  location?: string;
  threadTs?: string;
  messageTs?: string;
  userId?: string;
  nagUrgency?: string;
  nagLabel?: string;
  toolCalls: ToolCallEntry[];
  agentResponse?: string;
  iterations: number;
  status: string;
  error?: string;
  skipReason?: string;
  durationMs: number;
  timestamp: number;
}

const TRIGGER_CONFIG: Record<string, { icon: string; label: string }> = {
  thread_reply: { icon: "chatbubble-outline", label: "Thread Reply" },
  nag_check: { icon: "alarm-outline", label: "Nag Check" },
  thread_creation: { icon: "add-circle-outline", label: "Thread Created" },
};

const STATUS_COLORS: Record<string, string> = {
  success: "#34C759",
  error: "#FF3B30",
  skipped: "#8E8E93",
};

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ToolCallItem({ call, index }: { call: ToolCallEntry; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const { colors, isDark } = useTheme();

  return (
    <View style={[styles.toolCallItem, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
      <TouchableOpacity
        style={styles.toolCallHeader}
        onPress={() => setExpanded(!expanded)}
      >
        <View style={styles.toolCallLeft}>
          <Text style={[styles.toolCallIndex, { color: colors.textTertiary }]}>{index + 1}.</Text>
          <Text style={[styles.toolCallName, { color: colors.text }]}>{call.tool}</Text>
        </View>
        <View style={styles.toolCallRight}>
          <Text style={[styles.toolCallDuration, { color: colors.textTertiary }]}>{formatDuration(call.durationMs)}</Text>
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={14}
            color={colors.textTertiary}
          />
        </View>
      </TouchableOpacity>
      {expanded && (
        <View style={[styles.toolCallDetails, { borderTopColor: colors.border }]}>
          <Text style={[styles.toolCallDetailLabel, { color: colors.textTertiary }]}>Args:</Text>
          <ScrollView horizontal style={styles.codeScroll}>
            <Text style={[styles.codeText, { color: colors.text }]}>
              {JSON.stringify(call.args, null, 2)}
            </Text>
          </ScrollView>
          <Text style={[styles.toolCallDetailLabel, { marginTop: 8, color: colors.textTertiary }]}>Result:</Text>
          <ScrollView horizontal style={styles.codeScroll}>
            <Text style={[styles.codeText, { color: colors.text }]}>
              {typeof call.result === "string"
                ? call.result.slice(0, 500)
                : JSON.stringify(call.result, null, 2)?.slice(0, 500)}
            </Text>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function ActivityCard({ entry }: { entry: ActivityLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const { colors, isDark } = useTheme();
  const triggerConfig = TRIGGER_CONFIG[entry.trigger] ?? {
    icon: "ellipse-outline",
    label: entry.trigger,
  };
  const statusColor = STATUS_COLORS[entry.status] ?? "#8E8E93";

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      <TouchableOpacity
        style={styles.cardContent}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        {/* Header row */}
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Ionicons
              name={triggerConfig.icon as keyof typeof Ionicons.glyphMap}
              size={18}
              color={colors.icon}
            />
            <Text style={[styles.triggerLabel, { color: colors.text }]}>{triggerConfig.label}</Text>
            {entry.location && (
              <View style={[styles.locationBadge, { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={[styles.locationBadgeText, { color: colors.textSecondary }]}>{entry.location}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.timeAgo, { color: colors.textTertiary }]}>{formatTimeAgo(entry.timestamp)}</Text>
        </View>

        {/* Summary row */}
        <View style={styles.summaryRow}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
            <Text style={styles.statusText}>{entry.status}</Text>
          </View>
          <Text style={[styles.summaryDetail, { color: colors.textSecondary }]}>
            {formatDuration(entry.durationMs)}
          </Text>
          {entry.iterations > 0 && (
            <Text style={[styles.summaryDetail, { color: colors.textSecondary }]}>
              {entry.iterations} iter
            </Text>
          )}
          {entry.toolCalls.length > 0 && (
            <Text style={[styles.summaryDetail, { color: colors.textSecondary }]}>
              {entry.toolCalls.length} tool{entry.toolCalls.length !== 1 ? "s" : ""}
            </Text>
          )}
          {entry.nagLabel && (
            <Text style={[styles.summaryDetail, { color: colors.textSecondary }]}>{entry.nagLabel}</Text>
          )}
          <View style={{ flex: 1 }} />
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={16}
            color={colors.iconSecondary}
          />
        </View>

        {/* Expanded details */}
        {expanded && (
          <View style={[styles.expandedSection, { borderTopColor: colors.border }]}>
            {/* Error */}
            {entry.error && (
              <View style={[styles.errorBox, { backgroundColor: isDark ? 'rgba(255,59,48,0.15)' : '#FFF0F0', borderColor: isDark ? 'rgba(255,59,48,0.3)' : '#FFD0D0' }]}>
                <Text style={[styles.errorText, { color: colors.error }]}>{entry.error}</Text>
              </View>
            )}

            {/* Skip reason */}
            {entry.skipReason && (
              <View style={[styles.skipBox, { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={[styles.skipText, { color: colors.textSecondary }]}>{entry.skipReason}</Text>
              </View>
            )}

            {/* Tool calls */}
            {entry.toolCalls.length > 0 && (
              <View style={styles.toolCallsSection}>
                <Text style={[styles.expandedLabel, { color: colors.textSecondary }]}>Tool Calls</Text>
                {entry.toolCalls.map((call, i) => (
                  <ToolCallItem key={i} call={call} index={i} />
                ))}
              </View>
            )}

            {/* Agent response */}
            {entry.agentResponse && (
              <View style={styles.responseSection}>
                <Text style={[styles.expandedLabel, { color: colors.textSecondary }]}>Agent Response</Text>
                <Text style={[styles.responseText, { color: colors.text }]}>{entry.agentResponse}</Text>
              </View>
            )}

            {/* Metadata */}
            <View style={[styles.metadataSection, { borderTopColor: colors.border }]}>
              {entry.threadTs && (
                <Text style={[styles.metadataText, { color: colors.textTertiary }]}>
                  Thread: {entry.threadTs}
                </Text>
              )}
              {entry.messageTs && (
                <Text style={[styles.metadataText, { color: colors.textTertiary }]}>
                  Message: {entry.messageTs}
                </Text>
              )}
              {entry.userId && (
                <Text style={[styles.metadataText, { color: colors.textTertiary }]}>
                  User: {entry.userId}
                </Text>
              )}
              <Text style={[styles.metadataText, { color: colors.textTertiary }]}>
                {new Date(entry.timestamp).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </Text>
            </View>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

export function SlackBotActivityScreen() {
  const insets = useSafeAreaInsets();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();
  const { config, isLoading } = useSlackBotConfig();

  const activityLog = (config?.activityLog ?? []) as ActivityLogEntry[];
  // Most recent first
  const sortedLog = [...activityLog].reverse();

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.backgroundSecondary }]}>
        <ActivityIndicator size="large" color={primaryColor} />
      </View>
    );
  }

  if (!config) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.backgroundSecondary }]}>
        <Ionicons name="warning-outline" size={48} color={colors.textTertiary} />
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          Slack bot not configured for this community.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}
      contentContainerStyle={{
        paddingBottom: insets.bottom + 20,
        paddingTop: 12,
      }}
      data={sortedLog}
      keyExtractor={(item, index) => `${item.timestamp}-${index}`}
      renderItem={({ item }) => <ActivityCard entry={item} />}
      ListEmptyComponent={
        <View style={styles.centered}>
          <Ionicons name="document-text-outline" size={48} color={colors.iconSecondary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No activity yet</Text>
          <Text style={[styles.emptySubtext, { color: colors.textTertiary }]}>
            Bot interactions will appear here as they occur.
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    minHeight: 300,
  },
  emptyText: {
    fontSize: 16,
    marginTop: 12,
    textAlign: "center",
  },
  emptySubtext: {
    fontSize: 14,
    marginTop: 4,
    textAlign: "center",
  },
  card: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },
  cardContent: {
    padding: 14,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  triggerLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  locationBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  locationBadgeText: {
    fontSize: 12,
    fontWeight: "500",
  },
  timeAgo: {
    fontSize: 13,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
  },
  summaryDetail: {
    fontSize: 13,
  },
  expandedSection: {
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
  },
  expandedLabel: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  errorBox: {
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
  },
  errorText: {
    fontSize: 13,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  skipBox: {
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  skipText: {
    fontSize: 13,
  },
  toolCallsSection: {
    marginBottom: 10,
  },
  toolCallItem: {
    borderRadius: 8,
    marginBottom: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toolCallHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 10,
  },
  toolCallLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  toolCallIndex: {
    fontSize: 12,
    fontWeight: "600",
  },
  toolCallName: {
    fontSize: 14,
    fontWeight: "500",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  toolCallRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  toolCallDuration: {
    fontSize: 12,
  },
  toolCallDetails: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toolCallDetailLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    marginTop: 6,
    marginBottom: 2,
  },
  codeScroll: {
    maxHeight: 120,
  },
  codeText: {
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 18,
  },
  responseSection: {
    marginBottom: 10,
  },
  responseText: {
    fontSize: 14,
    lineHeight: 20,
  },
  metadataSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  metadataText: {
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginBottom: 2,
  },
});
