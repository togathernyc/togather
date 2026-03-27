import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
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
  type SubtaskItem,
  type TaskListItem,
  type TaskRow,
  type TaskSourceType,
} from "./taskHelpers";
import { useTheme } from "@hooks/useTheme";
import { TaskDetailScreen } from "./TaskDetailScreen";
import type { ThemeColors } from "@/theme/colors";

type Segment = "my" | "all" | "claimable";
type TaskListScope = "active" | "completed";
type MainTab = "tasks" | "workflows";
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
  workflow_template: "WORKFLOW",
};

function getSourceBadgeStyle(
  sourceType: TaskSourceType,
  colors: ThemeColors,
  isDark: boolean,
): { bg: string; fg: string } {
  if (sourceType === "workflow_template") {
    return {
      bg: isDark ? "rgba(0,122,255,0.15)" : "#EEF2FF",
      fg: colors.link,
    };
  }
  return {
    bg: colors.surfaceSecondary,
    fg: colors.textSecondary,
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

  const [mainTab, setMainTab] = useState<MainTab>("tasks");
  const [segment, setSegment] = useState<Segment>("my");
  const [taskListScope, setTaskListScope] = useState<TaskListScope>("active");
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
  const [overflowMenuTaskId, setOverflowMenuTaskId] = useState<string | null>(null);
  const [overflowMenuPos, setOverflowMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [overflowMenuMeta, setOverflowMenuMeta] = useState<{ taskId: Id<"tasks">; hasAssignee: boolean } | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [detailGroupId, setDetailGroupId] = useState<string | null>(null);

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

  const [tplModalOpen, setTplModalOpen] = useState(false);
  const [tplEditingId, setTplEditingId] = useState<string | null>(null);
  const [tplTitle, setTplTitle] = useState("");
  const [tplDescription, setTplDescription] = useState("");
  const [tplGroupId, setTplGroupId] = useState<string | null>(null);
  const [tplTags, setTplTags] = useState("");
  const [tplSteps, setTplSteps] = useState<{ title: string; description: string }[]>([
    { title: "", description: "" },
  ]);
  const [tplBusy, setTplBusy] = useState(false);
  const [tplError, setTplError] = useState<string | null>(null);

  const [applyTarget, setApplyTarget] = useState<{
    templateId: string;
    groupId: string;
  } | null>(null);
  const [applyMemberSearch, setApplyMemberSearch] = useState("");
  const [debouncedApplyMemberSearch, setDebouncedApplyMemberSearch] = useState("");
  const [applyMemberId, setApplyMemberId] = useState<string | null>(null);
  const [applyMemberName, setApplyMemberName] = useState<string | null>(null);
  const [applyAssignSearch, setApplyAssignSearch] = useState("");
  const [debouncedApplyAssignSearch, setDebouncedApplyAssignSearch] = useState("");
  const [applyAssigneeId, setApplyAssigneeId] = useState<string | null>(null);
  const [applyAssigneeName, setApplyAssigneeName] = useState<string | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const taskFilterArgsBase = useMemo(
    () => ({
      sourceType: sourceFilter === "all" ? undefined : sourceFilter,
      tag: tagFilter === "all" ? undefined : tagFilter,
      searchText: searchText.trim() || undefined,
    }),
    [sourceFilter, tagFilter, searchText],
  );

  const taskFilterArgsWithScope = useMemo(
    () => ({
      ...taskFilterArgsBase,
      listScope:
        taskListScope === "completed" ? ("completed" as const) : ("active" as const),
    }),
    [taskFilterArgsBase, taskListScope],
  );

  const myTasks = useAuthenticatedQuery(
    api.functions.tasks.index.listMine,
    mainTab === "tasks" && segment === "my" ? taskFilterArgsWithScope : "skip",
  );
  const allTasks = useAuthenticatedQuery(
    api.functions.tasks.index.listAll,
    mainTab === "tasks" && segment === "all" ? taskFilterArgsWithScope : "skip",
  );
  const claimableTasks = useAuthenticatedQuery(
    api.functions.tasks.index.listClaimable,
    mainTab === "tasks" && segment === "claimable" && taskListScope === "active"
      ? taskFilterArgsBase
      : "skip",
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

  const hasLeaderAccess = useAuthenticatedQuery(
    api.functions.tasks.index.hasLeaderAccess,
    community?.id
      ? { communityId: community.id as Id<"communities"> }
      : "skip",
  );

  const groupWorkflowTemplates = useAuthenticatedQuery(
    api.functions.taskTemplates.index.list,
    mainTab === "workflows" && hasLeaderAccess === true && contextGroupId
      ? { groupId: contextGroupId as Id<"groups"> }
      : "skip",
  );

  const allWorkflowTemplates = useAuthenticatedQuery(
    api.functions.taskTemplates.index.listAll,
    mainTab === "workflows" && hasLeaderAccess === true && !contextGroupId
      ? {}
      : "skip",
  );

  const workflowTemplates = contextGroupId ? groupWorkflowTemplates : allWorkflowTemplates;

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

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedApplyMemberSearch(applyMemberSearch.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [applyMemberSearch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedApplyAssignSearch(applyAssignSearch.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [applyAssignSearch]);

  const selectedCreateGroup = createGroupId
    ? leaderGroups.find((group) => group._id === createGroupId)
    : undefined;

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
    if (segment === "claimable") {
      if (taskListScope === "completed") return [];
      return groupScopedClaimableTasks;
    }
    return filteredAllTasks;
  }, [
    filteredAllTasks,
    groupScopedClaimableTasks,
    groupScopedMyTasks,
    segment,
    taskListScope,
  ]);

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
    return activeTasks
      ? buildTaskRows(activeTasks as TaskListItem[])
      : [];
  }, [activeTasks]);

  const claimTask = useAuthenticatedMutation(api.functions.tasks.index.claim);
  const markDone = useAuthenticatedMutation(api.functions.tasks.index.markDone);
  const reopenTask = useAuthenticatedMutation(api.functions.tasks.index.reopen);
  const snoozeTask = useAuthenticatedMutation(api.functions.tasks.index.snooze);
  const cancelTask = useAuthenticatedMutation(api.functions.tasks.index.cancel);
  const assignTask = useAuthenticatedMutation(api.functions.tasks.index.assign);
  const createTask = useAuthenticatedMutation(api.functions.tasks.index.create);
  const createTemplateMutation = useAuthenticatedMutation(
    api.functions.taskTemplates.index.create,
  );
  const updateTemplateMutation = useAuthenticatedMutation(
    api.functions.taskTemplates.index.update,
  );
  const removeTemplateMutation = useAuthenticatedMutation(
    api.functions.taskTemplates.index.remove,
  );
  const createFromTemplateMutation = useAuthenticatedMutation(
    api.functions.tasks.index.createFromTemplate,
  );

  const applyMemberResults = useAuthenticatedQuery(
    api.functions.tasks.index.searchRelevantMembers,
    applyTarget && debouncedApplyMemberSearch.length >= 2
      ? {
          groupId: applyTarget.groupId as Id<"groups">,
          searchText: debouncedApplyMemberSearch,
          limit: 30,
        }
      : "skip",
  ) as GroupMemberSearchResult[] | undefined;

  const applyLeaderResults = useAuthenticatedQuery(
    api.functions.tasks.index.searchAssignableLeaders,
    applyTarget && debouncedApplyAssignSearch.length >= 2
      ? {
          groupId: applyTarget.groupId as Id<"groups">,
          searchText: debouncedApplyAssignSearch,
          limit: 30,
        }
      : "skip",
  ) as LeaderSearchResult[] | undefined;

  const templatesByGroup = useMemo(() => {
    const list = workflowTemplates;
    if (!list?.length) {
      return [] as Array<[string, NonNullable<typeof list>]>;
    }
    if (contextGroupId) {
      const name =
        leaderGroups.find((g) => g._id === contextGroupId)?.name ?? "Group";
      return [[name, list]] as Array<[string, NonNullable<typeof list>]>;
    }
    const map = new Map<string, NonNullable<typeof list>>();
    for (const t of list) {
      const g = (t as { groupName?: string }).groupName ?? "Group";
      const cur = map.get(g) ?? [];
      cur.push(t);
      map.set(g, cur);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [workflowTemplates, contextGroupId, leaderGroups]);

  function openTemplateModalCreate() {
    setTplEditingId(null);
    setTplTitle("");
    setTplDescription("");
    setTplTags("");
    setTplGroupId(contextGroupId ?? leaderGroups[0]?._id ?? null);
    setTplSteps([{ title: "", description: "" }]);
    setTplError(null);
    setTplModalOpen(true);
  }

  function openTemplateModalEdit(template: {
    _id: string;
    title: string;
    description?: string;
    groupId: Id<"groups">;
    steps: Array<{ title: string; description?: string; orderIndex: number }>;
    tags?: string[];
  }) {
    setTplEditingId(template._id);
    setTplTitle(template.title);
    setTplDescription(template.description ?? "");
    setTplTags(template.tags?.join(", ") ?? "");
    setTplGroupId(template.groupId.toString());
    setTplSteps(
      [...template.steps]
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((s) => ({ title: s.title, description: s.description ?? "" })),
    );
    setTplError(null);
    setTplModalOpen(true);
  }

  async function handleSaveTemplate() {
    if (!tplGroupId) {
      setTplError("Select a group");
      return;
    }
    if (!tplTitle.trim()) {
      setTplError("Title is required");
      return;
    }
    const steps = tplSteps
      .map((s, i) => ({
        title: s.title.trim(),
        description: s.description.trim() || undefined,
        orderIndex: i,
      }))
      .filter((s) => s.title.length > 0);
    if (steps.length === 0) {
      setTplError("Add at least one step with a title");
      return;
    }

    const parsedTags = parseTagsInput(tplTags);
    setTplBusy(true);
    setTplError(null);
    try {
      if (tplEditingId) {
        await updateTemplateMutation({
          templateId: tplEditingId as Id<"taskTemplates">,
          title: tplTitle.trim(),
          description: tplDescription.trim() || null,
          steps,
          tags: parsedTags,
        });
        setActionSuccess("Workflow updated");
      } else {
        await createTemplateMutation({
          groupId: tplGroupId as Id<"groups">,
          title: tplTitle.trim(),
          description: tplDescription.trim() || undefined,
          steps,
          tags: parsedTags,
        });
        setActionSuccess("Workflow created");
      }
      setTplModalOpen(false);
    } catch (error) {
      setTplError(
        error instanceof Error ? error.message : "Could not save workflow",
      );
    } finally {
      setTplBusy(false);
    }
  }

  function showTemplateActions(template: {
    _id: string;
    title: string;
    description?: string;
    groupId: Id<"groups">;
    steps: Array<{ title: string; description?: string; orderIndex: number }>;
    isActive: boolean;
  }) {
    Alert.alert(template.title, undefined, [
      {
        text: "Edit",
        onPress: () => openTemplateModalEdit(template),
      },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await removeTemplateMutation({
                templateId: template._id as Id<"taskTemplates">,
              });
              setActionSuccess("Workflow removed");
            } catch (error) {
              setActionError(
                error instanceof Error ? error.message : "Delete failed",
              );
            }
          })();
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  async function handleApplyTemplate() {
    if (!applyTarget || !applyMemberId) {
      setApplyError("Select an associated member");
      return;
    }
    const groupId = applyTarget.groupId;
    setApplyBusy(true);
    setApplyError(null);
    try {
      const parentId = await createFromTemplateMutation({
        templateId: applyTarget.templateId as Id<"taskTemplates">,
        targetMemberId: applyMemberId as Id<"users">,
        assignedToId: applyAssigneeId
          ? (applyAssigneeId as Id<"users">)
          : undefined,
      });
      setApplyTarget(null);
      setActionSuccess("Workflow applied");
      router.push(
        `/(user)/leader-tools/${groupId}/tasks/${parentId.toString()}` as any,
      );
    } catch (error) {
      setApplyError(
        error instanceof Error ? error.message : "Could not apply workflow",
      );
    } finally {
      setApplyBusy(false);
    }
  }

  async function runTaskAction(
    taskId: TaskId,
    action: "claim" | "done" | "snooze" | "cancel" | "assign" | "reopen",
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
      } else if (action === "reopen") {
        await reopenTask({ taskId });
        setActionSuccess("Task reopened");
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

  const renderCompletedFooter = () => {
    if (segment === "claimable") return null;
    return (
      <Pressable
        onPress={() =>
          setTaskListScope((prev) => (prev === "active" ? "completed" : "active"))
        }
        style={styles.showCompletedFooter}
      >
        <Text style={[styles.showCompletedText, { color: colors.link }]}>
          {taskListScope === "completed" ? "Hide completed tasks" : "Show completed tasks"}
        </Text>
      </Pressable>
    );
  };

  const renderTaskCard = ({ item }: { item: TaskRow }) => {
    const task = item.task;
    const taskId = task._id;
    const taskIdKey = taskId.toString();
    const sourceType = (task.sourceType ?? "manual") as TaskSourceType;
    const isBusy = busyTaskId === taskIdKey;
    const showAssignPanel = assigningTaskId === taskIdKey;
    const isCompletedView = taskListScope === "completed";
    const isExpanded = expandedParents.has(taskIdKey);
    const hasSubtasks = task.subtasks && task.subtasks.length > 0;
    const goToDetail = () => {
      if (isDesktopWeb) {
        setDetailTaskId(taskIdKey);
        setDetailGroupId(task.groupId);
        return;
      }
      router.push(`/(user)/leader-tools/${task.groupId}/tasks/${taskIdKey}`);
    };

    const badgeStyle = getSourceBadgeStyle(sourceType, colors, isDark);

    const showOverflowMenu = (e?: any) => {
      if (Platform.OS === "web") {
        if (overflowMenuTaskId === taskIdKey) {
          setOverflowMenuTaskId(null);
          setOverflowMenuPos(null);
          setOverflowMenuMeta(null);
        } else {
          const nativeEvent = e?.nativeEvent;
          setOverflowMenuTaskId(taskIdKey);
          setOverflowMenuPos({
            top: nativeEvent?.pageY ?? 0,
            left: nativeEvent?.pageX ?? 0,
          });
          setOverflowMenuMeta({ taskId, hasAssignee: !!task.assignedToId });
        }
        return;
      }
      const options: Array<{ text: string; style?: "destructive" | "cancel"; onPress?: () => void }> = [];
      if (!isCompletedView) {
        options.push({
          text: "Snooze 1 week",
          onPress: () => runTaskAction(taskId, "snooze"),
        });
        options.push({
          text: "Cancel Task",
          style: "destructive",
          onPress: () => runTaskAction(taskId, "cancel"),
        });
        if (task.assignedToId) {
          options.push({
            text: "Reassign",
            onPress: () =>
              setAssigningTaskId((current) =>
                current === taskIdKey ? null : taskIdKey,
              ),
          });
        } else {
          options.push({
            text: "Assign",
            onPress: () =>
              setAssigningTaskId((current) =>
                current === taskIdKey ? null : taskIdKey,
              ),
          });
        }
      }
      options.push({ text: "Cancel", style: "cancel" });
      Alert.alert(task.title, undefined, options);
    };

    const progressBlock =
      task.subtaskProgress && task.subtaskProgress.total > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isExpanded ? "Collapse subtasks" : "Expand subtasks"}
          onPress={() => {
            toggleParentExpanded(taskIdKey);
          }}
          style={[styles.subtaskProgressBlock, Platform.OS === "web" && { cursor: "pointer" as any }]}
        >
          <View style={styles.progressLabelRow}>
            <Text style={[styles.subtaskProgressLabel, { color: colors.textSecondary }]}>
              {task.subtaskProgress.completed} of {task.subtaskProgress.total} steps
            </Text>
            <Ionicons
              name={isExpanded ? "chevron-up" : "chevron-down"}
              size={14}
              color={colors.textSecondary}
            />
          </View>
          <View style={[styles.subtaskProgressTrack, { backgroundColor: colors.borderLight }]}>
            <View
              style={[
                styles.subtaskProgressFill,
                {
                  backgroundColor: colors.link,
                  width: `${Math.round(
                    (task.subtaskProgress.completed / task.subtaskProgress.total) * 100,
                  )}%`,
                },
              ]}
            />
          </View>
        </Pressable>
      ) : null;

    const inlineSubtasks =
      hasSubtasks && isExpanded ? (
        <View style={[styles.inlineSubtaskList, { borderTopColor: colors.borderLight }]}>
          {task.subtasks!.map((sub: SubtaskItem) => {
            const isDone = sub.status === "done";
            const openSubDetail = () => {
              const subIdStr = sub._id.toString();
              if (isDesktopWeb) {
                setDetailTaskId(subIdStr);
                setDetailGroupId(task.groupId);
              } else {
                router.push(`/(user)/leader-tools/${task.groupId}/tasks/${subIdStr}`);
              }
            };
            return (
              <View key={sub._id} style={styles.inlineSubtaskRow}>
                <Pressable
                  onPress={() => {
                    const subId = sub._id as unknown as Id<"tasks">;
                    if (isDone) {
                      void runTaskAction(subId, "reopen");
                    } else {
                      void runTaskAction(subId, "done");
                    }
                  }}
                  style={styles.inlineSubtaskCheckbox}
                >
                  <Ionicons
                    name={isDone ? "checkbox" : "square-outline"}
                    size={20}
                    color={isDone ? colors.success : colors.textSecondary}
                  />
                </Pressable>
                <Pressable
                  onPress={openSubDetail}
                  style={styles.inlineSubtaskContent}
                >
                  <Text
                    style={[
                      styles.inlineSubtaskTitle,
                      { color: isDone ? colors.textSecondary : colors.text },
                      isDone && styles.inlineSubtaskDone,
                    ]}
                  >
                    {sub.title}
                  </Text>
                  {sub.assignedToName ? (
                    <Text style={[styles.inlineSubtaskAssignee, { color: colors.textSecondary }]}>
                      {sub.assignedToName}
                    </Text>
                  ) : null}
                </Pressable>
                <Pressable onPress={openSubDetail} style={styles.inlineSubtaskOpen}>
                  <Ionicons name="open-outline" size={14} color={colors.textSecondary} />
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null;

    return (
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.borderLight },
        ]}
      >
        <View style={styles.cardHeader}>
          <Pressable onPress={goToDetail} style={styles.cardTitlePressable}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>{task.title}</Text>
          </Pressable>
          <View style={[styles.badge, { backgroundColor: badgeStyle.bg }]}>
            <Text style={[styles.badgeText, { color: badgeStyle.fg }]}>
              {sourceLabels[sourceType] ?? "TASK"}
            </Text>
          </View>
        </View>

        {progressBlock}
        {inlineSubtasks}

        <Pressable onPress={goToDetail}>
          <View style={styles.metaRow}>
            <Ionicons name="people-outline" size={14} color={colors.textSecondary} />
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
              {task.groupName ?? "Group"}
            </Text>
            {task.assignedToName ? (
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                • {task.assignedToName}
              </Text>
            ) : null}
            <Text
              style={[styles.statusText, { color: statusColor(task.status, colors) }]}
            >
              {formatStatus(task.status)}
            </Text>
          </View>

          {!hasSubtasks && task.targetType !== "none" ? (
            <View
              style={[
                styles.targetPill,
                {
                  backgroundColor: isDark
                    ? "rgba(0,122,255,0.15)"
                    : "#E0F2FE",
                },
              ]}
            >
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
                <View
                  key={`${taskIdKey}-${tag}`}
                  style={[
                    styles.tagChip,
                    {
                      backgroundColor: isDark
                        ? "rgba(0,122,255,0.15)"
                        : "#EEF2FF",
                    },
                  ]}
                >
                  <Text style={[styles.tagChipText, { color: colors.link }]}>
                    #{tag}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </Pressable>

        <View style={styles.actionsRow}>
          {isCompletedView && task.status === "done" ? (
            <Pressable
              disabled={isBusy}
              onPress={() => runTaskAction(taskId, "reopen")}
              style={[
                styles.primaryAction,
                { backgroundColor: colors.link },
                isBusy && styles.disabledAction,
              ]}
            >
              <Text style={[styles.primaryActionText, { color: colors.textInverse }]}>
                {isBusy ? "..." : "Reopen"}
              </Text>
            </Pressable>
          ) : (segment === "claimable" || segment === "all") &&
            !task.assignedToId ? (
            <Pressable
              disabled={isBusy}
              onPress={() => runTaskAction(taskId, "claim")}
              style={[
                styles.primaryAction,
                { backgroundColor: colors.link },
                isBusy && styles.disabledAction,
              ]}
            >
              <Text style={[styles.primaryActionText, { color: colors.textInverse }]}>
                {isBusy ? "..." : "Claim"}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              disabled={isBusy}
              onPress={() => runTaskAction(taskId, "done")}
              style={[
                styles.doneButton,
                { backgroundColor: colors.success },
                isBusy && styles.disabledAction,
              ]}
            >
              <Ionicons name="checkmark" size={14} color={colors.textInverse} />
              <Text style={[styles.doneButtonText, { color: colors.textInverse }]}>
                {isBusy ? "..." : "Done"}
              </Text>
            </Pressable>
          )}
          {!isCompletedView ? (
            <Pressable
              disabled={isBusy}
              onPress={(e) => showOverflowMenu(e)}
              style={[
                styles.overflowButton,
                { borderColor: colors.border, backgroundColor: colors.surface },
                isBusy && styles.disabledAction,
              ]}
            >
              <Ionicons name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        {showAssignPanel ? (
          <View style={[styles.assignPanel, { borderTopColor: colors.borderLight }]}>
            <Text style={[styles.assignPanelTitle, { color: colors.textSecondary }]}>
              Assigned to
            </Text>
            <View style={styles.assignButtonsRow}>
              {(assignableLeaders ?? []).map((leader) => (
                <Pressable
                  key={`${taskIdKey}-${leader.userId}`}
                  disabled={isBusy}
                  onPress={() =>
                    runTaskAction(
                      taskId,
                      "assign",
                      leader.userId as Id<"users">,
                    )
                  }
                  style={[
                    styles.assignButton,
                    {
                      borderColor: isDark
                        ? "rgba(0,122,255,0.3)"
                        : "#BFDBFE",
                      backgroundColor: colors.selectedBackground,
                    },
                    isBusy && styles.disabledAction,
                  ]}
                >
                  <Text style={[styles.assignButtonText, { color: colors.link }]}>
                    {leader.name}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                disabled={isBusy}
                onPress={() => runTaskAction(taskId, "assign")}
                style={[
                  styles.assignButton,
                  {
                    borderColor: isDark
                      ? "rgba(0,122,255,0.3)"
                      : "#BFDBFE",
                    backgroundColor: colors.selectedBackground,
                  },
                  isBusy && styles.disabledAction,
                ]}
              >
                <Text style={[styles.assignButtonText, { color: colors.link }]}>
                  Unassign
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
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
              <Text style={[styles.headerTitle, { color: colors.text }]}>
                {mainTab === "workflows" ? "Workflows" : "Tasks"}
              </Text>
              <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
                {mainTab === "workflows"
                  ? "Reusable checklists for your groups"
                  : "All task-related workflows"}
              </Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              style={[styles.createButton, { backgroundColor: colors.link }]}
              onPress={() =>
                mainTab === "workflows" ? openTemplateModalCreate() : setIsCreateOpen(true)
              }
            >
              <Ionicons name="add" size={16} color={colors.textInverse} />
              <Text style={[styles.createButtonText, { color: colors.textInverse }]}>
                {mainTab === "workflows" ? "New" : "Create"}
              </Text>
            </Pressable>
            {mainTab === "tasks" ? (
              <Pressable
                testID="tasks-filter-button"
                style={[styles.headerFilterButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
                onPress={() => setIsFilterModalOpen(true)}
              >
                <Ionicons name="options-outline" size={18} color={colors.textSecondary} />
                {hasActiveFilters ? <View style={[styles.headerFilterDot, { backgroundColor: colors.link }]} /> : null}
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>

      {hasLeaderAccess === true ? (
        <View style={styles.underlineTabRow}>
          <Pressable onPress={() => setMainTab("tasks")} style={styles.underlineTab}>
            <Text
              style={[
                styles.underlineTabText,
                { color: mainTab === "tasks" ? colors.text : colors.textSecondary },
                mainTab === "tasks" && { fontWeight: "700" },
              ]}
            >
              Tasks
            </Text>
            {mainTab === "tasks" ? (
              <View style={[styles.underlineTabIndicator, { backgroundColor: primaryColor }]} />
            ) : null}
          </Pressable>
          <Pressable onPress={() => setMainTab("workflows")} style={styles.underlineTab}>
            <Text
              style={[
                styles.underlineTabText,
                { color: mainTab === "workflows" ? colors.text : colors.textSecondary },
                mainTab === "workflows" && { fontWeight: "700" },
              ]}
            >
              Workflows
            </Text>
            {mainTab === "workflows" ? (
              <View style={[styles.underlineTabIndicator, { backgroundColor: primaryColor }]} />
            ) : null}
          </Pressable>
        </View>
      ) : null}

      {actionError ? <Text style={[styles.errorText, { color: colors.destructive }]}>{actionError}</Text> : null}
      {actionSuccess ? <Text style={[styles.successText, { color: colors.success }]}>{actionSuccess}</Text> : null}

      {mainTab === "tasks" ? (
        <>
          <View style={[styles.segmentRow, { gap: 6, paddingBottom: 6 }]}>
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
              onPress={() => {
                setTaskListScope("active");
                setSegment("claimable");
              }}
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
                {segment === "claimable" && taskListScope === "completed"
                  ? "Claimable tasks are always open. Switch to Open to claim work, or pick My/All Tasks to see completed items."
                  : taskListScope === "completed"
                    ? "No completed tasks match your filters."
                    : segment === "my"
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
                  ListFooterComponent={renderCompletedFooter}
                />
              </View>
              <View style={[styles.desktopDetail, { backgroundColor: colors.surfaceSecondary }]}>
                {detailTaskId && detailGroupId ? (
                  <TaskDetailScreen
                    key={detailTaskId}
                    groupIdProp={detailGroupId}
                    taskIdProp={detailTaskId}
                    embedded
                  />
                ) : (
                  <ScrollView contentContainerStyle={styles.detailContent}>
                    <Text style={[styles.detailTitle, { color: colors.text }]}>Task details</Text>
                    <Text style={[styles.detailBody, { color: colors.text }]}>
                      Click a task to open its detail page, edit it, and review history.
                    </Text>
                  </ScrollView>
                )}
              </View>
            </View>
          ) : (
            <FlatList
              data={taskRows}
              renderItem={renderTaskCard}
              keyExtractor={(row) => row.task._id.toString()}
              contentContainerStyle={styles.listContent}
              ListFooterComponent={renderCompletedFooter}
            />
          )}
        </>
      ) : workflowTemplates === undefined ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading workflows...</Text>
        </View>
      ) : templatesByGroup.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="git-branch-outline" size={48} color={colors.iconSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No workflow templates</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Tap New to create a reusable checklist for your groups.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent}>
          {templatesByGroup.map(([groupName, tmplList]) => (
            <View key={groupName} style={{ marginBottom: 18 }}>
              <Text
                style={[
                  styles.workflowGroupHeading,
                  { color: colors.textSecondary },
                ]}
              >
                {groupName}
              </Text>
              {tmplList.map((t) => (
                <Pressable
                  key={t._id.toString()}
                  onLongPress={() => showTemplateActions(t)}
                  delayLongPress={450}
                  style={[
                    styles.card,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.borderLight,
                      opacity: t.isActive ? 1 : 0.65,
                    },
                  ]}
                >
                  <View style={styles.workflowRowTop}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={[styles.cardTitle, { color: colors.text }]}>{t.title}</Text>
                      {!t.isActive ? (
                        <Text style={[styles.workflowInactiveLabel, { color: colors.warning }]}>
                          Inactive
                        </Text>
                      ) : null}
                    </View>
                    <View style={[styles.workflowStepBadge, { backgroundColor: colors.textSecondary }]}>
                      <Text style={[styles.badgeText, { color: colors.textInverse }]}>
                        {t.steps?.length ?? 0} steps
                      </Text>
                    </View>
                  </View>
                  <View style={styles.workflowCardActions}>
                    <Pressable
                      style={[
                        styles.inlineAction,
                        {
                          borderColor: colors.border,
                          backgroundColor: colors.surface,
                          alignSelf: "flex-start",
                        },
                      ]}
                      onPress={() => openTemplateModalEdit(t)}
                    >
                      <Text style={[styles.inlineActionText, { color: colors.text }]}>Edit</Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.primaryAction,
                        {
                          backgroundColor: colors.link,
                          alignSelf: "flex-start",
                        },
                        !t.isActive && styles.disabledAction,
                      ]}
                      disabled={!t.isActive}
                      onPress={() => {
                        setApplyTarget({
                          templateId: t._id.toString(),
                          groupId: t.groupId.toString(),
                        });
                        setApplyMemberSearch("");
                        setDebouncedApplyMemberSearch("");
                        setApplyMemberId(null);
                      setApplyMemberName(null);
                      setApplyAssignSearch("");
                      setDebouncedApplyAssignSearch("");
                      setApplyAssigneeId(null);
                      setApplyAssigneeName(null);
                      setApplyError(null);
                    }}
                    >
                      <Text style={[styles.primaryActionText, { color: colors.textInverse }]}>
                        Apply to Person
                      </Text>
                    </Pressable>
                  </View>
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
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
                  [
                    "all",
                    "manual",
                    "reach_out",
                    "bot_task_reminder",
                    "followup",
                    "workflow_template",
                  ] as SourceFilter[]
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
            Target defaults to this group. Add someone from the community (they do not need to be in this group yet—useful for pre-join onboarding).
          </Text>

          <Text style={[styles.inputLabel, { color: colors.text }]}>Associated member</Text>
          <TextInput
            value={createRelevantMemberSearch}
            onChangeText={setCreateRelevantMemberSearch}
            placeholder="Search community members"
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

      <Modal
        visible={tplModalOpen}
        animationType="slide"
        onRequestClose={() => setTplModalOpen(false)}
      >
        <ScrollView
          style={[styles.modalContainer, { backgroundColor: colors.modalBackground }]}
          contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }}
        >
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {tplEditingId ? "Edit workflow" : "New workflow"}
            </Text>
            <Pressable onPress={() => setTplModalOpen(false)}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          <Text style={[styles.inputLabel, { color: colors.text }]}>Template name *</Text>
          <TextInput
            value={tplTitle}
            onChangeText={setTplTitle}
            placeholder="Onboarding checklist"
            placeholderTextColor={colors.inputPlaceholder}
            style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
          />

          <Text style={[styles.inputLabel, { color: colors.text }]}>Description (optional)</Text>
          <TextInput
            value={tplDescription}
            onChangeText={setTplDescription}
            placeholder="Shown on the parent task"
            multiline
            placeholderTextColor={colors.inputPlaceholder}
            style={[styles.textInput, styles.multilineInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
          />

          <Text style={[styles.inputLabel, { color: colors.text }]}>Tags (comma separated)</Text>
          <TextInput
            value={tplTags}
            onChangeText={setTplTags}
            placeholder="care, prayer_request"
            placeholderTextColor={colors.inputPlaceholder}
            style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
          />

          <Text style={[styles.inputLabel, { color: colors.text }]}>Group *</Text>
          {tplEditingId ? (
            <View style={[styles.lockedField, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[styles.lockedFieldText, { color: colors.text }]}>
                {leaderGroups.find((g) => g._id === tplGroupId)?.name ?? "Group"}
              </Text>
            </View>
          ) : contextGroupId ? (
            <View style={[styles.lockedField, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[styles.lockedFieldText, { color: colors.text }]}>
                {leaderGroups.find((g) => g._id === contextGroupId)?.name ?? "Current group"}
              </Text>
            </View>
          ) : (
            <View style={styles.chipsWrap}>
              {leaderGroups.map((group) => (
                <Pressable
                  key={group._id}
                  onPress={() => setTplGroupId(group._id)}
                  style={[
                    styles.groupChip,
                    { borderColor: colors.border, backgroundColor: colors.surface },
                    tplGroupId === group._id && {
                      backgroundColor: colors.selectedBackground,
                      borderColor: colors.link,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.groupChipText,
                      { color: colors.text },
                      tplGroupId === group._id && { color: colors.link },
                    ]}
                  >
                    {group.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          <Text style={[styles.inputLabel, { color: colors.text }]}>Steps *</Text>
          {tplSteps.map((step, index) => (
            <View
              key={`step-${index}`}
              style={[styles.templateStepCard, { borderColor: colors.borderLight }]}
            >
              <View style={styles.templateStepHeader}>
                <Text style={{ color: colors.textSecondary, fontWeight: "700" }}>Step {index + 1}</Text>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <Pressable
                    onPress={() =>
                      setTplSteps((prev) => {
                        if (index <= 0) return prev;
                        const next = [...prev];
                        [next[index - 1], next[index]] = [next[index], next[index - 1]];
                        return next;
                      })
                    }
                  >
                    <Ionicons name="arrow-up" size={18} color={colors.link} />
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      setTplSteps((prev) => {
                        if (index >= prev.length - 1) return prev;
                        const next = [...prev];
                        [next[index + 1], next[index]] = [next[index], next[index + 1]];
                        return next;
                      })
                    }
                  >
                    <Ionicons name="arrow-down" size={18} color={colors.link} />
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      setTplSteps((prev) => prev.filter((_, i) => i !== index))
                    }
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.destructive} />
                  </Pressable>
                </View>
              </View>
              <TextInput
                value={step.title}
                onChangeText={(v) =>
                  setTplSteps((prev) =>
                    prev.map((s, i) => (i === index ? { ...s, title: v } : s)),
                  )
                }
                placeholder="Step title"
                placeholderTextColor={colors.inputPlaceholder}
                style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
              />
              <TextInput
                value={step.description}
                onChangeText={(v) =>
                  setTplSteps((prev) =>
                    prev.map((s, i) => (i === index ? { ...s, description: v } : s)),
                  )
                }
                placeholder="Optional description"
                multiline
                placeholderTextColor={colors.inputPlaceholder}
                style={[styles.textInput, styles.multilineInput, { marginTop: 8, borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
              />
            </View>
          ))}
          <Pressable
            onPress={() => setTplSteps((prev) => [...prev, { title: "", description: "" }])}
            style={[styles.inlineAction, { marginTop: 8, borderColor: colors.border, alignSelf: "flex-start" }]}
          >
            <Text style={[styles.inlineActionText, { color: colors.link }]}>+ Add step</Text>
          </Pressable>

          {tplError ? <Text style={[styles.errorText, { color: colors.destructive }]}>{tplError}</Text> : null}

          <View style={styles.modalActions}>
            <Pressable
              onPress={() => setTplModalOpen(false)}
              style={[styles.modalActionButton, styles.cancelButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
            >
              <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={tplBusy}
              onPress={() => void handleSaveTemplate()}
              style={[styles.modalActionButton, styles.saveButton, { backgroundColor: colors.link }]}
            >
              <Text style={[styles.saveButtonText, { color: colors.textInverse }]}>
                {tplBusy ? "Saving..." : "Save"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </Modal>

      <Modal
        visible={applyTarget !== null}
        animationType="slide"
        onRequestClose={() => setApplyTarget(null)}
      >
        <ScrollView
          style={[styles.modalContainer, { backgroundColor: colors.modalBackground }]}
          contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }}
        >
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Apply workflow</Text>
            <Pressable onPress={() => setApplyTarget(null)}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          <Text style={[styles.inputLabel, { color: colors.text }]}>Associated member *</Text>
          <Text style={[styles.searchHelperText, { color: colors.textSecondary, marginBottom: 6 }]}>
            Anyone in this community counts, even if they are not in this group yet.
          </Text>
          <TextInput
            value={applyMemberSearch}
            onChangeText={setApplyMemberSearch}
            placeholder="Search community members"
            placeholderTextColor={colors.inputPlaceholder}
            style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
          />
          {applyMemberId && applyMemberName ? (
            <Pressable
              onPress={() => {
                setApplyMemberId(null);
                setApplyMemberName(null);
              }}
              style={[styles.selectionPill, { borderColor: colors.link, backgroundColor: colors.selectedBackground }]}
            >
              <Text style={[styles.selectionPillText, { color: colors.link }]}>
                {applyMemberName} • Tap to clear
              </Text>
            </Pressable>
          ) : null}
          {applyMemberSearch.trim().length >= 2 ? (
            <ScrollView
              style={[styles.searchResultsList, { borderColor: colors.borderLight, backgroundColor: colors.surface }]}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              {(applyMemberResults ?? []).map((member) => (
                <Pressable
                  key={member.userId}
                  onPress={() => {
                    setApplyMemberId(member.userId);
                    setApplyMemberName(member.name);
                    setApplyMemberSearch("");
                  }}
                  style={[styles.searchResultRow, { borderBottomColor: colors.borderLight }]}
                >
                  <Text style={[styles.searchResultText, { color: colors.text }]}>{member.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Text style={[styles.searchHelperText, { color: colors.textSecondary }]}>
              Type at least 2 characters.
            </Text>
          )}

          <Text style={[styles.inputLabel, { color: colors.text }]}>Assigned to (optional)</Text>
          <TextInput
            value={applyAssignSearch}
            onChangeText={setApplyAssignSearch}
            placeholder="Search group leaders"
            placeholderTextColor={colors.inputPlaceholder}
            style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
          />
          {applyAssigneeId && applyAssigneeName ? (
            <Pressable
              onPress={() => {
                setApplyAssigneeId(null);
                setApplyAssigneeName(null);
              }}
              style={[styles.selectionPill, { borderColor: colors.link, backgroundColor: colors.selectedBackground }]}
            >
              <Text style={[styles.selectionPillText, { color: colors.link }]}>
                {applyAssigneeName} • Tap to clear
              </Text>
            </Pressable>
          ) : null}
          {applyAssignSearch.trim().length >= 2 ? (
            <ScrollView
              style={[styles.searchResultsList, { borderColor: colors.borderLight, backgroundColor: colors.surface }]}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              {(applyLeaderResults ?? []).map((leader) => (
                <Pressable
                  key={leader.userId}
                  onPress={() => {
                    setApplyAssigneeId(leader.userId);
                    setApplyAssigneeName(leader.name);
                    setApplyAssignSearch("");
                  }}
                  style={[styles.searchResultRow, { borderBottomColor: colors.borderLight }]}
                >
                  <Text style={[styles.searchResultText, { color: colors.text }]}>{leader.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {applyError ? <Text style={[styles.errorText, { color: colors.destructive }]}>{applyError}</Text> : null}

          <View style={styles.modalActions}>
            <Pressable
              onPress={() => setApplyTarget(null)}
              style={[styles.modalActionButton, styles.cancelButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
            >
              <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={applyBusy}
              onPress={() => void handleApplyTemplate()}
              style={[styles.modalActionButton, styles.saveButton, { backgroundColor: colors.link }]}
            >
              <Text style={[styles.saveButtonText, { color: colors.textInverse }]}>
                {applyBusy ? "Applying..." : "Apply"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </Modal>

      {/* Fixed-position overflow menu for web (rendered outside FlatList to avoid scroll clipping) */}
      {Platform.OS === "web" && overflowMenuTaskId && overflowMenuPos && overflowMenuMeta ? (
        <>
          <Pressable
            style={styles.webOverflowBackdrop}
            onPress={() => {
              setOverflowMenuTaskId(null);
              setOverflowMenuPos(null);
              setOverflowMenuMeta(null);
            }}
          />
          <View
            style={[
              styles.webOverflowMenu,
              {
                backgroundColor: colors.surface,
                borderColor: colors.borderLight,
                position: "fixed" as any,
                top: overflowMenuPos.top,
                left: overflowMenuPos.left - 180,
              },
            ]}
          >
            <Pressable
              style={styles.webOverflowItem}
              onPress={() => {
                const tid = overflowMenuMeta.taskId;
                setOverflowMenuTaskId(null);
                setOverflowMenuPos(null);
                setOverflowMenuMeta(null);
                void runTaskAction(tid, "snooze");
              }}
            >
              <Ionicons name="time-outline" size={16} color={colors.text} />
              <Text style={[styles.webOverflowText, { color: colors.text }]}>Snooze 1 week</Text>
            </Pressable>
            <Pressable
              style={styles.webOverflowItem}
              onPress={() => {
                const tid = overflowMenuMeta.taskId;
                setOverflowMenuTaskId(null);
                setOverflowMenuPos(null);
                setOverflowMenuMeta(null);
                void runTaskAction(tid, "cancel");
              }}
            >
              <Ionicons name="close-circle-outline" size={16} color={colors.destructive} />
              <Text style={[styles.webOverflowText, { color: colors.destructive }]}>Cancel Task</Text>
            </Pressable>
            <Pressable
              style={styles.webOverflowItem}
              onPress={() => {
                const taskIdKey = overflowMenuMeta.taskId.toString();
                setOverflowMenuTaskId(null);
                setOverflowMenuPos(null);
                setOverflowMenuMeta(null);
                setAssigningTaskId((current) =>
                  current === taskIdKey ? null : taskIdKey,
                );
              }}
            >
              <Ionicons name="person-outline" size={16} color={colors.text} />
              <Text style={[styles.webOverflowText, { color: colors.text }]}>
                {overflowMenuMeta.hasAssignee ? "Reassign" : "Assign"}
              </Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  );

  return content;
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
    paddingVertical: 6,
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
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  cardTitlePressable: {
    flex: 1,
    paddingVertical: 4,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  workflowCardActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "center",
    marginTop: 4,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 9,
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
  subtaskProgressBlock: {
    marginTop: 8,
    paddingVertical: 4,
  },
  subtaskProgressLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  subtaskProgressTrack: {
    marginTop: 4,
    height: 5,
    borderRadius: 3,
    overflow: "hidden",
  },
  subtaskProgressFill: {
    height: "100%",
    borderRadius: 999,
  },
  workflowGroupHeading: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
    marginBottom: 8,
  },
  workflowRowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  workflowInactiveLabel: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: "600",
  },
  workflowStepBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  templateStepCard: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  templateStepHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  underlineTabRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 24,
    marginBottom: 8,
  },
  underlineTab: {
    paddingBottom: 8,
    alignItems: "center",
  },
  underlineTabText: {
    fontSize: 15,
    fontWeight: "500",
  },
  underlineTabIndicator: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 1,
  },
  showCompletedFooter: {
    paddingVertical: 16,
    alignItems: "center",
  },
  showCompletedText: {
    fontSize: 14,
    fontWeight: "600",
  },
  doneButton: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  doneButtonText: {
    fontSize: 12,
    fontWeight: "700",
  },
  overflowButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  progressLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  inlineSubtaskList: {
    marginTop: 8,
    borderTopWidth: 1,
    paddingTop: 8,
    gap: 6,
  },
  inlineSubtaskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
  },
  inlineSubtaskCheckbox: {
    padding: 2,
  },
  inlineSubtaskContent: {
    flex: 1,
  },
  inlineSubtaskOpen: {
    padding: 4,
    opacity: 0.5,
  },
  inlineSubtaskTitle: {
    fontSize: 13,
    fontWeight: "500",
  },
  inlineSubtaskDone: {
    textDecorationLine: "line-through",
    opacity: 0.6,
  },
  inlineSubtaskAssignee: {
    fontSize: 11,
    marginTop: 2,
  },
  webOverflowBackdrop: {
    ...(Platform.OS === "web"
      ? ({ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 } as any)
      : {}),
  },
  webOverflowMenu: {
    minWidth: 180,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 4,
    zIndex: 1000,
    ...Platform.select({
      web: {
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
      },
      default: {
        elevation: 8,
      },
    }),
  },
  webOverflowItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  webOverflowText: {
    fontSize: 14,
    fontWeight: "500",
  },
});
