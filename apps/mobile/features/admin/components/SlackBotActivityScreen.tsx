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

  return (
    <View style={styles.toolCallItem}>
      <TouchableOpacity
        style={styles.toolCallHeader}
        onPress={() => setExpanded(!expanded)}
      >
        <View style={styles.toolCallLeft}>
          <Text style={styles.toolCallIndex}>{index + 1}.</Text>
          <Text style={styles.toolCallName}>{call.tool}</Text>
        </View>
        <View style={styles.toolCallRight}>
          <Text style={styles.toolCallDuration}>{formatDuration(call.durationMs)}</Text>
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={14}
            color="#999"
          />
        </View>
      </TouchableOpacity>
      {expanded && (
        <View style={styles.toolCallDetails}>
          <Text style={styles.toolCallDetailLabel}>Args:</Text>
          <ScrollView horizontal style={styles.codeScroll}>
            <Text style={styles.codeText}>
              {JSON.stringify(call.args, null, 2)}
            </Text>
          </ScrollView>
          <Text style={[styles.toolCallDetailLabel, { marginTop: 8 }]}>Result:</Text>
          <ScrollView horizontal style={styles.codeScroll}>
            <Text style={styles.codeText}>
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
  const triggerConfig = TRIGGER_CONFIG[entry.trigger] ?? {
    icon: "ellipse-outline",
    label: entry.trigger,
  };
  const statusColor = STATUS_COLORS[entry.status] ?? "#8E8E93";

  return (
    <View style={styles.card}>
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
              color="#666"
            />
            <Text style={styles.triggerLabel}>{triggerConfig.label}</Text>
            {entry.location && (
              <View style={styles.locationBadge}>
                <Text style={styles.locationBadgeText}>{entry.location}</Text>
              </View>
            )}
          </View>
          <Text style={styles.timeAgo}>{formatTimeAgo(entry.timestamp)}</Text>
        </View>

        {/* Summary row */}
        <View style={styles.summaryRow}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
            <Text style={styles.statusText}>{entry.status}</Text>
          </View>
          <Text style={styles.summaryDetail}>
            {formatDuration(entry.durationMs)}
          </Text>
          {entry.iterations > 0 && (
            <Text style={styles.summaryDetail}>
              {entry.iterations} iter
            </Text>
          )}
          {entry.toolCalls.length > 0 && (
            <Text style={styles.summaryDetail}>
              {entry.toolCalls.length} tool{entry.toolCalls.length !== 1 ? "s" : ""}
            </Text>
          )}
          {entry.nagLabel && (
            <Text style={styles.summaryDetail}>{entry.nagLabel}</Text>
          )}
          <View style={{ flex: 1 }} />
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={16}
            color="#ccc"
          />
        </View>

        {/* Expanded details */}
        {expanded && (
          <View style={styles.expandedSection}>
            {/* Error */}
            {entry.error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{entry.error}</Text>
              </View>
            )}

            {/* Skip reason */}
            {entry.skipReason && (
              <View style={styles.skipBox}>
                <Text style={styles.skipText}>{entry.skipReason}</Text>
              </View>
            )}

            {/* Tool calls */}
            {entry.toolCalls.length > 0 && (
              <View style={styles.toolCallsSection}>
                <Text style={styles.expandedLabel}>Tool Calls</Text>
                {entry.toolCalls.map((call, i) => (
                  <ToolCallItem key={i} call={call} index={i} />
                ))}
              </View>
            )}

            {/* Agent response */}
            {entry.agentResponse && (
              <View style={styles.responseSection}>
                <Text style={styles.expandedLabel}>Agent Response</Text>
                <Text style={styles.responseText}>{entry.agentResponse}</Text>
              </View>
            )}

            {/* Metadata */}
            <View style={styles.metadataSection}>
              {entry.threadTs && (
                <Text style={styles.metadataText}>
                  Thread: {entry.threadTs}
                </Text>
              )}
              {entry.messageTs && (
                <Text style={styles.metadataText}>
                  Message: {entry.messageTs}
                </Text>
              )}
              {entry.userId && (
                <Text style={styles.metadataText}>
                  User: {entry.userId}
                </Text>
              )}
              <Text style={styles.metadataText}>
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
  const { config, isLoading } = useSlackBotConfig();

  const activityLog = (config?.activityLog ?? []) as ActivityLogEntry[];
  // Most recent first
  const sortedLog = [...activityLog].reverse();

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={primaryColor} />
      </View>
    );
  }

  if (!config) {
    return (
      <View style={styles.centered}>
        <Ionicons name="warning-outline" size={48} color="#999" />
        <Text style={styles.emptyText}>
          Slack bot not configured for this community.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={{
        paddingBottom: insets.bottom + 20,
        paddingTop: 12,
      }}
      data={sortedLog}
      keyExtractor={(item, index) => `${item.timestamp}-${index}`}
      renderItem={({ item }) => <ActivityCard entry={item} />}
      ListEmptyComponent={
        <View style={styles.centered}>
          <Ionicons name="document-text-outline" size={48} color="#ccc" />
          <Text style={styles.emptyText}>No activity yet</Text>
          <Text style={styles.emptySubtext}>
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
    backgroundColor: "#F2F2F7",
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
    color: "#666",
    marginTop: 12,
    textAlign: "center",
  },
  emptySubtext: {
    fontSize: 14,
    color: "#999",
    marginTop: 4,
    textAlign: "center",
  },
  card: {
    backgroundColor: "#fff",
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
    color: "#000",
  },
  locationBadge: {
    backgroundColor: "#F0F0F0",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  locationBadgeText: {
    fontSize: 12,
    color: "#666",
    fontWeight: "500",
  },
  timeAgo: {
    fontSize: 13,
    color: "#999",
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
    color: "#666",
  },
  expandedSection: {
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E5E5EA",
    paddingTop: 12,
  },
  expandedLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#666",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  errorBox: {
    backgroundColor: "#FFF0F0",
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#FFD0D0",
  },
  errorText: {
    fontSize: 13,
    color: "#CC0000",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  skipBox: {
    backgroundColor: "#F5F5F5",
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  skipText: {
    fontSize: 13,
    color: "#666",
  },
  toolCallsSection: {
    marginBottom: 10,
  },
  toolCallItem: {
    backgroundColor: "#F9F9F9",
    borderRadius: 8,
    marginBottom: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5E5EA",
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
    color: "#999",
    fontWeight: "600",
  },
  toolCallName: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  toolCallRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  toolCallDuration: {
    fontSize: 12,
    color: "#999",
  },
  toolCallDetails: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E5E5EA",
  },
  toolCallDetailLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#999",
    textTransform: "uppercase",
    marginTop: 6,
    marginBottom: 2,
  },
  codeScroll: {
    maxHeight: 120,
  },
  codeText: {
    fontSize: 12,
    color: "#333",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 18,
  },
  responseSection: {
    marginBottom: 10,
  },
  responseText: {
    fontSize: 14,
    color: "#333",
    lineHeight: 20,
  },
  metadataSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E5E5EA",
    paddingTop: 8,
  },
  metadataText: {
    fontSize: 12,
    color: "#999",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginBottom: 2,
  },
});
