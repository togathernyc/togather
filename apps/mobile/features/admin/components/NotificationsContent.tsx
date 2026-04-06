/**
 * NotificationsContent - Admin broadcast control panel
 *
 * Allows community admins to create targeted notifications
 * with 2-party approval before sending.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { useQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { BroadcastComposer } from "./BroadcastComposer";
import { BroadcastApprovalList } from "./BroadcastApprovalList";

type View = "list" | "compose";

export function NotificationsContent() {
  const { community, user } = useAuth();
  const { colors } = useTheme();
  const [currentView, setCurrentView] = useState<View>("list");

  const communityId = community?.id as Id<"communities"> | undefined;

  const broadcasts = useQuery(
    api.functions.adminBroadcasts.list,
    communityId ? { communityId } : "skip"
  );

  const pendingCount = broadcasts?.filter((b) => b.status === "pending_approval").length || 0;

  if (!communityId) {
    return (
      <View style={[styles.center, { backgroundColor: colors.surfaceSecondary }]}>
        <Text style={{ color: colors.textSecondary }}>No community selected</Text>
      </View>
    );
  }

  if (currentView === "compose") {
    return (
      <BroadcastComposer
        communityId={communityId}
        onBack={() => setCurrentView("list")}
        onCreated={() => setCurrentView("list")}
      />
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}
      contentContainerStyle={styles.contentContainer}
    >
      {/* Create New */}
      <TouchableOpacity
        style={[styles.createButton, { backgroundColor: DEFAULT_PRIMARY_COLOR }]}
        onPress={() => setCurrentView("compose")}
      >
        <Ionicons name="add-circle-outline" size={22} color="#fff" />
        <Text style={styles.createButtonText}>New Broadcast</Text>
      </TouchableOpacity>

      {/* Pending Approvals */}
      {pendingCount > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            PENDING APPROVAL ({pendingCount})
          </Text>
          <BroadcastApprovalList
            communityId={communityId}
            broadcasts={broadcasts?.filter((b) => b.status === "pending_approval") || []}
          />
        </>
      )}

      {/* All Broadcasts */}
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
        ALL BROADCASTS
      </Text>

      {broadcasts === undefined ? (
        <ActivityIndicator style={{ marginTop: 20 }} color={colors.textSecondary} />
      ) : broadcasts.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.surface }]}>
          <Ionicons name="megaphone-outline" size={36} color={colors.borderLight} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No broadcasts yet. Create one to notify targeted users.
          </Text>
        </View>
      ) : (
        broadcasts.map((broadcast) => (
          <View
            key={broadcast._id}
            style={[styles.broadcastCard, { backgroundColor: colors.surface }]}
          >
            <View style={styles.broadcastHeader}>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(broadcast.status) }]}>
                <Text style={styles.statusText}>{formatStatus(broadcast.status)}</Text>
              </View>
              <Text style={[styles.broadcastDate, { color: colors.textSecondary }]}>
                {new Date(broadcast.createdAt).toLocaleDateString()}
              </Text>
            </View>
            <Text style={[styles.broadcastTitle, { color: colors.text }]}>
              {broadcast.title}
            </Text>
            <Text style={[styles.broadcastBody, { color: colors.textSecondary }]} numberOfLines={2}>
              {broadcast.body}
            </Text>
            <View style={styles.broadcastMeta}>
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                {broadcast.targetUserCount} users &middot; {broadcast.channels.join(", ")} &middot; by {broadcast.createdByName}
              </Text>
              {broadcast.targetCriteria && (
                <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                  Target: {formatCriteria(broadcast.targetCriteria)}
                </Text>
              )}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

function getStatusColor(status: string): string {
  switch (status) {
    case "draft": return "#94a3b8";
    case "pending_approval": return "#f59e0b";
    case "approved": return "#22c55e";
    case "sent": return "#3b82f6";
    case "rejected": return "#ef4444";
    default: return "#94a3b8";
  }
}

function formatStatus(status: string): string {
  switch (status) {
    case "draft": return "Draft";
    case "pending_approval": return "Pending";
    case "approved": return "Approved";
    case "sent": return "Sent";
    case "rejected": return "Rejected";
    default: return status;
  }
}

function formatCriteria(criteria: { type: string; groupTypeSlug?: string; daysThreshold?: number }): string {
  switch (criteria.type) {
    case "all_users": return "All users";
    case "new_users": return `New users (${criteria.daysThreshold || 30}d)`;
    case "no_profile_pic": return "No profile picture";
    case "no_group_of_type": return `No ${criteria.groupTypeSlug || "group"}`;
    case "leaders_no_group_image": return "Leaders w/o group image";
    default: return criteria.type;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  createButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  createButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 12,
    marginTop: 8,
  },
  emptyCard: {
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
  },
  broadcastCard: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  broadcastHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
  broadcastDate: {
    fontSize: 12,
  },
  broadcastTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  broadcastBody: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  broadcastMeta: {
    gap: 2,
  },
  metaText: {
    fontSize: 12,
  },
});
