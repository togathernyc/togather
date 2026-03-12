import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import { useAuth } from "@providers/AuthProvider";
import { useIsDesktopWeb } from "../../../hooks/useIsDesktopWeb";
import {
  buildTaskRows,
  parseTagsInput,
  type TaskListItem,
  type TaskRow,
  type TaskSourceType,
} from "./taskHelpers";

type Segment = "my" | "all" | "claimable";
type TaskId = Id<"tasks">;
type SourceFilter = "all" | TaskSourceType;
type AssigneeFilter = "all" | "unassigned" | string;
type GroupMemberSearchResult = {
  userId: string;
  name: string;
};
type LeaderSearchResult = {
  userId: string;
  name: string;
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
  const router = useRouter();
  const params = useLocalSearchParams<{ group_id?: string }>();
  const { primaryColor } = useCommunityTheme();
  const isDesktopWeb = useIsDesktopWeb();
  const { community } = useAuth();
  const contextGroupId =
    typeof params.group_id === "string" ? params.group_id : null;

  const [segment, setSegment] = useState<Segment>("my");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("all");
  const [searchText, setSearchText] = useState("");
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const [assigningTaskId, setAssigningTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createGroupId, setCreateGroupId] = useState<string | null>(contextGroupId);
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createTagsInput, setCreateTagsInput] = useState("");
  const [createRelevantMemberId, setCreateRelevantMemberId] = useState<string | null>(
    null,
  );
  const [createRelevantMemberName, setCreateRelevantMemberName] = useState<
    string | null
  >(null);
  const [createRelevantMemberSearch, setCreateRelevantMemberSearch] = useState("");
  const [debouncedRelevantMemberSearch, setDebouncedRelevantMemberSearch] =
    useState("");
  const [createAssignedToId, setCreateAssignedToId] = useState<string | null>(null);
  const [createAssignedToName, setCreateAssignedToName] = useState<string | null>(
    null,
  );
  const [createAssignedSearch, setCreateAssignedSearch] = useState("");
  const [debouncedAssignedSearch, setDebouncedAssignedSearch] = useState("");
  const [createParentTaskId, setCreateParentTaskId] = useState<string | null>(null);
  const [createParentTaskSearch, setCreateParentTaskSearch] = useState("");
  const [debouncedParentTaskSearch, setDebouncedParentTaskSearch] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const taskFilterArgs = useMemo(
    () => ({
      sourceType: sourceFilter === "all" ? undefined : sourceFilter,
      tag: tagFilter === "all" ? undefined : tagFilter,
      searchText: searchText.trim() || undefined,
    }),
    [sourceFilter, tagFilter, searchText],
  );

  const myTasks = useAuthenticatedQuery(api.functions.tasks.index.listMine, taskFilterArgs);
  const allTasks = useAuthenticatedQuery(api.functions.tasks.index.listAll, taskFilterArgs);
  const claimableTasks = useAuthenticatedQuery(
    api.functions.tasks.index.listClaimable,
    taskFilterArgs,
  );

  const groups = useAuthenticatedQuery(
    api.functions.groups.queries.listForUser,
    community?.id
      ? {
          communityId: community.id as Id<"communities">,
          limit: 100,
        }
      : "skip",
  ) as Array<{ _id: string; name: string; userRole?: string }> | undefined;

  const leaderGroups = useMemo(() => {
    return (groups ?? []).filter(
      (group) => group.userRole === "leader" || group.userRole === "admin",
    );
  }, [groups]);

  useEffect(() => {
    if (!contextGroupId) return;
    setCreateGroupId(contextGroupId);
  }, [contextGroupId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedRelevantMemberSearch(createRelevantMemberSearch.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [createRelevantMemberSearch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedAssignedSearch(createAssignedSearch.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [createAssignedSearch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedParentTaskSearch(createParentTaskSearch.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [createParentTaskSearch]);

  const selectedCreateGroup =
    createGroupId && leaderGroups.find((group) => group._id === createGroupId);

  const createRelevantMemberResults = useAuthenticatedQuery(
    api.functions.tasks.index.searchRelevantMembers,
    createGroupId && debouncedRelevantMemberSearch.length >= 2
      ? {
          groupId: createGroupId as Id<"groups">,
          searchText: debouncedRelevantMemberSearch,
          limit: 30,
        }
      : "skip",
  ) as GroupMemberSearchResult[] | undefined;

  const createAssignableLeaderResults = useAuthenticatedQuery(
    api.functions.tasks.index.searchAssignableLeaders,
    createGroupId && debouncedAssignedSearch.length >= 2
      ? {
          groupId: createGroupId as Id<"groups">,
          searchText: debouncedAssignedSearch,
          limit: 30,
        }
      : "skip",
  ) as LeaderSearchResult[] | undefined;

  const createGroupTasks = useAuthenticatedQuery(
    api.functions.tasks.index.listGroup,
    createGroupId
      ? {
          groupId: createGroupId as Id<"groups">,
          searchText: debouncedParentTaskSearch || undefined,
        }
      : "skip",
  ) as TaskListItem[] | undefined;

  const createParentTaskOptions = useMemo(
    () => (createGroupTasks ?? []).filter((task) => !task.parentTaskId),
    [createGroupTasks],
  );

  const assigneeOptions = useMemo(() => {
    const tasks = allTasks ?? [];
    const leadersById = new Map<string, string>();
    let hasUnassigned = false;
    for (const task of tasks) {
      if (task.assignedToId) {
        leadersById.set(
          task.assignedToId.toString(),
          task.assignedToName?.trim() || "Assigned Leader",
        );
      } else {
        hasUnassigned = true;
      }
    }

    const leaderOptions = [...leadersById.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return [
      { value: "all", label: "All Assignees" },
      ...leaderOptions,
      ...(hasUnassigned ? [{ value: "unassigned", label: "Unassigned" }] : []),
    ];
  }, [allTasks]);

  const filteredAllTasks = useMemo(() => {
    if (!allTasks) return allTasks;
    if (assigneeFilter === "all") return allTasks;
    if (assigneeFilter === "unassigned") {
      return allTasks.filter((task) => !task.assignedToId);
    }
    return allTasks.filter((task) => task.assignedToId?.toString() === assigneeFilter);
  }, [allTasks, assigneeFilter]);

  const activeTasks = useMemo(() => {
    if (segment === "my") return myTasks;
    if (segment === "claimable") return claimableTasks;
    return filteredAllTasks;
  }, [claimableTasks, filteredAllTasks, myTasks, segment]);

  const assigningTask = useMemo(
    () =>
      (activeTasks ?? []).find((task) => task._id.toString() === assigningTaskId) ??
      null,
    [activeTasks, assigningTaskId],
  );

  const assignableLeaders = useAuthenticatedQuery(
    api.functions.tasks.index.listAssignableLeaders,
    assigningTask ? { groupId: assigningTask.groupId } : "skip",
  ) as Array<{ userId: string; name: string }> | undefined;

  const availableTags = useMemo(() => {
    const tasks = activeTasks ?? [];
    return [...new Set(tasks.flatMap((task) => task.tags ?? []))].sort();
  }, [activeTasks]);

  const taskRows = useMemo(() => {
    return activeTasks ? buildTaskRows(activeTasks, expandedParents) : [];
  }, [activeTasks, expandedParents]);

  const claimTask = useAuthenticatedMutation(api.functions.tasks.index.claim);
  const markDone = useAuthenticatedMutation(api.functions.tasks.index.markDone);
  const snoozeTask = useAuthenticatedMutation(api.functions.tasks.index.snooze);
  const cancelTask = useAuthenticatedMutation(api.functions.tasks.index.cancel);
  const assignTask = useAuthenticatedMutation(api.functions.tasks.index.assign);
  const createTask = useAuthenticatedMutation(api.functions.tasks.index.create);

  async function runTaskAction(
    taskId: TaskId,
    action: "claim" | "done" | "snooze" | "cancel" | "assign",
    assigneeId?: Id<"users">,
  ) {
    setBusyTaskId(taskId.toString());
    setActionError(null);
    setActionSuccess(null);
    try {
      if (action === "claim") {
        await claimTask({ taskId });
        setActionSuccess("Task claimed");
      } else if (action === "done") {
        await markDone({ taskId });
        setActionSuccess("Task marked done");
      } else if (action === "snooze") {
        await snoozeTask({ taskId, preset: "1_week" });
        setActionSuccess("Task snoozed for 1 week");
      } else if (action === "assign") {
        await assignTask({ taskId, assigneeId });
        setActionSuccess(assigneeId ? "Task assigned" : "Task unassigned");
      } else {
        await cancelTask({ taskId });
        setActionSuccess("Task canceled");
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Task action failed");
    } finally {
      setBusyTaskId(null);
      if (action === "assign") setAssigningTaskId(null);
    }
  }

  async function handleCreateTask() {
    if (!createGroupId) {
      setCreateError("Select a group");
      return;
    }
    if (!createTitle.trim()) {
      setCreateError("Title is required");
      return;
    }

    setCreateBusy(true);
    setCreateError(null);
    try {
      await createTask({
        groupId: createGroupId as Id<"groups">,
        title: createTitle,
        description: createDescription.trim() || undefined,
        tags: parseTagsInput(createTagsInput),
        responsibilityType: createAssignedToId ? "person" : "group",
        assignedToId: createAssignedToId
          ? (createAssignedToId as Id<"users">)
          : undefined,
        targetType: createRelevantMemberId ? "member" : "group",
        targetMemberId: createRelevantMemberId
          ? (createRelevantMemberId as Id<"users">)
          : undefined,
        targetGroupId: createRelevantMemberId
          ? undefined
          : (createGroupId as Id<"groups">),
        parentTaskId: createParentTaskId
          ? (createParentTaskId as Id<"tasks">)
          : undefined,
      });

      setCreateTitle("");
      setCreateDescription("");
      setCreateTagsInput("");
      setCreateRelevantMemberId(null);
      setCreateRelevantMemberName(null);
      setCreateRelevantMemberSearch("");
      setCreateAssignedToId(null);
      setCreateAssignedToName(null);
      setCreateAssignedSearch("");
      setCreateParentTaskId(null);
      setCreateParentTaskSearch("");
      if (!contextGroupId) {
        setCreateGroupId(null);
      }
      setIsCreateOpen(false);
      setActionSuccess("Task created");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create task");
    } finally {
      setCreateBusy(false);
    }
  }

  const toggleParentExpanded = (taskId: string) => {
    setExpandedParents((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const renderTaskCard = ({ item }: { item: TaskRow }) => {
    const task = item.task;
    const taskId = task._id;
    const taskIdKey = taskId.toString();
    const sourceType = (task.sourceType ?? "manual") as TaskSourceType;
    const isBusy = busyTaskId === taskIdKey;
    const showAssignPanel = assigningTaskId === taskIdKey;

    return (
      <Pressable
        onPress={() =>
          router.push(`/(user)/leader-tools/${task.groupId}/tasks/${taskIdKey}`)
        }
        style={[
          styles.card,
          item.depth > 0 && styles.childCard,
          { marginLeft: item.depth * 14 },
        ]}
      >
        <View style={styles.cardHeader}>
          <View style={styles.titleContainer}>
            {item.hasChildren ? (
              <Pressable
                onPress={(event) => {
                  event.stopPropagation();
                  toggleParentExpanded(taskIdKey);
                }}
                hitSlop={8}
                style={styles.chevronButton}
              >
                <Ionicons
                  name={expandedParents.has(taskIdKey) ? "chevron-down" : "chevron-forward"}
                  size={14}
                  color="#64748B"
                />
              </Pressable>
            ) : null}
            <Text style={styles.cardTitle}>{task.title}</Text>
          </View>
          <View
            style={[
              styles.badge,
              { backgroundColor: sourceColors[sourceType] ?? "#64748B" },
            ]}
          >
            <Text style={styles.badgeText}>{sourceLabels[sourceType] ?? "TASK"}</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <Ionicons name="people-outline" size={14} color="#64748B" />
          <Text style={styles.metaText}>{task.groupName ?? "Group"}</Text>
          {task.assignedToName ? (
            <Text style={styles.metaText}>• {task.assignedToName}</Text>
          ) : null}
          <Text style={[styles.statusText, { color: statusColor(task.status) }]}>
            {formatStatus(task.status)}
          </Text>
        </View>

        {task.targetType !== "none" ? (
          <View style={styles.targetPill}>
            <Text style={styles.targetPillText}>
              {task.targetType === "member"
                ? `Member: ${task.targetMemberName ?? "Unknown"}`
                : `Group: ${task.targetGroupName ?? "Group"}`}
            </Text>
          </View>
        ) : null}

        {task.tags && task.tags.length > 0 ? (
          <View style={styles.tagsRow}>
            {task.tags.map((tag) => (
              <View key={`${taskIdKey}-${tag}`} style={styles.tagChip}>
                <Text style={styles.tagChipText}>#{tag}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.actionsRow}>
          {(segment === "claimable" || segment === "all") && !task.assignedToId ? (
            <Pressable
              disabled={isBusy}
              onPress={(event) => {
                event.stopPropagation();
                runTaskAction(taskId, "claim");
              }}
              style={[styles.primaryAction, isBusy && styles.disabledAction]}
            >
              <Text style={styles.primaryActionText}>{isBusy ? "..." : "Claim"}</Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                disabled={isBusy}
                onPress={(event) => {
                  event.stopPropagation();
                  runTaskAction(taskId, "done");
                }}
                style={[styles.inlineAction, isBusy && styles.disabledAction]}
              >
                <Text style={styles.inlineActionText}>Done</Text>
              </Pressable>
              <Pressable
                disabled={isBusy}
                onPress={(event) => {
                  event.stopPropagation();
                  runTaskAction(taskId, "snooze");
                }}
                style={[styles.inlineAction, isBusy && styles.disabledAction]}
              >
                <Text style={styles.inlineActionText}>Snooze 1w</Text>
              </Pressable>
              <Pressable
                disabled={isBusy}
                onPress={(event) => {
                  event.stopPropagation();
                  runTaskAction(taskId, "cancel");
                }}
                style={[styles.inlineAction, isBusy && styles.disabledAction]}
              >
                <Text style={[styles.inlineActionText, { color: "#DC2626" }]}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                disabled={isBusy}
                onPress={(event) => {
                  event.stopPropagation();
                  setAssigningTaskId((current) =>
                    current === taskIdKey ? null : taskIdKey,
                  );
                }}
                style={[styles.inlineAction, isBusy && styles.disabledAction]}
              >
                <Text style={styles.inlineActionText}>
                  {task.assignedToId ? "Reassign" : "Assign"}
                </Text>
              </Pressable>
            </>
          )}
        </View>

        {showAssignPanel ? (
          <View style={styles.assignPanel}>
            <Text style={styles.assignPanelTitle}>Assigned to</Text>
            <View style={styles.assignButtonsRow}>
              {(assignableLeaders ?? []).map((leader) => (
                <Pressable
                  key={`${taskIdKey}-${leader.userId}`}
                  disabled={isBusy}
                  onPress={(event) => {
                    event.stopPropagation();
                    runTaskAction(taskId, "assign", leader.userId as Id<"users">);
                  }}
                  style={[styles.assignButton, isBusy && styles.disabledAction]}
                >
                  <Text style={styles.assignButtonText}>{leader.name}</Text>
                </Pressable>
              ))}
              <Pressable
                disabled={isBusy}
                onPress={(event) => {
                  event.stopPropagation();
                  runTaskAction(taskId, "assign");
                }}
                style={[styles.assignButton, isBusy && styles.disabledAction]}
              >
                <Text style={styles.assignButtonText}>Unassign</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </Pressable>
    );
  };

  const isLoading = activeTasks === undefined;

  const content = (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <View style={styles.headerRow}>
          <View style={styles.headerTitleWrap}>
            <Pressable
              style={styles.backButton}
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                  return;
                }
                router.push("/(tabs)/profile");
              }}
            >
              <Ionicons name="arrow-back" size={22} color="#0F172A" />
            </Pressable>
            <View>
              <Text style={styles.headerTitle}>Tasks</Text>
              <Text style={styles.headerSubtitle}>All task-related workflows</Text>
            </View>
          </View>
          <Pressable style={styles.createButton} onPress={() => setIsCreateOpen(true)}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.createButtonText}>Create</Text>
          </Pressable>
        </View>
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
            style={[styles.segmentText, segment === "my" && styles.segmentTextActive]}
          >
            My Tasks
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setSegment("all")}
          style={[
            styles.segmentButton,
            segment === "all" && { backgroundColor: primaryColor },
          ]}
        >
          <Text
            style={[styles.segmentText, segment === "all" && styles.segmentTextActive]}
          >
            All Tasks
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

      <View style={styles.filtersContainer}>
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder="Search title, tag, member, or group"
          style={styles.searchInput}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chipsRow}>
            {(["all", "manual", "reach_out", "bot_task_reminder"] as SourceFilter[]).map(
              (source) => (
                <Pressable
                  key={source}
                  onPress={() => setSourceFilter(source)}
                  style={[
                    styles.filterChip,
                    sourceFilter === source && styles.filterChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      sourceFilter === source && styles.filterChipTextActive,
                    ]}
                  >
                    {source === "all" ? "All Sources" : sourceLabels[source]}
                  </Text>
                </Pressable>
              ),
            )}
            <Pressable
              onPress={() => setTagFilter("all")}
              style={[styles.filterChip, tagFilter === "all" && styles.filterChipActive]}
            >
              <Text
                style={[
                  styles.filterChipText,
                  tagFilter === "all" && styles.filterChipTextActive,
                ]}
              >
                All Tags
              </Text>
            </Pressable>
            {availableTags.map((tag) => (
              <Pressable
                key={tag}
                onPress={() => setTagFilter(tag)}
                style={[styles.filterChip, tagFilter === tag && styles.filterChipActive]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    tagFilter === tag && styles.filterChipTextActive,
                  ]}
                >
                  #{tag}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
        {segment === "all" ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipsRow}>
              {assigneeOptions.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => setAssigneeFilter(option.value)}
                  style={[
                    styles.filterChip,
                    assigneeFilter === option.value && styles.filterChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      assigneeFilter === option.value && styles.filterChipTextActive,
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        ) : null}
      </View>

      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
      {actionSuccess ? <Text style={styles.successText}>{actionSuccess}</Text> : null}

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
              : segment === "all"
                ? "Open and snoozed tasks from your groups will appear here."
                : "Unassigned group tasks will appear here."}
          </Text>
        </View>
      ) : isDesktopWeb ? (
        <View style={styles.desktopContainer}>
          <View style={styles.desktopList}>
            <FlatList
              data={taskRows}
              renderItem={renderTaskCard}
              keyExtractor={(row) => row.task._id.toString()}
              contentContainerStyle={styles.listContent}
            />
          </View>
          <View style={styles.desktopDetail}>
            <ScrollView contentContainerStyle={styles.detailContent}>
              <Text style={styles.detailTitle}>Task details</Text>
              <Text style={styles.detailBody}>
                Click a task to open its detail page, edit it, and review history.
              </Text>
            </ScrollView>
          </View>
        </View>
      ) : (
        <FlatList
          data={taskRows}
          renderItem={renderTaskCard}
          keyExtractor={(row) => row.task._id.toString()}
          contentContainerStyle={styles.listContent}
        />
      )}

      <Modal visible={isCreateOpen} animationType="slide" onRequestClose={() => setIsCreateOpen(false)}>
        <ScrollView
          style={styles.modalContainer}
          contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Create Task</Text>
            <Pressable onPress={() => setIsCreateOpen(false)}>
              <Ionicons name="close" size={24} color="#0F172A" />
            </Pressable>
          </View>

          <Text style={styles.inputLabel}>Group</Text>
          {contextGroupId ? (
            <View style={styles.lockedField}>
              <Text style={styles.lockedFieldText}>
                {selectedCreateGroup?.name ?? "Current group"}
              </Text>
            </View>
          ) : (
            <View style={styles.chipsWrap}>
              {leaderGroups.map((group) => (
                <Pressable
                  key={group._id}
                  onPress={() => {
                    setCreateGroupId(group._id);
                    setCreateRelevantMemberId(null);
                    setCreateRelevantMemberName(null);
                    setCreateAssignedToId(null);
                    setCreateAssignedToName(null);
                    setCreateParentTaskId(null);
                  }}
                  style={[
                    styles.groupChip,
                    createGroupId === group._id && styles.groupChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.groupChipText,
                      createGroupId === group._id && styles.groupChipTextActive,
                    ]}
                  >
                    {group.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          <Text style={styles.inputLabel}>Title *</Text>
          <TextInput
            value={createTitle}
            onChangeText={setCreateTitle}
            placeholder="Task title"
            style={styles.textInput}
          />

          <Text style={styles.inputLabel}>Description</Text>
          <TextInput
            value={createDescription}
            onChangeText={setCreateDescription}
            placeholder="Optional details"
            multiline
            style={[styles.textInput, styles.multilineInput]}
          />

          <Text style={styles.inputLabel}>Tags (comma separated)</Text>
          <TextInput
            value={createTagsInput}
            onChangeText={setCreateTagsInput}
            placeholder="care, prayer_request"
            style={styles.textInput}
          />

          <Text style={styles.helperText}>
            Target defaults to this group. Add a relevant member only if needed.
          </Text>

          <Text style={styles.inputLabel}>Relevant member</Text>
          <TextInput
            value={createRelevantMemberSearch}
            onChangeText={setCreateRelevantMemberSearch}
            placeholder="Search members (server search)"
            style={styles.textInput}
          />
          {createRelevantMemberId && createRelevantMemberName ? (
            <Pressable
              onPress={() => {
                setCreateRelevantMemberId(null);
                setCreateRelevantMemberName(null);
              }}
              style={styles.selectionPill}
            >
              <Text style={styles.selectionPillText}>
                {createRelevantMemberName} • Tap to clear
              </Text>
            </Pressable>
          ) : null}
          {createRelevantMemberSearch.trim().length >= 2 ? (
            <ScrollView
              style={styles.searchResultsList}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              {(createRelevantMemberResults ?? []).map((member) => {
                return (
                  <Pressable
                    key={member.userId}
                    onPress={() => {
                      setCreateRelevantMemberId(member.userId);
                      setCreateRelevantMemberName(member.name);
                      setCreateRelevantMemberSearch("");
                    }}
                    style={styles.searchResultRow}
                  >
                    <Text style={styles.searchResultText}>{member.name}</Text>
                  </Pressable>
                );
              })}
              {createRelevantMemberResults !== undefined &&
              createRelevantMemberResults.length === 0 ? (
                <Text style={styles.searchHelperText}>No matching members.</Text>
              ) : null}
            </ScrollView>
          ) : (
            <Text style={styles.searchHelperText}>Type at least 2 characters.</Text>
          )}

          <Text style={styles.inputLabel}>Assigned to</Text>
          <TextInput
            value={createAssignedSearch}
            onChangeText={setCreateAssignedSearch}
            placeholder="Search group leaders (server search)"
            style={styles.textInput}
          />
          {createAssignedToId && createAssignedToName ? (
            <Pressable
              onPress={() => {
                setCreateAssignedToId(null);
                setCreateAssignedToName(null);
              }}
              style={styles.selectionPill}
            >
              <Text style={styles.selectionPillText}>
                {createAssignedToName} • Tap to clear
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.searchHelperText}>
              Leave empty to keep responsibility at group level.
            </Text>
          )}
          {createAssignedSearch.trim().length >= 2 ? (
            <ScrollView
              style={styles.searchResultsList}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              {(createAssignableLeaderResults ?? []).map((leader) => (
                <Pressable
                  key={leader.userId}
                  onPress={() => {
                    setCreateAssignedToId(leader.userId);
                    setCreateAssignedToName(leader.name);
                    setCreateAssignedSearch("");
                  }}
                  style={styles.searchResultRow}
                >
                  <Text style={styles.searchResultText}>{leader.name}</Text>
                </Pressable>
              ))}
              {createAssignableLeaderResults !== undefined &&
              createAssignableLeaderResults.length === 0 ? (
                <Text style={styles.searchHelperText}>No matching leaders.</Text>
              ) : null}
            </ScrollView>
          ) : null}

          {createGroupId ? (
            <>
              <Text style={styles.inputLabel}>
                Parent Task ({selectedCreateGroup?.name ?? "Current group"})
              </Text>
              <TextInput
                value={createParentTaskSearch}
                onChangeText={setCreateParentTaskSearch}
                placeholder="Search tasks (server search)"
                style={styles.textInput}
              />
              <ScrollView
                style={styles.searchResultsList}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
                <Pressable
                  onPress={() => setCreateParentTaskId(null)}
                  style={[
                    styles.searchResultRow,
                    createParentTaskId === null && styles.searchResultRowActive,
                  ]}
                >
                  <Text style={styles.searchResultText}>None</Text>
                </Pressable>
                {createParentTaskOptions.map((task) => (
                  <Pressable
                    key={task._id}
                    onPress={() => setCreateParentTaskId(task._id.toString())}
                    style={[
                      styles.searchResultRow,
                      createParentTaskId === task._id.toString() &&
                        styles.searchResultRowActive,
                    ]}
                  >
                    <Text style={styles.searchResultText}>{task.title}</Text>
                  </Pressable>
                ))}
                {createParentTaskOptions.length === 0 ? (
                  <Text style={styles.searchHelperText}>No matching parent tasks.</Text>
                ) : null}
              </ScrollView>
            </>
          ) : null}

          {createError ? <Text style={styles.errorText}>{createError}</Text> : null}

          <View style={styles.modalActions}>
            <Pressable
              onPress={() => setIsCreateOpen(false)}
              style={[styles.modalActionButton, styles.cancelButton]}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={createBusy}
              onPress={handleCreateTask}
              style={[styles.modalActionButton, styles.saveButton]}
            >
              <Text style={styles.saveButtonText}>
                {createBusy ? "Creating..." : "Create"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </Modal>
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
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  backButton: {
    borderRadius: 999,
    padding: 4,
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
  createButton: {
    borderRadius: 8,
    backgroundColor: "#2563EB",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  createButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 12,
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
  filtersContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#0F172A",
    backgroundColor: "#fff",
  },
  chipsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingBottom: 4,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#fff",
  },
  filterChipActive: {
    borderColor: "#2563EB",
    backgroundColor: "#EFF6FF",
  },
  filterChipText: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "600",
  },
  filterChipTextActive: {
    color: "#1D4ED8",
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
  childCard: {
    borderStyle: "dashed",
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
  titleContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 2,
    flex: 1,
  },
  chevronButton: {
    marginTop: 2,
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
  targetPill: {
    marginTop: 8,
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "#E0F2FE",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  targetPillText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#075985",
  },
  tagsRow: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  tagChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "#EEF2FF",
  },
  tagChipText: {
    fontSize: 11,
    color: "#4338CA",
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
  assignPanel: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    paddingTop: 10,
    gap: 8,
  },
  assignPanelTitle: {
    fontSize: 12,
    color: "#475569",
    fontWeight: "700",
  },
  assignButtonsRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  assignButton: {
    borderWidth: 1,
    borderColor: "#BFDBFE",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#EFF6FF",
  },
  assignButtonText: {
    color: "#1D4ED8",
    fontSize: 12,
    fontWeight: "600",
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
  errorText: {
    marginHorizontal: 16,
    marginBottom: 8,
    color: "#DC2626",
    fontSize: 12,
    fontWeight: "600",
  },
  successText: {
    marginHorizontal: 16,
    marginBottom: 8,
    color: "#16A34A",
    fontSize: 12,
    fontWeight: "600",
  },
  desktopContainer: {
    flex: 1,
    flexDirection: "row",
  },
  desktopList: {
    width: 460,
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
  modalContainer: {
    flex: 1,
    backgroundColor: "#fff",
    paddingHorizontal: 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0F172A",
  },
  inputLabel: {
    marginTop: 12,
    marginBottom: 6,
    color: "#334155",
    fontSize: 13,
    fontWeight: "700",
  },
  helperText: {
    marginTop: 10,
    color: "#64748B",
    fontSize: 12,
    lineHeight: 18,
  },
  lockedField: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#F8FAFC",
  },
  lockedFieldText: {
    fontSize: 14,
    color: "#0F172A",
    fontWeight: "600",
  },
  textInput: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#0F172A",
    backgroundColor: "#fff",
  },
  multilineInput: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  groupChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#fff",
  },
  groupChipActive: {
    backgroundColor: "#EEF2FF",
    borderColor: "#4F46E5",
  },
  groupChipText: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "600",
  },
  groupChipTextActive: {
    color: "#3730A3",
  },
  selectionPill: {
    marginTop: 8,
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  selectionPillText: {
    color: "#1D4ED8",
    fontSize: 12,
    fontWeight: "600",
  },
  searchResultsList: {
    maxHeight: 180,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 10,
    backgroundColor: "#fff",
  },
  searchResultRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  searchResultRowActive: {
    backgroundColor: "#EFF6FF",
  },
  searchResultText: {
    color: "#0F172A",
    fontSize: 13,
    fontWeight: "500",
  },
  searchHelperText: {
    marginTop: 8,
    color: "#64748B",
    fontSize: 12,
  },
  modalActions: {
    marginTop: 20,
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  modalActionButton: {
    flex: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#fff",
  },
  cancelButtonText: {
    color: "#334155",
    fontWeight: "700",
  },
  saveButton: {
    backgroundColor: "#2563EB",
  },
  saveButtonText: {
    color: "#fff",
    fontWeight: "700",
  },
});
