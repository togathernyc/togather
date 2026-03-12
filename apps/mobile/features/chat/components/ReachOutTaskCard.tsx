import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import type { Id } from "@services/api/convex";
import { api, useAuthenticatedMutation } from "@services/api/convex";
import { useCommunityTheme } from "@hooks/useCommunityTheme";

type ReachOutTaskStatus = "pending" | "assigned" | "resolved" | "revoked";

type ReachOutTaskCardData = {
  _id: Id<"tasks">;
  groupId?: Id<"groups">;
  title?: string;
  description?: string;
  content?: string;
  status: string;
  assignedToId?: Id<"users">;
  assignedToName?: string;
  assignee?: { _id: Id<"users">; name: string } | null;
  createdAt: number;
  viewerCanManage?: boolean;
  viewerCanWithdraw?: boolean;
};

function mapStatus(task: ReachOutTaskCardData): ReachOutTaskStatus {
  if (task.status === "resolved" || task.status === "done") return "resolved";
  if (task.status === "revoked" || task.status === "canceled") return "revoked";
  if (task.status === "assigned") return "assigned";
  if (task.status === "open" || task.status === "snoozed") {
    const hasAssignee = Boolean(task.assignedToId || task.assignedToName || task.assignee);
    return hasAssignee ? "assigned" : "pending";
  }
  return "pending";
}

function statusBadge(status: ReachOutTaskStatus) {
  if (status === "resolved") {
    return { label: "Resolved", color: "#34C759", icon: "checkmark-circle-outline" as const };
  }
  if (status === "revoked") {
    return { label: "Withdrawn", color: "#999999", icon: "close-circle-outline" as const };
  }
  if (status === "assigned") {
    return { label: "Seen", color: "#007AFF", icon: "eye-outline" as const };
  }
  return { label: "Sent", color: "#FF9500", icon: "time-outline" as const };
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (diffDays === 1) {
    return "Yesterday";
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

interface ReachOutTaskCardProps {
  task: ReachOutTaskCardData;
  variant: "member" | "leader";
}

export function ReachOutTaskCard({ task, variant }: ReachOutTaskCardProps) {
  const { primaryColor } = useCommunityTheme();
  const router = useRouter();
  const pathname = usePathname();
  const [busyAction, setBusyAction] = useState<null | "claim" | "done" | "unassign" | "withdraw">(null);

  const claimTask = useAuthenticatedMutation(api.functions.tasks.index.claim);
  const markDone = useAuthenticatedMutation(api.functions.tasks.index.markDone);
  const assignTask = useAuthenticatedMutation(api.functions.tasks.index.assign);
  const withdrawReachOut = useAuthenticatedMutation(api.functions.tasks.index.withdrawReachOut);

  const status = useMemo(() => mapStatus(task), [task]);
  const badge = statusBadge(status);
  const assigneeName = task.assignee?.name || task.assignedToName;
  const content = task.content || task.title || task.description || "Reach-out request";
  const isOpen = status === "pending" || status === "assigned";

  const onClaim = async () => {
    setBusyAction("claim");
    try {
      await claimTask({ taskId: task._id });
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to claim task");
    } finally {
      setBusyAction(null);
    }
  };

  const onDone = async () => {
    setBusyAction("done");
    try {
      await markDone({ taskId: task._id });
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to mark done");
    } finally {
      setBusyAction(null);
    }
  };

  const onUnassign = async () => {
    setBusyAction("unassign");
    try {
      await assignTask({ taskId: task._id });
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to unassign");
    } finally {
      setBusyAction(null);
    }
  };

  const onWithdraw = () => {
    Alert.alert(
      "Withdraw Request",
      "Are you sure you want to withdraw this request?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Withdraw",
          style: "destructive",
          onPress: async () => {
            setBusyAction("withdraw");
            try {
              await withdrawReachOut({ taskId: task._id });
            } catch (error: any) {
              Alert.alert("Error", error?.message || "Failed to withdraw request");
            } finally {
              setBusyAction(null);
            }
          },
        },
      ],
    );
  };

  const openTasks = () => {
    const encodedReturnTo = encodeURIComponent(pathname);
    if (task.groupId) {
      router.push(`/(user)/leader-tools/${task.groupId}/tasks?returnTo=${encodedReturnTo}`);
      return;
    }
    router.push(`/tasks?returnTo=${encodedReturnTo}`);
  };

  return (
    <View style={[styles.card, { borderLeftColor: badge.color }]}>
      <View style={styles.header}>
        <View style={[styles.badge, { backgroundColor: `${badge.color}20` }]}>
          <Ionicons name={badge.icon} size={14} color={badge.color} />
          <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
        </View>
        <Text style={styles.time}>{formatTime(task.createdAt)}</Text>
      </View>

      <Text style={styles.content}>{content}</Text>
      {assigneeName ? <Text style={styles.meta}>Assigned to {assigneeName}</Text> : null}

      {variant === "member" ? (
        <View style={styles.actionsRow}>
          {isOpen && (task.viewerCanWithdraw ?? true) ? (
            <Pressable style={styles.textAction} onPress={onWithdraw} disabled={busyAction === "withdraw"}>
              {busyAction === "withdraw" ? (
                <ActivityIndicator size="small" color="#999" />
              ) : (
                <Text style={styles.textActionLabel}>Withdraw</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {variant === "leader" && (task.viewerCanManage ?? true) ? (
        <View style={styles.actionsRow}>
          {status === "pending" ? (
            <Pressable style={[styles.button, { backgroundColor: `${primaryColor}20` }]} onPress={onClaim}>
              {busyAction === "claim" ? (
                <ActivityIndicator size="small" color={primaryColor} />
              ) : (
                <Text style={[styles.buttonText, { color: primaryColor }]}>Claim</Text>
              )}
            </Pressable>
          ) : null}
          {status === "assigned" ? (
            <>
              <Pressable style={[styles.button, { backgroundColor: "#34C75920" }]} onPress={onDone}>
                {busyAction === "done" ? (
                  <ActivityIndicator size="small" color="#34C759" />
                ) : (
                  <Text style={[styles.buttonText, { color: "#34C759" }]}>Done</Text>
                )}
              </Pressable>
              <Pressable style={[styles.button, { backgroundColor: "#FF3B3020" }]} onPress={onUnassign}>
                {busyAction === "unassign" ? (
                  <ActivityIndicator size="small" color="#FF3B30" />
                ) : (
                  <Text style={[styles.buttonText, { color: "#FF3B30" }]}>Unassign</Text>
                )}
              </Pressable>
            </>
          ) : null}
          <Pressable style={styles.button} onPress={openTasks}>
            <Text style={styles.buttonText}>Open Tasks</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  time: {
    fontSize: 12,
    color: "#999",
  },
  content: {
    fontSize: 15,
    color: "#333",
    lineHeight: 21,
  },
  meta: {
    marginTop: 8,
    fontSize: 13,
    color: "#666",
  },
  actionsRow: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
  },
  buttonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#333",
  },
  textAction: {
    paddingVertical: 4,
  },
  textActionLabel: {
    fontSize: 13,
    color: "#999",
  },
});
