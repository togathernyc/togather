import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { parseTagsInput } from "./taskHelpers";
import { useTheme } from "@hooks/useTheme";
import type { ThemeColors } from "@/theme/colors";

type TaskDetail = {
  _id: Id<"tasks">;
  groupId: Id<"groups">;
  groupName?: string;
  title: string;
  description?: string;
  status: string;
  tags?: string[];
  assignedToId?: Id<"users">;
  assignedToName?: string;
  targetType: "none" | "member" | "group";
  targetMemberId?: Id<"users">;
  targetMemberName?: string;
  parentTaskId?: Id<"tasks">;
  parentTaskTitle?: string;
  createdByName?: string;
  createdAt: number;
  updatedAt: number;
};

type HistoryEvent = {
  _id: string;
  type: string;
  createdAt: number;
  performedByName?: string;
  payload?: unknown;
};

type SearchResult = {
  userId: string;
  name: string;
};

function formatDateTime(timestamp?: number) {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString();
}

function statusColor(status: string, colors: ThemeColors): string {
  if (status === "done") return colors.success;
  if (status === "snoozed") return colors.warning;
  if (status === "canceled") return colors.destructive;
  return colors.link;
}

function eventLabel(type: string): string {
  if (type === "created") return "Created";
  if (type === "assigned") return "Assigned";
  if (type === "claimed") return "Claimed";
  if (type === "done") return "Marked done";
  if (type === "snoozed") return "Snoozed";
  if (type === "canceled") return "Canceled";
  if (type === "updated") return "Updated";
  return type;
}

