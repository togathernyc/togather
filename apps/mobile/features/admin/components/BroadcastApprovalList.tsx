/**
 * BroadcastApprovalList - Shows pending broadcasts for admin approval/rejection
 *
 * 2-party control: the approving admin must be different from the creator.
 */

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";

interface Broadcast {
  _id: string;
  title: string;
  body: string;
  channels: string[];
  targetUserCount: number;
  targetCriteria: { type: string; groupTypeSlug?: string; daysThreshold?: number };
  createdById: string;
  createdByName: string;
  createdAt: number;
}

interface BroadcastApprovalListProps {
  communityId: Id<"communities">;
  broadcasts: Broadcast[];
  onSelect?: (broadcast: Broadcast) => void;
}

export function BroadcastApprovalList({
  communityId,
  broadcasts,
  onSelect,
}: BroadcastApprovalListProps) {
  const { user } = useAuth();
  const { colors } = useTheme();

  const approveMutation = useAuthenticatedMutation(api.functions.adminBroadcasts.approve);
  const rejectMutation = useAuthenticatedMutation(api.functions.adminBroadcasts.reject);
  const sendMutation = useAuthenticatedMutation(api.functions.adminBroadcasts.sendBroadcast);

  const handleApprove = (broadcast: Broadcast) => {
    if (broadcast.createdById === user?.id) {
      Alert.alert("Cannot Approve", "You cannot approve your own broadcast. Another admin must approve it.");
      return;
    }

    Alert.alert(
      "Approve Broadcast",
      `"${broadcast.title}" will be ready to send to ${broadcast.targetUserCount} users.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Approve",
          onPress: async () => {
            try {
              await approveMutation({
                broadcastId: broadcast._id as Id<"adminBroadcasts">,
              });
            } catch (error: any) {
              Alert.alert("Error", error.message || "Failed to approve.");
            }
          },
        },
      ]
    );
  };

  const handleReject = (broadcast: Broadcast) => {
    Alert.alert(
      "Reject Broadcast",
      `Are you sure you want to reject "${broadcast.title}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reject",
          style: "destructive",
          onPress: async () => {
            try {
              await rejectMutation({
                broadcastId: broadcast._id as Id<"adminBroadcasts">,
              });
            } catch (error: any) {
              Alert.alert("Error", error.message || "Failed to reject.");
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      {broadcasts.map((broadcast) => {
        const isCreator = broadcast.createdById === user?.id;

        return (
          <TouchableOpacity
            key={broadcast._id}
            style={[styles.card, { backgroundColor: colors.surface }]}
            onPress={() => onSelect?.(broadcast)}
            activeOpacity={0.7}
          >
            <Text style={[styles.title, { color: colors.text }]}>{broadcast.title}</Text>
            <Text style={[styles.body, { color: colors.textSecondary }]} numberOfLines={2}>
              {broadcast.body}
            </Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              {broadcast.targetUserCount} users &middot; {broadcast.channels.join(", ")} &middot; by {broadcast.createdByName}
            </Text>

            {isCreator ? (
              <Text style={[styles.waitingText, { color: colors.textSecondary }]}>
                Waiting for another admin to approve
              </Text>
            ) : (
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.rejectButton, { borderColor: "#ef4444" }]}
                  onPress={() => handleReject(broadcast)}
                >
                  <Ionicons name="close" size={18} color="#ef4444" />
                  <Text style={[styles.rejectText]}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.approveButton, { backgroundColor: "#22c55e" }]}
                  onPress={() => handleApprove(broadcast)}
                >
                  <Ionicons name="checkmark" size={18} color="#fff" />
                  <Text style={styles.approveText}>Approve</Text>
                </TouchableOpacity>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
    marginBottom: 16,
  },
  card: {
    borderRadius: 12,
    padding: 14,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 6,
  },
  meta: {
    fontSize: 12,
    marginBottom: 12,
  },
  waitingText: {
    fontSize: 13,
    fontStyle: "italic",
    textAlign: "center",
    paddingVertical: 8,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
  },
  rejectButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  rejectText: {
    color: "#ef4444",
    fontWeight: "600",
  },
  approveButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 10,
    borderRadius: 10,
  },
  approveText: {
    color: "#fff",
    fontWeight: "600",
  },
});
