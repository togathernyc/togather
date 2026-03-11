import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { UserRoute } from "@components/guards/UserRoute";
import {
  api,
  Id,
  useAuthenticatedMutation,
  useAuthenticatedQuery,
} from "@services/api/convex";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useIsDesktopWeb } from "../../../hooks/useIsDesktopWeb";

type TaskSourceType = "manual" | "bot_task_reminder" | "reach_out" | "followup";

type Segment = "my" | "claimable";
type TaskId = Id<"tasks">;

type TaskListItem = {
  _id: TaskId;
  title: string;
  description?: string;
  status: string;
  sourceType: TaskSourceType;
  groupName?: string;
  groupId: Id<"groups">;
  assignedToId?: Id<"users">;
};

const sourceLabels: Record<TaskSourceType, string> = {
  manual: "MANUAL",
  bot_task_reminder: "BOT",
  reach_out: "REACH OUT",
  followup: "FOLLOW-UP",
};

const sourceColors: Record<TaskSourceType, string> = {
  manual: "#64748B",
  bot_task_reminder: "#7C3AED",
  reach_out: "#2563EB",
  followup: "#0891B2",
};

function formatStatus(status: string): string {
  if (status === "snoozed") return "Snoozed";
  if (status === "done") return "Done";
  if (status === "canceled") return "Canceled";
  return "Open";
}

function statusColor(status: string): string {
  if (status === "done") return "#16A34A";
  if (status === "snoozed") return "#CA8A04";
  if (status === "canceled") return "#DC2626";
  return "#2563EB";
}