export function TaskDetailScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ group_id?: string; task_id?: string }>();
  const groupId =
    typeof params.group_id === "string" ? (params.group_id as Id<"groups">) : null;
  const taskId =
    typeof params.task_id === "string" ? (params.task_id as Id<"tasks">) : null;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { primaryColor } = useCommunityTheme();

  const task = useAuthenticatedQuery(
    api.functions.tasks.index.getDetail,
    taskId ? { taskId } : "skip",
  ) as TaskDetail | undefined;

  const history = useAuthenticatedQuery(
    api.functions.tasks.index.listHistory,
    taskId ? { taskId } : "skip",
  ) as HistoryEvent[] | undefined;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [relevantMemberId, setRelevantMemberId] = useState<string | null>(null);
  const [relevantMemberName, setRelevantMemberName] = useState<string | null>(null);
  const [relevantSearch, setRelevantSearch] = useState("");
  const [debouncedRelevantSearch, setDebouncedRelevantSearch] = useState("");
  const [assignedToId, setAssignedToId] = useState<string | null>(null);
  const [assignedToName, setAssignedToName] = useState<string | null>(null);
  const [assignedSearch, setAssignedSearch] = useState("");
  const [debouncedAssignedSearch, setDebouncedAssignedSearch] = useState("");
  const [parentTaskId, setParentTaskId] = useState<string | null>(null);
  const [parentTaskSearch, setParentTaskSearch] = useState("");
  const [debouncedParentTaskSearch, setDebouncedParentTaskSearch] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState<null | "done" | "snooze" | "cancel">(
    null,
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedRelevantSearch(relevantSearch.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [relevantSearch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedAssignedSearch(assignedSearch.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [assignedSearch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedParentTaskSearch(parentTaskSearch.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [parentTaskSearch]);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description ?? "");
    setTagsInput((task.tags ?? []).join(", "));
    setRelevantMemberId(task.targetType === "member" ? task.targetMemberId?.toString() ?? null : null);
    setRelevantMemberName(task.targetType === "member" ? task.targetMemberName ?? null : null);
    setAssignedToId(task.assignedToId?.toString() ?? null);
    setAssignedToName(task.assignedToName ?? null);
    setParentTaskId(task.parentTaskId?.toString() ?? null);
  }, [task?._id, task]);

  const relevantMemberResults = useAuthenticatedQuery(
    api.functions.tasks.index.searchRelevantMembers,
    groupId && debouncedRelevantSearch.length >= 2
      ? { groupId, searchText: debouncedRelevantSearch, limit: 30 }
      : "skip",
  ) as SearchResult[] | undefined;

  const assigneeResults = useAuthenticatedQuery(
    api.functions.tasks.index.searchAssignableLeaders,
    groupId && debouncedAssignedSearch.length >= 2
      ? { groupId, searchText: debouncedAssignedSearch, limit: 30 }
      : "skip",
  ) as SearchResult[] | undefined;

  const parentTaskResults = useAuthenticatedQuery(
    api.functions.tasks.index.listGroup,
    groupId
      ? {
          groupId,
          searchText: debouncedParentTaskSearch || undefined,
        }
      : "skip",
  ) as Array<{ _id: Id<"tasks">; title: string; parentTaskId?: Id<"tasks"> }> | undefined;

  const parentTaskOptions = useMemo(
    () =>
      (parentTaskResults ?? []).filter(
        (candidate) =>
          !candidate.parentTaskId && candidate._id.toString() !== taskId?.toString(),
      ),
    [parentTaskResults, taskId],
  );

  const updateTask = useAuthenticatedMutation(api.functions.tasks.index.update);
  const assignTask = useAuthenticatedMutation(api.functions.tasks.index.assign);
  const markDone = useAuthenticatedMutation(api.functions.tasks.index.markDone);
  const snoozeTask = useAuthenticatedMutation(api.functions.tasks.index.snooze);
  const cancelTask = useAuthenticatedMutation(api.functions.tasks.index.cancel);

  const originalAssigneeId = task?.assignedToId?.toString() ?? null;

  async function handleSave() {
    if (!taskId) return;
    if (!title.trim()) {
      setSaveError("Title is required");
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      await updateTask({
        taskId,
        title,
        description: description.trim() || null,
        tags: parseTagsInput(tagsInput),
        relevantMemberId: relevantMemberId
          ? (relevantMemberId as Id<"users">)
          : null,
        parentTaskId: parentTaskId ? (parentTaskId as Id<"tasks">) : null,
      });

      if (assignedToId !== originalAssigneeId) {
        if (assignedToId) {
          await assignTask({
            taskId,
            assigneeId: assignedToId as Id<"users">,
          });
        } else {
          await assignTask({ taskId });
        }
      }

      setSaveSuccess("Task updated");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to update task");
    } finally {
      setSaving(false);
    }
  }

  async function runStatusAction(action: "done" | "snooze" | "cancel") {
    if (!taskId) return;
    setStatusBusy(action);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      if (action === "done") {
        await markDone({ taskId });
        setSaveSuccess("Task marked done");
      } else if (action === "snooze") {
        await snoozeTask({ taskId, preset: "1_week" });
        setSaveSuccess("Task snoozed for 1 week");
      } else {
        await cancelTask({ taskId });
        setSaveSuccess("Task canceled");
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to update status");
    } finally {
      setStatusBusy(null);
    }
  }

  if (!taskId || !groupId) {
    return (
      <UserRoute>
        <View style={[styles.centered, { backgroundColor: colors.surface }]}>
          <Text style={[styles.errorText, { color: colors.error }]}>Missing task route params.</Text>
        </View>
      </UserRoute>
    );
  }

  if (!task) {
    return (
      <UserRoute>
        <View style={[styles.centered, { backgroundColor: colors.surface }]}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading task details...</Text>
        </View>
      </UserRoute>
    );
  }

  return (
    <UserRoute>
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: colors.borderLight }]}>
          <Pressable
            style={styles.backButton}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
                return;
              }
              router.push(`/(user)/leader-tools/${groupId}/tasks`);
            }}
          >
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Task details</Text>
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
              Edit fields and review full history
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: `${statusColor(task.status, colors)}20` }]}>
            <Text style={[styles.statusBadgeText, { color: statusColor(task.status, colors) }]}>
              {task.status.toUpperCase()}
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: insets.bottom + 28,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.metaCard, { borderColor: colors.borderLight, backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[styles.metaRow, { color: colors.text }]}>Group: {task.groupName ?? "Group"}</Text>
            <Text style={[styles.metaRow, { color: colors.text }]}>
              Created by: {task.createdByName ?? "System"}
            </Text>
            <Text style={[styles.metaRow, { color: colors.text }]}>Created: {formatDateTime(task.createdAt)}</Text>
            <Text style={[styles.metaRow, { color: colors.text }]}>Updated: {formatDateTime(task.updatedAt)}</Text>
          </View>

          <Text style={[styles.inputLabel, { color: colors.text }]}>Title *</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
            placeholderTextColor={colors.inputPlaceholder}
          />

          <Text style={[styles.inputLabel, { color: colors.text }]}>Description</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            style={[styles.textInput, styles.multilineInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
            multiline
            placeholder="Optional details"
            placeholderTextColor={colors.inputPlaceholder}
          />

          <Text style={[styles.inputLabel, { color: colors.text }]}>Tags (comma separated)</Text>
          <TextInput
            value={tagsInput}
            onChangeText={setTagsInput}
            style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
            placeholder="care, prayer_request"
            placeholderTextColor={colors.inputPlaceholder}
          />

          <Text style={[styles.helperText, { color: colors.textSecondary }]}>
            Target defaults to group. Add a relevant member only when needed.
          </Text>
          <Text style={[styles.inputLabel, { color: colors.text }]}>Relevant member</Text>
          <TextInput
            value={relevantSearch}
            onChangeText={setRelevantSearch}
            style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
            placeholder="Search members (server search)"
            placeholderTextColor={colors.inputPlaceholder}
          />
          {relevantMemberId && relevantMemberName ? (
            <Pressable
              onPress={() => {
                setRelevantMemberId(null);
                setRelevantMemberName(null);
              }}
              style={[styles.selectionPill, { borderColor: colors.link, backgroundColor: colors.selectedBackground }]}
            >
              <Text style={[styles.selectionPillText, { color: colors.link }]}>
                {relevantMemberName} • Tap to clear
              </Text>
            </Pressable>
          ) : null}
          {relevantSearch.trim().length >= 2 ? (
            <ScrollView style={[styles.searchResultsList, { borderColor: colors.borderLight, backgroundColor: colors.surface }]} nestedScrollEnabled>
              {(relevantMemberResults ?? []).map((member) => (
                <Pressable
                  key={member.userId}
                  onPress={() => {
                    setRelevantMemberId(member.userId);
                    setRelevantMemberName(member.name);
                    setRelevantSearch("");
                  }}
                  style={[styles.searchResultRow, { borderBottomColor: colors.borderLight }]}
                >
                  <Text style={[styles.searchResultText, { color: colors.text }]}>{member.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <Text style={[styles.inputLabel, { color: colors.text }]}>Assigned to</Text>
          <TextInput
            value={assignedSearch}
            onChangeText={setAssignedSearch}
            style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
            placeholder="Search leaders (server search)"
            placeholderTextColor={colors.inputPlaceholder}
          />
          {assignedToId && assignedToName ? (
            <Pressable
              onPress={() => {
                setAssignedToId(null);
                setAssignedToName(null);
              }}
              style={[styles.selectionPill, { borderColor: colors.link, backgroundColor: colors.selectedBackground }]}
            >
              <Text style={[styles.selectionPillText, { color: colors.link }]}>
                {assignedToName} • Tap to clear
              </Text>
            </Pressable>
          ) : (
            <Text style={[styles.helperText, { color: colors.textSecondary }]}>Leave empty for group responsibility.</Text>
          )}
          {assignedSearch.trim().length >= 2 ? (
            <ScrollView style={[styles.searchResultsList, { borderColor: colors.borderLight, backgroundColor: colors.surface }]} nestedScrollEnabled>
              {(assigneeResults ?? []).map((leader) => (
                <Pressable
                  key={leader.userId}
                  onPress={() => {
                    setAssignedToId(leader.userId);
                    setAssignedToName(leader.name);
                    setAssignedSearch("");
                  }}
                  style={[styles.searchResultRow, { borderBottomColor: colors.borderLight }]}
                >
                  <Text style={[styles.searchResultText, { color: colors.text }]}>{leader.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          <Text style={[styles.inputLabel, { color: colors.text }]}>Parent task</Text>
          <TextInput
            value={parentTaskSearch}
            onChangeText={setParentTaskSearch}
            style={[styles.textInput, { borderColor: colors.inputBorder, color: colors.text, backgroundColor: colors.inputBackground }]}
            placeholder="Search tasks (server search)"
            placeholderTextColor={colors.inputPlaceholder}
          />
          <ScrollView style={[styles.searchResultsList, { borderColor: colors.borderLight, backgroundColor: colors.surface }]} nestedScrollEnabled>
            <Pressable
              onPress={() => setParentTaskId(null)}
              style={[
                styles.searchResultRow,
                { borderBottomColor: colors.borderLight },
                parentTaskId === null && { backgroundColor: colors.selectedBackground },
              ]}
            >
              <Text style={[styles.searchResultText, { color: colors.text }]}>None</Text>
            </Pressable>
            {parentTaskOptions.map((candidate) => (
              <Pressable
                key={candidate._id}
                onPress={() => setParentTaskId(candidate._id.toString())}
                style={[
                  styles.searchResultRow,
                  { borderBottomColor: colors.borderLight },
                  parentTaskId === candidate._id.toString() && { backgroundColor: colors.selectedBackground },
                ]}
              >
                <Text style={[styles.searchResultText, { color: colors.text }]}>{candidate.title}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {saveError ? <Text style={[styles.errorText, { color: colors.error }]}>{saveError}</Text> : null}
          {saveSuccess ? <Text style={[styles.successText, { color: colors.success }]}>{saveSuccess}</Text> : null}

          {(task.status === "open" || task.status === "snoozed") ? (
            <View style={styles.quickActionsRow}>
              <Pressable
                style={[styles.quickAction, { borderColor: colors.border, backgroundColor: colors.surface }]}
                onPress={() => runStatusAction("done")}
                disabled={statusBusy !== null}
              >
                <Text style={[styles.quickActionText, { color: colors.text }]}>
                  {statusBusy === "done" ? "..." : "Done"}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.quickAction, { borderColor: colors.border, backgroundColor: colors.surface }]}
                onPress={() => runStatusAction("snooze")}
                disabled={statusBusy !== null}
              >
                <Text style={[styles.quickActionText, { color: colors.text }]}>
                  {statusBusy === "snooze" ? "..." : "Snooze 1w"}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.quickAction, { borderColor: colors.border, backgroundColor: colors.surface }]}
                onPress={() => runStatusAction("cancel")}
                disabled={statusBusy !== null}
              >
                <Text style={[styles.quickActionText, { color: colors.destructive }]}>
                  {statusBusy === "cancel" ? "..." : "Cancel"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          <Pressable
            style={[styles.saveButton, { backgroundColor: colors.buttonPrimary }, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={[styles.saveButtonText, { color: colors.buttonPrimaryText }]}>{saving ? "Saving..." : "Save changes"}</Text>
          </Pressable>

          <Text style={[styles.sectionTitle, { color: colors.text }]}>History</Text>
          <View style={[styles.historyCard, { borderColor: colors.borderLight, backgroundColor: colors.surface }]}>
            {(history ?? []).map((event) => (
              <View key={event._id} style={[styles.historyRow, { borderBottomColor: colors.borderLight }]}>
                <Text style={[styles.historyTitle, { color: colors.text }]}>{eventLabel(event.type)}</Text>
                <Text style={[styles.historySubtitle, { color: colors.textSecondary }]}>
                  {event.performedByName ?? "System"} • {formatDateTime(event.createdAt)}
                </Text>
              </View>
            ))}
            {history !== undefined && history.length === 0 ? (
              <Text style={[styles.helperText, { color: colors.textSecondary }]}>No history yet.</Text>
            ) : null}
          </View>
        </ScrollView>
      </View>
    </UserRoute>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  loadingText: {
    marginTop: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    borderRadius: 999,
    padding: 4,
  },
  headerCopy: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 12,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  metaCard: {
    marginTop: 16,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  metaRow: {
    fontSize: 12,
  },
  inputLabel: {
    marginTop: 12,
    marginBottom: 6,
    fontSize: 13,
    fontWeight: "700",
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
  helperText: {
    marginTop: 8,
    fontSize: 12,
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
  quickActionsRow: {
    marginTop: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  quickAction: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  quickActionText: {
    fontSize: 12,
    fontWeight: "600",
  },
  saveButton: {
    marginTop: 16,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonText: {
    fontWeight: "700",
  },
  errorText: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: "600",
  },
  successText: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: "600",
  },
  sectionTitle: {
    marginTop: 20,
    marginBottom: 8,
    fontSize: 16,
    fontWeight: "700",
  },
  historyCard: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  historyRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  historyTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  historySubtitle: {
    marginTop: 2,
    fontSize: 12,
  },
});
