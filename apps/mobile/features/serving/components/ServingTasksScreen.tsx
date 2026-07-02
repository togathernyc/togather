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
 * How-To guidance: short `text` guidance renders inline (quiet secondary text);
 * heavier kinds (`link` / `media` / `doc`) show a compact "How-To →" chip that
 * opens the full-screen read-only `HowToViewer`. Personal tasks show their note
 * inline and expand (on tap) to Edit / Delete affordances.
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
  Alert,
  Platform,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthenticatedQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { ProgressBar } from "@components/ui/ProgressBar";
import { useEventModeStore } from "@/stores/eventModeStore";
import { ServingPlanSwitcher } from "./ServingPlanSwitcher";
import { HowToViewer, type HowToViewerContent } from "./HowToViewer";

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
  /** Unique per row (a "during" task expands to one row per service time). */
  key: string;
  /** Real task id, passed to completion mutations. */
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

  // Header context (event title + when). Reuses the already-cheap serving
  // eligibility query — no extra fetch specific to this screen.
  const eligibility = useAuthenticatedQuery(
    api.functions.scheduling.serving.getServingEligibility,
    planId ? {} : "skip",
  ) as { plans: Array<{ planId: string; title: string; startsAt: number }> } | null | undefined;
  const activePlan = eligibility?.plans.find((p) => p.planId === planId) ?? null;

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
  // The how-to guidance currently open in the full-screen viewer (null = none).
  const [viewerContent, setViewerContent] = useState<HowToViewerContent | null>(null);

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

  // Overall readiness across every segment.
  const allTasks = tasks
    ? [...tasks.before, ...tasks.during, ...tasks.after]
    : [];
  const overallDone = allTasks.filter((t) => t.completed).length;
  const overallTotal = allTasks.length;

  return (
    <>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 40,
        }}
      >
        <ServingPlanSwitcher />

        <ServingHeader
          title={activePlan?.title ?? "My tasks"}
          startsAt={activePlan?.startsAt}
          done={overallDone}
          total={overallTotal}
          loading={tasks === undefined}
          colors={colors}
          primaryColor={primaryColor}
        />

        {tasks === undefined ? (
          <View style={styles.inlineLoading}>
            <ActivityIndicator size="small" color={colors.text} />
          </View>
        ) : (
          SEGMENTS.map(({ key, label }) => {
            const segmentTasks = tasks[key] ?? [];
            const done = segmentTasks.filter((t) => t.completed).length;
            const total = segmentTasks.length;
            const progress = total > 0 ? done / total : 0;

            return (
              <View key={key} style={styles.segment}>
                <View style={styles.segmentHeader}>
                  <Text style={[styles.segmentTitle, { color: colors.textSecondary }]}>
                    {label.toUpperCase()}
                  </Text>
                  <Text
                    style={[styles.segmentCount, { color: colors.textTertiary }]}
                  >
                    {done}/{total}
                  </Text>
                </View>
                <ProgressBar
                  progress={progress}
                  color={primaryColor}
                  height={4}
                />

                <View
                  style={[
                    styles.card,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                >
                  {segmentTasks.length === 0 ? (
                    <Text
                      style={[styles.cardEmpty, { color: colors.textTertiary }]}
                    >
                      Nothing here yet.
                    </Text>
                  ) : (
                    segmentTasks.map((task, i) => (
                      <TaskRow
                        key={task.key}
                        task={task}
                        first={i === 0}
                        colors={colors}
                        primaryColor={primaryColor}
                        expanded={expandedId === task.key}
                        editing={editingId === task.key}
                        onToggle={() => toggle(task)}
                        onOpenHowTo={() =>
                          setViewerContent({
                            taskId: task.taskId,
                            title: task.title,
                            howToType: task.howToType ?? "none",
                            howToUrl: task.howToUrl,
                            howToMediaPath: task.howToMediaPath,
                            howToDoc: task.howToDoc,
                          })
                        }
                        onToggleExpand={() =>
                          setExpandedId((cur) =>
                            cur === task.key ? null : task.key,
                          )
                        }
                        onEdit={() => setEditingId(task.key)}
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
                    ))
                  )}
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
                    <Ionicons name="add" size={17} color={primaryColor} />
                    <Text style={[styles.addButtonText, { color: primaryColor }]}>
                      Add my own task
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      <HowToViewer
        visible={viewerContent !== null}
        content={viewerContent}
        onClose={() => setViewerContent(null)}
      />
    </>
  );
}

// ============================================================================
// Header
// ============================================================================

/** Format a plan start timestamp as e.g. "Sun, Jul 6 · 9:00 AM". */
function formatWhen(startsAt: number): string {
  const d = new Date(startsAt);
  const day = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} · ${time}`;
}

function ServingHeader({
  title,
  startsAt,
  done,
  total,
  loading,
  colors,
  primaryColor,
}: {
  title: string;
  startsAt?: number;
  done: number;
  total: number;
  loading: boolean;
  colors: ThemeColors;
  primaryColor: string;
}) {
  const allDone = total > 0 && done === total;
  return (
    <View style={styles.header}>
      <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={2}>
        {title}
      </Text>
      {startsAt ? (
        <Text style={[styles.headerWhen, { color: colors.textSecondary }]}>
          {formatWhen(startsAt)}
        </Text>
      ) : null}

      {!loading && total > 0 ? (
        <View style={styles.readiness}>
          <View style={styles.readinessLabelRow}>
            <Text style={[styles.readinessLabel, { color: colors.textSecondary }]}>
              {allDone ? "You're all set" : "Your readiness"}
            </Text>
            <Text style={[styles.readinessCount, { color: colors.text }]}>
              {done} of {total}
            </Text>
          </View>
          <ProgressBar progress={done / total} color={primaryColor} height={8} />
        </View>
      ) : null}
    </View>
  );
}

// ============================================================================
// Task row
// ============================================================================

type ThemeColors = ReturnType<typeof useTheme>["colors"];

interface TaskRowProps {
  task: ServingTask;
  first: boolean;
  colors: ThemeColors;
  primaryColor: string;
  expanded: boolean;
  editing: boolean;
  onToggle: () => void;
  onOpenHowTo: () => void;
  onToggleExpand: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (patch: { title?: string; note?: string }) => void;
  onDelete: () => void;
}

/** How-to kinds that open the full-screen viewer rather than rendering inline. */
const VIEWER_HOW_TO_ICONS: Record<
  "link" | "media" | "doc",
  keyof typeof Ionicons.glyphMap
> = {
  link: "link-outline",
  media: "image-outline",
  doc: "document-text-outline",
};

function TaskRow({
  task,
  first,
  colors,
  primaryColor,
  expanded,
  editing,
  onToggle,
  onOpenHowTo,
  onToggleExpand,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: TaskRowProps) {
  const [editTitle, setEditTitle] = useState(task.title);
  const [editNote, setEditNote] = useState(task.note ?? "");

  const howToType = task.howToType ?? "none";
  // Short text guidance renders inline; personal notes render inline too.
  const inlineText = task.isPersonal
    ? task.note
    : howToType === "text"
      ? task.howToText
      : null;
  // link / media / doc open the viewer via a compact affordance.
  const viewerType =
    !task.isPersonal && (howToType === "link" || howToType === "media" || howToType === "doc")
      ? howToType
      : null;

  return (
    <View
      style={[
        styles.taskRow,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
      ]}
    >
      <View style={styles.taskRowMain}>
        <Pressable
          onPress={onToggle}
          hitSlop={10}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: task.completed }}
          accessibilityLabel={task.title}
          style={styles.checkboxPress}
        >
          <View
            style={[
              styles.checkbox,
              task.completed
                ? { backgroundColor: primaryColor, borderColor: primaryColor }
                : { borderColor: colors.textTertiary },
            ]}
          >
            {task.completed ? (
              <Ionicons name="checkmark" size={15} color="#fff" />
            ) : null}
          </View>
        </Pressable>

        <Pressable
          style={styles.taskBody}
          onPress={task.isPersonal ? onToggleExpand : undefined}
          disabled={!task.isPersonal}
        >
          <Text
            style={[
              styles.taskTitle,
              { color: colors.text },
              task.completed && styles.taskTitleDone,
            ]}
          >
            {task.title}
          </Text>

          {task.isPersonal ? (
            <View style={styles.taskMetaRow}>
              <Text style={[styles.taskMeta, { color: colors.textTertiary }]}>
                Added by you
              </Text>
            </View>
          ) : null}

          {inlineText ? (
            <Text
              style={[
                styles.inlineHowTo,
                { color: colors.textSecondary },
                task.completed && styles.inlineHowToDone,
              ]}
              numberOfLines={2}
            >
              {inlineText}
            </Text>
          ) : null}
        </Pressable>

        {/* How-To sits on the same line as the title (row-level, right side).
            `link` opens the URL directly; `media`/`doc` open the viewer. */}
        {viewerType ? (
          <Pressable
            onPress={() => {
              if (howToType === "link" && task.howToUrl) {
                void Linking.openURL(task.howToUrl).catch(() => {});
              } else {
                onOpenHowTo();
              }
            }}
            hitSlop={6}
            style={[styles.howToChip, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel={
              howToType === "link"
                ? `Open link for ${task.title}`
                : `Open how-to for ${task.title}`
            }
          >
            <Ionicons
              name={VIEWER_HOW_TO_ICONS[viewerType]}
              size={13}
              color={primaryColor}
            />
            <Text style={[styles.howToChipText, { color: primaryColor }]}>
              How-To
            </Text>
            <Ionicons
              name={howToType === "link" ? "open-outline" : "arrow-forward"}
              size={13}
              color={primaryColor}
            />
          </Pressable>
        ) : null}
      </View>

      {expanded && task.isPersonal ? (
        <View style={styles.taskDetail}>
          {editing ? (
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
            <View style={styles.personalActions}>
              <Pressable onPress={onEdit} style={styles.textButton}>
                <Text style={{ color: primaryColor }}>Edit</Text>
              </Pressable>
              <Pressable onPress={onDelete} style={styles.textButton}>
                <Text style={{ color: colors.error ?? "#c00" }}>Delete</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
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
  inlineLoading: { paddingVertical: 48, alignItems: "center" },

  // Header
  header: { paddingHorizontal: 16, marginBottom: 20 },
  headerTitle: { fontSize: 26, fontWeight: "700", letterSpacing: -0.4 },
  headerWhen: { fontSize: 14, marginTop: 4 },
  readiness: { marginTop: 16, gap: 8 },
  readinessLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  readinessLabel: { fontSize: 13, fontWeight: "500" },
  readinessCount: { fontSize: 13, fontWeight: "700" },

  // Segments
  segment: { paddingHorizontal: 16, marginBottom: 24 },
  segmentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  segmentTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.8 },
  segmentCount: { fontSize: 12, fontWeight: "600" },
  card: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  cardEmpty: { fontSize: 14, fontStyle: "italic", padding: 16 },

  // Task rows
  taskRow: { paddingHorizontal: 14, paddingVertical: 12 },
  taskRowMain: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  checkboxPress: { paddingTop: 1 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  taskBody: { flex: 1 },
  taskTitle: { fontSize: 15, lineHeight: 20, fontWeight: "500" },
  taskTitleDone: { textDecorationLine: "line-through", opacity: 0.5 },
  taskMetaRow: { flexDirection: "row", gap: 8, marginTop: 3 },
  taskMeta: { fontSize: 12 },
  inlineHowTo: { fontSize: 13, lineHeight: 18, marginTop: 6 },
  inlineHowToDone: { opacity: 0.5 },
  howToChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    flexShrink: 0,
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  howToChipText: { fontSize: 12, fontWeight: "600" },
  taskDetail: { paddingLeft: 34, paddingTop: 10 },
  personalActions: { flexDirection: "row", gap: 16 },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 10,
    marginTop: 6,
  },
  addButtonText: { fontSize: 14, fontWeight: "600" },
  addForm: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
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