export function TasksTabScreen() {
  const insets = useSafeAreaInsets();
  const { primaryColor } = useCommunityTheme();
  const isDesktopWeb = useIsDesktopWeb();

  const [segment, setSegment] = useState<Segment>("my");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const myTasks = useAuthenticatedQuery(api.functions.tasks.index.listMine, {});
  const claimableTasks = useAuthenticatedQuery(
    api.functions.tasks.index.listClaimable,
    {},
  );

  const claimTask = useAuthenticatedMutation(api.functions.tasks.index.claim);
  const markDone = useAuthenticatedMutation(api.functions.tasks.index.markDone);
  const snoozeTask = useAuthenticatedMutation(api.functions.tasks.index.snooze);
  const cancelTask = useAuthenticatedMutation(api.functions.tasks.index.cancel);

  const activeTasks = (segment === "my" ? myTasks : claimableTasks) as
    | TaskListItem[]
    | undefined;
  const selectedTask = useMemo(() => {
    if (!activeTasks || activeTasks.length === 0) return null;
    const fallback = activeTasks[0];
    if (!selectedTaskId) return fallback;
    return (
      activeTasks.find((task) => task._id.toString() === selectedTaskId) ??
      fallback
    );
  }, [activeTasks, selectedTaskId]);

  async function runTaskAction(
    taskId: TaskId,
    action: "claim" | "done" | "snooze" | "cancel",
  ) {
    setBusyTaskId(taskId.toString());
    try {
      if (action === "claim") {
        await claimTask({ taskId });
      } else if (action === "done") {
        await markDone({ taskId });
      } else if (action === "snooze") {
        await snoozeTask({ taskId, preset: "1_week" });
      } else {
        await cancelTask({ taskId });
      }
    } finally {
      setBusyTaskId(null);
    }
  }

  const renderTaskCard = ({ item }: { item: TaskListItem }) => {
    const taskId = item._id;
    const taskIdKey = taskId.toString();
    const sourceType = (item.sourceType ?? "manual") as TaskSourceType;
    const isSelected = selectedTask?._id?.toString() === taskIdKey;
    const isBusy = busyTaskId === taskIdKey;

    return (
      <Pressable
        onPress={() => setSelectedTaskId(taskIdKey)}
        style={[
          styles.card,
          isSelected && isDesktopWeb ? styles.cardSelected : undefined,
        ]}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <View
            style={[
              styles.badge,
              { backgroundColor: sourceColors[sourceType] ?? "#64748B" },
            ]}
          >
            <Text style={styles.badgeText}>
              {sourceLabels[sourceType] ?? "TASK"}
            </Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <Ionicons name="people-outline" size={14} color="#64748B" />
          <Text style={styles.metaText}>{item.groupName ?? "Group"}</Text>
          <Text
            style={[styles.statusText, { color: statusColor(item.status) }]}
          >
            {formatStatus(item.status)}
          </Text>
        </View>

        <View style={styles.actionsRow}>
          {segment === "claimable" && !item.assignedToId ? (
            <Pressable
              disabled={isBusy}
              onPress={() => runTaskAction(taskId, "claim")}
              style={[styles.primaryAction, isBusy && styles.disabledAction]}
            >
              <Text style={styles.primaryActionText}>
                {isBusy ? "..." : "Claim"}
              </Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                disabled={isBusy}
                onPress={() => runTaskAction(taskId, "done")}
                style={[styles.inlineAction, isBusy && styles.disabledAction]}
              >
                <Text style={styles.inlineActionText}>Done</Text>
              </Pressable>
              <Pressable
                disabled={isBusy}
                onPress={() => runTaskAction(taskId, "snooze")}
                style={[styles.inlineAction, isBusy && styles.disabledAction]}
              >
                <Text style={styles.inlineActionText}>Snooze 1w</Text>
              </Pressable>
              <Pressable
                disabled={isBusy}
                onPress={() => runTaskAction(taskId, "cancel")}
                style={[styles.inlineAction, isBusy && styles.disabledAction]}
              >
                <Text style={[styles.inlineActionText, { color: "#DC2626" }]}>
                  Cancel
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </Pressable>
    );
  };

  const isLoading = activeTasks === undefined;

  const content = (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Text style={styles.headerTitle}>Tasks</Text>
        <Text style={styles.headerSubtitle}>All task-related workflows</Text>
      </View>

      <View style={styles.segmentRow}>
        <Pressable
          onPress={() => setSegment("my")}
          style={[
            styles.segmentButton,
            segment === "my" && { backgroundColor: primaryColor },
          ]}
        >
          <Text
            style={[
              styles.segmentText,
              segment === "my" && styles.segmentTextActive,
            ]}
          >
            My Tasks
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setSegment("claimable")}
          style={[
            styles.segmentButton,
            segment === "claimable" && { backgroundColor: primaryColor },
          ]}
        >
          <Text
            style={[
              styles.segmentText,
              segment === "claimable" && styles.segmentTextActive,
            ]}
          >
            Claimable
          </Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={styles.loadingText}>Loading tasks...</Text>
        </View>
      ) : !activeTasks || activeTasks.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="checkmark-done-outline" size={48} color="#94A3B8" />
          <Text style={styles.emptyTitle}>No tasks here yet</Text>
          <Text style={styles.emptySubtitle}>
            {segment === "my"
              ? "Assigned tasks will appear here."
              : "Unassigned group tasks will appear here."}
          </Text>
        </View>
      ) : isDesktopWeb ? (
        <View style={styles.desktopContainer}>
          <View style={styles.desktopList}>
            <FlatList
              data={activeTasks}
              renderItem={renderTaskCard}
              keyExtractor={(item) => item._id.toString()}
              contentContainerStyle={styles.listContent}
            />
          </View>
          <View style={styles.desktopDetail}>
            {selectedTask ? (
              <ScrollView contentContainerStyle={styles.detailContent}>
                <Text style={styles.detailTitle}>{selectedTask.title}</Text>
                {selectedTask.description ? (
                  <Text style={styles.detailBody}>
                    {selectedTask.description}
                  </Text>
                ) : null}
                <View style={styles.detailMeta}>
                  <Text style={styles.detailMetaText}>
                    Group: {selectedTask.groupName ?? "Group"}
                  </Text>
                  <Text
                    style={[
                      styles.detailMetaText,
                      { color: statusColor(selectedTask.status) },
                    ]}
                  >
                    Status: {formatStatus(selectedTask.status)}
                  </Text>
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      ) : (
        <FlatList
          data={activeTasks}
          renderItem={renderTaskCard}
          keyExtractor={(item) => item._id.toString()}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );

  return <UserRoute>{content}</UserRoute>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: "#0F172A",
  },
  headerSubtitle: {
    marginTop: 4,
    fontSize: 14,
    color: "#64748B",
  },
  segmentRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 8,
  },
  segmentButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "#EEF2F7",
  },
  segmentText: {
    fontSize: 13,
    color: "#334155",
    fontWeight: "600",
  },
  segmentTextActive: {
    color: "#fff",
  },
  listContent: {
    padding: 12,
    paddingBottom: 28,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 12,
    marginBottom: 10,
  },
  cardSelected: {
    borderColor: "#2563EB",
    backgroundColor: "#F8FAFF",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: "#0F172A",
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },
  metaRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaText: {
    fontSize: 12,
    color: "#475569",
  },
  statusText: {
    marginLeft: "auto",
    fontSize: 12,
    fontWeight: "600",
  },
  actionsRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  primaryAction: {
    backgroundColor: "#2563EB",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  primaryActionText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  inlineAction: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: "#fff",
  },
  inlineActionText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#0F172A",
  },
  disabledAction: {
    opacity: 0.5,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: "#64748B",
  },
  emptyTitle: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: "700",
    color: "#0F172A",
  },
  emptySubtitle: {
    marginTop: 6,
    textAlign: "center",
    color: "#64748B",
  },
  desktopContainer: {
    flex: 1,
    flexDirection: "row",
  },
  desktopList: {
    width: 420,
    borderRightWidth: 1,
    borderRightColor: "#E2E8F0",
  },
  desktopDetail: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  detailContent: {
    padding: 20,
    gap: 10,
  },
  detailTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0F172A",
  },
  detailBody: {
    fontSize: 14,
    lineHeight: 20,
    color: "#334155",
  },
  detailMeta: {
    marginTop: 6,
    gap: 6,
  },
  detailMetaText: {
    fontSize: 13,
    color: "#64748B",
  },
});
