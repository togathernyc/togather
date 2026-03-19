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
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
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
import { useTheme } from "@hooks/useTheme";
import type { ThemeColors } from "@/theme/colors";

type Segment = "my" | "all" | "claimable";
type TaskId = Id<"tasks">;
type SourceFilter = "all" | TaskSourceType;
type AssigneeFilter = "all" | "unassigned" | string;
type GroupFilter = "all" | string;
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
  followup: "PEOPLE",
};

function getSourceColors(colors: ThemeColors): Record<TaskSourceType, string> {
  return {
    manual: colors.textSecondary,
    bot_task_reminder: colors.link,
    reach_out: colors.link,
    followup: colors.link,
  };
}

function formatStatus(status: string): string {
  if (status === "snoozed") return "Snoozed";
  if (status === "done") return "Done";
  if (status === "canceled") return "Canceled";
  return "Open";
}

function statusColor(status: string, colors: ThemeColors): string {
  if (status === "done") return colors.success;
  if (status === "snoozed") return colors.warning;
  if (status === "canceled") return colors.destructive;
  return colors.link;
}

export function TasksTabScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const params = useLocalSearchParams<{ group_id?: string; returnTo?: string }>();
  const { primaryColor } = useCommunityTheme();
  const isDesktopWeb = useIsDesktopWeb();
  const { community } = useAuth();
  const contextGroupId =
    typeof params.group_id === "string" ? params.group_id : null;
  const returnToParam =
    typeof params.returnTo === "string" && params.returnTo.trim().length > 0
      ? decodeURIComponent(params.returnTo)
      : null;
  const returnTo = returnToParam && returnToParam !== pathname ? returnToParam : null;

  const [segment, setSegment] = useState<Segment>("my");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("all");
  const [selectedGroupId, setSelectedGroupId] = useState<GroupFilter>(
    contextGroupId ?? "all",
  );
  const [searchText, setSearchText] = useState("");
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
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
    setSelectedGroupId(contextGroupId ?? "all");
    setAssigneeFilter("all");
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

  const groupScopedAllTasks = useMemo(() => {
    if (!allTasks) return allTasks;
    if (selectedGroupId === "all") return allTasks;
    return allTasks.filter((task) => task.groupId.toString() === selectedGroupId);
  }, [allTasks, selectedGroupId]);

  const groupScopedMyTasks = useMemo(() => {
    if (!myTasks) return myTasks;
    if (selectedGroupId === "all") return myTasks;
    return myTasks.filter((task) => task.groupId.toString() === selectedGroupId);
  }, [myTasks, selectedGroupId]);

  const groupScopedClaimableTasks = useMemo(() => {
    if (!claimableTasks) return claimableTasks;
    if (selectedGroupId === "all") return claimableTasks;
    return claimableTasks.filter((task) => task.groupId.toString() === selectedGroupId);
  }, [claimableTasks, selectedGroupId]);

  const assigneeOptions = useMemo(() => {
    const tasks = groupScopedAllTasks ?? [];
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
  }, [groupScopedAllTasks]);

  useEffect(() => {
    if (assigneeFilter === "all") return;
    const isValid = assigneeOptions.some((option) => option.value === assigneeFilter);
    if (!isValid) {
      setAssigneeFilter("all");
    }
  }, [assigneeFilter, assigneeOptions]);

  const filteredAllTasks = useMemo(() => {
    if (!groupScopedAllTasks) return groupScopedAllTasks;
    if (assigneeFilter === "all") return groupScopedAllTasks;
    if (assigneeFilter === "unassigned") {
      return groupScopedAllTasks.filter((task) => !task.assignedToId);
    }
    return groupScopedAllTasks.filter(
      (task) => task.assignedToId?.toString() === assigneeFilter,
    );
  }, [groupScopedAllTasks, assigneeFilter]);

  const activeTasks = useMemo(() => {
    if (segment === "my") return groupScopedMyTasks;
    if (segment === "claimable") return groupScopedClaimableTasks;
    return filteredAllTasks;
  }, [filteredAllTasks, groupScopedClaimableTasks, groupScopedMyTasks, segment]);

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

  useEffect(() => {
    if (tagFilter === "all") return;
    const isValid = availableTags.includes(tagFilter);
    if (!isValid) {
      setTagFilter("all");
    }
  }, [tagFilter, availableTags]);

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
          { backgroundColor: colors.surface, borderColor: colors.borderLight },
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
                  color={colors.textSecondary}
                />
              </Pressable>
            ) : null}
            <Text style={[styles.cardTitle, { color: colors.text }]}>{task.title}</Text>
          </View>
          <View
            style={[
              styles.badge,
              { backgroundColor: getSourceColors(colors)[sourceType] ?? colors.textSecondary },
            ]}
          >
            <Text style={[styles.badgeText, { color: colors.textInverse }]}>{sourceLabels[sourceType] ?? "TASK"}</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <Ionicons name="people-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.metaText, { color: colors.textSecondary }]}>{task.groupName ?? "Group"}</Text>
          {task.assignedToName ? (
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>• {task.assignedToName}</Text>
          ) : null}
          <Text style={[styles.statusText, { color: statusColor(task.status, colors) }]}>
            {formatStatus(task.status)}
          </Text>
        </View>

        {task.targetType !== "none" ? (
          <View style={[styles.targetPill, { backgroundColor: isDark ? 'rgba(0,122,255,0.15)' : '#E0F2FE' }]}>
            <Text style={[styles.targetPillText, { color: colors.link }]}>
              {task.targetType === "member"
                ? `Member: ${task.targetMemberName ?? "Unknown"}`
                : `Group: ${task.targetGroupName ?? "Group"}`}
            </Text>
          </View>
        ) : null}

        {task.tags && task.tags.length > 0 ? (
          <View style={styles.tagsRow}>
            {task.tags.map((tag) => (
              <View key={`${taskIdKey}-${tag}`} style={[styles.tagChip, { backgroundColor: isDark ? 'rgba(0,122,255,0.15)' : '#EEF2FF' }]}>
                <Text style={[styles.tagChipText, { color: colors.link }]}>#{tag}</Text>
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
              style={[styles.primaryAction, { backgroundColor: colors.link }, isBusy && styles.disabledAction]}
            >
              <Text style={[styles.primaryActionText, { color: colors.textInverse }]}>{isBusy ? "..." : "Claim"}</Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                disabled={isBusy}
                onPress={(event) => {
                  event.stopPropagation();
                  runTaskAction(taskId, "done");
                }}
                style={[styles.inlineAction, { borderColor: colors.border, backgroundColor: colors.surface }, isBusy && styles.disabledAction]}
              >
                <Text style={[styles.inlineActionText, { color: colors.text }]}>Done</Text>
              </Pressable>
              <Pressable
                disabled={isBusy}
                onPress={(event) => {
                  event.stopPropagation();
                  runTaskAction(taskId, "snooze");
                }}
                style={[styles.inlineAction, { borderColor: colors.border, backgroundColor: colors.surface }, isBusy && styles.disabledAction]}
              >
                <Text style={[styles.inlineActionText, { color: colors.text }]}>Snooze 1w</Text>
              </Pressable>
              <Pressable
                disabled={isBusy}
                onPress={(event) => {
                  event.stopPropagation();
                  runTaskAction(taskId, "cancel");
                }}
                style={[styles.inlineAction, { borderColor: colors.border, backgroundColor: colors.surface }, isBusy && styles.disabledAction]}
              >
                <Text style={[styles.inlineActionText, { color: colors.destructive }]}>
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
                style={[styles.inlineAction, { borderColor: colors.border, backgroundColor: colors.surface }, isBusy && styles.disabledAction]}
              >
                <Text style={[styles.inlineActionText, { color: colors.text }]}>
                  {task.assignedToId ? "Reassign" : "Assign"}
                </Text>
              </Pressable>
            </>
          )}
        </View>

        {showAssignPanel ? (
          <View style={[styles.assignPanel, { borderTopColor: colors.borderLight }]}>
            <Text style={[styles.assignPanelTitle, { color: colors.textSecondary }]}>Assigned to</Text>
            <View style={styles.assignButtonsRow}>
              {(assignableLeaders ?? []).map((leader) => (
                <Pressable
                  key={`${taskIdKey}-${leader.userId}`}
                  disabled={isBusy}
                  onPress={(event) => {
                    event.stopPropagation();
                    runTaskAction(taskId, "assign", leader.userId as Id<"users">);
                  }}
                  style={[styles.assignButton, { borderColor: isDark ? 'rgba(0,122,255,0.3)' : '#BFDBFE', backgroundColor: colors.selectedBackground }, isBusy && styles.disabledAction]}
                >
                  <Text style={[styles.assignButtonText, { color: colors.link }]}>{leader.name}</Text>
                </Pressable>
              ))}
              <Pressable
                disabled={isBusy}
                onPress={(event) => {
                  event.stopPropagation();
                  runTaskAction(taskId, "assign");
                }}
                style={[styles.assignButton, { borderColor: isDark ? 'rgba(0,122,255,0.3)' : '#BFDBFE', backgroundColor: colors.selectedBackground }, isBusy && styles.disabledAction]}
              >
                <Text style={[styles.assignButtonText, { color: colors.link }]}>Unassign</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </Pressable>
    );
  };

  const isLoading = activeTasks === undefined;
  const groupFilterOptions = useMemo(
    () => [
      { value: "all", label: "All Groups" },
      ...leaderGroups.map((group) => ({ value: group._id, label: group.name })),
    ],
    [leaderGroups],
  );
  const defaultGroupFilter = contextGroupId ?? "all";
  const hasActiveFilters =
    selectedGroupId !== defaultGroupFilter ||
    sourceFilter !== "all" ||
    tagFilter !== "all" ||
    assigneeFilter !== "all";

  const content = (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <View style={styles.headerRow}>
          <View style={styles.headerTitleWrap}>
            <Pressable
              testID="tasks-back-button"
              style={styles.backButton}
              onPress={() => {
                if (returnTo) {
                  router.push(returnTo as any);
                  return;
                }
                if (router.canGoBack()) {
                  router.back();
                  return;
                }
                router.replace("/(tabs)/profile");
              }}
            >
              <Ionicons name="arrow-back" size={22} color={colors.text} />
            </Pressable>
            <View>
              <Text style={[styles.headerTitle, { color: colors.text }]}>Tasks</Text>
              <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>All task-related workflows</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <Pressable style={[styles.createButton, { backgroundColor: colors.link }]} onPress={() => setIsCreateOpen(true)}>
              <Ionicons name="add" size={16} color={colors.textInverse} />
              <Text style={[styles.createButtonText, { color: colors.textInverse }]}>Create</Text>
            </Pressable>
            <Pressable
              testID="tasks-filter-button"
              style={[styles.headerFilterButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={() => setIsFilterModalOpen(true)}
            >
              <Ionicons name="options-outline" size={18} color={colors.textSecondary} />
              {hasActiveFilters ? <View style={[styles.headerFilterDot, { backgroundColor: colors.link }]} /> : null}
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.segmentRow}>
        <Pressable
          onPress={() => setSegment("my")}
          style={[
            styles.segmentButton,
            { backgroundColor: colors.surfaceSecondary },
            segment === "my" && { backgroundColor: primaryColor },
          ]}
        >
          <Text
            style={[styles.segmentText, { color: colors.text }, segment === "my" && { color: colors.textInverse }]}
          >
            My Tasks
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setSegment("all")}
          style={[
            styles.segmentButton,
            { backgroundColor: colors.surfaceSecondary },
            segment === "all" && { backgroundColor: primaryColor },
          ]}
        >
          <Text
            style={[styles.segmentText, { color: colors.text }, segment === "all" && { color: colors.textInverse }]}
          >
            All Tasks
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setSegment("claimable")}
          style={[
            styles.segmentButton,
            { backgroundColor: colors.surfaceSecondary },
            segment === "claimable" && { backgroundColor: primaryColor },
          ]}
        >
          <Text
            style={[
              styles.segmentText,
              { color: colors.text },
              segment === "claimable" && { color: colors.textInverse },
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
          placeholderTextColor={colors.inputPlaceholder}
          style={[styles.searchInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
        />
      </View>

      {actionError ? <Text style={[styles.errorText, { color: colors.destructive }]}>{actionError}</Text> : null}
      {actionSuccess ? <Text style={[styles.successText, { color: colors.success }]}>{actionSuccess}</Text> : null}

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading tasks...</Text>
        </View>
      ) : !activeTasks || activeTasks.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="checkmark-done-outline" size={48} color={colors.iconSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No tasks here yet</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            {segment === "my"
              ? "Assigned tasks will appear here."
              : segment === "all"
                ? "Open and snoozed tasks from your groups will appear here."
                : "Unassigned group tasks will appear here."}
          </Text>
        </View>
      ) : isDesktopWeb ? (
        <View style={styles.desktopContainer}>
          <View style={[styles.desktopList, { borderRightColor: colors.borderLight }]}>
            <FlatList
              data={taskRows}
              renderItem={renderTaskCard}
              keyExtractor={(row) => row.task._id.toString()}
              contentContainerStyle={styles.listContent}
            />
          </View>
          <View style={[styles.desktopDetail, { backgroundColor: colors.surfaceSecondary }]}>
            <ScrollView contentContainerStyle={styles.detailContent}>
              <Text style={[styles.detailTitle, { color: colors.text }]}>Task details</Text>
              <Text style={[styles.detailBody, { color: colors.text }]}>
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

      <Modal
        visible={isFilterModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setIsFilterModalOpen(false)}
      >
        <View style={[styles.filterModalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.filterModalCard, { backgroundColor: colors.modalBackground }]}>
            <View style={styles.filterModalHeader}>
              <Text style={[styles.filterModalTitle, { color: colors.text }]}>Filter Tasks</Text>
              <Pressable onPress={() => setIsFilterModalOpen(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={[styles.filterSectionTitle, { color: colors.textSecondary }]}>Group</Text>
              <View style={styles.chipsWrap}>
                {groupFilterOptions.map((option) => (
                  <Pressable
                    key={option.value}
                    testID={`tasks-filter-group-${option.value}`}
                    onPress={() => setSelectedGroupId(option.value)}
                    style={[
                      styles.filterChip,
                      { borderColor: colors.border, backgroundColor: colors.surface },
                      selectedGroupId === option.value && { borderColor: colors.link, backgroundColor: colors.selectedBackground },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        { color: colors.text },
                        selectedGroupId === option.value && { color: colors.link },
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[styles.filterSectionTitle, { color: colors.textSecondary }]}>Source</Text>
              <View style={styles.chipsWrap}>
                {(
                  ["all", "manual", "reach_out", "bot_task_reminder", "followup"] as SourceFilter[]
                ).map((source) => (
                  <Pressable
                    key={source}
                    onPress={() => setSourceFilter(source)}
                    style={[
                      styles.filterChip,
                      { borderColor: colors.border, backgroundColor: colors.surface },
                      sourceFilter === source && { borderColor: colors.link, backgroundColor: colors.selectedBackground },
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        { color: colors.text },
                        sourceFilter === source && { color: colors.link },
                      ]}
                    >
                      {source === "all" ? "All Sources" : sourceLabels[source]}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[styles.filterSectionTitle, { color: colors.textSecondary }]}>Tags</Text>
              <View style={styles.chipsWrap}>
                <Pressable
                  onPress={() => setTagFilter("all")}
                  style={[styles.filterChip, { borderColor: colors.border, backgroundColor: colors.surface }, tagFilter === "all" && { borderColor: colors.link, backgroundColor: colors.selectedBackground }]}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      { color: colors.text },
                      tagFilter === "all" && { color: colors.link },
                    ]}
                  >
                    All Tags
                  </Text>
                </Pressable>
                {availableTags.map((tag) => (
                  <Pressable
                    key={tag}
                    onPress={() => setTagFilter(tag)}
                    style={[styles.filterChip, { borderColor: colors.border, backgroundColor: colors.surface }, tagFilter === tag && { borderColor: colors.link, backgroundColor: colors.selectedBackground }]}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        { color: colors.text },
                        tagFilter === tag && { color: colors.link },
                      ]}
                    >
                      #{tag}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {segment === "all" ? (
                <>
                  <Text style={[styles.filterSectionTitle, { color: colors.textSecondary }]}>Assignee</Text>
                  <View style={styles.chipsWrap}>
                    {assigneeOptions.map((option) => (
                      <Pressable
                        key={option.value}
                        testID={`tasks-filter-assignee-${option.value}`}
                        onPress={() => setAssigneeFilter(option.value)}
                        style={[
                          styles.filterChip,
                          { borderColor: colors.border, backgroundColor: colors.surface },
                          assigneeFilter === option.value && { borderColor: colors.link, backgroundColor: colors.selectedBackground },
                        ]}
                      >
                        <Text
                          style={[
                            styles.filterChipText,
                            { color: colors.text },
                            assigneeFilter === option.value && { color: colors.link },
                          ]}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}

              <View style={styles.filterActionsRow}>
                <Pressable
                  testID="tasks-filter-reset"
                  style={[styles.inlineAction, { borderColor: colors.border, backgroundColor: colors.surface }, styles.filterActionButton]}
                  onPress={() => {
                    setSelectedGroupId(defaultGroupFilter);
                    setSourceFilter("all");
                    setTagFilter("all");
                    setAssigneeFilter("all");
                  }}
                >
                  <Text style={[styles.inlineActionText, { color: colors.text }]}>Reset</Text>
                </Pressable>
                <Pressable
                  testID="tasks-filter-apply"
                  style={[styles.primaryAction, { backgroundColor: colors.link }, styles.filterActionButton]}
                  onPress={() => setIsFilterModalOpen(false)}
                >
                  <Text style={[styles.primaryActionText, { color: colors.textInverse }]}>Done</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isCreateOpen}
        animationType="slide"
        onRequestClose={() => setIsCreateOpen(false)}
      >
        <ScrollView
          style={[styles.modalContainer, { backgroundColor: colors.modalBackground }]}
          contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }}
        >
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Create Task</Text>
            <Pressable onPress={() => setIsCreateOpen(false)}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          <Text style={[styles.inputLabel, { color: colors.text }]}>Group</Text>
          {contextGroupId ? (
            <View style={[styles.lockedField, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[styles.lockedFieldText, { color: colors.text }]}>
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
                    { borderColor: colors.border, backgroundColor: colors.surface },
                    createGroupId === group._id && { backgroundColor: colors.selectedBackground, borderColor: colors.link },
                  ]}
                >
                  <Text
                    style={[
                      styles.groupChipText,
                      { color: colors.text },
                      createGroupId === group._id && { color: colors.link },
                    ]}
                  >
                    {group.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          <Text style={[styles.inputLabel, { color: colors.text }]}>Title *</Text>
          <TextInput
            value={createTitle}
            onChangeText={setCreateTitle}
            placeholder="Task title"
            placeholderTextColor={colors.inputPlaceholder}
            style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
          />

          <Text style={[styles.inputLabel, { color: colors.text }]}>Description</Text>
          <TextInput
            value={createDescription}
            onChangeText={setCreateDescription}
            placeholder="Optional details"
            multiline
            placeholderTextColor={colors.inputPlaceholder}
            style={[styles.textInput, styles.multilineInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
          />

          <Text style={[styles.inputLabel, { color: colors.text }]}>Tags (comma separated)</Text>
          <TextInput
            value={createTagsInput}
            onChangeText={setCreateTagsInput}
            placeholder="care, prayer_request"
            placeholderTextColor={colors.inputPlaceholder}
            style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
          />

          <Text style={[styles.helperText, { color: colors.textSecondary }]}>
            Target defaults to this group. Add a relevant member only if needed.
          </Text>

          <Text style={[styles.inputLabel, { color: colors.text }]}>Relevant member</Text>
          <TextInput
            value={createRelevantMemberSearch}
            onChangeText={setCreateRelevantMemberSearch}
            placeholder="Search members (server search)"
            placeholderTextColor={colors.inputPlaceholder}
            style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
          />
          {createRelevantMemberId && createRelevantMemberName ? (
            <Pressable
              onPress={() => {
                setCreateRelevantMemberId(null);
                setCreateRelevantMemberName(null);
              }}
              style={[styles.selectionPill, { borderColor: isDark ? 'rgba(0,122,255,0.3)' : '#BFDBFE', backgroundColor: colors.selectedBackground }]}
            >
              <Text style={[styles.selectionPillText, { color: colors.link }]}>
                {createRelevantMemberName} • Tap to clear
              </Text>
            </Pressable>
          ) : null}
          {createRelevantMemberSearch.trim().length >= 2 ? (
            <ScrollView
              style={[styles.searchResultsList, { borderColor: colors.borderLight, backgroundColor: colors.surface }]}
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
                    style={[styles.searchResultRow, { borderBottomColor: colors.borderLight }]}
                  >
                    <Text style={[styles.searchResultText, { color: colors.text }]}>{member.name}</Text>
                  </Pressable>
                );
              })}
              {createRelevantMemberResults !== undefined &&
              createRelevantMemberResults.length === 0 ? (
                <Text style={[styles.searchHelperText, { color: colors.textSecondary }]}>No matching members.</Text>
              ) : null}
            </ScrollView>
          ) : (
            <Text style={[styles.searchHelperText, { color: colors.textSecondary }]}>Type at least 2 characters.</Text>
          )}

          <Text style={[styles.inputLabel, { color: colors.text }]}>Assigned to</Text>
          <TextInput
            value={createAssignedSearch}
            onChangeText={setCreateAssignedSearch}
            placeholder="Search group leaders (server search)"
            placeholderTextColor={colors.inputPlaceholder}
            style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
          />
          {createAssignedToId && createAssignedToName ? (
            <Pressable
              onPress={() => {
                setCreateAssignedToId(null);
                setCreateAssignedToName(null);
              }}
              style={[styles.selectionPill, { borderColor: isDark ? 'rgba(0,122,255,0.3)' : '#BFDBFE', backgroundColor: colors.selectedBackground }]}
            >
              <Text style={[styles.selectionPillText, { color: colors.link }]}>
                {createAssignedToName} • Tap to clear
              </Text>
            </Pressable>
          ) : (
            <Text style={[styles.searchHelperText, { color: colors.textSecondary }]}>
              Leave empty to keep responsibility at group level.
            </Text>
          )}
          {createAssignedSearch.trim().length >= 2 ? (
            <ScrollView
              style={[styles.searchResultsList, { borderColor: colors.borderLight, backgroundColor: colors.surface }]}
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
                  style={[styles.searchResultRow, { borderBottomColor: colors.borderLight }]}
                >
                  <Text style={[styles.searchResultText, { color: colors.text }]}>{leader.name}</Text>
                </Pressable>
              ))}
              {createAssignableLeaderResults !== undefined &&
              createAssignableLeaderResults.length === 0 ? (
                <Text style={[styles.searchHelperText, { color: colors.textSecondary }]}>No matching leaders.</Text>
              ) : null}
            </ScrollView>
          ) : null}

          {createGroupId ? (
            <>
              <Text style={[styles.inputLabel, { color: colors.text }]}>
                Parent Task ({selectedCreateGroup?.name ?? "Current group"})
              </Text>
              <TextInput
                value={createParentTaskSearch}
                onChangeText={setCreateParentTaskSearch}
                placeholder="Search tasks (server search)"
                placeholderTextColor={colors.inputPlaceholder}
                style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
              />
              <ScrollView
                style={[styles.searchResultsList, { borderColor: colors.borderLight, backgroundColor: colors.surface }]}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
                <Pressable
                  onPress={() => setCreateParentTaskId(null)}
                  style={[
                    styles.searchResultRow,
                    { borderBottomColor: colors.borderLight },
                    createParentTaskId === null && { backgroundColor: colors.selectedBackground },
                  ]}
                >
                  <Text style={[styles.searchResultText, { color: colors.text }]}>None</Text>
                </Pressable>
                {createParentTaskOptions.map((task) => (
                  <Pressable
                    key={task._id}
                    onPress={() => setCreateParentTaskId(task._id.toString())}
                    style={[
                      styles.searchResultRow,
                      { borderBottomColor: colors.borderLight },
                      createParentTaskId === task._id.toString() &&
                        { backgroundColor: colors.selectedBackground },
                    ]}
                  >
                    <Text style={[styles.searchResultText, { color: colors.text }]}>{task.title}</Text>
                  </Pressable>
                ))}
                {createParentTaskOptions.length === 0 ? (
                  <Text style={[styles.searchHelperText, { color: colors.textSecondary }]}>No matching parent tasks.</Text>
                ) : null}
              </ScrollView>
            </>
          ) : null}

          {createError ? <Text style={[styles.errorText, { color: colors.destructive }]}>{createError}</Text> : null}

          <View style={styles.modalActions}>
            <Pressable
              onPress={() => setIsCreateOpen(false)}
              style={[styles.modalActionButton, styles.cancelButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
            >
              <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={createBusy}
              onPress={handleCreateTask}
              style={[styles.modalActionButton, styles.saveButton, { backgroundColor: colors.link }]}
            >
              <Text style={[styles.saveButtonText, { color: colors.textInverse }]}>
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
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
  },
  headerSubtitle: {
    marginTop: 4,
    fontSize: 14,
  },
  createButton: {
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  createButtonText: {
    fontWeight: "700",
    fontSize: 12,
  },
  headerFilterButton: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  headerFilterDot: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 7,
    height: 7,
    borderRadius: 4,
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
  },
  segmentText: {
    fontSize: 13,
    fontWeight: "600",
  },
  filtersContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
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
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  listContent: {
    padding: 12,
    paddingBottom: 28,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  childCard: {
    borderStyle: "dashed",
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
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
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
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  targetPillText: {
    fontSize: 11,
    fontWeight: "600",
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
  },
  tagChipText: {
    fontSize: 11,
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
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  primaryActionText: {
    fontSize: 12,
    fontWeight: "700",
  },
  inlineAction: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  inlineActionText: {
    fontSize: 12,
    fontWeight: "600",
  },
  assignPanel: {
    marginTop: 10,
    borderTopWidth: 1,
    paddingTop: 10,
    gap: 8,
  },
  assignPanelTitle: {
    fontSize: 12,
    fontWeight: "700",
  },
  assignButtonsRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  assignButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  assignButtonText: {
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
  },
  emptyTitle: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: "700",
  },
  emptySubtitle: {
    marginTop: 6,
    textAlign: "center",
  },
  errorText: {
    marginHorizontal: 16,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: "600",
  },
  successText: {
    marginHorizontal: 16,
    marginBottom: 8,
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
  },
  desktopDetail: {
    flex: 1,
  },
  detailContent: {
    padding: 20,
    gap: 10,
  },
  detailTitle: {
    fontSize: 24,
    fontWeight: "700",
  },
  detailBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  detailMeta: {
    marginTop: 6,
    gap: 6,
  },
  detailMetaText: {
    fontSize: 13,
  },
  filterModalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  filterModalCard: {
    maxHeight: "80%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 18,
  },
  filterModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  filterModalTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  filterSectionTitle: {
    marginTop: 14,
    marginBottom: 6,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  filterActionsRow: {
    marginTop: 18,
    marginBottom: 4,
    flexDirection: "row",
    gap: 10,
  },
  filterActionButton: {
    flex: 1,
    alignItems: "center",
  },
  modalContainer: {
    flex: 1,
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
  },
  inputLabel: {
    marginTop: 12,
    marginBottom: 6,
    fontSize: 13,
    fontWeight: "700",
  },
  helperText: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 18,
  },
  lockedField: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  lockedFieldText: {
    fontSize: 14,
    fontWeight: "600",
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
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
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  groupChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  selectionPill: {
    marginTop: 8,
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  selectionPillText: {
    fontSize: 12,
    fontWeight: "600",
  },
  searchResultsList: {
    maxHeight: 180,
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 10,
  },
  searchResultRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  searchResultText: {
    fontSize: 13,
    fontWeight: "500",
  },
  searchHelperText: {
    marginTop: 8,
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
  },
  cancelButtonText: {
    fontWeight: "700",
  },
  saveButton: {},
  saveButtonText: {
    fontWeight: "700",
  },
});
