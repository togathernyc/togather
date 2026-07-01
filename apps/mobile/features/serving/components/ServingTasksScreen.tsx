/**
 * ServingTasksScreen
 *
 * The "Tasks" tab of serving mode. Shows the current user's serving tasks for
 * the active plan (`useEventModeStore().activePlanId`), grouped into three
 * segments — Before / During / After. Each segment has its own ProgressBar
 * reflecting the user's completion of that segment's tasks.
 *
 * Two kinds of tasks are merged per segment (the `getMyServingTasks` query
 * returns an `isPersonal` flag):
 *   - Template (assigned) tasks — toggled via `toggleTaskCompletion`.
 *   - Personal (ad-hoc) tasks the user added — toggled via `togglePersonalTask`,
 *     and editable / deletable. These carry an "added by you" marker.
 *
 * Tapping a task expands its detail: the "How-To" guidance, rendered from
 * `howToDoc` (markdown) / `howToText` / `howToUrl` / media per `howToType`.
 *
 * A "＋ Add task" affordance opens a small inline form (title + optional note +
 * segment; a time label when adding under During) that calls `addPersonalTask`.
 */
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Linking,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthenticatedQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { ProgressBar } from "@components/ui/ProgressBar";
import { Markdown } from "@components/ui/Markdown";
import { useEventModeStore } from "@/stores/eventModeStore";

type Segment = "before" | "during" | "after";

const SEGMENTS: Array<{ key: Segment; label: string }> = [
  { key: "before", label: "Before" },
  { key: "during", label: "During" },
  { key: "after", label: "After" },
];

/** How-to guidance kind (mirrors the backend `howToType` validator). */
type HowToType = "none" | "text" | "link" | "media" | "doc";

/**
 * A serving task row. Shape follows `getMyServingTasks` + the eventTasks /
 * personalServingTasks schemas. `isPersonal` distinguishes the two sources so
 * the correct toggle mutation (and edit/delete affordances) can be used.
 */
type ServingTask = {
  taskId: string;
  title: string;
  segment: Segment;
  isPersonal: boolean;
  completed: boolean;
  timeLabel?: string | null;
  // Personal-only
  note?: string | null;
  // Template-only how-to guidance
  howToType?: HowToType;
  howToText?: string | null;
  howToUrl?: string | null;
  howToMediaPath?: string | null;
  howToDoc?: string | null;
};

type MyServingTasks = {
  before: ServingTask[];
  during: ServingTask[];
  after: ServingTask[];
};

/** Show a one-button error (Alert.alert is a no-op on web in this codebase). */
function notify(title: string, message: string) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

