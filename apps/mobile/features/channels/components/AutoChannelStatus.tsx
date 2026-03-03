/**
 * AutoChannelStatus - Status display component for PCO Auto Channels.
 *
 * Shows the current sync status and configuration for an auto channel.
 * Used in channel settings or detail views.
 *
 * Features:
 * - Shows sync status (last sync time, success/error)
 * - Displays current configuration summary
 * - Allows manual sync trigger
 * - Links to settings for editing
 */
import React, { useState } from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Text } from "react-native";
import { useQuery, useAction } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@services/api/convex";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useAuth } from "@providers/AuthProvider";
import type { Id } from "@services/api/convex";
import { formatDistanceToNow } from "date-fns";

interface AutoChannelStatusProps {
  channelId: Id<"chatChannels">;
  onEditSettings?: () => void;
}

export function AutoChannelStatus({
  channelId,
  onEditSettings,
}: AutoChannelStatusProps) {
  const { primaryColor } = useCommunityTheme();
  const { token } = useAuth();
  const [syncing, setSyncing] = useState(false);

  // Query for auto channel config
  const config = useQuery(
    api.functions.pcoServices.queries.getAutoChannelConfigByChannel,
    token ? { token, channelId } : "skip"
  );

  const triggerSync = useAction(
    api.functions.pcoServices.actions.triggerChannelSync
  );

  if (!config) {
    return null;
  }

  const handleSync = async () => {
    if (!token) return;
    try {
      setSyncing(true);
      await triggerSync({ token, channelId });
    } catch (err) {
      console.error("Sync failed:", err);
    } finally {
      setSyncing(false);
    }
  };

  // Extract nested config for PCO Services
  const pcoConfig = config.config;

  const statusColor =
    config.lastSyncStatus === "success" ? "#34C759" : "#FF3B30";
  const lastSyncText = config.lastSyncAt
    ? `Last synced ${formatDistanceToNow(config.lastSyncAt, { addSuffix: true })}`
    : "Never synced";

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons name="sync" size={16} color={primaryColor} />
          <Text style={styles.title}>PCO Auto Channel</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: primaryColor + "20" }]}>
          <Text style={[styles.badgeText, { color: primaryColor }]}>
            {pcoConfig.serviceTypeName || "PCO Services"}
          </Text>
        </View>
      </View>

      <View style={styles.info}>
        <Text style={styles.infoText}>
          {pcoConfig.syncScope === "all_teams"
            ? "Syncing all teams"
            : `Syncing ${pcoConfig.teamNames?.join(", ") || "selected teams"}`}
        </Text>
        <Text style={styles.infoText}>
          Members added {pcoConfig.addMembersDaysBefore} days before, removed{" "}
          {pcoConfig.removeMembersDaysAfter} days after service
        </Text>
      </View>

      <View style={styles.status}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={styles.statusText}>{lastSyncText}</Text>
        </View>
        {config.lastSyncError && (
          <Text style={styles.errorText}>{config.lastSyncError}</Text>
        )}
        {config.currentEventDate && (
          <Text style={styles.planText}>
            Current service:{" "}
            {new Date(config.currentEventDate).toLocaleDateString()}
          </Text>
        )}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.button}
          onPress={handleSync}
          disabled={syncing}
        >
          {syncing ? (
            <ActivityIndicator size="small" color={primaryColor} />
          ) : (
            <>
              <Ionicons name="sync" size={14} color={primaryColor} />
              <Text style={[styles.buttonText, { color: primaryColor }]}>
                Sync Now
              </Text>
            </>
          )}
        </TouchableOpacity>

        {onEditSettings && (
          <TouchableOpacity style={styles.button} onPress={onEditSettings}>
            <Ionicons name="settings-outline" size={14} color="#666" />
            <Text style={[styles.buttonText, { color: "#666" }]}>Settings</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#f9f9f9",
    borderRadius: 12,
    padding: 16,
    marginVertical: 8,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "500",
  },
  info: {
    marginBottom: 12,
  },
  infoText: {
    fontSize: 13,
    color: "#666",
    marginBottom: 4,
  },
  status: {
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    color: "#666",
  },
  errorText: {
    fontSize: 12,
    color: "#FF3B30",
    marginTop: 4,
  },
  planText: {
    fontSize: 12,
    color: "#999",
    marginTop: 4,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    backgroundColor: "#fff",
  },
  buttonText: {
    fontSize: 13,
    fontWeight: "500",
  },
});