export function ServingTasksScreen() {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();
  const activePlanId = useEventModeStore((s) => s.activePlanId);
  const planId = activePlanId as Id<"eventPlans"> | null;

  const tasks = useAuthenticatedQuery(
    api.functions.scheduling.eventTasks.getMyServingTasks,
    planId ? { planId } : "skip",
  ) as MyServingTasks | undefined;

  const toggleTaskCompletion = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.toggleTaskCompletion,
  );
  const togglePersonalTask = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.togglePersonalTask,
  );
  const addPersonalTask = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.addPersonalTask,
  );
  const updatePersonalTask = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.updatePersonalTask,
  );
  const deletePersonalTask = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.deletePersonalTask,
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Which segment's inline add-form is open (null = none).
  const [addingSegment, setAddingSegment] = useState<Segment | null>(null);
  // The personal task currently being edited (null = none).
  const [editingId, setEditingId] = useState<string | null>(null);

  const toggle = useCallback(
    async (task: ServingTask) => {
      if (!planId) return;
      try {
        if (task.isPersonal) {
          await togglePersonalTask({
            taskId: task.taskId as Id<"personalServingTasks">,
            completed: !task.completed,
          });
        } else {
          await toggleTaskCompletion({
            taskId: task.taskId as Id<"eventTasks">,
            timeLabel: task.timeLabel ?? undefined,
            completed: !task.completed,
          });
        }
      } catch (err) {
        notify("Couldn't update task", String((err as Error)?.message ?? err));
      }
    },
    [planId, togglePersonalTask, toggleTaskCompletion],
  );

  const remove = useCallback(
    async (taskId: string) => {
      try {
        await deletePersonalTask({
          taskId: taskId as Id<"personalServingTasks">,
        });
      } catch (err) {
        notify("Couldn't delete task", String((err as Error)?.message ?? err));
      }
    },
    [deletePersonalTask],
  );

  if (!planId) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="list-outline" size={28} color={colors.textTertiary} />
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          Not currently serving on an event.
        </Text>
      </View>
    );
  }

  if (tasks === undefined) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="small" color={colors.text} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{
        paddingTop: insets.top + 12,
        paddingBottom: insets.bottom + 32,
      }}
    >
      <Text style={[styles.screenTitle, { color: colors.text }]}>My tasks</Text>

      {SEGMENTS.map(({ key, label }) => {
        const segmentTasks = tasks[key] ?? [];
        const done = segmentTasks.filter((t) => t.completed).length;
        const total = segmentTasks.length;
        const progress = total > 0 ? done / total : 0;

        return (
          <View key={key} style={styles.segment}>
            <View style={styles.segmentHeader}>
              <Text style={[styles.segmentTitle, { color: colors.text }]}>
                {label}
              </Text>
              <Text
                style={[styles.segmentCount, { color: colors.textSecondary }]}
              >
                {done}/{total}
              </Text>
            </View>
            <ProgressBar progress={progress} color={primaryColor} />

            <View style={styles.taskList}>
              {segmentTasks.map((task) => (
                <TaskRow
                  key={task.taskId}
                  task={task}
                  colors={colors}
                  primaryColor={primaryColor}
                  expanded={expandedId === task.taskId}
                  editing={editingId === task.taskId}
                  onToggle={() => toggle(task)}
                  onPress={() =>
                    setExpandedId((cur) =>
                      cur === task.taskId ? null : task.taskId,
                    )
                  }
                  onEdit={() => setEditingId(task.taskId)}
                  onCancelEdit={() => setEditingId(null)}
                  onSaveEdit={async (patch) => {
                    try {
                      await updatePersonalTask({
                        taskId: task.taskId as Id<"personalServingTasks">,
                        ...patch,
                      });
                      setEditingId(null);
                    } catch (err) {
                      notify(
                        "Couldn't save task",
                        String((err as Error)?.message ?? err),
                      );
                    }
                  }}
                  onDelete={() => remove(task.taskId)}
                />
              ))}
            </View>

            {addingSegment === key ? (
              <AddTaskForm
                segment={key}
                colors={colors}
                primaryColor={primaryColor}
                onCancel={() => setAddingSegment(null)}
                onSubmit={async ({ title, note, timeLabel }) => {
                  if (!planId) return;
                  try {
                    await addPersonalTask({
                      planId,
                      segment: key,
                      title,
                      note: note || undefined,
                      timeLabel: timeLabel || undefined,
                    });
                    setAddingSegment(null);
                  } catch (err) {
                    notify(
                      "Couldn't add task",
                      String((err as Error)?.message ?? err),
                    );
                  }
                }}
              />
            ) : (
              <Pressable
                onPress={() => setAddingSegment(key)}
                style={styles.addButton}
                accessibilityRole="button"
                accessibilityLabel={`Add a ${label} task`}
              >
                <Ionicons name="add" size={18} color={primaryColor} />
                <Text style={[styles.addButtonText, { color: primaryColor }]}>
                  Add task
                </Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

// ============================================================================
// Task row
// ============================================================================

type ThemeColors = ReturnType<typeof useTheme>["colors"];

interface TaskRowProps {
  task: ServingTask;
  colors: ThemeColors;
  primaryColor: string;
  expanded: boolean;
  editing: boolean;
  onToggle: () => void;
  onPress: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (patch: { title?: string; note?: string }) => void;
  onDelete: () => void;
}

function TaskRow({
  task,
  colors,
  primaryColor,
  expanded,
  editing,
  onToggle,
  onPress,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: TaskRowProps) {
  const [editTitle, setEditTitle] = useState(task.title);
  const [editNote, setEditNote] = useState(task.note ?? "");

  return (
    <View style={[styles.taskRow, { borderColor: colors.border }]}>
      <View style={styles.taskRowMain}>
        <Pressable
          onPress={onToggle}
          hitSlop={8}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: task.completed }}
          accessibilityLabel={task.title}
        >
          <Ionicons
            name={task.completed ? "checkbox" : "square-outline"}
            size={24}
            color={task.completed ? primaryColor : colors.textTertiary}
          />
        </Pressable>

        <Pressable style={styles.taskTitleWrap} onPress={onPress}>
          <Text
            style={[
              styles.taskTitle,
              { color: colors.text },
              task.completed && styles.taskTitleDone,
            ]}
          >
            {task.title}
          </Text>
          <View style={styles.taskMetaRow}>
            {task.timeLabel ? (
              <Text style={[styles.taskMeta, { color: colors.textSecondary }]}>
                {task.timeLabel}
              </Text>
            ) : null}
            {task.isPersonal ? (
              <Text style={[styles.taskMeta, { color: colors.textTertiary }]}>
                Added by you
              </Text>
            ) : null}
          </View>
        </Pressable>
      </View>

      {expanded ? (
        <View style={styles.taskDetail}>
          {editing && task.isPersonal ? (
            <View style={styles.editForm}>
              <TextInput
                value={editTitle}
                onChangeText={setEditTitle}
                placeholder="Task title"
                placeholderTextColor={colors.textTertiary}
                style={[
                  styles.input,
                  { color: colors.text, borderColor: colors.border },
                ]}
              />
              <TextInput
                value={editNote}
                onChangeText={setEditNote}
                placeholder="Note (optional)"
                placeholderTextColor={colors.textTertiary}
                multiline
                style={[
                  styles.input,
                  styles.inputMultiline,
                  { color: colors.text, borderColor: colors.border },
                ]}
              />
              <View style={styles.editActions}>
                <Pressable onPress={onCancelEdit} style={styles.textButton}>
                  <Text style={{ color: colors.textSecondary }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    onSaveEdit({
                      title: editTitle.trim() || task.title,
                      note: editNote.trim(),
                    })
                  }
                  style={styles.textButton}
                >
                  <Text style={{ color: primaryColor, fontWeight: "600" }}>
                    Save
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              <HowTo task={task} colors={colors} primaryColor={primaryColor} />
              {task.isPersonal ? (
                <View style={styles.personalActions}>
                  <Pressable onPress={onEdit} style={styles.textButton}>
                    <Text style={{ color: primaryColor }}>Edit</Text>
                  </Pressable>
                  <Pressable onPress={onDelete} style={styles.textButton}>
                    <Text style={{ color: colors.error ?? "#c00" }}>Delete</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

// ============================================================================
// How-To detail
// ============================================================================

function HowTo({
  task,
  colors,
  primaryColor,
}: {
  task: ServingTask;
  colors: ThemeColors;
  primaryColor: string;
}) {
  const howToType = task.howToType ?? "none";

  if (task.isPersonal) {
    return task.note ? (
      <Text style={[styles.howToText, { color: colors.textSecondary }]}>
        {task.note}
      </Text>
    ) : (
      <Text style={[styles.howToEmpty, { color: colors.textTertiary }]}>
        No note.
      </Text>
    );
  }

  switch (howToType) {
    case "doc":
      return task.howToDoc ? (
        <View style={styles.markdownWrap}>
          <Markdown source={task.howToDoc} />
        </View>
      ) : (
        <Text style={[styles.howToEmpty, { color: colors.textTertiary }]}>
          No details.
        </Text>
      );
    case "text":
      return (
        <Text style={[styles.howToText, { color: colors.textSecondary }]}>
          {task.howToText ?? ""}
        </Text>
      );
    case "link":
      return task.howToUrl ? (
        <Pressable onPress={() => Linking.openURL(task.howToUrl as string)}>
          <Text style={[styles.howToLink, { color: primaryColor }]}>
            {task.howToUrl}
          </Text>
        </Pressable>
      ) : (
        <Text style={[styles.howToEmpty, { color: colors.textTertiary }]}>
          No link.
        </Text>
      );
    case "media":
      return task.howToUrl ? (
        <Pressable onPress={() => Linking.openURL(task.howToUrl as string)}>
          <Text style={[styles.howToLink, { color: primaryColor }]}>
            Open attachment
          </Text>
        </Pressable>
      ) : (
        <Text style={[styles.howToEmpty, { color: colors.textTertiary }]}>
          No attachment.
        </Text>
      );
    case "none":
    default:
      return (
        <Text style={[styles.howToEmpty, { color: colors.textTertiary }]}>
          No details.
        </Text>
      );
  }
}

// ============================================================================
// Add-task form
// ============================================================================

interface AddTaskFormProps {
  segment: Segment;
  colors: ThemeColors;
  primaryColor: string;
  onCancel: () => void;
  onSubmit: (values: {
    title: string;
    note: string;
    timeLabel: string;
  }) => void;
}

function AddTaskForm({
  segment,
  colors,
  primaryColor,
  onCancel,
  onSubmit,
}: AddTaskFormProps) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [timeLabel, setTimeLabel] = useState("");

  const canSubmit = title.trim().length > 0;

  return (
    <View style={[styles.addForm, { borderColor: colors.border }]}>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Task title"
        placeholderTextColor={colors.textTertiary}
        autoFocus
        style={[
          styles.input,
          { color: colors.text, borderColor: colors.border },
        ]}
      />
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Note (optional)"
        placeholderTextColor={colors.textTertiary}
        multiline
        style={[
          styles.input,
          styles.inputMultiline,
          { color: colors.text, borderColor: colors.border },
        ]}
      />
      {/* A time label only applies to "during" tasks (per service time). */}
      {segment === "during" ? (
        <TextInput
          value={timeLabel}
          onChangeText={setTimeLabel}
          placeholder="Time (e.g. 9:00 AM service)"
          placeholderTextColor={colors.textTertiary}
          style={[
            styles.input,
            { color: colors.text, borderColor: colors.border },
          ]}
        />
      ) : null}
      <View style={styles.editActions}>
        <Pressable onPress={onCancel} style={styles.textButton}>
          <Text style={{ color: colors.textSecondary }}>Cancel</Text>
        </Pressable>
        <Pressable
          disabled={!canSubmit}
          onPress={() =>
            onSubmit({ title: title.trim(), note: note.trim(), timeLabel: timeLabel.trim() })
          }
          style={styles.textButton}
        >
          <Text
            style={{
              color: canSubmit ? primaryColor : colors.textTertiary,
              fontWeight: "600",
            }}
          >
            Add
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 8,
  },
  emptyText: { fontSize: 15, textAlign: "center" },
  screenTitle: {
    fontSize: 28,
    fontWeight: "700",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  segment: { paddingHorizontal: 16, marginBottom: 24 },
  segmentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  segmentTitle: { fontSize: 17, fontWeight: "600" },
  segmentCount: { fontSize: 13 },
  taskList: { marginTop: 8 },
  taskRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  taskRowMain: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  taskTitleWrap: { flex: 1 },
  taskTitle: { fontSize: 15, lineHeight: 20 },
  taskTitleDone: { textDecorationLine: "line-through", opacity: 0.6 },
  taskMetaRow: { flexDirection: "row", gap: 8, marginTop: 2 },
  taskMeta: { fontSize: 12 },
  taskDetail: { paddingLeft: 36, paddingTop: 8 },
  howToText: { fontSize: 14, lineHeight: 20 },
  howToLink: { fontSize: 14, textDecorationLine: "underline" },
  howToEmpty: { fontSize: 13, fontStyle: "italic" },
  markdownWrap: { marginTop: 2 },
  personalActions: { flexDirection: "row", gap: 16, marginTop: 10 },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 10,
    marginTop: 4,
  },
  addButtonText: { fontSize: 15, fontWeight: "500" },
  addForm: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    gap: 8,
  },
  editForm: { gap: 8 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
  },
  inputMultiline: { minHeight: 60, textAlignVertical: "top" },
  editActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 16,
  },
  textButton: { paddingVertical: 6, paddingHorizontal: 4 },
});
